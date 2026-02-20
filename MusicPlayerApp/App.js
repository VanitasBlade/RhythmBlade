import React, { useEffect } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import TrackPlayer from 'react-native-track-player';

// Services
import playbackService, { PlaybackServiceHandler } from './src/services/playback';
import networkService from './src/services/network';

// Screens
import HomeScreen from './src/screens/HomeScreen';
import SearchScreen from './src/screens/SearchScreen';
import LibraryScreen from './src/screens/LibraryScreen';
import PlaylistsScreen from './src/screens/PlaylistsScreen';
import PlaylistDetailScreen from './src/screens/PlaylistDetailScreen';
import NowPlayingScreen from './src/screens/NowPlayingScreen';

// Components
import MiniPlayer from './src/components/MiniPlayer';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const TAB_SCREEN_OPTIONS = {
  headerShown: false,
  tabBarStyle: {
    backgroundColor: '#1a1a1a',
    borderTopColor: '#2a2a2a',
    height: 60,
    paddingBottom: 8,
    paddingTop: 8,
  },
  tabBarActiveTintColor: '#1DB954',
  tabBarInactiveTintColor: '#666',
};

const STACK_SCREEN_OPTIONS = {
  headerShown: false,
  cardStyle: { backgroundColor: '#121212' },
};

const createTabIcon = iconName => ({color, size}) =>
  <Icon name={iconName} size={size} color={color} />;

const tabIcons = {
  Home: createTabIcon('home'),
  Search: createTabIcon('cloud-download'),
  Library: createTabIcon('music-box-multiple'),
  Playlists: createTabIcon('playlist-music'),
};

// Register the playback service
TrackPlayer.registerPlaybackService(() => PlaybackServiceHandler);

function TabNavigator() {
  return (
    <View style={styles.container}>
      <Tab.Navigator
        screenOptions={TAB_SCREEN_OPTIONS}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            tabBarIcon: tabIcons.Home,
          }}
        />
        <Tab.Screen
          name="Search"
          component={SearchScreen}
          options={{
            tabBarIcon: tabIcons.Search,
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
          name="Playlists"
          component={PlaylistsScreen}
          options={{
            tabBarIcon: tabIcons.Playlists,
          }}
        />
      </Tab.Navigator>
      <MiniPlayer />
    </View>
  );
}

function App() {
  useEffect(() => {
    const initializeApp = async () => {
      // Initialize playback service
      await playbackService.initialize();
      
      // Initialize network monitoring
      networkService.initialize();
    };

    initializeApp();

    return () => {
      networkService.cleanup();
    };
  }, []);

  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor="#121212" />
      <Stack.Navigator
        screenOptions={STACK_SCREEN_OPTIONS}
      >
        <Stack.Screen name="MainTabs" component={TabNavigator} />
        <Stack.Screen
          name="NowPlaying"
          component={NowPlayingScreen}
          options={{
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="PlaylistDetail"
          component={PlaylistDetailScreen}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
