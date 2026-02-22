import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
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

const COMPLETION_LOOP_MS = 4000;
const COMPLETION_FADE_MS = 240;

const QueueItemCard = ({
  item,
  retrying,
  canceling,
  onRetry,
  onCancel,
  onDoneAnimationComplete,
}) => {
  const progress = Number.isFinite(item.progress)
    ? Math.max(0, Math.min(100, Math.round(item.progress)))
    : 0;
  const active = ACTIVE_QUEUE_STATUSES.has(item.status || 'queued');
  const done = item.status === 'done';
  const failed = item.status === 'failed';

  const [cardSize, setCardSize] = useState({width: 0, height: 0});
  const doneOutlineProgress = useRef(new Animated.Value(0)).current;
  const doneOutlineOpacity = useRef(new Animated.Value(1)).current;
  const doneOutlineStartedRef = useRef(false);
  const doneOutlineCompletedRef = useRef(false);
  const doneOutlineAnimationRef = useRef(null);

  const fallbackColor = getFallbackArtColor(item);
  const barColor = failed ? '#9b1c1c' : done ? C.textDeep : C.accent;
  const statusColor = failed ? '#f87171' : done ? C.accentFg : C.accent;

  const outlineTopWidth = useMemo(
    () =>
      doneOutlineProgress.interpolate({
        inputRange: [0, 0.25, 1],
        outputRange: [0, cardSize.width, cardSize.width],
        extrapolate: 'clamp',
      }),
    [cardSize.width, doneOutlineProgress],
  );

  const outlineRightHeight = useMemo(
    () =>
      doneOutlineProgress.interpolate({
        inputRange: [0, 0.25, 0.5, 1],
        outputRange: [0, 0, cardSize.height, cardSize.height],
        extrapolate: 'clamp',
      }),
    [cardSize.height, doneOutlineProgress],
  );

  const outlineBottomWidth = useMemo(
    () =>
      doneOutlineProgress.interpolate({
        inputRange: [0, 0.5, 0.75, 1],
        outputRange: [0, 0, cardSize.width, cardSize.width],
        extrapolate: 'clamp',
      }),
    [cardSize.width, doneOutlineProgress],
  );

  const outlineLeftHeight = useMemo(
    () =>
      doneOutlineProgress.interpolate({
        inputRange: [0, 0.75, 1],
        outputRange: [0, 0, cardSize.height],
        extrapolate: 'clamp',
      }),
    [cardSize.height, doneOutlineProgress],
  );

  const handleCardLayout = event => {
    const {width, height} = event.nativeEvent.layout;
    setCardSize(prev => {
      if (prev.width === width && prev.height === height) {
        return prev;
      }
      return {width, height};
    });
  };

  useEffect(() => {
    if (!done) {
      doneOutlineAnimationRef.current?.stop?.();
      doneOutlineStartedRef.current = false;
      doneOutlineCompletedRef.current = false;
      doneOutlineProgress.setValue(0);
      doneOutlineOpacity.setValue(1);
      return;
    }

    if (!cardSize.width || !cardSize.height || doneOutlineStartedRef.current) {
      return;
    }

    doneOutlineStartedRef.current = true;
    doneOutlineProgress.setValue(0);
    doneOutlineOpacity.setValue(1);

    const animation = Animated.sequence([
      Animated.timing(doneOutlineProgress, {
        toValue: 1,
        duration: COMPLETION_LOOP_MS,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
      Animated.timing(doneOutlineOpacity, {
        toValue: 0,
        duration: COMPLETION_FADE_MS,
        useNativeDriver: true,
      }),
    ]);

    doneOutlineAnimationRef.current = animation;
    animation.start(({finished}) => {
      if (!finished || doneOutlineCompletedRef.current) {
        return;
      }
      doneOutlineCompletedRef.current = true;
      onDoneAnimationComplete?.(item.id);
    });

    return () => {
      doneOutlineAnimationRef.current?.stop?.();
    };
  }, [
    cardSize.height,
    cardSize.width,
    done,
    doneOutlineOpacity,
    doneOutlineProgress,
    item.id,
    onDoneAnimationComplete,
  ]);

  return (
    <View style={styles.queueCardShell}>
      <View
        style={[styles.queueCard, failed && styles.queueCardFailed]}
        onLayout={handleCardLayout}>
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

        {done ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.queueDoneOutlineOverlay,
              {opacity: doneOutlineOpacity},
            ]}>
            <Animated.View
              style={[
                styles.queueDoneOutlineLine,
                styles.queueDoneOutlineTop,
                {width: outlineTopWidth},
              ]}
            />
            <Animated.View
              style={[
                styles.queueDoneOutlineLine,
                styles.queueDoneOutlineRight,
                {height: outlineRightHeight},
              ]}
            />
            <Animated.View
              style={[
                styles.queueDoneOutlineLine,
                styles.queueDoneOutlineBottom,
                {width: outlineBottomWidth},
              ]}
            />
            <Animated.View
              style={[
                styles.queueDoneOutlineLine,
                styles.queueDoneOutlineLeft,
                {height: outlineLeftHeight},
              ]}
            />
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
};

export default React.memo(QueueItemCard);
