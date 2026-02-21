import React from 'react';
import {StyleSheet, View} from 'react-native';
import {MUSIC_HOME_THEME as C} from '../theme/musicHomeTheme';

const SettingsScreen = () => <View style={styles.container} />;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
});

export default SettingsScreen;
