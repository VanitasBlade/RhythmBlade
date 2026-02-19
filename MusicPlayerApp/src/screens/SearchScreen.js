import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import apiService from '../services/api';
import playbackService from '../services/playback';
import storageService from '../services/storage';

const DOWNLOAD_OPTIONS = [
  {label: 'Hi-Res', description: '24-bit FLAC (DASH) up to 192 kHz'},
  {label: 'CD Lossless', description: '16-bit / 44.1 kHz FLAC'},
  {label: '320kbps AAC', description: 'High quality AAC streaming'},
  {label: '96kbps AAC', description: 'Data saver AAC streaming'},
];

const TABS = ['Tracks', 'Albums', 'Artists', 'Playlists'];

const SearchScreen = ({navigation}) => {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('Tracks');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloadSetting, setDownloadSetting] = useState('Hi-Res');

  useEffect(() => {
    const loadSettings = async () => {
      const settings = await storageService.getSettings();
      if (settings?.downloadSetting) {
        setDownloadSetting(settings.downloadSetting);
      }
    };
    loadSettings();
  }, []);

  const currentOption = useMemo(
    () =>
      DOWNLOAD_OPTIONS.find(option => option.label === downloadSetting) ||
      DOWNLOAD_OPTIONS[0],
    [downloadSetting],
  );

  const persistDownloadSetting = async nextSetting => {
    setDownloadSetting(nextSetting);
    const settings = await storageService.getSettings();
    await storageService.saveSettings({
      ...settings,
      downloadSetting: nextSetting,
    });
  };

  const searchSongs = async () => {
    if (!query.trim()) {
      return;
    }

    try {
      setLoading(true);
      setResults([]);
      const songs = await apiService.searchSongs(
        query.trim(),
        activeTab.toLowerCase(),
      );
      setResults(songs);
      if (songs.length === 0) {
        Alert.alert(
          'No Results',
          `No ${activeTab.toLowerCase()} found for your search.`,
        );
      }
    } catch (error) {
      Alert.alert(
        'Search Error',
        error.message || 'Failed to search. Please check your connection.',
      );
    } finally {
      setLoading(false);
    }
  };

  const downloadSong = async (item, index) => {
    if (!item.downloadable || downloading[index]) {
      return;
    }

    try {
      setDownloading(prev => ({...prev, [index]: true}));
      const track = await apiService.downloadSong(item, index, downloadSetting);
      await storageService.addToLibrary(track);

      Alert.alert(
        'Download Complete',
        `"${item.title}" has been added to your library.`,
        [
          {text: 'OK'},
          {
            text: 'Play Now',
            onPress: async () => {
              await playbackService.reset();
              await playbackService.addTrack(track);
              await playbackService.play();
              navigation.navigate('NowPlaying');
            },
          },
        ],
      );
    } catch (error) {
      Alert.alert(
        'Download Failed',
        error.message || 'Failed to download. Please try again.',
      );
    } finally {
      setDownloading(prev => ({...prev, [index]: false}));
    }
  };

  const renderResult = ({item, index}) => (
    <View style={styles.resultCard}>
      <View style={styles.resultLeft}>
        {item.artwork ? (
          <Image source={{uri: item.artwork}} style={styles.artworkImage} />
        ) : (
          <View style={styles.artworkPlaceholder}>
            <Icon name="music-note" size={20} color="#8fa7d5" />
          </View>
        )}
      </View>

      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.resultArtist} numberOfLines={1}>
          {item.artist || item.subtitle || activeTab}
        </Text>
        {!!item.subtitle && (
          <Text style={styles.resultMeta} numberOfLines={1}>
            {item.subtitle}
          </Text>
        )}
      </View>

      {item.downloadable ? (
        <TouchableOpacity
          style={[
            styles.downloadButton,
            downloading[index] && styles.downloadButtonBusy,
          ]}
          onPress={() => downloadSong(item, index)}
          disabled={downloading[index]}>
          {downloading[index] ? (
            <ActivityIndicator size="small" color="#dbe6ff" />
          ) : (
            <Icon name="download-outline" size={22} color="#dbe6ff" />
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const renderEmpty = () => {
    if (loading) {
      return null;
    }

    return (
      <View style={styles.emptyContainer}>
        <Icon name="cloud-search-outline" size={64} color="#6984ba" />
        <Text style={styles.emptyTitle}>
          {query
            ? `No ${activeTab.toLowerCase()} found`
            : `Search ${activeTab.toLowerCase()}`}
        </Text>
        <Text style={styles.emptySubtitle}>
          Try song title, artist, album, or paste a URL.
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>SquidWTF</Text>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => setSettingsOpen(true)}>
          <Icon name="cog-outline" size={18} color="#dbe6ff" />
          <Text style={styles.settingsLabel}>Settings</Text>
          <Text style={styles.settingsValue}>{currentOption.label}</Text>
          <Icon name="chevron-down" size={18} color="#9bb5e2" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchInputWrap}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search for tracks, albums, artists... or paste a URL"
            placeholderTextColor="#6e85b5"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={searchSongs}
            returnKeyType="search"
          />
        </View>
        <TouchableOpacity
          style={[
            styles.searchButton,
            (!query.trim() || loading) && styles.searchButtonDisabled,
          ]}
          onPress={searchSongs}
          disabled={!query.trim() || loading}>
          {loading ? (
            <ActivityIndicator size="small" color="#dbe6ff" />
          ) : (
            <>
              <Icon name="magnify" size={20} color="#dbe6ff" />
              <Text style={styles.searchButtonText}>Search</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.tabsRow}>
        {TABS.map(tab => {
          const active = tab === activeTab;
          return (
            <TouchableOpacity
              key={tab}
              style={styles.tabButton}
              onPress={() => {
                setActiveTab(tab);
                setResults([]);
              }}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {tab}
              </Text>
              {active ? <View style={styles.tabUnderline} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={results}
        renderItem={renderResult}
        keyExtractor={(item, index) =>
          `${item.type || activeTab}-${item.title}-${index}`
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
      />

      <Modal
        transparent
        visible={settingsOpen}
        animationType="fade"
        onRequestClose={() => setSettingsOpen(false)}>
        <TouchableOpacity
          activeOpacity={1}
          style={styles.modalBackdrop}
          onPress={() => setSettingsOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Streaming & Downloads</Text>
            {DOWNLOAD_OPTIONS.map(option => {
              const selected = option.label === downloadSetting;
              return (
                <TouchableOpacity
                  key={option.label}
                  style={[
                    styles.optionRow,
                    selected && styles.optionRowSelected,
                  ]}
                  onPress={async () => {
                    await persistDownloadSetting(option.label);
                    setSettingsOpen(false);
                  }}>
                  <View style={styles.optionTextWrap}>
                    <Text style={styles.optionTitle}>{option.label}</Text>
                    <Text style={styles.optionSubtitle}>
                      {option.description}
                    </Text>
                  </View>
                  {selected ? (
                    <Icon name="check" size={18} color="#dbe6ff" />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07142f',
  },
  topBar: {
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#16305e',
    backgroundColor: '#06112a',
  },
  brand: {
    fontSize: 30,
    color: '#eaf1ff',
    fontWeight: '800',
  },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1f69d4',
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#091d45',
  },
  settingsLabel: {
    color: '#dbe6ff',
    fontWeight: '700',
    fontSize: 14,
  },
  settingsValue: {
    color: '#8ea6d6',
    fontWeight: '700',
    fontSize: 14,
  },
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  searchInputWrap: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e3f78',
    backgroundColor: '#091b40',
    paddingHorizontal: 14,
    justifyContent: 'center',
    minHeight: 54,
  },
  searchInput: {
    color: '#eaf1ff',
    fontSize: 17,
  },
  searchButton: {
    minWidth: 110,
    borderRadius: 14,
    backgroundColor: '#1f69d4',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  searchButtonDisabled: {
    opacity: 0.6,
  },
  searchButtonText: {
    color: '#dbe6ff',
    fontSize: 24,
    fontWeight: '800',
  },
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1b3768',
    paddingHorizontal: 16,
  },
  tabButton: {
    marginRight: 18,
    paddingVertical: 12,
  },
  tabText: {
    color: '#90a7d3',
    fontSize: 17,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#67a7ff',
  },
  tabUnderline: {
    height: 2,
    backgroundColor: '#67a7ff',
    marginTop: 10,
  },
  listContent: {
    padding: 16,
    paddingBottom: 110,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1b3565',
    backgroundColor: '#0b1f4a',
    padding: 12,
    marginBottom: 12,
  },
  resultLeft: {
    marginRight: 12,
  },
  artworkImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  artworkPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#102a5f',
  },
  resultInfo: {
    flex: 1,
  },
  resultTitle: {
    color: '#e9f1ff',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 2,
  },
  resultArtist: {
    color: '#c2d2ef',
    fontSize: 17,
    marginBottom: 3,
  },
  resultMeta: {
    color: '#7f97c4',
    fontSize: 15,
  },
  downloadButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: '#2d5397',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0c234f',
  },
  downloadButtonBusy: {
    opacity: 0.75,
  },
  emptyContainer: {
    paddingTop: 90,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    marginTop: 14,
    color: '#d8e5ff',
    fontSize: 20,
    fontWeight: '700',
  },
  emptySubtitle: {
    marginTop: 8,
    color: '#829ac6',
    fontSize: 14,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(3, 12, 27, 0.72)',
    justifyContent: 'flex-start',
    paddingTop: 120,
    paddingHorizontal: 18,
  },
  modalCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#235cb8',
    backgroundColor: '#081a3f',
    padding: 12,
  },
  modalTitle: {
    color: '#dbe8ff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  optionRow: {
    borderWidth: 1,
    borderColor: '#1a3468',
    borderRadius: 14,
    backgroundColor: '#081a3f',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionRowSelected: {
    borderColor: '#2b7bf0',
    backgroundColor: '#0c2758',
  },
  optionTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  optionTitle: {
    color: '#e3edff',
    fontSize: 22,
    fontWeight: '700',
  },
  optionSubtitle: {
    color: '#90a6d1',
    fontSize: 14,
    marginTop: 2,
  },
});

export default SearchScreen;
