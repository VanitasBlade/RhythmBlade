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
import {formatDuration, getFallbackArtColor} from '../search.utils';
import styles from '../search.styles';
import {MUSIC_HOME_THEME as C} from '../../../theme/musicHomeTheme';

const SearchResultCard = ({
  item,
  index,
  activeSearchType,
  linkedJob,
  isQueuing,
  onQueueDownload,
  onPress,
}) => {
  const isActive = linkedJob
    ? ACTIVE_QUEUE_STATUSES.has(linkedJob.status)
    : false;
  const isDone = linkedJob?.status === 'done';
  const isFailed = linkedJob?.status === 'failed';
  const navigable = typeof onPress === 'function';
  const disabled =
    !item.downloadable || isQueuing || isActive || isDone || navigable;
  const durationText = formatDuration(item.duration);
  const fallbackColor = getFallbackArtColor(item);
  const CardContainer = navigable ? TouchableOpacity : View;
  const cardProps = navigable
    ? {
        activeOpacity: 0.85,
        onPress: () => onPress(item, item?.index ?? index),
      }
    : {};

  return (
    <CardContainer style={styles.resultCard} {...cardProps}>
      <View
        style={[styles.resultArtworkShell, {backgroundColor: fallbackColor}]}>
        {item.artwork ? (
          <Image
            source={{uri: item.artwork}}
            style={styles.resultArtworkImage}
          />
        ) : (
          <Icon name="music-note" size={22} color={C.accentFg} />
        )}
      </View>

      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.resultArtist} numberOfLines={1}>
          {item.artist || item.subtitle || activeSearchType}
        </Text>
        {!!item.subtitle && (
          <Text style={styles.resultMeta} numberOfLines={1}>
            {item.subtitle}
          </Text>
        )}
      </View>

      <View style={styles.resultRight}>
        {navigable ? (
          <Icon name="chevron-right" size={18} color={C.textDeep} />
        ) : (
          <Text style={styles.resultDuration}>{durationText || '--:--'}</Text>
        )}
        {!navigable && item.downloadable ? (
          <TouchableOpacity
            style={[
              styles.downloadButton,
              isDone && styles.downloadButtonDone,
              isFailed && styles.downloadButtonRetry,
              (isQueuing || isActive) && styles.downloadButtonBusy,
            ]}
            onPress={() => onQueueDownload(item, item?.index ?? index)}
            disabled={disabled}>
            {isQueuing || isActive ? (
              <ActivityIndicator size="small" color={C.bg} />
            ) : (
              <Icon
                name={isDone ? 'check' : 'download-outline'}
                size={16}
                color={C.bg}
              />
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    </CardContainer>
  );
};

export default React.memo(SearchResultCard);
