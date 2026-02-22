import {Dimensions, Platform, StatusBar, StyleSheet} from 'react-native';
import {MUSIC_HOME_THEME as C} from '../../theme/musicHomeTheme';

const {width} = Dimensions.get('window');
const topInset = Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;
const headerTopPadding = topInset + (Platform.OS === 'ios' ? 46 : 16);
const menuTop = headerTopPadding + 42;

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
    paddingTop: headerTopPadding,
    paddingBottom: 14,
  },
  headerText: {
    fontSize: 22,
    fontWeight: '700',
    color: C.text,
  },
  headerIconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {width: 36, height: 36},
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
    height: 112,
    marginBottom: 30,
    justifyContent: 'flex-start',
  },
  title: {
    fontSize: 23,
    lineHeight: 31,
    fontWeight: 'bold',
    color: C.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  artist: {
    fontSize: 18,
    lineHeight: 24,
    color: C.textDim,
    textAlign: 'center',
    marginBottom: 0,
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
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 15,
  },
  optionsMenu: {
    position: 'absolute',
    top: menuTop,
    right: 20,
    minWidth: 152,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    overflow: 'hidden',
    zIndex: 20,
  },
  menuOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  menuOptionDanger: {
    borderTopWidth: 1,
    borderTopColor: C.borderDim,
  },
  menuOptionText: {
    color: C.textDim,
    fontSize: 13,
    fontWeight: '600',
  },
  menuOptionTextDanger: {
    color: '#f57f86',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 5, 18, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    color: C.text,
    fontSize: 21,
    fontWeight: '700',
  },
  detailRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: C.borderDim,
  },
  detailLabel: {
    color: C.textMute,
    fontSize: 12,
    marginBottom: 3,
  },
  detailValue: {
    color: C.text,
    fontSize: 14,
    fontWeight: '600',
  },
  queueOverlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 5, 18, 0.78)',
    justifyContent: 'flex-end',
  },
  queueCard: {
    maxHeight: '68%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 18,
  },
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  queueHeaderTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: '700',
  },
  queueHeaderMeta: {
    color: C.textMute,
    fontSize: 12,
    marginTop: 2,
  },
  queueListContent: {
    paddingBottom: 8,
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    backgroundColor: C.bg,
    minHeight: 58,
    paddingRight: 10,
    marginBottom: 8,
  },
  queueItemActive: {
    borderColor: C.accent,
    backgroundColor: '#1f153e',
  },
  queueArtwork: {
    width: 58,
    height: 58,
    borderTopLeftRadius: 7,
    borderBottomLeftRadius: 7,
  },
  queueArtworkFallback: {
    width: 58,
    height: 58,
    borderTopLeftRadius: 7,
    borderBottomLeftRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueMeta: {
    flex: 1,
    paddingHorizontal: 10,
  },
  queueTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
  },
  queueArtist: {
    marginTop: 2,
    color: C.textMute,
    fontSize: 12,
  },
  queueEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 42,
  },
  queueEmptyText: {
    marginTop: 10,
    color: C.textDim,
    fontSize: 14,
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
