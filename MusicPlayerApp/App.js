import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import TrackPlayer from 'react-native-track-player';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { MUSIC_HOME_THEME as C } from './src/theme/musicHomeTheme';

// Services
import networkService from './src/services/network/NetworkService';
import playbackService, {
  PlaybackServiceHandler,
} from './src/services/playback/PlaybackService';
import storageService from './src/services/storage/StorageService';
import appDialogService from './src/services/ui/AppDialogService';

// Screens
import HomeScreen from './src/screens/home/HomeScreen';
import LibraryScreen from './src/screens/library/LibraryScreen';
import NowPlayingScreen from './src/screens/nowPlaying/NowPlayingScreen';
import PlaylistDetailScreen from './src/screens/playlistDetail/PlaylistDetailScreen';
import SearchScreen from './src/screens/search/SearchScreen';
import SettingsScreen from './src/screens/settings/SettingsScreen';

// Components
import AppDialogHost from './src/components/AppDialogHost';
import MiniPlayer from './src/components/MiniPlayer';

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
  cardStyle: { backgroundColor: C.bg },
};

const createTabIcon =
  iconName =>
    ({ color, size }) =>
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
      <Tab.Navigator
        detachInactiveScreens={false}
        lazy={false}
        screenOptions={TAB_SCREEN_OPTIONS}>
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
    let cancelled = false;
    const initializeApp = async () => {
      try {
        await Promise.all([
          playbackService.initialize(),
          storageService.getLocalLibrary(),
        ]);
        networkService.initialize();
      } catch (error) {
        console.error('App bootstrap failed:', error);
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }

      if (!cancelled) {
        storageService
          .runLibrarySyncInBackground({
            recursive: true,
            promptForPermission: true,
            readEmbeddedTextMetadata: true,
          })
          .catch(error => {
            console.error('Background library sync failed:', error);
          });
      }
    };

    initializeApp();

    return () => {
      cancelled = true;
      networkService.cleanup();
    };
  }, []);

  if (bootstrapping) {
    return (
      <View style={styles.bootContainer}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <ActivityIndicator size="small" color={C.accentFg} />
        <Text style={styles.bootText}>Loading your library...</Text>
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
