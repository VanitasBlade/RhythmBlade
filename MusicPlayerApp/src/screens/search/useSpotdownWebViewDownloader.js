import {useCallback, useEffect, useMemo, useRef} from 'react';
import RNFS from 'react-native-fs';

import {
  canExtractEmbeddedArtwork,
  extractEmbeddedArtworkDataUri,
} from '../../services/artwork/ArtworkService';
import storageService from '../../services/storage/StorageService';
import {
  sanitizeFileSegment,
  toFileUriFromPath,
} from '../../services/storage/storage.helpers';
import {
  ACTIVE_QUEUE_STATUSES,
  DEFAULT_DOWNLOAD_SETTING,
  normalizeDownloadSetting,
} from './search.constants';

const SPOTDOWN_WEB_URL = 'https://spotdown.org';
const SPOTDOWN_DOWNLOAD_API_PATH = '/api/download';
const SPOTDOWN_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const ACTIVE_STATUSES = ACTIVE_QUEUE_STATUSES;
const MAX_STORED_JOBS = 220;
const MAX_CONCURRENT_DOWNLOADS = 3;
const INTER_JOB_DELAY_MS = 500;
const DOWNLOAD_EVENT_TIMEOUT_MS = 150000;
const TOKEN_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_READY_TIMEOUT_MS = 25000;
const RESULT_TIMEOUT_MS = 30000;
const MIN_VALID_AUDIO_FILE_BYTES = 48 * 1024;
const CANCELLED_ERROR = '__SPOTDOWN_CANCELLED__';
const BRIDGE_RECOVERY_DEBOUNCE_MS = 1500;

const SPOTDOWN_BRIDGE_SCRIPT = [
  '(function(){',
  'if(window.__spotdownBridgeInstalled){',
  'try{if(typeof window.__spotdownBridgePost==="function"){window.__spotdownBridgePost("SPOTDOWN_BRIDGE_READY",{href:window.location.href,repeated:true});}else if(window.ReactNativeWebView&&typeof window.ReactNativeWebView.postMessage==="function"){window.ReactNativeWebView.postMessage(JSON.stringify({type:"SPOTDOWN_BRIDGE_READY",href:window.location.href,repeated:true}));}}catch(_){}',
  'true;return;}',
  'window.__spotdownBridgeInstalled=true;',
  'var DOWNLOAD_API_PATH="/api/download";',
  'var TOKEN_API_PATH="/api/get-session-token";',
  'var SEARCH_INPUT_SELECTOR="#search-form-input";',
  'var SEARCH_BUTTON_SELECTOR="#search-form__button";',
  'var SONG_SELECTOR=".song-list .song";',
  'var STEP_ONE_SELECTOR=".button-container button, .button-container a, button.get-link, a.get-link";',
  'var STEP_TWO_SELECTOR=".download-now, .button-container .download-now, a.download-now, button.download-now";',
  'var pendingDownloadQueue=[];',
  'var latestSearchRequestId=null;',
  'var resultsEmitTimer=null;',
  'var sessionTokenCache=null;',
  'var hasPendingJob=function(jobId){if(!jobId){return false;}return pendingDownloadQueue.some(function(entry){return entry&&entry.jobId===jobId;});};',
  'var removePendingJob=function(jobId){var id=toText(jobId||"");if(!id){return;}pendingDownloadQueue=pendingDownloadQueue.filter(function(entry){return !(entry&&entry.jobId===id);});};',
  'var queuePendingDownload=function(meta){if(!meta){return;}var jobId=toText(meta.jobId||"");if(jobId&&hasPendingJob(jobId)){return;}pendingDownloadQueue.push({jobId:jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:toText(meta.title||"")||null,createdAt:Date.now()});};',
  'var shiftPendingDownload=function(){var now=Date.now();while(pendingDownloadQueue.length){var next=pendingDownloadQueue.shift();if(!next){continue;}var age=now-Number(next.createdAt||now);if(age>120000){continue;}return next;}return null;};',
  'var post=window.__spotdownBridgePost||function(type,payload){try{var bridge=window.ReactNativeWebView;if(!bridge||typeof bridge.postMessage!=="function"){return false;}bridge.postMessage(JSON.stringify(Object.assign({type:type},payload||{})));return true;}catch(_){return false;}};',
  'window.__spotdownBridgePost=post;',
  'var toText=function(v){if(typeof v==="string"){return v.trim();}if(v===null||typeof v==="undefined"){return "";}return String(v).trim();};',
  'var normalizeUrl=function(v){var raw=toText(v);if(!raw){return "";}try{return new URL(raw,window.location.origin).toString();}catch(_){return raw;}};',
  'var readResults=function(){var nodes=Array.prototype.slice.call(document.querySelectorAll(SONG_SELECTOR));return nodes.map(function(node,index){var title=toText((node.querySelector(".title")||{}).innerText||((node.querySelector(".title")||{}).textContent)||"Unknown");var artist=toText((node.querySelector(".artist")||{}).innerText||((node.querySelector(".artist")||{}).textContent)||"Unknown Artist");var artUrl=toText((node.querySelector("img")||{}).getAttribute&&node.querySelector("img").getAttribute("src")||"");var explicitId=toText(node.getAttribute("data-id")||node.getAttribute("data-song-id")||node.getAttribute("data-track-id")||"");return{id:explicitId||String(index),title:title||"Unknown",artist:artist||"Unknown Artist",duration:null,artUrl:artUrl||null,index:index};});};',
  'var emitResults=function(reason,requestId){post("SPOTDOWN_RESULTS",{reason:reason||"unknown",requestId:requestId||latestSearchRequestId||null,results:readResults()});};',
  'var scheduleResultsEmit=function(reason,requestId,delay){if(resultsEmitTimer){clearTimeout(resultsEmitTimer);resultsEmitTimer=null;}resultsEmitTimer=setTimeout(function(){resultsEmitTimer=null;emitResults(reason,requestId);},Math.max(0,Number(delay)||120));};',
  'var waitForStepTwo=function(item,timeoutMs){return new Promise(function(resolve,reject){var settled=false;var timer=null;var observer=null;var cleanup=function(){if(timer){clearTimeout(timer);timer=null;}if(observer){observer.disconnect();observer=null;}};var done=function(fn){return function(value){if(settled){return;}settled=true;cleanup();fn(value);};};var resolveOnce=done(resolve);var rejectOnce=done(reject);var initial=item&&item.querySelector(STEP_TWO_SELECTOR);if(initial){resolveOnce(initial);return;}timer=setTimeout(function(){rejectOnce(new Error("timeout"));},Math.max(0,Number(timeoutMs)||10000));observer=new MutationObserver(function(){var button=item&&item.querySelector(STEP_TWO_SELECTOR);if(button){resolveOnce(button);}});observer.observe(item,{childList:true,subtree:true});});};',
  'var isLikelyDownloadUrl=function(rawUrl){var normalized=normalizeUrl(rawUrl||"");var lower=toText(normalized).toLowerCase();if(!normalized){return false;}if(lower.indexOf("blob:")===0){return true;}if(lower.indexOf("javascript:")===0||lower==="#"||lower.indexOf("intent:")===0){return false;}if(lower.indexOf("amskiploomr.com")!==-1||lower.indexOf("doubleclick.net")!==-1||lower.indexOf("googlesyndication.com")!==-1){return false;}if(lower.indexOf(DOWNLOAD_API_PATH)!==-1){return true;}if(/(\\.mp3|\\.m4a|\\.aac|\\.flac|\\.wav|\\.ogg)(\\?|$)/i.test(lower)){return true;}return lower.indexOf("http://")===0||lower.indexOf("https://")===0;};',
  'var emitPendingDownloadUrl=function(rawUrl,meta){var normalized=normalizeUrl(rawUrl||"");if(!normalized){return false;}var info=meta||shiftPendingDownload();if(!info){return false;}var lower=toText(normalized).toLowerCase();var isBlob=lower.indexOf("blob:")===0;if(isBlob){if(emitBlobDownloadFromUrl(normalized,info)){if(info&&info.jobId){removePendingJob(info.jobId);}post("SPOTDOWN_BRIDGE_ACTIVITY",{event:"blob-download-captured",url:normalized,jobId:info&&info.jobId||null});return true;}return false;}var isApi=lower.indexOf(DOWNLOAD_API_PATH)!==-1;post("SPOTDOWN_DOWNLOAD_URL",{jobId:info&&info.jobId||null,index:Number.isInteger(info&&info.index)?info.index:null,title:toText(info&&info.title||"Unknown")||"Unknown",url:normalized,status:0,requestUrl:normalized,responseUrl:normalized,allowApiUrl:Boolean(isApi),method:isApi?"POST":"GET"});if(info&&info.jobId){removePendingJob(info.jobId);}return true;};',
  'var resolveStepTwoHref=function(stepTwo){var anchorHref=normalizeUrl((stepTwo&&stepTwo.getAttribute&&stepTwo.getAttribute("href"))||(stepTwo&&stepTwo.href)||"");var lowerHref=toText(anchorHref).toLowerCase();var looksLikeApi=anchorHref&&anchorHref.indexOf(DOWNLOAD_API_PATH)!==-1;var usable=Boolean(anchorHref&&lowerHref!=="#"&&lowerHref.indexOf("javascript:")!==0);return{url:anchorHref||"",isApi:Boolean(looksLikeApi),usable:usable};};',
  'var emitStepTwoHref=function(stepTwo,meta){var resolved=resolveStepTwoHref(stepTwo);if(!resolved.usable){return false;}return emitPendingDownloadUrl(resolved.url,{jobId:meta&&meta.jobId||null,index:Number.isInteger(meta&&meta.index)?meta.index:null,title:toText(meta&&meta.title||"Unknown")||"Unknown"});};',
  'var triggerStepTwo=function(stepTwo,meta){if(!stepTwo){return false;}queuePendingDownload(meta);if(stepTwo&&stepTwo.tagName&&String(stepTwo.tagName).toLowerCase()==="a"){try{if(emitStepTwoHref(stepTwo,meta)){post("SPOTDOWN_DOWNLOAD_STARTED",{jobId:meta&&meta.jobId||null,index:Number.isInteger(meta&&meta.index)?meta.index:null,title:toText(meta&&meta.title||"Unknown")||"Unknown"});return true;}stepTwo.setAttribute("target","_self");}catch(_){}}try{var clickEvent=new MouseEvent("click",{view:window,bubbles:true,cancelable:true});stepTwo.dispatchEvent(clickEvent);}catch(_){stepTwo.click();}post("SPOTDOWN_DOWNLOAD_STARTED",{jobId:meta&&meta.jobId||null,index:Number.isInteger(meta&&meta.index)?meta.index:null,title:toText(meta&&meta.title||"Unknown")||"Unknown"});var pendingJobId=toText(meta&&meta.jobId||"");if(pendingJobId){setTimeout(function(){var refreshedStepTwo=stepTwo;try{var rows=Array.prototype.slice.call(document.querySelectorAll(SONG_SELECTOR));var candidate=Number.isInteger(meta&&meta.index)&&rows[meta.index]?rows[meta.index]:null;if(!candidate&&meta&&meta.title){candidate=rows.find(function(node){var nodeTitle=toText((node.querySelector(".title")||{}).innerText||((node.querySelector(".title")||{}).textContent)||"");return nodeTitle&&nodeTitle.toLowerCase()===toText(meta.title).toLowerCase();})||null;}if(candidate){refreshedStepTwo=candidate.querySelector(STEP_TWO_SELECTOR)||refreshedStepTwo;}}catch(_){}if(emitStepTwoHref(refreshedStepTwo,meta)){return;}if(!hasPendingJob(pendingJobId)){return;}removePendingJob(pendingJobId);post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:pendingJobId,index:Number.isInteger(meta&&meta.index)?meta.index:null,title:toText(meta&&meta.title||"Unknown")||"Unknown",reason:"no-download-request-detected"});},12000);}return true;};',
  'var encodeBase64Chunk=function(uint8){if(!uint8||!uint8.length){return "";}var STEP=0x8000;var binary="";for(var offset=0;offset<uint8.length;offset+=STEP){var slice=uint8.subarray(offset,Math.min(offset+STEP,uint8.length));binary+=String.fromCharCode.apply(null,slice);}return btoa(binary);};',
  'var resolveFilename=function(contentType,disposition){var filenameMatch=toText(disposition||"").match(/filename\\*?=(?:\\")?([^\\";]+)/i);if(filenameMatch&&filenameMatch[1]){return filenameMatch[1];}return toText(contentType||"").indexOf("mpeg")!==-1?"song.mp3":"song.bin";};',
  'var emitChunkPayload=function(meta,bytes,contentType,filename,requestUrl,responseUrl,statusCode){if(!bytes||!bytes.length){post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:meta&&meta.jobId||null,index:Number.isInteger(meta&&meta.index)?meta.index:null,title:meta&&meta.title||null,reason:"empty-response",status:Number(statusCode)||0,requestUrl:requestUrl||null,responseUrl:responseUrl||null});return false;}try{var chunkByteSize=96*1024;var chunkCount=Math.max(1,Math.ceil(bytes.length/chunkByteSize));for(var chunkIndex=0;chunkIndex<chunkCount;chunkIndex+=1){var start=chunkIndex*chunkByteSize;var end=Math.min(start+chunkByteSize,bytes.length);var encoded=encodeBase64Chunk(bytes.subarray(start,end));post("SPOTDOWN_DOWNLOAD_CHUNK",{jobId:meta&&meta.jobId||null,index:Number.isInteger(meta&&meta.index)?meta.index:null,chunkIndex:chunkIndex,chunkCount:chunkCount,totalBytes:bytes.length,mimeType:contentType||null,filename:filename,data:encoded});}post("SPOTDOWN_DOWNLOAD_URL",{jobId:meta&&meta.jobId||null,index:Number.isInteger(meta&&meta.index)?meta.index:null,title:meta&&meta.title||null,url:null,status:Number(statusCode)||0,requestUrl:requestUrl||null,responseUrl:responseUrl||null,contentType:contentType||null,filename:filename,chunkTransfer:{chunkCount:chunkCount,totalBytes:bytes.length,mimeType:contentType||null,filename:filename}});return true;}catch(error){post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:meta&&meta.jobId||null,index:Number.isInteger(meta&&meta.index)?meta.index:null,title:meta&&meta.title||null,reason:toText(error&&error.message||error)||"chunk-encode-error",status:Number(statusCode)||0,requestUrl:requestUrl||null,responseUrl:responseUrl||null});return false;}};',
  'var emitBlobDownloadFromUrl=function(rawUrl,meta){var normalized=normalizeUrl(rawUrl||"");var lower=toText(normalized).toLowerCase();if(!normalized||lower.indexOf("blob:")!==0){return false;}var info={jobId:meta&&meta.jobId||null,index:Number.isInteger(meta&&meta.index)?meta.index:null,title:toText(meta&&meta.title||"Unknown")||"Unknown"};var requestFn=(typeof nativeFetch==="function"?nativeFetch:(window.fetch&&window.fetch.bind?window.fetch.bind(window):null));if(!requestFn){post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:info.jobId||null,index:Number.isInteger(info.index)?info.index:null,title:info.title||null,reason:"blob-fetch-missing",requestUrl:normalized||null,responseUrl:normalized||null,status:null});return false;}requestFn(normalized,{method:"GET",credentials:"include"}).then(function(response){var statusCode=Number(response&&response.status)||200;var contentType=toText((response&&response.headers&&response.headers.get&&response.headers.get("content-type"))||"audio/mpeg");var disposition=toText((response&&response.headers&&response.headers.get&&response.headers.get("content-disposition"))||"");var filename=resolveFilename(contentType,disposition);response.arrayBuffer().then(function(buffer){if(buffer&&buffer.byteLength){emitChunkPayload(info,new Uint8Array(buffer),contentType,filename,normalized,normalized,statusCode);return;}post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:info.jobId||null,index:Number.isInteger(info.index)?info.index:null,title:info.title||null,reason:"blob-empty-response",requestUrl:normalized||null,responseUrl:normalized||null,status:statusCode});}).catch(function(error){post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:info.jobId||null,index:Number.isInteger(info.index)?info.index:null,title:info.title||null,reason:toText(error&&error.message||error)||"blob-buffer-read-failed",requestUrl:normalized||null,responseUrl:normalized||null,status:statusCode});});}).catch(function(error){post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:info.jobId||null,index:Number.isInteger(info.index)?info.index:null,title:info.title||null,reason:toText(error&&error.message||error)||"blob-fetch-failed",requestUrl:normalized||null,responseUrl:normalized||null,status:null});});return true;};',
  'var tryExtractUrlFromText=function(value){var text=toText(value||"");if(!text){return "";}var match=text.match(/https?:\\/\\/[^\\s\\"\\\'<>]+/i);return match&&match[0]?normalizeUrl(match[0]):"";};',
  'var serializeFormBody=function(form,enctype){var formData;try{formData=new FormData(form);}catch(_){formData=null;}if(!formData){return{body:null,headers:{},enctype:enctype||""};}var lower=toText(enctype||"").toLowerCase();if(lower.indexOf("multipart/form-data")!==-1){return{body:formData,headers:{},enctype:lower};}var params=new URLSearchParams();formData.forEach(function(v,k){if(typeof v==="string"){params.append(k,v);}else if(v&&typeof v.name==="string"){params.append(k,v.name);}else{params.append(k,toText(v));}});if(lower.indexOf("text/plain")!==-1){return{body:params.toString(),headers:{"content-type":"text/plain;charset=UTF-8"},enctype:lower};}return{body:params.toString(),headers:{"content-type":"application/x-www-form-urlencoded;charset=UTF-8"},enctype:lower||"application/x-www-form-urlencoded"};};',
  'var interceptDownloadFormSubmit=function(form,source){if(!form){return false;}var action=normalizeUrl((form.getAttribute&&form.getAttribute("action"))||form.action||window.location.href||"");var method=toText((form.getAttribute&&form.getAttribute("method"))||form.method||"GET").toUpperCase();if(method!=="POST"||action.indexOf(DOWNLOAD_API_PATH)===-1){return false;}if(form.__spotdownSubmitInterceptBusy){return true;}form.__spotdownSubmitInterceptBusy=true;var pending=shiftPendingDownload();var meta={jobId:pending&&pending.jobId||null,index:pending&&Number.isInteger(pending.index)?pending.index:null,title:toText(pending&&pending.title||"")||null};var release=function(){setTimeout(function(){try{form.__spotdownSubmitInterceptBusy=false;}catch(_){}},150);};var fail=function(reason,extra){post("SPOTDOWN_DOWNLOAD_ERROR",Object.assign({jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,reason:reason||"download-form-submit-failed",requestUrl:action||null,responseUrl:null,status:null},extra||{}));};var enctype=toText((form.getAttribute&&form.getAttribute("enctype"))||form.enctype||"application/x-www-form-urlencoded");var serialized=serializeFormBody(form,enctype);var headers=Object.assign({},serialized&&serialized.headers||{});if(sessionTokenCache){headers["x-session-token"]=sessionTokenCache;}post("SPOTDOWN_BRIDGE_ACTIVITY",{event:"download-form-intercepted",source:source||"unknown",action:action||null,method:method,enctype:serialized&&serialized.enctype||null,jobId:meta.jobId||null});try{var requestFn=(typeof nativeFetch==="function"?nativeFetch:(window.fetch&&window.fetch.bind?window.fetch.bind(window):null));if(!requestFn){release();fail("download-form-fetch-missing");return true;}requestFn(action,{method:"POST",headers:headers,body:serialized&&serialized.body,credentials:"include"}).then(function(response){var statusCode=Number(response&&response.status)||0;var responseUrl=normalizeUrl((response&&response.url)||action||"");var contentType=toText((response&&response.headers&&response.headers.get&&response.headers.get("content-type"))||"");var disposition=toText((response&&response.headers&&response.headers.get&&response.headers.get("content-disposition"))||"");var filename=resolveFilename(contentType,disposition);if(responseUrl&&responseUrl.indexOf(DOWNLOAD_API_PATH)===-1){post("SPOTDOWN_DOWNLOAD_URL",{jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,url:responseUrl,status:statusCode,contentType:contentType||null,filename:filename,requestUrl:action||null,responseUrl:responseUrl||null});release();return;}var arrayReader=response&&response.clone?response.clone():response;arrayReader.arrayBuffer().then(function(buffer){if(buffer&&buffer.byteLength){emitChunkPayload(meta,new Uint8Array(buffer),contentType,filename,action,responseUrl,statusCode);release();return;}var textReader=response&&response.clone?response.clone():null;if(textReader&&typeof textReader.text==="function"){textReader.text().then(function(text){var extracted=tryExtractUrlFromText(text);if(extracted){post("SPOTDOWN_DOWNLOAD_URL",{jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,url:extracted,status:statusCode,contentType:contentType||null,filename:filename,requestUrl:action||null,responseUrl:responseUrl||null});release();return;}fail("empty-response",{status:statusCode,responseUrl:responseUrl||null});release();}).catch(function(){fail("empty-response",{status:statusCode,responseUrl:responseUrl||null});release();});return;}fail("empty-response",{status:statusCode,responseUrl:responseUrl||null});release();}).catch(function(error){fail(toText(error&&error.message||error)||"download-form-buffer-read-failed",{status:statusCode,responseUrl:responseUrl||null});release();});}).catch(function(error){fail(toText(error&&error.message||error)||"download-form-fetch-failed");release();});}catch(error){release();fail(toText(error&&error.message||error)||"download-form-submit-failed");}return true;};',
  'if(window.HTMLFormElement&&window.HTMLFormElement.prototype&&!window.__spotdownFormWrapped){window.__spotdownFormWrapped=true;var originalFormSubmit=HTMLFormElement.prototype.submit;HTMLFormElement.prototype.submit=function(){if(interceptDownloadFormSubmit(this,"form.submit")){return;}return originalFormSubmit.call(this);};if(typeof HTMLFormElement.prototype.requestSubmit==="function"){var originalRequestSubmit=HTMLFormElement.prototype.requestSubmit;HTMLFormElement.prototype.requestSubmit=function(submitter){if(interceptDownloadFormSubmit(this,"form.requestSubmit")){return;}return originalRequestSubmit.call(this,submitter);};}document.addEventListener("submit",function(event){try{var form=event&&event.target;if(!form||!(form instanceof HTMLFormElement)){return;}if(interceptDownloadFormSubmit(form,"submit-event")){if(event&&typeof event.preventDefault==="function"){event.preventDefault();}if(event&&typeof event.stopPropagation==="function"){event.stopPropagation();}}}catch(_){}},true);}',
  'var nativeFetch=typeof window.fetch==="function"?window.fetch.bind(window):null;',
  'if(typeof window.fetch==="function"&&!window.__spotdownFetchWrapped){window.__spotdownFetchWrapped=true;var originalFetch=nativeFetch||window.fetch.bind(window);window.fetch=async function(){var args=Array.prototype.slice.call(arguments);var requestInput=args[0];var requestInit=args[1]||{};var url=normalizeUrl((requestInput&&requestInput.toString&&requestInput.toString())||requestInput);var method=toText((requestInit&&requestInit.method)||((requestInput&&requestInput.method)||"GET")).toUpperCase();var isDownload=method==="POST"&&url.indexOf(DOWNLOAD_API_PATH)!==-1;var pending=isDownload?shiftPendingDownload():null;var meta={jobId:pending&&pending.jobId||null,index:pending&&Number.isInteger(pending.index)?pending.index:null,title:toText(pending&&pending.title||"")||null};var response=await originalFetch.apply(window,args);try{if(url.indexOf(TOKEN_API_PATH)!==-1){response.clone().json().then(function(data){var token=toText((data||{}).token||"");var expires=Number((data||{}).expires)||0;if(token){sessionTokenCache=token;post("SPOTDOWN_SESSION_TOKEN",{token:token,expires:expires});post("SPOTDOWN_BRIDGE_ACTIVITY",{event:"session-token",expires:expires});}}).catch(function(){});}}catch(_){}try{if(isDownload){var statusCode=Number(response&&response.status)||0;var responseUrl=normalizeUrl((response&&response.url)||url||"");var contentType=toText((response&&response.headers&&response.headers.get&&response.headers.get("content-type"))||"");var disposition=toText((response&&response.headers&&response.headers.get&&response.headers.get("content-disposition"))||"");var filename=resolveFilename(contentType,disposition);if(responseUrl&&responseUrl.indexOf(DOWNLOAD_API_PATH)===-1){post("SPOTDOWN_DOWNLOAD_URL",{jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,url:responseUrl,status:statusCode,contentType:contentType||null,filename:filename,requestUrl:url||null});return response;}response.clone().arrayBuffer().then(function(buffer){if(buffer&&buffer.byteLength){emitChunkPayload(meta,new Uint8Array(buffer),contentType,filename,url,responseUrl,statusCode);return;}post("SPOTDOWN_DOWNLOAD_URL",{jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,url:responseUrl||url||null,status:statusCode,contentType:contentType||null,filename:filename,requestUrl:url||null,allowApiUrl:true,method:"POST"});}).catch(function(error){response.clone().text().then(function(text){var extracted=tryExtractUrlFromText(text);if(extracted){post("SPOTDOWN_DOWNLOAD_URL",{jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,url:extracted,status:statusCode,contentType:contentType||null,filename:filename,requestUrl:url||null});return;}post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,reason:toText(error&&error.message||error)||"fetch-buffer-read-failed",status:statusCode,requestUrl:url||null,responseUrl:responseUrl||null});}).catch(function(){post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,reason:toText(error&&error.message||error)||"fetch-buffer-read-failed",status:statusCode,requestUrl:url||null,responseUrl:responseUrl||null});});});}}catch(_){}return response;};}',
  'if(window.XMLHttpRequest&&!window.__spotdownXhrWrapped){window.__spotdownXhrWrapped=true;var originalOpen=XMLHttpRequest.prototype.open;var originalSend=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(method,url){this.__spotdownMethod=toText(method).toUpperCase();this.__spotdownUrl=normalizeUrl(url);return originalOpen.apply(this,arguments);};XMLHttpRequest.prototype.send=function(body){var method=toText(this.__spotdownMethod).toUpperCase();var url=normalizeUrl(this.__spotdownUrl||"");var isDownload=method==="POST"&&url.indexOf(DOWNLOAD_API_PATH)!==-1;if(isDownload){var pending=shiftPendingDownload();var meta={jobId:pending&&pending.jobId||null,index:pending&&Number.isInteger(pending.index)?pending.index:null,title:toText(pending&&pending.title||"")||null};this.__spotdownJobId=meta.jobId;this.__spotdownIndex=meta.index;this.__spotdownTitle=meta.title;try{if(!this.responseType||this.responseType==="text"){this.responseType="arraybuffer";}}catch(_){}this.addEventListener("load",function(){var responseUrl=normalizeUrl(this.responseURL||url||"");var contentType=toText(this.getResponseHeader("content-type")||"");var disposition=toText(this.getResponseHeader("content-disposition")||"");var filename=resolveFilename(contentType,disposition);if(responseUrl&&responseUrl.indexOf(DOWNLOAD_API_PATH)===-1){post("SPOTDOWN_DOWNLOAD_URL",{jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,url:responseUrl,status:Number(this.status)||0,contentType:contentType||null,filename:filename,requestUrl:url||null});return;}var response=this.response;if(response&&response.byteLength){emitChunkPayload(meta,new Uint8Array(response),contentType,filename,url,responseUrl,Number(this.status)||0);return;}var fallbackText=tryExtractUrlFromText(this.responseText||"");if(fallbackText){post("SPOTDOWN_DOWNLOAD_URL",{jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,url:fallbackText,status:Number(this.status)||0,contentType:contentType||null,filename:filename,requestUrl:url||null});return;}post("SPOTDOWN_DOWNLOAD_URL",{jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,url:responseUrl||url||null,status:Number(this.status)||0,contentType:contentType||null,filename:filename,requestUrl:url||null,allowApiUrl:true,method:"POST"});});this.addEventListener("error",function(){post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,reason:"xhr-error",requestUrl:url||null});});this.addEventListener("timeout",function(){post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,reason:"xhr-timeout",requestUrl:url||null});});this.addEventListener("abort",function(){post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:meta.jobId||null,index:Number.isInteger(meta.index)?meta.index:null,title:meta.title||null,reason:"xhr-abort",requestUrl:url||null});});}return originalSend.apply(this,arguments);};}',
  'window._spotdownDownload=async function(index,jobId,expectedTitle,expectedArtist,expectedId){var safeIndex=Number(index);var expected=toText(expectedTitle||"");var expectedArtistText=toText(expectedArtist||"");var expectedIdText=toText(expectedId||"");var items=Array.prototype.slice.call(document.querySelectorAll(SONG_SELECTOR));var normalizeLower=function(v){return toText(v).toLowerCase();};var matchesSong=function(node){if(!node){return false;}var nodeId=toText(node.getAttribute("data-id")||node.getAttribute("data-song-id")||node.getAttribute("data-track-id")||"");if(expectedIdText&&nodeId&&nodeId===expectedIdText){return true;}var nodeTitle=toText((node.querySelector(".title")||{}).innerText||((node.querySelector(".title")||{}).textContent)||"");var nodeArtist=toText((node.querySelector(".artist")||{}).innerText||((node.querySelector(".artist")||{}).textContent)||"");if(expected&&expectedArtistText){return normalizeLower(nodeTitle)===normalizeLower(expected)&&normalizeLower(nodeArtist)===normalizeLower(expectedArtistText);}if(expected){return normalizeLower(nodeTitle)===normalizeLower(expected);}return false;};var item=Number.isInteger(safeIndex)&&items[safeIndex]?items[safeIndex]:null;if(item&&!matchesSong(item)&&(expected||expectedIdText)){item=null;}if(!item&&(expected||expectedArtistText||expectedIdText)){item=items.find(matchesSong)||null;}if(!item){item=items.find(function(node){return Boolean(node&&node.querySelector(STEP_TWO_SELECTOR));})||items.find(function(node){return Boolean(node&&node.querySelector(STEP_ONE_SELECTOR));})||null;}if(!item){post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:jobId||null,index:Number.isInteger(safeIndex)?safeIndex:null,title:expected||null,artist:expectedArtistText||null,reason:"song-item-not-found"});return false;}var title=toText((item.querySelector(".title")||{}).innerText||((item.querySelector(".title")||{}).textContent)||"Unknown")||expected||"Unknown";var effectiveIndex=items.indexOf(item);queuePendingDownload({jobId:jobId||null,index:Number.isInteger(effectiveIndex)?effectiveIndex:null,title:title});var directStepTwo=item.querySelector(STEP_TWO_SELECTOR);if(directStepTwo){triggerStepTwo(directStepTwo,{jobId:jobId||null,index:Number.isInteger(effectiveIndex)?effectiveIndex:null,title:title});return true;}var stepOne=item.querySelector(STEP_ONE_SELECTOR)||item.querySelector(".button-container *");if(!stepOne){post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:jobId||null,index:Number.isInteger(effectiveIndex)?effectiveIndex:null,title:title,artist:expectedArtistText||null,reason:"step-one-button-not-found"});return false;}post("SPOTDOWN_BRIDGE_ACTIVITY",{event:"download-step1",index:Number.isInteger(effectiveIndex)?effectiveIndex:null,title:title,jobId:jobId||null});stepOne.click();try{var stepTwo=await waitForStepTwo(item,10000);triggerStepTwo(stepTwo,{jobId:jobId||null,index:Number.isInteger(effectiveIndex)?effectiveIndex:null,title:title});return true;}catch(_){post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:jobId||null,index:Number.isInteger(effectiveIndex)?effectiveIndex:null,title:title,artist:expectedArtistText||null,reason:"timeout"});return false;}};',
  'var runSearchCommand=function(command){var query=toText(command&&command.query||"");if(!query){post("SPOTDOWN_RESULTS",{requestId:command&&command.requestId||null,reason:"empty-query",results:[]});return;}latestSearchRequestId=command&&command.requestId||null;var input=document.querySelector(SEARCH_INPUT_SELECTOR);var submitButton=document.querySelector(SEARCH_BUTTON_SELECTOR);if(!input||!submitButton){post("SPOTDOWN_RESULTS",{requestId:latestSearchRequestId||null,reason:"search-controls-not-found",results:[]});return;}input.focus&&input.focus();input.value=query;input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));submitButton.click();scheduleResultsEmit("search-submit",latestSearchRequestId,180);var attempts=0;var maxAttempts=80;var interval=setInterval(function(){attempts+=1;var rows=document.querySelectorAll(SONG_SELECTOR).length;if(rows>0||attempts>=maxAttempts){clearInterval(interval);scheduleResultsEmit("search-settled",latestSearchRequestId,60);}},250);};',
  'var runTokenRefreshCommand=function(){var tokenUrl=TOKEN_API_PATH+"?ts="+Date.now();fetch(tokenUrl,{cache:"no-store"}).catch(function(){});};',
  'var handleBridgeCommand=function(raw){if(!raw){return;}var parsed=null;try{parsed=typeof raw==="string"?JSON.parse(raw):raw;}catch(_){return;}if(!parsed||typeof parsed!=="object"){return;}if(parsed.type==="SPOTDOWN_CMD_SEARCH"){runSearchCommand(parsed);return;}if(parsed.type==="SPOTDOWN_CMD_REFRESH_RESULTS"){scheduleResultsEmit("refresh-results",parsed&&parsed.requestId||null,20);return;}if(parsed.type==="SPOTDOWN_CMD_REFRESH_TOKEN"){runTokenRefreshCommand();return;}if(parsed.type==="SPOTDOWN_CMD_DOWNLOAD"){window._spotdownDownload(parsed&&parsed.index,parsed&&parsed.jobId,parsed&&parsed.title,parsed&&parsed.artist,parsed&&parsed.songId).catch(function(error){post("SPOTDOWN_DOWNLOAD_ERROR",{jobId:parsed&&parsed.jobId||null,index:Number.isInteger(parsed&&parsed.index)?parsed.index:null,reason:toText(error&&error.message||error)||"download-command-failed"});});}};',
  'if(!window.__spotdownResultObserversInstalled){window.__spotdownResultObserversInstalled=true;var observer=new MutationObserver(function(){scheduleResultsEmit("mutation-observer");});try{observer.observe(document.documentElement||document.body,{childList:true,subtree:true});}catch(_){}}',
  'var createPopupProxy=function(){var proxy={closed:false,opener:null,close:function(){this.closed=true;},focus:function(){}};var locationProxy={assign:function(url){emitPendingDownloadUrl(url,null);},replace:function(url){emitPendingDownloadUrl(url,null);},toString:function(){return "";}};try{Object.defineProperty(locationProxy,"href",{set:function(url){emitPendingDownloadUrl(url,null);},get:function(){return "";},configurable:true});}catch(_){}proxy.location=locationProxy;return proxy;};',
  'window.open=function(url){var normalized=normalizeUrl(url||"");if(normalized&&pendingDownloadQueue.length>0&&isLikelyDownloadUrl(normalized)){if(emitPendingDownloadUrl(normalized,null)){post("SPOTDOWN_BRIDGE_ACTIVITY",{event:"window-open-download-captured",url:normalized});}return createPopupProxy();}post("SPOTDOWN_BRIDGE_ACTIVITY",{event:"window-open-blocked",url:normalized||null});return createPopupProxy();};',
  'document.addEventListener("click",function(event){try{if(!pendingDownloadQueue.length){return;}var target=event&&event.target;var anchor=target&&target.closest?target.closest("a[href]"):null;if(!anchor){return;}var href=normalizeUrl((anchor.getAttribute&&anchor.getAttribute("href"))||anchor.href||"");var hasDownloadAttr=Boolean(anchor&&anchor.hasAttribute&&anchor.hasAttribute("download"));if(!href||(!hasDownloadAttr&&!isLikelyDownloadUrl(href))){return;}if(emitPendingDownloadUrl(href,null)){post("SPOTDOWN_BRIDGE_ACTIVITY",{event:"anchor-download-captured",url:href});if(event&&typeof event.preventDefault==="function"){event.preventDefault();}if(event&&typeof event.stopPropagation==="function"){event.stopPropagation();}}}catch(_){}},true);',
  'window.addEventListener("message",function(event){handleBridgeCommand(event&&event.data);});',
  'document.addEventListener("message",function(event){handleBridgeCommand(event&&event.data);});',
  'post("SPOTDOWN_BRIDGE_READY",{href:window.location.href});',
  'scheduleResultsEmit("bridge-init",null,60);',
  '})();',
  'true;',
].join('\n');

function sleep(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  return new Promise(resolve => setTimeout(resolve, delay));
}

function clampProgress(value, fallback = 0) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseDuration(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function normalizeSong(item = {}) {
  return {
    ...item,
    title: String(item?.title || '').trim() || 'Unknown',
    artist: String(item?.artist || '').trim() || 'Unknown Artist',
    album: String(item?.album || '').trim(),
    subtitle: String(item?.subtitle || '').trim(),
    artwork: String(item?.artwork || item?.artUrl || '').trim() || null,
    duration: parseDuration(item?.duration),
    url: String(item?.url || '').trim() || null,
    downloadable: item?.downloadable !== false,
    index: Number.isInteger(item?.index) ? item.index : null,
  };
}

function normalizeResultItem(item = {}, index = 0) {
  const normalized = normalizeSong(item);
  const finalIndex = Number.isInteger(item?.index)
    ? item.index
    : Number.isInteger(index)
    ? index
    : 0;
  return {
    ...normalized,
    type: 'track',
    index: finalIndex,
    requestIndex: finalIndex,
    duration: null,
    artUrl: normalized.artwork,
  };
}

function extensionFromMimeOrName(mimeType = '', filename = '') {
  const filenameMatch = String(filename || '')
    .trim()
    .match(/\\.([a-z0-9]{2,5})(?:\\?.*)?$/i);
  if (filenameMatch?.[1]) {
    const ext = filenameMatch[1].toLowerCase();
    return ext === 'mp4' ? '.m4a' : `.${ext}`;
  }
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('mpeg') || mime.includes('mp3')) {
    return '.mp3';
  }
  if (mime.includes('flac')) {
    return '.flac';
  }
  if (mime.includes('wav')) {
    return '.wav';
  }
  if (mime.includes('aac') || mime.includes('mp4')) {
    return '.m4a';
  }
  if (mime.includes('ogg')) {
    return '.ogg';
  }
  return '.mp3';
}

function normalizeHeaderMap(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return Object.entries(value).reduce((acc, [rawKey, rawValue]) => {
    const key = String(rawKey || '')
      .trim()
      .toLowerCase();
    const next = String(rawValue || '').trim();
    if (!key || !next) {
      return acc;
    }
    acc[key] = next;
    return acc;
  }, {});
}

function isAllowedTopLevelNavigation(rawUrl = '') {
  const value = String(rawUrl || '').trim();
  if (!value) {
    return false;
  }
  const lower = value.toLowerCase();
  if (
    lower === 'about:blank' ||
    lower.startsWith('about:srcdoc') ||
    lower.startsWith('blob:') ||
    lower.startsWith('data:')
  ) {
    return true;
  }
  const schemeMatch = lower.match(/^([a-z][a-z0-9+.-]*):/i);
  const scheme = String(schemeMatch?.[1] || '').toLowerCase();
  if (!scheme) {
    return false;
  }
  if (scheme !== 'http' && scheme !== 'https') {
    return false;
  }
  const authorityMatch = lower.match(/^https?:\/\/([^/?#]+)/i);
  const authority = String(authorityMatch?.[1] || '').trim();
  if (!authority) {
    return false;
  }
  const hostPort = authority.includes('@')
    ? String(authority.split('@').pop() || '')
    : authority;
  const host = String(hostPort.split(':')[0] || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!host) {
    return false;
  }
  return host === 'spotdown.org' || host.endsWith('.spotdown.org');
}

function deriveFilenameFromUrl(rawUrl = '') {
  const value = String(rawUrl || '').trim();
  if (!value) {
    return 'song.mp3';
  }
  const lastSegment = value.split('/').pop() || '';
  const base = lastSegment.split('?')[0] || '';
  if (base && base.includes('.')) {
    return base;
  }
  return 'song.mp3';
}

function pickPendingSignalJobId(pendingMap, preferredJobId) {
  if (
    !pendingMap ||
    typeof pendingMap.size !== 'number' ||
    pendingMap.size < 1
  ) {
    return null;
  }
  const preferred = String(preferredJobId || '').trim();
  if (preferred && pendingMap.has(preferred)) {
    return preferred;
  }
  const first = pendingMap.keys().next()?.value;
  return String(first || '').trim() || null;
}

function isLikelyDownloadNavigation(rawUrl = '') {
  const value = String(rawUrl || '').trim();
  const lower = value.toLowerCase();
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
    return false;
  }
  if (
    lower.includes('amskiploomr.com') ||
    lower.includes('doubleclick.net') ||
    lower.includes('googlesyndication.com')
  ) {
    return false;
  }
  if (lower.includes('/api/download')) {
    return true;
  }
  return /(\\.mp3|\\.m4a|\\.aac|\\.flac|\\.wav|\\.ogg)(\\?|$)/i.test(lower);
}

function cloneJob(job) {
  if (!job) {
    return null;
  }
  return {
    ...job,
    song: job.song ? {...job.song} : null,
    request: job.request
      ? {
          ...job.request,
          song: job.request.song ? {...job.request.song} : null,
        }
      : null,
  };
}

function isDirectMediaUrl(url = '') {
  const value = String(url || '').trim();
  if (!value) {
    return false;
  }
  if (value.toLowerCase().startsWith('blob:')) {
    return false;
  }
  return !value.includes(SPOTDOWN_DOWNLOAD_API_PATH);
}

function createQueuedJob(song, index, downloadSetting) {
  const now = Date.now();
  const id = `spotdown_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const normalizedSong = normalizeSong(song);
  const requestIndex = Number.isInteger(index)
    ? index
    : Number.isInteger(normalizedSong.index)
    ? normalizedSong.index
    : null;
  return {
    id,
    requestIndex,
    status: 'queued',
    spotdownStatus: 'pending',
    phase: 'queued',
    progress: 0,
    title: normalizedSong.title,
    artist: normalizedSong.artist,
    album: normalizedSong.album || '',
    artwork: normalizedSong.artwork,
    duration: null,
    downloadSetting,
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
    song: null,
    request: {
      song: normalizedSong,
      index: requestIndex,
      downloadSetting,
      convertAacToMp3Enabled: false,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function useSpotdownWebViewDownloader(options = {}) {
  const onBridgeActivity =
    typeof options?.onBridgeActivity === 'function'
      ? options.onBridgeActivity
      : null;
  const onActiveDownloadCountChange =
    typeof options?.onActiveDownloadCountChange === 'function'
      ? options.onActiveDownloadCountChange
      : null;

  const webViewRef = useRef(null);
  const bridgeReadyRef = useRef(false);
  const bridgeReadyWaitersRef = useRef([]);
  const pendingSearchRef = useRef(null);
  const jobsRef = useRef(new Map());
  const chunkStoreRef = useRef(new Map());
  const cancelledJobsRef = useRef(new Set());
  const activeJobIdsRef = useRef(new Set());
  const processingRef = useRef(false);
  const lastJobStartAtRef = useRef(0);
  const activeNativeDownloadRef = useRef(new Map());
  const pendingDownloadSignalsRef = useRef(new Map());
  const downloadTriggerAttemptRef = useRef(new Map());
  const lastStartedDownloadJobIdRef = useRef(null);
  const sessionTokenRef = useRef({token: null, expires: 0});
  const tokenWaitersRef = useRef([]);
  const tokenRefreshInFlightRef = useRef(false);
  const lastActiveCountRef = useRef(null);
  const lastRecoveryAtRef = useRef(0);

  const log = useCallback((message, context = null) => {
    if (!__DEV__) {
      return;
    }
    const timestamp = new Date().toISOString();
    if (context === null || typeof context === 'undefined') {
      console.log(`[SpotdownWV ${timestamp}] ${message}`);
      return;
    }
    console.log(`[SpotdownWV ${timestamp}] ${message}`, context);
  }, []);

  const getActiveDownloadCount = useCallback(() => {
    let count = 0;
    jobsRef.current.forEach(job => {
      if (ACTIVE_STATUSES.has(job?.status || '')) {
        count += 1;
      }
    });
    return count;
  }, []);

  const emitActiveDownloadCount = useCallback(
    _reason => {
      if (!onActiveDownloadCountChange) {
        return;
      }
      const nextCount = getActiveDownloadCount();
      if (lastActiveCountRef.current === nextCount) {
        return;
      }
      lastActiveCountRef.current = nextCount;
      try {
        onActiveDownloadCountChange(nextCount);
      } catch (_) {
        // Ignore callback consumer errors.
      }
    },
    [getActiveDownloadCount, onActiveDownloadCountChange],
  );

  useEffect(() => {
    lastActiveCountRef.current = null;
    emitActiveDownloadCount('listener-change');
  }, [emitActiveDownloadCount]);

  const flushBridgeReadyWaiters = useCallback(() => {
    const waiters = bridgeReadyWaitersRef.current.splice(0);
    waiters.forEach(resolve => resolve());
  }, []);

  const flushTokenWaiters = useCallback(() => {
    const waiters = tokenWaitersRef.current.splice(0);
    waiters.forEach(waiter => {
      waiter.resolve(true);
    });
  }, []);

  const rejectTokenWaiters = useCallback(message => {
    const waiters = tokenWaitersRef.current.splice(0);
    waiters.forEach(waiter => {
      waiter.reject(new Error(message));
    });
  }, []);

  const waitForBridgeReady = useCallback(
    (timeoutMs = BRIDGE_READY_TIMEOUT_MS) => {
      if (bridgeReadyRef.current) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const resolveOnce = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          const idx = bridgeReadyWaitersRef.current.indexOf(resolveOnce);
          if (idx >= 0) {
            bridgeReadyWaitersRef.current.splice(idx, 1);
          }
          reject(new Error('Spotdown webview bridge is not ready.'));
        }, Math.max(1, Number(timeoutMs) || BRIDGE_READY_TIMEOUT_MS));
        bridgeReadyWaitersRef.current.push(resolveOnce);
      });
    },
    [],
  );

  const sendBridgeCommand = useCallback(command => {
    const webView = webViewRef.current;
    if (!webView || typeof webView.postMessage !== 'function') {
      throw new Error('Spotdown hidden webview is unavailable.');
    }
    webView.postMessage(JSON.stringify(command));
  }, []);

  const installPreDispatchDiagnostics = useCallback(
    (jobId, itemIndex) => {
      const safeJobId = String(jobId || '').trim();
      if (!safeJobId) {
        return;
      }
      const webView = webViewRef.current;
      if (!webView || typeof webView.injectJavaScript !== 'function') {
        return;
      }
      const contextPayload = JSON.stringify({
        jobId: safeJobId,
        itemIndex: Number.isInteger(itemIndex) ? itemIndex : null,
      });
      const diagnosticScript = `
        (function(){
          try {
            var ctx = ${contextPayload};
            window.__spotdownDiagContext = ctx;
            var getCtx = function(){
              var active = window.__spotdownDiagContext || ctx || {};
              return active && typeof active === 'object' ? active : {};
            };
            var rn = window.ReactNativeWebView;
            var toText = function(value){
              if (typeof value === 'string') { return value.trim(); }
              if (value === null || typeof value === 'undefined') { return ''; }
              return String(value).trim();
            };
            var postRaw = function(payload){
              try {
                if (!rn || typeof rn.postMessage !== 'function') { return false; }
                rn.postMessage(JSON.stringify(payload));
                return true;
              } catch (_) { return false; }
            };
            var postDiag = function(label, data){
              var activeCtx = getCtx();
              postRaw({
                type: 'SPOTDOWN_DIAG',
                jobId: activeCtx && activeCtx.jobId ? activeCtx.jobId : null,
                itemIndex: Number.isInteger(activeCtx && activeCtx.itemIndex) ? activeCtx.itemIndex : null,
                label: label || 'unknown',
                data: data || {}
              });
            };
            var normalizeUrl = function(raw){
              var text = toText(raw);
              if (!text) { return ''; }
              try {
                return new URL(text, window.location.origin).toString();
              } catch (_) {
                return text;
              }
            };
            var deriveFilename = function(rawUrl){
              var value = toText(rawUrl);
              if (!value) { return 'song.mp3'; }
              var tail = value.split('/').pop() || '';
              var base = tail.split('?')[0] || '';
              if (base && base.indexOf('.') !== -1) { return base; }
              return 'song.mp3';
            };
            var encodeBase64Chunk = function(uint8){
              if (!uint8 || !uint8.length) { return ''; }
              var STEP = 0x8000;
              var binary = '';
              for (var offset = 0; offset < uint8.length; offset += STEP) {
                var slice = uint8.subarray(offset, Math.min(offset + STEP, uint8.length));
                binary += String.fromCharCode.apply(null, slice);
              }
              return btoa(binary);
            };
            var emitBlobChunks = function(blobUrl, source){
              var fetchFn = window.fetch && window.fetch.bind ? window.fetch.bind(window) : null;
              if (!fetchFn) {
                postDiag('download-url-skipped', {source: source || null, url: blobUrl || null, reason: 'blob-fetch-missing'});
                return false;
              }
              fetchFn(blobUrl, {method:'GET', credentials:'include'})
                .then(function(response){
                  var status = Number(response && response.status) || 200;
                  var contentType = toText(response && response.headers && response.headers.get && response.headers.get('content-type')) || 'audio/mpeg';
                  var filename = deriveFilename(blobUrl);
                  return response.arrayBuffer().then(function(buffer){
                    var bytes = buffer ? new Uint8Array(buffer) : null;
                    if (!bytes || !bytes.length) {
                      var activeCtx = getCtx();
                      postRaw({
                        type: 'SPOTDOWN_DOWNLOAD_ERROR',
                        jobId: activeCtx && activeCtx.jobId ? activeCtx.jobId : null,
                        index: Number.isInteger(activeCtx && activeCtx.itemIndex) ? activeCtx.itemIndex : null,
                        reason: 'blob-empty-response',
                        requestUrl: blobUrl || null,
                        responseUrl: blobUrl || null,
                        status: status
                      });
                      return;
                    }
                    var chunkByteSize = 96 * 1024;
                    var chunkCount = Math.max(1, Math.ceil(bytes.length / chunkByteSize));
                    for (var chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
                      var activeCtx = getCtx();
                      var start = chunkIndex * chunkByteSize;
                      var end = Math.min(start + chunkByteSize, bytes.length);
                      postRaw({
                        type: 'SPOTDOWN_DOWNLOAD_CHUNK',
                        jobId: activeCtx && activeCtx.jobId ? activeCtx.jobId : null,
                        index: Number.isInteger(activeCtx && activeCtx.itemIndex) ? activeCtx.itemIndex : null,
                        chunkIndex: chunkIndex,
                        chunkCount: chunkCount,
                        totalBytes: bytes.length,
                        mimeType: contentType || null,
                        filename: filename,
                        data: encodeBase64Chunk(bytes.subarray(start, end))
                      });
                    }
                    var activeCtx = getCtx();
                    postRaw({
                      type: 'SPOTDOWN_DOWNLOAD_URL',
                      jobId: activeCtx && activeCtx.jobId ? activeCtx.jobId : null,
                      index: Number.isInteger(activeCtx && activeCtx.itemIndex) ? activeCtx.itemIndex : null,
                      title: null,
                      url: null,
                      status: status,
                      requestUrl: blobUrl || null,
                      responseUrl: blobUrl || null,
                      contentType: contentType || null,
                      filename: filename,
                      chunkTransfer: {
                        chunkCount: chunkCount,
                        totalBytes: bytes.length,
                        mimeType: contentType || null,
                        filename: filename
                      }
                    });
                    postDiag('download-url-emitted', {
                      source: source || null,
                      url: blobUrl || null,
                      isBlob: true,
                      chunkCount: chunkCount,
                      totalBytes: bytes.length
                    });
                  });
                })
                .catch(function(error){
                  var activeCtx = getCtx();
                  postRaw({
                    type: 'SPOTDOWN_DOWNLOAD_ERROR',
                    jobId: activeCtx && activeCtx.jobId ? activeCtx.jobId : null,
                    index: Number.isInteger(activeCtx && activeCtx.itemIndex) ? activeCtx.itemIndex : null,
                    reason: toText(error && error.message || error) || 'blob-fetch-failed',
                    requestUrl: blobUrl || null,
                    responseUrl: blobUrl || null,
                    status: null
                  });
                });
              return true;
            };
            var shouldIgnore = function(urlLower){
              return (
                urlLower.indexOf('amskiploomr.com') !== -1 ||
                urlLower.indexOf('doubleclick.net') !== -1 ||
                urlLower.indexOf('googlesyndication.com') !== -1
              );
            };
            var emitDownload = function(rawUrl, source){
              var normalized = normalizeUrl(rawUrl);
              var lower = toText(normalized).toLowerCase();
              if (lower.indexOf('blob:') === 0) {
                return emitBlobChunks(normalized, source || null);
              }
              var isHttp = lower.indexOf('https://') === 0 || lower.indexOf('http://') === 0;
              if (!normalized || !isHttp) {
                postDiag('download-url-skipped', {source: source || null, url: normalized || null, reason: 'not-http'});
                return false;
              }
              if (shouldIgnore(lower)) {
                postDiag('download-url-skipped', {source: source || null, url: normalized, reason: 'ignored-domain'});
                return false;
              }
              var activeCtx = getCtx();
              var isApi = lower.indexOf('/api/download') !== -1;
              var filename = deriveFilename(normalized);
              postRaw({
                type: 'SPOTDOWN_DOWNLOAD_URL',
                jobId: activeCtx && activeCtx.jobId ? activeCtx.jobId : null,
                index: Number.isInteger(activeCtx && activeCtx.itemIndex) ? activeCtx.itemIndex : null,
                title: null,
                url: normalized,
                status: 0,
                requestUrl: normalized,
                responseUrl: normalized,
                contentType: null,
                filename: filename,
                chunkTransfer: null,
                allowApiUrl: Boolean(isApi),
                method: isApi ? 'POST' : 'GET'
              });
              postDiag('download-url-emitted', {
                source: source || null,
                url: normalized,
                isApi: isApi,
                filename: filename
              });
              return true;
            };

            var prevOpen = window.open;
            var createPopupProxy = function(){
              var proxy = {closed:false, opener:null, close:function(){this.closed=true;}, focus:function(){}};
              var locationProxy = {
                assign: function(url){ emitDownload(url, 'window.open.location.assign'); },
                replace: function(url){ emitDownload(url, 'window.open.location.replace'); },
                toString: function(){ return ''; }
              };
              try {
                Object.defineProperty(locationProxy, 'href', {
                  set: function(url){ emitDownload(url, 'window.open.location.href'); },
                  get: function(){ return ''; },
                  configurable: true
                });
              } catch (_) {}
              proxy.location = locationProxy;
              return proxy;
            };
            window.open = function(url, target, features){
              var handled = emitDownload(url, 'window.open');
              postDiag('window.open fired', {
                url: toText(url) || null,
                target: toText(target) || null,
                features: toText(features) || null,
                handled: handled
              });
              if (handled) { return createPopupProxy(); }
              try {
                return typeof prevOpen === 'function' ? prevOpen.apply(window, arguments) : null;
              } catch (e) {
                postDiag('window.open error', {err: String(e && e.message || e)});
                return createPopupProxy();
              }
            };

            try {
              var prevAssign = window.location.assign.bind(window.location);
              window.location.assign = function(url){
                var handled = emitDownload(url, 'location.assign');
                postDiag('location.assign fired', {url: toText(url) || null, handled: handled});
                if (handled) { return; }
                return prevAssign(url);
              };
            } catch (e) {
              postDiag('location.assign intercept failed', {err: String(e && e.message || e)});
            }

            try {
              var prevReplace = window.location.replace.bind(window.location);
              window.location.replace = function(url){
                var handled = emitDownload(url, 'location.replace');
                postDiag('location.replace fired', {url: toText(url) || null, handled: handled});
                if (handled) { return; }
                return prevReplace(url);
              };
            } catch (e) {
              postDiag('location.replace intercept failed', {err: String(e && e.message || e)});
            }

            if (!window.__spotdownDiagAnchorHooked) {
              window.__spotdownDiagAnchorHooked = true;
              document.addEventListener('click', function(event){
                try {
                  var target = event && event.target ? event.target : null;
                  var anchor = target && target.closest ? target.closest('a[href]') : null;
                  if (!anchor) { return; }
                  var href = normalizeUrl((anchor.getAttribute && anchor.getAttribute('href')) || anchor.href || '');
                  var hasDownload = Boolean(anchor && anchor.hasAttribute && anchor.hasAttribute('download'));
                  var handled = false;
                  if (href && (hasDownload || toText(href).toLowerCase().indexOf('http') === 0)) {
                    handled = emitDownload(href, 'anchor.click');
                  }
                  postDiag('anchor click event', {
                    href: href || null,
                    hasDownload: hasDownload,
                    handled: handled
                  });
                } catch (_) {}
              }, true);
            }

            postDiag('diag-ready-pre-dispatch', {
              jobId: ctx && ctx.jobId ? ctx.jobId : null,
              index: Number.isInteger(ctx && ctx.itemIndex) ? ctx.itemIndex : null
            });
          } catch (error) {
            try {
              var rn2 = window.ReactNativeWebView;
              rn2 && rn2.postMessage && rn2.postMessage(JSON.stringify({
                type: 'SPOTDOWN_DIAG',
                jobId: ${JSON.stringify(safeJobId)},
                label: 'diag-install-crashed',
                data: {err: String(error && error.message || error)}
              }));
            } catch (_) {}
          }
        })();
        true;
      `;
      try {
        webView.injectJavaScript(diagnosticScript);
      } catch (error) {
        log('Failed to inject pre-dispatch Spotdown diagnostics.', {
          jobId: safeJobId,
          error: error?.message || String(error),
        });
      }
    },
    [log],
  );

  const resetBridgeState = useCallback(() => {
    bridgeReadyRef.current = false;
    lastStartedDownloadJobIdRef.current = null;
    downloadTriggerAttemptRef.current.clear();
    if (pendingSearchRef.current) {
      clearTimeout(pendingSearchRef.current.timeout);
      pendingSearchRef.current.reject(
        new Error('Spotdown webview reloaded before search finished.'),
      );
      pendingSearchRef.current = null;
    }
    pendingDownloadSignalsRef.current.forEach(signal => {
      clearTimeout(signal.timeout);
      signal.reject(new Error('Spotdown webview reloaded.'));
    });
    pendingDownloadSignalsRef.current.clear();
  }, []);

  const recoverSpotdownWebView = useCallback(
    reason => {
      const now = Date.now();
      if (now - lastRecoveryAtRef.current < BRIDGE_RECOVERY_DEBOUNCE_MS) {
        return;
      }
      lastRecoveryAtRef.current = now;
      resetBridgeState();
      log('Recovering Spotdown WebView.', {reason: reason || null});
      const webView = webViewRef.current;
      if (!webView) {
        return;
      }
      try {
        if (typeof webView.stopLoading === 'function') {
          webView.stopLoading();
        }
      } catch (_) {
        // Ignore stopLoading failures.
      }
      try {
        if (typeof webView.injectJavaScript === 'function') {
          webView.injectJavaScript(
            `(function(){try{window.location.replace("${SPOTDOWN_WEB_URL}");}catch(_){window.location.href="${SPOTDOWN_WEB_URL}";}true;})();`,
          );
        }
      } catch (_) {
        // Ignore recovery injection failures.
      }
    },
    [log, resetBridgeState],
  );

  const patchJob = useCallback(
    (jobId, patch = {}) => {
      const existing = jobsRef.current.get(jobId);
      if (!existing) {
        return null;
      }
      const next = {
        ...existing,
        ...patch,
        updatedAt: Date.now(),
      };
      jobsRef.current.set(jobId, next);
      emitActiveDownloadCount('patch-job');
      return next;
    },
    [emitActiveDownloadCount],
  );

  const resolveDownloadSignal = useCallback((jobId, payload) => {
    const signal = pendingDownloadSignalsRef.current.get(jobId);
    if (!signal) {
      return false;
    }
    pendingDownloadSignalsRef.current.delete(jobId);
    downloadTriggerAttemptRef.current.delete(jobId);
    if (lastStartedDownloadJobIdRef.current === jobId) {
      lastStartedDownloadJobIdRef.current = null;
    }
    clearTimeout(signal.timeout);
    signal.resolve(payload);
    return true;
  }, []);

  const rejectDownloadSignal = useCallback((jobId, message) => {
    const signal = pendingDownloadSignalsRef.current.get(jobId);
    if (!signal) {
      return false;
    }
    pendingDownloadSignalsRef.current.delete(jobId);
    downloadTriggerAttemptRef.current.delete(jobId);
    if (lastStartedDownloadJobIdRef.current === jobId) {
      lastStartedDownloadJobIdRef.current = null;
    }
    clearTimeout(signal.timeout);
    signal.reject(new Error(message || 'Spotdown download failed.'));
    return true;
  }, []);

  const waitForSessionToken = useCallback(async () => {
    const current = sessionTokenRef.current;
    const hasValidToken =
      current?.token &&
      Number(current.expires) > 0 &&
      Date.now() < Number(current.expires);
    if (hasValidToken) {
      return current;
    }

    await waitForBridgeReady();
    if (!tokenRefreshInFlightRef.current) {
      tokenRefreshInFlightRef.current = true;
      sendBridgeCommand({type: 'SPOTDOWN_CMD_REFRESH_TOKEN'});
    }

    try {
      await new Promise((resolve, reject) => {
        const waiter = {
          resolve: () => {
            clearTimeout(timer);
            resolve(true);
          },
          reject: error => {
            clearTimeout(timer);
            reject(error);
          },
        };
        const timer = setTimeout(() => {
          const idx = tokenWaitersRef.current.indexOf(waiter);
          if (idx >= 0) {
            tokenWaitersRef.current.splice(idx, 1);
          }
          reject(new Error('Timed out waiting for Spotdown session token.'));
        }, TOKEN_WAIT_TIMEOUT_MS);
        tokenWaitersRef.current.push(waiter);
      });
    } catch (error) {
      tokenRefreshInFlightRef.current = false;
      throw error;
    }

    const refreshed = sessionTokenRef.current;
    if (!refreshed?.token) {
      throw new Error('Spotdown session token unavailable.');
    }
    return refreshed;
  }, [sendBridgeCommand, waitForBridgeReady]);

  const buildDownloadHeaders = useCallback(payload => {
    const rawHeaders = normalizeHeaderMap(payload?.headers);
    const headers = {
      Accept: rawHeaders.accept || '*/*',
      Referer: rawHeaders.referer || SPOTDOWN_WEB_URL,
      Origin: rawHeaders.origin || SPOTDOWN_WEB_URL,
    };
    const token = String(sessionTokenRef.current?.token || '').trim();
    if (token) {
      headers['x-session-token'] = token;
    }
    if (rawHeaders.cookie) {
      headers.Cookie = rawHeaders.cookie;
    }
    return headers;
  }, []);

  const writeChunkedDownloadToFile = useCallback(
    async (job, payload) => {
      const chunkTransfer = payload?.chunkTransfer || {};
      const expectedCount = Math.max(0, Number(chunkTransfer?.chunkCount) || 0);
      const store = chunkStoreRef.current.get(job.id);
      const parts = Array.isArray(store?.parts)
        ? store.parts.filter(Boolean)
        : Array.isArray(chunkTransfer?.parts)
        ? chunkTransfer.parts.filter(Boolean)
        : [];
      if (!parts.length) {
        throw new Error('No Spotdown chunk payload received.');
      }
      if (expectedCount > 0 && parts.length < expectedCount) {
        throw new Error(
          `Spotdown chunk payload incomplete (${parts.length}/${expectedCount}).`,
        );
      }

      const destinationDir = await storageService.getWritableMusicDir();
      const extension = extensionFromMimeOrName(
        chunkTransfer?.mimeType || payload?.contentType,
        chunkTransfer?.filename || payload?.filename || '',
      );
      const baseName =
        sanitizeFileSegment(`${job.artist} - ${job.title}`) ||
        `Spotdown_${Date.now()}`;
      const preferredPath = `${destinationDir}/${baseName}${extension}`;
      const destinationPath = await storageService.ensureUniquePath(
        preferredPath,
      );

      patchJob(job.id, {
        status: 'downloading',
        spotdownStatus: 'active',
        phase: 'downloading',
        progress: 8,
        downloadedBytes: 0,
        totalBytes: Number(chunkTransfer?.totalBytes) || null,
      });

      await RNFS.writeFile(destinationPath, parts[0], 'base64');
      for (let index = 1; index < parts.length; index += 1) {
        if (cancelledJobsRef.current.has(job.id)) {
          throw new Error(CANCELLED_ERROR);
        }
        await RNFS.appendFile(destinationPath, parts[index], 'base64');
        const ratio = (index + 1) / parts.length;
        patchJob(job.id, {
          status: 'downloading',
          spotdownStatus: 'active',
          phase: 'downloading',
          progress: clampProgress(8 + 88 * ratio, 20),
        });
      }

      const stat = await RNFS.stat(destinationPath).catch(() => null);
      const fileSize = Number(stat?.size) || 0;
      if (fileSize < MIN_VALID_AUDIO_FILE_BYTES) {
        throw new Error(
          `Spotdown audio file appears incomplete (${fileSize} bytes).`,
        );
      }

      let embeddedArtwork = null;
      if (canExtractEmbeddedArtwork(destinationPath)) {
        embeddedArtwork = await extractEmbeddedArtworkDataUri({
          localPath: destinationPath,
          url: toFileUriFromPath(destinationPath),
        }).catch(() => null);
      }

      const filename = destinationPath.split('/').pop();
      const localSong = {
        title: job.title,
        artist: job.artist,
        album: job.album,
        artwork: embeddedArtwork || job.artwork || null,
        duration: null,
        downloadable: true,
        id: `spotdown_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        filename,
        sourceFilename: filename,
        sourceSongId: null,
        url: toFileUriFromPath(destinationPath),
        localPath: destinationPath,
        isLocal: true,
      };
      const savedSong = await storageService.saveRemoteSongToDevice(localSong);
      const finalSong = savedSong || localSong;
      patchJob(job.id, {
        status: 'done',
        spotdownStatus: 'complete',
        phase: 'done',
        progress: 100,
        downloadedBytes: fileSize,
        totalBytes: fileSize,
        error: null,
        song: {
          ...finalSong,
          duration: null,
          downloadable: true,
        },
      });
      chunkStoreRef.current.delete(job.id);
      return cloneJob(jobsRef.current.get(job.id));
    },
    [patchJob],
  );

  const downloadFromDirectUrl = useCallback(
    async (job, payload) => {
      const mediaUrl = String(payload?.url || '').trim();
      if (!mediaUrl) {
        throw new Error('Missing Spotdown media URL.');
      }
      const allowApiUrl = payload?.allowApiUrl === true;
      if (!allowApiUrl && !isDirectMediaUrl(mediaUrl)) {
        throw new Error(
          'Spotdown returned API endpoint without chunk payload.',
        );
      }
      const destinationDir = await storageService.getWritableMusicDir();
      const extension = extensionFromMimeOrName(
        payload?.contentType || '',
        payload?.filename || '',
      );
      const baseName =
        sanitizeFileSegment(`${job.artist} - ${job.title}`) ||
        `Spotdown_${Date.now()}`;
      const preferredPath = `${destinationDir}/${baseName}${extension}`;
      const destinationPath = await storageService.ensureUniquePath(
        preferredPath,
      );

      patchJob(job.id, {
        status: 'downloading',
        spotdownStatus: 'active',
        phase: 'downloading',
        progress: 8,
        downloadedBytes: 0,
        totalBytes: null,
      });

      const task = RNFS.downloadFile({
        fromUrl: mediaUrl,
        toFile: destinationPath,
        method: allowApiUrl
          ? 'POST'
          : String(payload?.method || 'GET').toUpperCase(),
        headers: buildDownloadHeaders(payload),
        background: true,
        discretionary: true,
        begin: response => {
          patchJob(job.id, {
            status: 'downloading',
            spotdownStatus: 'active',
            phase: 'downloading',
            progress: 18,
            totalBytes: Number(response?.contentLength) || null,
            downloadedBytes: 0,
          });
        },
        progressDivider: 1,
        progress: response => {
          const written = Number(response?.bytesWritten) || 0;
          const total = Number(response?.contentLength) || null;
          const ratio = total && total > 0 ? written / total : 0;
          patchJob(job.id, {
            status: 'downloading',
            spotdownStatus: 'active',
            phase: 'downloading',
            progress: clampProgress(20 + 75 * ratio, 30),
            downloadedBytes: written,
            totalBytes: total,
          });
        },
      });

      activeNativeDownloadRef.current.set(job.id, task.jobId);
      let response;
      try {
        response = await task.promise;
      } finally {
        activeNativeDownloadRef.current.delete(job.id);
      }
      if (
        !response ||
        response.statusCode < 200 ||
        response.statusCode >= 300
      ) {
        throw new Error(
          `Spotdown direct download failed (${
            response?.statusCode || 'unknown'
          }).`,
        );
      }
      const stat = await RNFS.stat(destinationPath).catch(() => null);
      const fileSize = Number(stat?.size) || 0;
      if (fileSize < MIN_VALID_AUDIO_FILE_BYTES) {
        throw new Error(
          `Spotdown direct file appears incomplete (${fileSize} bytes).`,
        );
      }

      let embeddedArtwork = null;
      if (canExtractEmbeddedArtwork(destinationPath)) {
        embeddedArtwork = await extractEmbeddedArtworkDataUri({
          localPath: destinationPath,
          url: toFileUriFromPath(destinationPath),
        }).catch(() => null);
      }

      const filename = destinationPath.split('/').pop();
      const localSong = {
        title: job.title,
        artist: job.artist,
        album: job.album,
        artwork: embeddedArtwork || job.artwork || null,
        duration: null,
        downloadable: true,
        id: `spotdown_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        filename,
        sourceFilename: filename,
        sourceSongId: null,
        url: toFileUriFromPath(destinationPath),
        localPath: destinationPath,
        isLocal: true,
      };
      const savedSong = await storageService.saveRemoteSongToDevice(localSong);
      const finalSong = savedSong || localSong;
      patchJob(job.id, {
        status: 'done',
        spotdownStatus: 'complete',
        phase: 'done',
        progress: 100,
        downloadedBytes: fileSize,
        totalBytes: fileSize,
        error: null,
        song: {
          ...finalSong,
          duration: null,
          downloadable: true,
        },
      });
      chunkStoreRef.current.delete(job.id);
      return cloneJob(jobsRef.current.get(job.id));
    },
    [buildDownloadHeaders, patchJob],
  );

  const executeJobDownload = useCallback(
    async job => {
      if (!job || !job.id) {
        throw new Error('Spotdown download job is invalid.');
      }
      log('Download pipeline started.', {
        jobId: job.id,
        title: job.title || null,
        index: Number.isInteger(job.requestIndex) ? job.requestIndex : null,
      });
      if (cancelledJobsRef.current.has(job.id)) {
        throw new Error(CANCELLED_ERROR);
      }

      const currentToken = await waitForSessionToken();
      if (!currentToken?.token) {
        throw new Error('Spotdown session token unavailable.');
      }

      patchJob(job.id, {
        status: 'preparing',
        spotdownStatus: 'active',
        phase: 'preparing',
        progress: 2,
        error: null,
      });
      log('Session token validated for download.', {
        jobId: job.id,
        expires: Number(currentToken?.expires) || null,
      });

      await waitForBridgeReady();
      const dispatchBridgeDownloadCommand = (targetJob, reason = 'initial') => {
        if (!targetJob?.id) {
          return;
        }
        const commandIndex = Number.isInteger(targetJob.requestIndex)
          ? targetJob.requestIndex
          : Number.isInteger(targetJob?.request?.index)
          ? targetJob.request.index
          : 0;
        installPreDispatchDiagnostics(targetJob.id, commandIndex);
        const attempt =
          Number(downloadTriggerAttemptRef.current.get(targetJob.id) || 0) + 1;
        downloadTriggerAttemptRef.current.set(targetJob.id, attempt);
        sendBridgeCommand({
          type: 'SPOTDOWN_CMD_DOWNLOAD',
          jobId: targetJob.id,
          index: commandIndex,
          title:
            String(
              targetJob?.request?.song?.title ||
                targetJob?.title ||
                targetJob?.request?.song?.name ||
                '',
            ).trim() || null,
          artist:
            String(
              targetJob?.request?.song?.artist ||
                targetJob?.artist ||
                targetJob?.request?.song?.subtitle ||
                '',
            ).trim() || null,
          songId: String(targetJob?.request?.song?.id || '').trim() || null,
        });
        log('Download command dispatched to WebView.', {
          jobId: targetJob.id,
          title: targetJob.title || null,
          reason,
          attempt,
        });
      };
      const signal = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingDownloadSignalsRef.current.delete(job.id);
          downloadTriggerAttemptRef.current.delete(job.id);
          log('Timed out waiting for bridge download signal.', {
            jobId: job.id,
            timeoutMs: DOWNLOAD_EVENT_TIMEOUT_MS,
          });
          reject(
            new Error('Timed out waiting for Spotdown download response.'),
          );
        }, DOWNLOAD_EVENT_TIMEOUT_MS);

        pendingDownloadSignalsRef.current.set(job.id, {
          resolve: payload => {
            clearTimeout(timeout);
            resolve(payload);
          },
          reject: error => {
            clearTimeout(timeout);
            reject(error);
          },
          timeout,
        });

        try {
          dispatchBridgeDownloadCommand(job, 'initial');
        } catch (error) {
          clearTimeout(timeout);
          pendingDownloadSignalsRef.current.delete(job.id);
          downloadTriggerAttemptRef.current.delete(job.id);
          log('Failed to dispatch download command.', {
            jobId: job.id,
            error: error?.message || String(error),
          });
          reject(error);
        }
      });
      log('Bridge download signal received.', {
        jobId: job.id,
        hasChunkTransfer: Boolean(signal?.chunkTransfer),
        hasUrl: Boolean(String(signal?.url || '').trim()),
      });

      if (cancelledJobsRef.current.has(job.id)) {
        throw new Error(CANCELLED_ERROR);
      }

      if (signal?.chunkTransfer || chunkStoreRef.current.has(job.id)) {
        return writeChunkedDownloadToFile(job, signal);
      }
      if (signal?.url) {
        return downloadFromDirectUrl(job, signal);
      }
      throw new Error('Spotdown download payload was empty.');
    },
    [
      downloadTriggerAttemptRef,
      downloadFromDirectUrl,
      installPreDispatchDiagnostics,
      log,
      patchJob,
      sendBridgeCommand,
      waitForBridgeReady,
      waitForSessionToken,
      writeChunkedDownloadToFile,
    ],
  );

  const processQueue = useCallback(async () => {
    if (processingRef.current) {
      return;
    }
    processingRef.current = true;
    try {
      while (true) {
        const pending = Array.from(jobsRef.current.values()).filter(
          item =>
            item.status === 'queued' &&
            !cancelledJobsRef.current.has(item.id) &&
            !activeJobIdsRef.current.has(item.id),
        );
        if (!pending.length) {
          break;
        }
        if (activeJobIdsRef.current.size >= MAX_CONCURRENT_DOWNLOADS) {
          break;
        }

        const nextJob = pending[0];
        if (!nextJob || activeJobIdsRef.current.has(nextJob.id)) {
          break;
        }
        const elapsed = Date.now() - lastJobStartAtRef.current;
        if (lastJobStartAtRef.current > 0 && elapsed < INTER_JOB_DELAY_MS) {
          await sleep(INTER_JOB_DELAY_MS - elapsed);
        }
        lastJobStartAtRef.current = Date.now();
        activeJobIdsRef.current.add(nextJob.id);

        executeJobDownload(nextJob)
          .catch(error => {
            const message = String(error?.message || error || '').trim();
            if (
              message === CANCELLED_ERROR ||
              cancelledJobsRef.current.has(nextJob.id)
            ) {
              cancelledJobsRef.current.delete(nextJob.id);
              jobsRef.current.delete(nextJob.id);
              emitActiveDownloadCount('cancelled-job');
              return;
            }
            log('Download job failed.', {
              jobId: nextJob.id,
              title: nextJob.title || null,
              reason: message || 'unknown',
            });
            patchJob(nextJob.id, {
              status: 'failed',
              spotdownStatus: 'error',
              phase: 'failed',
              progress: 0,
              error: message || 'Spotdown download failed.',
            });
          })
          .finally(() => {
            activeJobIdsRef.current.delete(nextJob.id);
            emitActiveDownloadCount('job-finished');
            processQueue().catch(() => {});
          });
      }
    } finally {
      processingRef.current = false;
    }
  }, [emitActiveDownloadCount, executeJobDownload, log, patchJob]);

  const searchSongs = useCallback(
    async query => {
      const trimmed = String(query || '').trim();
      if (!trimmed) {
        return [];
      }
      await waitForBridgeReady();

      if (pendingSearchRef.current) {
        clearTimeout(pendingSearchRef.current.timeout);
        pendingSearchRef.current.reject(
          new Error('Spotdown search superseded by a new request.'),
        );
        pendingSearchRef.current = null;
      }

      const requestId = `spotdown_search_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      const results = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingSearchRef.current = null;
          reject(new Error('Spotdown search timed out.'));
        }, RESULT_TIMEOUT_MS);
        pendingSearchRef.current = {requestId, resolve, reject, timeout};
        try {
          sendBridgeCommand({
            type: 'SPOTDOWN_CMD_SEARCH',
            requestId,
            query: trimmed,
          });
        } catch (error) {
          clearTimeout(timeout);
          pendingSearchRef.current = null;
          reject(error);
        }
      });
      return Array.isArray(results) ? results.map(normalizeResultItem) : [];
    },
    [sendBridgeCommand, waitForBridgeReady],
  );

  const getAlbumTracks = useCallback(
    async album => {
      const albumUrl = String(album?.url || '').trim();
      if (!albumUrl) {
        return [];
      }
      return searchSongs(albumUrl, 'tracks');
    },
    [searchSongs],
  );

  const startDownload = useCallback(
    async (
      song,
      index = null,
      downloadSetting = DEFAULT_DOWNLOAD_SETTING,
      _convertAacToMp3Enabled = false,
    ) => {
      const normalizedSetting = normalizeDownloadSetting(downloadSetting);
      const queued = createQueuedJob(song, index, normalizedSetting);
      jobsRef.current.set(queued.id, queued);
      emitActiveDownloadCount('queue-job');
      processQueue().catch(() => {});
      return cloneJob(queued);
    },
    [emitActiveDownloadCount, processQueue],
  );

  const getDownloadJobs = useCallback(async limit => {
    const list = Array.from(jobsRef.current.values())
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .slice(-(Number(limit) || MAX_STORED_JOBS));
    return list.map(cloneJob);
  }, []);

  const retryDownload = useCallback(
    async (
      jobId,
      fallbackSong = null,
      downloadSetting = DEFAULT_DOWNLOAD_SETTING,
      _convertAacToMp3Enabled = false,
    ) => {
      const job = jobsRef.current.get(jobId);
      if (!job) {
        throw new Error('Download job not found');
      }
      if (ACTIVE_STATUSES.has(job.status)) {
        throw new Error('Download is already in progress.');
      }

      const requestSong = normalizeSong(
        job?.request?.song ||
          fallbackSong || {
            title: job.title,
            artist: job.artist,
            album: job.album,
            artwork: job.artwork,
            duration: null,
          },
      );
      const setting = normalizeDownloadSetting(
        downloadSetting || job.downloadSetting,
      );
      cancelledJobsRef.current.delete(jobId);
      chunkStoreRef.current.delete(jobId);
      patchJob(jobId, {
        status: 'queued',
        spotdownStatus: 'pending',
        phase: 'queued',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
        song: null,
        request: {
          song: requestSong,
          index: Number.isInteger(job.requestIndex)
            ? job.requestIndex
            : Number.isInteger(job?.request?.index)
            ? job.request.index
            : null,
          downloadSetting: setting,
          convertAacToMp3Enabled: false,
        },
        downloadSetting: setting,
      });
      processQueue().catch(() => {});
      return cloneJob(jobsRef.current.get(jobId));
    },
    [patchJob, processQueue],
  );

  const cancelDownload = useCallback(
    async jobId => {
      const existing = jobsRef.current.get(jobId);
      if (!existing) {
        return true;
      }
      cancelledJobsRef.current.add(jobId);
      chunkStoreRef.current.delete(jobId);
      rejectDownloadSignal(jobId, 'Download cancelled.');

      const taskId = activeNativeDownloadRef.current.get(jobId);
      if (Number.isInteger(taskId)) {
        try {
          RNFS.stopDownload(taskId);
        } catch (_) {
          // Ignore stop errors.
        }
      }
      activeNativeDownloadRef.current.delete(jobId);
      activeJobIdsRef.current.delete(jobId);
      downloadTriggerAttemptRef.current.delete(jobId);
      jobsRef.current.delete(jobId);
      emitActiveDownloadCount('cancel-download');
      processQueue().catch(() => {});
      return true;
    },
    [emitActiveDownloadCount, processQueue, rejectDownloadSignal],
  );

  const syncConvertToMp3 = useCallback(async () => false, []);

  const handleBridgeMessage = useCallback(
    event => {
      const raw = String(event?.nativeEvent?.data || '').trim();
      if (!raw) {
        return;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        return;
      }
      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      const type = String(parsed?.type || '').trim();
      if (!type) {
        return;
      }

      if (onBridgeActivity) {
        try {
          onBridgeActivity({type, source: 'spotdown', payload: parsed});
        } catch (_) {
          // Ignore callback errors.
        }
      }

      if (type === 'SPOTDOWN_BRIDGE_READY') {
        bridgeReadyRef.current = true;
        flushBridgeReadyWaiters();
        return;
      }
      if (type === 'SPOTDOWN_SESSION_TOKEN') {
        const token = String(parsed?.token || '').trim() || null;
        const expires = Number(parsed?.expires) || 0;
        sessionTokenRef.current = {token, expires};
        tokenRefreshInFlightRef.current = false;
        if (token) {
          flushTokenWaiters();
        }
        return;
      }
      if (type === 'SPOTDOWN_BRIDGE_ACTIVITY') {
        const eventName = String(parsed?.event || '')
          .trim()
          .toLowerCase();
        const important =
          eventName.includes('download') ||
          eventName.includes('step') ||
          eventName.includes('anchor') ||
          eventName.includes('window-open');
        if (important) {
          log('Bridge activity event.', {
            event: eventName || null,
            url: String(parsed?.url || '').trim() || null,
            jobId: String(parsed?.jobId || '').trim() || null,
            index: Number.isFinite(Number(parsed?.index))
              ? Number(parsed.index)
              : null,
            title: String(parsed?.title || '').trim() || null,
          });
        }
        return;
      }
      if (type === 'SPOTDOWN_DIAG') {
        log('Bridge diagnostic event.', {
          jobId: String(parsed?.jobId || '').trim() || null,
          index: Number.isFinite(Number(parsed?.itemIndex))
            ? Number(parsed.itemIndex)
            : null,
          label: String(parsed?.label || '').trim() || 'unknown',
          data:
            parsed?.data && typeof parsed.data === 'object'
              ? parsed.data
              : {raw: parsed?.data ?? null},
        });
        return;
      }
      if (type === 'SPOTDOWN_RESULTS') {
        const requestId = String(parsed?.requestId || '').trim();
        const pending = pendingSearchRef.current;
        if (pending && requestId && pending.requestId === requestId) {
          const reason = String(parsed?.reason || '').trim();
          const nextResults = Array.isArray(parsed?.results)
            ? parsed.results
            : [];
          const isTerminalReason =
            reason === 'search-settled' ||
            reason === 'empty-query' ||
            reason === 'search-controls-not-found' ||
            reason === 'refresh-results';
          if (nextResults.length > 0 || isTerminalReason) {
            clearTimeout(pending.timeout);
            pendingSearchRef.current = null;
            pending.resolve(nextResults);
          }
        }
        return;
      }
      if (type === 'SPOTDOWN_DOWNLOAD_STARTED') {
        const jobId = String(parsed?.jobId || '').trim();
        if (!jobId || !jobsRef.current.has(jobId)) {
          return;
        }
        lastStartedDownloadJobIdRef.current = jobId;
        log('Bridge reported download started.', {
          jobId,
          title: String(parsed?.title || '').trim() || null,
          index: Number(parsed?.index),
        });
        patchJob(jobId, {
          status: 'preparing',
          spotdownStatus: 'active',
          phase: 'resolving',
          progress: 3,
        });
        return;
      }
      if (type === 'SPOTDOWN_DOWNLOAD_CHUNK') {
        const jobId = String(parsed?.jobId || '').trim();
        if (!jobId) {
          return;
        }
        const chunkIndex = Number(parsed?.chunkIndex);
        const chunkCount = Number(parsed?.chunkCount);
        const data = String(parsed?.data || '');
        if (!Number.isFinite(chunkIndex) || chunkIndex < 0 || !data) {
          return;
        }

        const existing = chunkStoreRef.current.get(jobId) || {
          parts: [],
          chunkCount: Number.isFinite(chunkCount) ? chunkCount : 0,
          totalBytes: Number(parsed?.totalBytes) || null,
          mimeType: String(parsed?.mimeType || '').trim() || null,
          filename: String(parsed?.filename || '').trim() || null,
        };
        existing.parts[chunkIndex] = data;
        if (Number.isFinite(chunkCount) && chunkCount > 0) {
          existing.chunkCount = chunkCount;
        }
        if (!existing.totalBytes && Number(parsed?.totalBytes) > 0) {
          existing.totalBytes = Number(parsed.totalBytes);
        }
        if (!existing.mimeType && parsed?.mimeType) {
          existing.mimeType = String(parsed.mimeType).trim();
        }
        if (!existing.filename && parsed?.filename) {
          existing.filename = String(parsed.filename).trim();
        }
        chunkStoreRef.current.set(jobId, existing);
        return;
      }
      if (type === 'SPOTDOWN_DOWNLOAD_URL') {
        const jobId = String(parsed?.jobId || '').trim();
        if (!jobId) {
          return;
        }
        log('Bridge reported download URL payload.', {
          jobId,
          hasUrl: Boolean(String(parsed?.url || '').trim()),
          hasChunkTransfer: Boolean(parsed?.chunkTransfer),
          status: Number(parsed?.status) || null,
          requestUrl: String(parsed?.requestUrl || '').trim() || null,
          responseUrl: String(parsed?.responseUrl || '').trim() || null,
        });
        const chunkMeta = parsed?.chunkTransfer || null;
        const store = chunkStoreRef.current.get(jobId);
        const payload = {
          ...parsed,
          chunkTransfer: chunkMeta
            ? {
                ...chunkMeta,
                parts: Array.isArray(chunkMeta?.parts)
                  ? chunkMeta.parts
                  : Array.isArray(store?.parts)
                  ? store.parts
                  : null,
                chunkCount:
                  Number(chunkMeta?.chunkCount) ||
                  Number(store?.chunkCount) ||
                  0,
                totalBytes:
                  Number(chunkMeta?.totalBytes) ||
                  Number(store?.totalBytes) ||
                  0,
                mimeType: chunkMeta?.mimeType || store?.mimeType || null,
                filename: chunkMeta?.filename || store?.filename || null,
              }
            : null,
        };
        resolveDownloadSignal(jobId, payload);
        return;
      }
      if (type === 'SPOTDOWN_DOWNLOAD_ERROR') {
        const jobId = String(parsed?.jobId || '').trim();
        const reason =
          String(parsed?.reason || '').trim() || 'Spotdown download failed.';
        log('Bridge reported download error.', {
          jobId: jobId || null,
          reason,
          status: Number(parsed?.status) || null,
          requestUrl: String(parsed?.requestUrl || '').trim() || null,
          responseUrl: String(parsed?.responseUrl || '').trim() || null,
        });
        if (
          jobId &&
          reason === 'no-download-request-detected' &&
          pendingDownloadSignalsRef.current.has(jobId)
        ) {
          const currentJob = jobsRef.current.get(jobId);
          const attempt = Number(
            downloadTriggerAttemptRef.current.get(jobId) || 1,
          );
          const maxRetryAttempts = 3;
          if (currentJob && attempt < maxRetryAttempts) {
            const nextAttempt = attempt + 1;
            downloadTriggerAttemptRef.current.set(jobId, nextAttempt);
            log('Retrying Spotdown download trigger after missing request.', {
              jobId,
              attempt: nextAttempt,
              title: currentJob?.title || null,
            });
            try {
              const retryIndex = Number.isInteger(currentJob.requestIndex)
                ? currentJob.requestIndex
                : Number.isInteger(currentJob?.request?.index)
                ? currentJob.request.index
                : 0;
              installPreDispatchDiagnostics(currentJob.id, retryIndex);
              sendBridgeCommand({
                type: 'SPOTDOWN_CMD_DOWNLOAD',
                jobId: currentJob.id,
                index: retryIndex,
                title:
                  String(
                    currentJob?.request?.song?.title ||
                      currentJob?.title ||
                      currentJob?.request?.song?.name ||
                      '',
                  ).trim() || null,
                artist:
                  String(
                    currentJob?.request?.song?.artist ||
                      currentJob?.artist ||
                      currentJob?.request?.song?.subtitle ||
                      '',
                  ).trim() || null,
                songId:
                  String(currentJob?.request?.song?.id || '').trim() || null,
              });
              return;
            } catch (retryError) {
              log('Failed to dispatch Spotdown retry command.', {
                jobId,
                attempt: nextAttempt,
                error: retryError?.message || String(retryError),
              });
            }
          }
        }
        if (jobId && rejectDownloadSignal(jobId, reason)) {
          return;
        }
        if (jobId && jobsRef.current.has(jobId)) {
          const job = jobsRef.current.get(jobId);
          const stillWaitingSignal =
            pendingDownloadSignalsRef.current.has(jobId);
          const isStaleNoRequestError =
            reason === 'no-download-request-detected' &&
            !stillWaitingSignal &&
            Boolean(job) &&
            (job.spotdownStatus === 'active' ||
              job.status === 'downloading' ||
              job.status === 'done');
          if (isStaleNoRequestError) {
            log('Ignoring stale bridge error after download intercept.', {
              jobId,
              reason,
              status: job?.status || null,
            });
            return;
          }
          patchJob(jobId, {
            status: 'failed',
            spotdownStatus: 'error',
            phase: 'failed',
            progress: 0,
            error: reason,
          });
        }
      }
    },
    [
      flushBridgeReadyWaiters,
      flushTokenWaiters,
      onBridgeActivity,
      installPreDispatchDiagnostics,
      log,
      patchJob,
      rejectDownloadSignal,
      resolveDownloadSignal,
      sendBridgeCommand,
    ],
  );

  const handleShouldStartLoadWithRequest = useCallback(
    request => {
      if (request?.isTopFrame === false) {
        return true;
      }
      const url = String(request?.url || '').trim();
      const allowed = isAllowedTopLevelNavigation(url);
      if (
        isLikelyDownloadNavigation(url) &&
        pendingDownloadSignalsRef.current.size > 0
      ) {
        const interceptedJobId = pickPendingSignalJobId(
          pendingDownloadSignalsRef.current,
          lastStartedDownloadJobIdRef.current,
        );
        if (interceptedJobId) {
          const filename = deriveFilenameFromUrl(url);
          log('Intercepted download navigation before load.', {
            jobId: interceptedJobId,
            url,
            filename,
            allowed,
          });
          resolveDownloadSignal(interceptedJobId, {
            url,
            status: 0,
            requestUrl: url,
            responseUrl: url,
            contentType: null,
            filename,
            chunkTransfer: null,
            allowApiUrl: url.toLowerCase().includes('/api/download'),
            method: url.toLowerCase().includes('/api/download')
              ? 'POST'
              : 'GET',
          });
          return false;
        }
      }
      if (!allowed) {
        log('Blocked external Spotdown navigation request.', {
          url: url || null,
        });
        if (
          isLikelyDownloadNavigation(url) &&
          pendingDownloadSignalsRef.current.size > 0
        ) {
          const interceptedJobId = pickPendingSignalJobId(
            pendingDownloadSignalsRef.current,
            lastStartedDownloadJobIdRef.current,
          );
          if (interceptedJobId) {
            const filename = deriveFilenameFromUrl(url);
            log('Intercepted download navigation, resolving signal.', {
              jobId: interceptedJobId,
              url,
              filename,
            });
            resolveDownloadSignal(interceptedJobId, {
              url,
              status: 0,
              requestUrl: url,
              responseUrl: url,
              contentType: null,
              filename,
              chunkTransfer: null,
              allowApiUrl: url.toLowerCase().includes('/api/download'),
              method: url.toLowerCase().includes('/api/download')
                ? 'POST'
                : 'GET',
            });
          }
        }
        return false;
      }
      return true;
    },
    [log, resolveDownloadSignal],
  );

  const handleFileDownload = useCallback(
    event => {
      const payload = event?.nativeEvent || event || {};
      const url = String(payload?.downloadUrl || payload?.url || '').trim();
      if (!url) {
        return;
      }
      const lowerUrl = url.toLowerCase();
      if (lowerUrl.startsWith('blob:')) {
        log('Ignoring file-download intercept for blob URL.', {url});
        return;
      }
      log('Intercepted WebView file download.', {url});
      const interceptedJobId = pickPendingSignalJobId(
        pendingDownloadSignalsRef.current,
        lastStartedDownloadJobIdRef.current,
      );
      if (!interceptedJobId) {
        return;
      }
      const filename = deriveFilenameFromUrl(url);
      log('Resolving download signal from file-download intercept.', {
        jobId: interceptedJobId,
        url,
        filename,
      });
      resolveDownloadSignal(interceptedJobId, {
        url,
        status: 0,
        requestUrl: url,
        responseUrl: url,
        contentType: null,
        filename,
        chunkTransfer: null,
      });
    },
    [log, resolveDownloadSignal],
  );

  const handleWebViewLoadStart = useCallback(
    event => {
      const url = String(event?.nativeEvent?.url || '').trim();
      if (!isAllowedTopLevelNavigation(url)) {
        log('Ignoring Spotdown load-start for disallowed URL.', {
          url: url || null,
        });
        return;
      }
      resetBridgeState();
    },
    [log, resetBridgeState],
  );

  const handleWebViewLoadEnd = useCallback(
    event => {
      const url = String(event?.nativeEvent?.url || '').trim();
      if (!isAllowedTopLevelNavigation(url)) {
        recoverSpotdownWebView('load-end-disallowed-url');
        return;
      }
      // Bridge-ready is emitted from injected JS after each load.
    },
    [recoverSpotdownWebView],
  );

  const webViewProps = useMemo(
    () => ({
      source: {uri: SPOTDOWN_WEB_URL},
      originWhitelist: ['*'],
      javaScriptEnabled: true,
      domStorageEnabled: true,
      userAgent: SPOTDOWN_ANDROID_UA,
      sharedCookiesEnabled: true,
      thirdPartyCookiesEnabled: true,
      setSupportMultipleWindows: false,
      mixedContentMode: 'always',
      injectedJavaScriptBeforeContentLoaded: SPOTDOWN_BRIDGE_SCRIPT,
      injectedJavaScript: SPOTDOWN_BRIDGE_SCRIPT,
      onShouldStartLoadWithRequest: handleShouldStartLoadWithRequest,
      onFileDownload: handleFileDownload,
      hasOnFileDownload: true,
      onLoadStart: handleWebViewLoadStart,
      onLoadEnd: handleWebViewLoadEnd,
      onMessage: handleBridgeMessage,
      onError: event => {
        const nativeEvent = event?.nativeEvent || null;
        log('WebView onError.', nativeEvent);
        recoverSpotdownWebView('on-error');
      },
      onHttpError: event => {
        const nativeEvent = event?.nativeEvent || null;
        log('WebView onHttpError.', nativeEvent);
        recoverSpotdownWebView('http-error');
      },
      onNavigationStateChange: navState => {
        const url = String(navState?.url || '').trim();
        const allowed = isAllowedTopLevelNavigation(url);
        log('WebView navigation changed.', {
          url: url || null,
          loading: Boolean(navState?.loading),
          canGoBack: Boolean(navState?.canGoBack),
          allowed,
        });
        if (!allowed) {
          recoverSpotdownWebView('navigation-disallowed-url');
        }
      },
    }),
    [
      handleBridgeMessage,
      handleFileDownload,
      handleShouldStartLoadWithRequest,
      handleWebViewLoadEnd,
      handleWebViewLoadStart,
      log,
      recoverSpotdownWebView,
    ],
  );

  useEffect(
    () => () => {
      rejectTokenWaiters('Spotdown hook unmounted.');
      if (pendingSearchRef.current) {
        clearTimeout(pendingSearchRef.current.timeout);
        pendingSearchRef.current.reject(new Error('Spotdown hook unmounted.'));
        pendingSearchRef.current = null;
      }
      pendingDownloadSignalsRef.current.forEach(signal => {
        clearTimeout(signal.timeout);
        signal.reject(new Error('Spotdown hook unmounted.'));
      });
      pendingDownloadSignalsRef.current.clear();
      lastStartedDownloadJobIdRef.current = null;
      downloadTriggerAttemptRef.current.clear();
    },
    [rejectTokenWaiters],
  );

  return {
    webViewRef,
    webViewProps,
    searchSongs,
    getAlbumTracks,
    startDownload,
    getDownloadJobs,
    retryDownload,
    cancelDownload,
    syncConvertToMp3,
  };
}

export default useSpotdownWebViewDownloader;
