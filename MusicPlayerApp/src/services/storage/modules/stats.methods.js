import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../storage.constants';

const getTodayDateString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const statsMethods = {
    async getListeningStats() {
        try {
            const stored = await AsyncStorage.getItem(STORAGE_KEYS.LISTENING_STATS);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.error('Error reading listening stats:', error);
        }
        return {
            dailyListening: {}, // { 'YYYY-MM-DD': seconds }
            songPlays: {},      // { 'trackId': playCount }
            artistPlays: {},    // { 'artistName': playCount }
            topSongData: null   // { id, title, artist, artwork, playCount }
        };
    },

    async recordListeningActivity(track, durationListenedSeconds) {
        if (!track || durationListenedSeconds <= 0) return;

        try {
            const stats = await this.getListeningStats();
            const today = getTodayDateString();

            // Ensure stats format
            stats.dailyListening = stats.dailyListening || {};
            stats.songPlays = stats.songPlays || {};
            stats.artistPlays = stats.artistPlays || {};

            // 1. Record daily listening duration (in seconds)
            stats.dailyListening[today] = (stats.dailyListening[today] || 0) + durationListenedSeconds;

            // 2. We only count a "play" if the user listened for at least 15 seconds (or the full duration if it's very short)
            const trackDuration = Number(track.duration) || 0;
            const isSignificantPlay = durationListenedSeconds >= 15 || (trackDuration > 0 && durationListenedSeconds >= trackDuration * 0.5);

            if (isSignificantPlay) {
                const trackId = track.id;
                stats.songPlays[trackId] = (stats.songPlays[trackId] || 0) + 1;

                if (track.artist && track.artist !== 'Unknown Artist') {
                    stats.artistPlays[track.artist] = (stats.artistPlays[track.artist] || 0) + 1;
                }

                // Update top song if this song now has more plays
                const currentTopPlays = stats.topSongData ? stats.topSongData.playCount : 0;
                if (stats.songPlays[trackId] > currentTopPlays || stats.topSongData?.id === trackId) {
                    stats.topSongData = {
                        id: trackId,
                        title: track.title,
                        artist: track.artist,
                        artwork: track.artwork,
                        playCount: stats.songPlays[trackId],
                    };
                }
            }

            await AsyncStorage.setItem(STORAGE_KEYS.LISTENING_STATS, JSON.stringify(stats));
        } catch (error) {
            console.error('Error saving listening stats:', error);
        }
    }
};
