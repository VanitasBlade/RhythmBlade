package com.musicplayerapp.mediastore

import android.Manifest
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.ArrayDeque
import java.io.File
import java.util.Collections
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class MediaStoreLibraryModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {
  companion object {
    private const val MODULE_NAME = "MediaStoreLibraryModule"
    private const val EVENT_CHANGED = "mediaStoreChanged"
    private const val DATA_COLUMN = "_data"
    private val SUPPORTED_AUDIO_EXTENSIONS = setOf(
      "mp3",
      "flac",
      "aac",
      "m4a",
      "wav",
      "ogg",
      "opus",
      "aiff",
      "wma",
    )
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var observer: ContentObserver? = null
  private var observerRegistered = false

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName(): String = MODULE_NAME

  private fun hasReadPermission(): Boolean {
    val permission = if (Build.VERSION.SDK_INT >= 33) {
      Manifest.permission.READ_MEDIA_AUDIO
    } else {
      Manifest.permission.READ_EXTERNAL_STORAGE
    }
    return ContextCompat.checkSelfPermission(
      reactApplicationContext,
      permission,
    ) == PackageManager.PERMISSION_GRANTED
  }

  private fun emitChangedEvent(uri: String? = null) {
    val payload = Arguments.createMap().apply {
      putDouble("timestamp", System.currentTimeMillis().toDouble())
      if (!uri.isNullOrBlank()) {
        putString("uri", uri)
      }
    }
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_CHANGED, payload)
  }

  private fun createPermissionDeniedResult(): WritableMap =
    Arguments.createMap().apply {
      putArray("rows", Arguments.createArray())
      putInt("total", 0)
      putDouble("queriedAt", System.currentTimeMillis().toDouble())
      putBoolean("permissionDenied", true)
    }

  private fun projectionColumns(): Array<String> = arrayOf(
    MediaStore.Audio.Media._ID,
    MediaStore.Audio.Media.TITLE,
    MediaStore.Audio.Media.ARTIST,
    MediaStore.Audio.Media.ALBUM,
    MediaStore.Audio.Media.DURATION,
    MediaStore.Audio.Media.DATE_ADDED,
    MediaStore.Audio.Media.DATE_MODIFIED,
    MediaStore.Audio.Media.SIZE,
    MediaStore.Audio.Media.MIME_TYPE,
    MediaStore.Audio.Media.ALBUM_ID,
    MediaStore.Audio.Media.DISPLAY_NAME,
    MediaStore.Audio.Media.RELATIVE_PATH,
    DATA_COLUMN,
  )

  private fun cursorString(cursor: android.database.Cursor, name: String): String {
    val index = cursor.getColumnIndex(name)
    if (index < 0 || cursor.isNull(index)) {
      return ""
    }
    return cursor.getString(index) ?: ""
  }

  private fun cursorLong(cursor: android.database.Cursor, name: String): Long {
    val index = cursor.getColumnIndex(name)
    if (index < 0 || cursor.isNull(index)) {
      return 0L
    }
    return cursor.getLong(index)
  }

  private fun cursorDouble(cursor: android.database.Cursor, name: String): Double {
    val index = cursor.getColumnIndex(name)
    if (index < 0 || cursor.isNull(index)) {
      return 0.0
    }
    return cursor.getDouble(index)
  }

  private fun mapCursorRow(cursor: android.database.Cursor): WritableMap {
    val mediaStoreId = cursorLong(cursor, MediaStore.Audio.Media._ID)
    val contentUri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
      .buildUpon()
      .appendPath(mediaStoreId.toString())
      .build()
      .toString()
    val durationMs = cursorDouble(cursor, MediaStore.Audio.Media.DURATION)
    val durationSec = if (durationMs <= 0.0) 0.0 else durationMs / 1000.0
    val dateAddedSec = cursorLong(cursor, MediaStore.Audio.Media.DATE_ADDED)
    val dateModifiedSec = cursorLong(cursor, MediaStore.Audio.Media.DATE_MODIFIED)
    val albumId = cursorLong(cursor, MediaStore.Audio.Media.ALBUM_ID)
    val absolutePath = cursorString(cursor, DATA_COLUMN)
    val relativePath = cursorString(cursor, MediaStore.Audio.Media.RELATIVE_PATH)

    return Arguments.createMap().apply {
      putString("id", mediaStoreId.toString())
      putString("mediaStoreId", mediaStoreId.toString())
      putString("contentUri", contentUri)
      putString("title", cursorString(cursor, MediaStore.Audio.Media.TITLE))
      putString("artist", cursorString(cursor, MediaStore.Audio.Media.ARTIST))
      putString("album", cursorString(cursor, MediaStore.Audio.Media.ALBUM))
      putDouble("durationSec", durationSec)
      putDouble("dateAddedSec", dateAddedSec.toDouble())
      putDouble("dateModifiedSec", dateModifiedSec.toDouble())
      putDouble("dateAddedMs", dateAddedSec.toDouble() * 1000.0)
      putDouble("dateModifiedMs", dateModifiedSec.toDouble() * 1000.0)
      putDouble("size", cursorLong(cursor, MediaStore.Audio.Media.SIZE).toDouble())
      putString("mimeType", cursorString(cursor, MediaStore.Audio.Media.MIME_TYPE))
      putDouble("albumId", albumId.toDouble())
      putString("displayName", cursorString(cursor, MediaStore.Audio.Media.DISPLAY_NAME))
      putString("relativePath", relativePath)
      putString("absolutePath", absolutePath)
      if (albumId > 0L) {
        putString("albumArtUri", "content://media/external/audio/albumart/$albumId")
      } else {
        putNull("albumArtUri")
      }
    }
  }

  private fun normalizePath(path: String?): String {
    return (path ?: "")
      .replace('\\', '/')
      .trim()
      .lowercase(Locale.US)
  }

  private fun resolveStablePath(file: File): String {
    return try {
      file.canonicalPath
    } catch (_: Throwable) {
      file.absolutePath
    }
  }

  private fun isSupportedAudioFile(file: File): Boolean {
    if (!file.isFile) {
      return false
    }
    val ext = file.name
      .substringAfterLast('.', "")
      .lowercase(Locale.US)
    return ext.isNotEmpty() && SUPPORTED_AUDIO_EXTENSIONS.contains(ext)
  }

  private fun discoverAudioFilesInDirectory(root: File): List<String> {
    if (!root.exists() || !root.isDirectory) {
      return emptyList()
    }

    val discovered = mutableListOf<String>()
    val seen = mutableSetOf<String>()
    val stack = ArrayDeque<File>()
    stack.add(root)

    while (stack.isNotEmpty()) {
      val current = stack.removeLast()
      val children = current.listFiles() ?: continue
      children.forEach { child ->
        if (child.isDirectory) {
          stack.add(child)
          return@forEach
        }
        if (!isSupportedAudioFile(child)) {
          return@forEach
        }
        val stablePath = resolveStablePath(child)
        val normalizedStablePath = normalizePath(stablePath)
        if (normalizedStablePath.isNotEmpty() && seen.add(normalizedStablePath)) {
          discovered.add(stablePath)
        }
      }
    }

    return discovered
  }

  private fun queryRows(options: ReadableMap?): WritableArray {
    val rows = Arguments.createArray()
    val minDateModifiedSec = when {
      options?.hasKey("minDateModifiedSec") == true ->
        options.getDouble("minDateModifiedSec").toLong()
      options?.hasKey("minDateModifiedMs") == true ->
        (options.getDouble("minDateModifiedMs") / 1000.0).toLong()
      else -> 0L
    }
    val selectionParts = mutableListOf("${MediaStore.Audio.Media.IS_MUSIC} != 0")
    val selectionArgs = mutableListOf<String>()
    if (minDateModifiedSec > 0L) {
      selectionParts.add("${MediaStore.Audio.Media.DATE_MODIFIED} >= ?")
      selectionArgs.add(minDateModifiedSec.toString())
    }

    val cursor = reactApplicationContext.contentResolver.query(
      MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
      projectionColumns(),
      selectionParts.joinToString(" AND "),
      if (selectionArgs.isEmpty()) null else selectionArgs.toTypedArray(),
      "${MediaStore.Audio.Media.DATE_MODIFIED} DESC",
    )

    cursor?.use { safeCursor ->
      while (safeCursor.moveToNext()) {
        rows.pushMap(mapCursorRow(safeCursor))
      }
    }
    return rows
  }

  @ReactMethod
  fun isSupported(promise: Promise) {
    promise.resolve(true)
  }

  @ReactMethod
  fun queryAudioSnapshot(options: ReadableMap?, promise: Promise) {
    if (!hasReadPermission()) {
      promise.resolve(createPermissionDeniedResult())
      return
    }

    Thread {
      try {
        val rows = queryRows(options)
        val payload = Arguments.createMap().apply {
          putArray("rows", rows)
          putInt("total", rows.size())
          putDouble("queriedAt", System.currentTimeMillis().toDouble())
          putBoolean("permissionDenied", false)
        }
        promise.resolve(payload)
      } catch (error: Throwable) {
        promise.reject("MEDIASTORE_QUERY_FAILED", error)
      }
    }.start()
  }

  @ReactMethod
  fun queryByPath(path: String?, promise: Promise) {
    if (!hasReadPermission()) {
      promise.resolve(null)
      return
    }

    val normalizedPath = (path ?: "").trim()
    if (normalizedPath.isEmpty()) {
      promise.resolve(null)
      return
    }

    Thread {
      try {
        val projection = projectionColumns()
        val resolver = reactApplicationContext.contentResolver
        val exactCursor = resolver.query(
          MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
          projection,
          "$DATA_COLUMN = ?",
          arrayOf(normalizedPath),
          "${MediaStore.Audio.Media.DATE_MODIFIED} DESC",
        )
        exactCursor?.use { cursor ->
          if (cursor.moveToFirst()) {
            promise.resolve(mapCursorRow(cursor))
            return@Thread
          }
        }

        val filename = File(normalizedPath).name
        if (filename.isEmpty()) {
          promise.resolve(null)
          return@Thread
        }
        val fallbackCursor = resolver.query(
          MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
          projection,
          "${MediaStore.Audio.Media.DISPLAY_NAME} = ?",
          arrayOf(filename),
          "${MediaStore.Audio.Media.DATE_MODIFIED} DESC",
        )
        fallbackCursor?.use { cursor ->
          while (cursor.moveToNext()) {
            val mapped = mapCursorRow(cursor)
            val candidatePath = mapped.getString("absolutePath") ?: ""
            if (candidatePath == normalizedPath) {
              promise.resolve(mapped)
              return@Thread
            }
          }
        }
        promise.resolve(null)
      } catch (error: Throwable) {
        promise.reject("MEDIASTORE_QUERY_BY_PATH_FAILED", error)
      }
    }.start()
  }

  @ReactMethod
  fun scanPaths(paths: ReadableArray?, promise: Promise) {
    val requested = paths?.size() ?: 0
    val acceptedPaths = mutableListOf<String>()
    for (index in 0 until requested) {
      val candidate = paths?.getString(index)?.trim() ?: ""
      if (candidate.isNotEmpty()) {
        acceptedPaths.add(candidate)
      }
    }

    if (acceptedPaths.isEmpty()) {
      val payload = Arguments.createMap().apply {
        putInt("requested", requested)
        putInt("accepted", 0)
        putInt("discoveredFiles", 0)
        putInt("scannedFiles", 0)
        putInt("failedFiles", 0)
        putArray("results", Arguments.createArray())
      }
      promise.resolve(payload)
      return
    }

    Thread {
      val statusByPath = Collections.synchronizedMap(mutableMapOf<String, String>())
      val discoveredByPath = Collections.synchronizedMap(mutableMapOf<String, Int>())
      val scannedByPath = Collections.synchronizedMap(mutableMapOf<String, Int>())
      val failedByPath = Collections.synchronizedMap(mutableMapOf<String, Int>())
      val errorByPath = Collections.synchronizedMap(mutableMapOf<String, String>())
      val firstScannedPathByPath = Collections.synchronizedMap(mutableMapOf<String, String>())
      val firstUriByPath = Collections.synchronizedMap(mutableMapOf<String, String>())
      val ownersByFilePath = Collections.synchronizedMap(
        mutableMapOf<String, MutableSet<String>>(),
      )
      val filesToScan = mutableSetOf<String>()

      fun markPathFailed(path: String, reason: String) {
        statusByPath[path] = "failed"
        if (!errorByPath.containsKey(path)) {
          errorByPath[path] = reason
        }
      }

      fun registerDiscoveredFile(pathOwner: String, rawFilePath: String) {
        val normalizedFilePath = normalizePath(rawFilePath)
        if (normalizedFilePath.isEmpty()) {
          return
        }
        filesToScan.add(rawFilePath)
        synchronized(ownersByFilePath) {
          val owners = ownersByFilePath[normalizedFilePath] ?: mutableSetOf()
          owners.add(pathOwner)
          ownersByFilePath[normalizedFilePath] = owners
        }
      }

      acceptedPaths.forEach { path ->
        statusByPath[path] = "queued"
        discoveredByPath[path] = 0
        scannedByPath[path] = 0
        failedByPath[path] = 0

        val target = File(path)
        if (!target.exists()) {
          markPathFailed(path, "path-not-found")
          return@forEach
        }

        if (target.isFile) {
          if (!isSupportedAudioFile(target)) {
            markPathFailed(path, "unsupported-file-type")
            return@forEach
          }
          val resolvedPath = resolveStablePath(target)
          discoveredByPath[path] = 1
          registerDiscoveredFile(path, resolvedPath)
          return@forEach
        }

        if (!target.isDirectory) {
          markPathFailed(path, "invalid-path-type")
          return@forEach
        }

        val discovered = discoverAudioFilesInDirectory(target)
        discoveredByPath[path] = discovered.size
        if (discovered.isEmpty()) {
          statusByPath[path] = "scanned"
          return@forEach
        }
        discovered.forEach { filePath ->
          registerDiscoveredFile(path, filePath)
        }
      }

      fun resolvePayload() {
        val output = Arguments.createArray()
        var discoveredFilesTotal = 0
        var scannedFilesTotal = 0
        var failedFilesTotal = 0

        acceptedPaths.forEach { inputPath ->
          val discoveredCount = discoveredByPath[inputPath] ?: 0
          val scannedCount = scannedByPath[inputPath] ?: 0
          val failedCount = failedByPath[inputPath] ?: 0
          discoveredFilesTotal += discoveredCount
          scannedFilesTotal += scannedCount
          failedFilesTotal += failedCount

          val currentStatus = statusByPath[inputPath] ?: "queued"
          val finalStatus = when {
            currentStatus == "failed" -> "failed"
            discoveredCount > 0 && scannedCount == 0 -> "failed"
            else -> "scanned"
          }

          output.pushMap(
            Arguments.createMap().apply {
              putString("path", inputPath)
              putString("status", finalStatus)
              putInt("discoveredFiles", discoveredCount)
              putInt("scannedFiles", scannedCount)
              putInt("failedFiles", failedCount)
              firstScannedPathByPath[inputPath]?.let { putString("scannedPath", it) }
              firstUriByPath[inputPath]?.let { putString("uri", it) }
              errorByPath[inputPath]?.let { putString("error", it) }
            },
          )
        }

        val payload = Arguments.createMap().apply {
          putInt("requested", requested)
          putInt("accepted", acceptedPaths.size)
          putInt("discoveredFiles", discoveredFilesTotal)
          putInt("scannedFiles", scannedFilesTotal)
          putInt("failedFiles", failedFilesTotal)
          putArray("results", output)
        }
        promise.resolve(payload)
      }

      if (filesToScan.isEmpty()) {
        resolvePayload()
        return@Thread
      }

      val normalizedScanList = filesToScan.toTypedArray()
      val remaining = AtomicInteger(normalizedScanList.size)
      val resolved = AtomicBoolean(false)

      try {
        MediaScannerConnection.scanFile(
          reactApplicationContext,
          normalizedScanList,
          null,
        ) { scannedPath, uri ->
          val normalizedScannedPath = normalizePath(scannedPath)
          val owners = synchronized(ownersByFilePath) {
            ownersByFilePath[normalizedScannedPath]?.toList() ?: emptyList()
          }
          val callbackPath = scannedPath?.trim().orEmpty()
          val callbackUri = uri?.toString().orEmpty()

          owners.forEach { ownerPath ->
            if (uri != null) {
              synchronized(scannedByPath) {
                scannedByPath[ownerPath] = (scannedByPath[ownerPath] ?: 0) + 1
              }
              statusByPath[ownerPath] = "scanned"
              if (!firstScannedPathByPath.containsKey(ownerPath) && callbackPath.isNotEmpty()) {
                firstScannedPathByPath[ownerPath] = callbackPath
              }
              if (!firstUriByPath.containsKey(ownerPath) && callbackUri.isNotEmpty()) {
                firstUriByPath[ownerPath] = callbackUri
              }
            } else {
              synchronized(failedByPath) {
                failedByPath[ownerPath] = (failedByPath[ownerPath] ?: 0) + 1
              }
              if (!errorByPath.containsKey(ownerPath)) {
                errorByPath[ownerPath] = "media-scanner-null-uri"
              }
            }
          }

          if (remaining.decrementAndGet() == 0 && resolved.compareAndSet(false, true)) {
            acceptedPaths.forEach { path ->
              val currentStatus = statusByPath[path] ?: "queued"
              if (currentStatus == "failed") {
                return@forEach
              }
              val discoveredCount = discoveredByPath[path] ?: 0
              val scannedCount = scannedByPath[path] ?: 0
              statusByPath[path] = if (discoveredCount > 0 && scannedCount == 0) {
                "failed"
              } else {
                "scanned"
              }
            }
            resolvePayload()
          }
        }
      } catch (error: Throwable) {
        acceptedPaths.forEach { path ->
          markPathFailed(path, error.message ?: "scan-failed")
        }
        if (resolved.compareAndSet(false, true)) {
          resolvePayload()
        }
      }
    }.start()
  }

  @ReactMethod
  fun startObserver() {
    if (observerRegistered) {
      return
    }
    val nextObserver = object : ContentObserver(mainHandler) {
      override fun onChange(selfChange: Boolean) {
        super.onChange(selfChange)
        emitChangedEvent()
      }

      override fun onChange(selfChange: Boolean, uri: android.net.Uri?) {
        super.onChange(selfChange, uri)
        emitChangedEvent(uri?.toString())
      }
    }

    reactApplicationContext.contentResolver.registerContentObserver(
      MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
      true,
      nextObserver,
    )
    observer = nextObserver
    observerRegistered = true
  }

  @ReactMethod
  fun stopObserver() {
    val current = observer ?: return
    if (!observerRegistered) {
      return
    }
    try {
      reactApplicationContext.contentResolver.unregisterContentObserver(current)
    } catch (_: Throwable) {
      // Ignore.
    }
    observerRegistered = false
    observer = null
  }

  override fun onHostResume() {
    // no-op
  }

  override fun onHostPause() {
    // no-op
  }

  override fun onHostDestroy() {
    stopObserver()
  }
}
