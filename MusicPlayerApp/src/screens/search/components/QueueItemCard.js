import React from 'react';
import {
  ActivityIndicator,
  Image,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {ACTIVE_QUEUE_STATUSES} from '../search.constants';
import {
  getFallbackArtColor,
  getQueueStatusLabel,
  getQueueSubtitle,
} from '../search.utils';
import styles from '../search.styles';
import {MUSIC_HOME_THEME as C} from '../../../theme/musicHomeTheme';

const QueueItemCard = ({item, retrying, canceling, onRetry, onCancel}) => {
  const progress = Number.isFinite(item.progress)
    ? Math.max(0, Math.min(100, Math.round(item.progress)))
    : 0;
  const active = ACTIVE_QUEUE_STATUSES.has(item.status || 'queued');
  const done = item.status === 'done';
  const failed = item.status === 'failed';
  const fallbackColor = getFallbackArtColor(item);
  const barColor = failed ? '#9b1c1c' : done ? C.textDeep : C.accent;
  const statusColor = failed ? '#f87171' : done ? C.accentFg : C.accent;

  return (
    <View style={styles.queueCardShell}>
      <View style={[styles.queueCard, failed && styles.queueCardFailed]}>
        <View style={[styles.queueAccent, {backgroundColor: barColor}]} />
        <View
          style={[styles.queueArtworkWrap, {backgroundColor: fallbackColor}]}>
          {item.artwork ? (
            <Image source={{uri: item.artwork}} style={styles.queueArtwork} />
          ) : (
            <Icon name="music-note" size={22} color={C.accentFg} />
          )}
        </View>
        <View style={styles.queueInfo}>
          <View style={styles.queueHeader}>
            <Text style={styles.queueTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[styles.queueStatus, {color: statusColor}]}>
              {getQueueStatusLabel(item)}
            </Text>
          </View>
          <View style={styles.queueProgressTrack}>
            <View
              style={[
                styles.queueProgressFill,
                {width: `${progress}%`, backgroundColor: barColor},
              ]}
            />
          </View>
          <Text style={styles.queueMeta} numberOfLines={1}>
            {getQueueSubtitle(item)}
          </Text>
        </View>
        <View style={styles.queueActionWrap}>
          {failed ? (
            <TouchableOpacity
              style={[
                styles.retrySquareButton,
                retrying && styles.retrySquareButtonBusy,
              ]}
              onPress={() => onRetry(item)}
              disabled={retrying}>
              {retrying ? (
                <ActivityIndicator size="small" color={C.accentFg} />
              ) : (
                <Icon name="refresh" size={15} color={C.accentFg} />
              )}
            </TouchableOpacity>
          ) : active ? (
            <TouchableOpacity
              style={[
                styles.cancelSquareButton,
                canceling && styles.cancelSquareButtonBusy,
              ]}
              onPress={() => onCancel(item)}
              disabled={canceling}>
              {canceling ? (
                <ActivityIndicator size="small" color={C.textDim} />
              ) : (
                <Icon name="close" size={15} color={C.textDim} />
              )}
            </TouchableOpacity>
          ) : done ? (
            <View style={styles.queueDoneState}>
              <Icon name="check-all" size={18} color={C.accentFg} />
            </View>
          ) : (
            <View style={styles.queueActionSpacer} />
          )}
        </View>
      </View>
    </View>
  );
};

export default React.memo(QueueItemCard);
