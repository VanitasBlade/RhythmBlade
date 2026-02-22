import {Dimensions, StyleSheet} from 'react-native';
import {MUSIC_HOME_THEME as C} from '../../theme/musicHomeTheme';

const {width} = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  headerText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
  artworkContainer: {
    alignItems: 'center',
    marginVertical: 40,
  },
  artwork: {
    width: width - 80,
    height: width - 80,
    borderRadius: 12,
  },
  placeholderArtwork: {
    width: width - 80,
    height: width - 80,
    borderRadius: 12,
    backgroundColor: C.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trackInfo: {
    paddingHorizontal: 40,
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: C.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  artist: {
    fontSize: 18,
    color: C.textDim,
    textAlign: 'center',
    marginBottom: 4,
  },
  album: {
    fontSize: 14,
    color: C.textMute,
    textAlign: 'center',
  },
  progressContainer: {
    paddingHorizontal: 30,
    marginBottom: 20,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  timeText: {
    fontSize: 12,
    color: C.textDim,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  playButton: {
    marginHorizontal: 20,
  },
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 60,
    marginBottom: 40,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 18,
    color: C.textDim,
    marginTop: 20,
  },
});

export default styles;
