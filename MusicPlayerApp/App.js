import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Alert, StatusBar, StyleSheet, Text, View} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import TrackPlayer from 'react-native-track-player';
import {MUSIC_HOME_THEME as C} from './src/theme/musicHomeTheme';

// Services
import playbackService, {
  PlaybackServiceHandler,
} from './src/services/playback/PlaybackService';
import networkService from './src/services/network/NetworkService';
import storageService from './src/services/storage/StorageService';
import appDialogService from './src/services/ui/AppDialogService';

// Screens
import HomeScreen from './src/screens/home/HomeScreen';
import SearchScreen from './src/screens/search/SearchScreen';
import LibraryScreen from './src/screens/library/LibraryScreen';
import SettingsScreen from './src/screens/settings/SettingsScreen';
import PlaylistDetailScreen from './src/screens/playlistDetail/PlaylistDetailScreen';
import NowPlayingScreen from './src/screens/nowPlaying/NowPlayingScreen';

// Components
import MiniPlayer from './src/components/MiniPlayer';
import AppDialogHost from './src/components/AppDialogHost';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const TAB_SCREEN_OPTIONS = {
  headerShown: false,
  tabBarStyle: {
    backgroundColor: C.bgDeep,
    borderTopColor: C.borderDim,
    height: 68,
    paddingBottom: 10,
    paddingTop: 8,
  },
  tabBarActiveTintColor: C.accentFg,
  tabBarInactiveTintColor: C.textDeep,
  tabBarLabelStyle: {
    fontSize: 11,
    fontWeight: '600',
  },
};

const STACK_SCREEN_OPTIONS = {
  headerShown: false,
  cardStyle: {backgroundColor: C.bg},
};

const createTabIcon =
  iconName =>
  ({color, size}) =>
    <Icon name={iconName} size={size} color={color} />;

const tabIcons = {
  Home: createTabIcon('home'),
  Library: createTabIcon('music-box-multiple'),
  Search: createTabIcon('download'),
  Settings: createTabIcon('cog'),
};

// Register the playback service
TrackPlayer.registerPlaybackService(() => PlaybackServiceHandler);

function TabNavigator() {
  return (
    <View style={styles.container}>
      <Tab.Navigator screenOptions={TAB_SCREEN_OPTIONS}>
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            tabBarIcon: tabIcons.Home,
          }}
        />
        <Tab.Screen
          name="Library"
          component={LibraryScreen}
          options={{
            tabBarIcon: tabIcons.Library,
          }}
        />
        <Tab.Screen
          name="Search"
          component={SearchScreen}
          options={{
            tabBarIcon: tabIcons.Search,
            tabBarLabel: 'Downloader',
            tabBarHideOnKeyboard: true,
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarIcon: tabIcons.Settings,
          }}
        />
      </Tab.Navigator>
      <MiniPlayer />
    </View>
  );
}

function App() {
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    const nativeAlert = Alert.alert.bind(Alert);
    appDialogService.setNativeAlert(nativeAlert);
    try {
      Alert.alert = (...args) => {
        appDialogService.alert(...args);
      };
    } catch (error) {
      console.error('Could not override Alert.alert:', error);
    }

    return () => {
      try {
        Alert.alert = nativeAlert;
      } catch (error) {
        // noop
      }
    };
  }, []);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        await playbackService.initialize();
        networkService.initialize();

        await storageService.syncEnabledFileSourcesToLibrary({
          recursive: true,
          promptForPermission: true,
          migrateArtwork: true,
          migrateDuration: true,
        });
      } catch (error) {
        console.error('App bootstrap failed:', error);
      } finally {
        setBootstrapping(false);
      }
    };

    initializeApp();

    return () => {
      networkService.cleanup();
    };
  }, []);

  if (bootstrapping) {
    return (
      <View style={styles.bootContainer}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <ActivityIndicator size="small" color={C.accentFg} />
        <Text style={styles.bootText}>Syncing music library...</Text>
        <AppDialogHost />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <Stack.Navigator screenOptions={STACK_SCREEN_OPTIONS}>
        <Stack.Screen name="MainTabs" component={TabNavigator} />
        <Stack.Screen
          name="NowPlaying"
          component={NowPlayingScreen}
          options={{
            presentation: 'modal',
          }}
        />
        <Stack.Screen name="PlaylistDetail" component={PlaylistDetailScreen} />
      </Stack.Navigator>
      <AppDialogHost />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bootContainer: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bootText: {
    marginTop: 12,
    color: C.textDim,
    fontSize: 14,
    fontWeight: '600',
  },
});

export default App;
