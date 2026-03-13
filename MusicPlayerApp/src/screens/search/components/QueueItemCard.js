import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { MUSIC_HOME_THEME as C } from '../../../theme/musicHomeTheme';
import { ACTIVE_QUEUE_STATUSES } from '../search.constants';
import styles from '../search.styles';
import {
  getFallbackArtColor,
  getQueueStatusLabel,
  getQueueSubtitle,
} from '../search.utils';

const COMPLETION_LOOP_MS = 4000;
const COMPLETION_FADE_MS = 240;
const PROGRESS_ANIMATION_MIN_MS = 120;
const PROGRESS_ANIMATION_MAX_MS = 600;
const DONE_OUTLINE_STROKE_WIDTH = 2;
const QUEUE_CARD_RADIUS = 8;
const AnimatedRect = Animated.createAnimatedComponent(Rect);

const QueueItemCard = ({
  item,
  retrying,
  canceling,
  onRetry,
  onCancel,
  onDoneAnimationComplete,
}) => {
  const targetProgress = Number.isFinite(item.progress)
    ? Math.max(0, Math.min(100, Math.round(item.progress)))
    : 0;
  const active = ACTIVE_QUEUE_STATUSES.has(item.status || 'queued');
  const done = item.status === 'done';
  const failed = item.status === 'failed';

  const [cardSize, setCardSize] = useState({ width: 0, height: 0 });
  const animatedProgress = useRef(new Animated.Value(targetProgress)).current;
  const doneOutlineProgress = useRef(new Animated.Value(0)).current;
  const doneOutlineOpacity = useRef(new Animated.Value(1)).current;
  const doneOutlineStartedRef = useRef(false);
  const doneOutlineCompletedRef = useRef(false);
  const doneOutlineAnimationRef = useRef(null);
  const onDoneAnimationCompleteRef = useRef(onDoneAnimationComplete);
  const lastAnimatedJobIdRef = useRef(String(item?.id || ''));

  const fallbackColor = getFallbackArtColor(item);
  const barColor = failed ? '#9b1c1c' : done ? C.textDeep : C.accent;
  const statusColor = failed ? '#f87171' : done ? C.accentFg : C.accent;
  const progressWidth = useMemo(
    () =>
      animatedProgress.interpolate({
        inputRange: [0, 100],
        outputRange: ['0%', '100%'],
        extrapolate: 'clamp',
      }),
    [animatedProgress],
  );

  const outlineGeometry = useMemo(() => {
    const width = Math.max(0, Math.round(cardSize.width));
    const height = Math.max(0, Math.round(cardSize.height));
    const stroke = DONE_OUTLINE_STROKE_WIDTH;
    const inset = stroke / 2;
    const drawWidth = Math.max(0, width - stroke);
    const drawHeight = Math.max(0, height - stroke);
    const maxRadius = Math.min(drawWidth / 2, drawHeight / 2);
    const radius = Math.max(0, Math.min(QUEUE_CARD_RADIUS - inset, maxRadius));
    const straightWidth = Math.max(0, drawWidth - radius * 2);
    const straightHeight = Math.max(0, drawHeight - radius * 2);
    const perimeter =
      2 * (straightWidth + straightHeight) + 2 * Math.PI * radius;

    return {
      width,
      height,
      stroke,
      inset,
      drawWidth,
      drawHeight,
      radius,
      perimeter: Math.max(0, perimeter),
    };
  }, [cardSize.height, cardSize.width]);

  const outlineDashOffset = useMemo(
    () =>
      doneOutlineProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [outlineGeometry.perimeter, 0],
        extrapolate: 'clamp',
      }),
    [doneOutlineProgress, outlineGeometry.perimeter],
  );

  const handleCardLayout = event => {
    const width = Math.round(event.nativeEvent.layout.width);
    const height = Math.round(event.nativeEvent.layout.height);
    setCardSize(prev => {
      if (prev.width === width && prev.height === height) {
        return prev;
      }
      return { width, height };
    });
  };

  useEffect(() => {
    onDoneAnimationCompleteRef.current = onDoneAnimationComplete;
  }, [onDoneAnimationComplete]);

  useEffect(() => {
    animatedProgress.stopAnimation(currentValue => {
      const current = Number(currentValue) || 0;
      const next = targetProgress;

      if (next <= current) {
        animatedProgress.setValue(next);
        return;
      }

      const delta = next - current;
      const duration = Math.max(
        PROGRESS_ANIMATION_MIN_MS,
        Math.min(PROGRESS_ANIMATION_MAX_MS, Math.round(delta * 20)),
      );

      Animated.timing(animatedProgress, {
        toValue: next,
        duration,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    });
  }, [animatedProgress, targetProgress]);

  useEffect(
    () => () => {
      animatedProgress.stopAnimation();
    },
    [animatedProgress],
  );

  useEffect(() => {
    const currentJobId = String(item?.id || '');
    if (lastAnimatedJobIdRef.current === currentJobId) {
      return;
    }
    doneOutlineAnimationRef.current?.stop?.();
    doneOutlineStartedRef.current = false;
    doneOutlineCompletedRef.current = false;
    doneOutlineProgress.setValue(0);
    doneOutlineOpacity.setValue(1);
    lastAnimatedJobIdRef.current = currentJobId;
  }, [doneOutlineOpacity, doneOutlineProgress, item?.id]);

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

    let finishedNaturally = false;
    doneOutlineAnimationRef.current = animation;
    animation.start(({ finished }) => {
      if (!finished) {
        doneOutlineStartedRef.current = false;
        return;
      }
      if (doneOutlineCompletedRef.current) {
        return;
      }
      finishedNaturally = true;
      doneOutlineCompletedRef.current = true;
      onDoneAnimationCompleteRef.current?.(item.id, item?.source || 'tidal');
    });

    return () => {
      if (!finishedNaturally && !doneOutlineCompletedRef.current) {
        doneOutlineStartedRef.current = false;
      }
      doneOutlineAnimationRef.current?.stop?.();
    };
  }, [
    cardSize.height,
    cardSize.width,
    done,
    doneOutlineOpacity,
    doneOutlineProgress,
    item.id,
    item?.source,
  ]);

  return (
    <View style={styles.queueCardShell}>
      <View
        style={[styles.queueCard, failed && styles.queueCardFailed]}
        onLayout={handleCardLayout}>
        <View style={[styles.queueAccent, { backgroundColor: barColor }]} />
        <View
          style={[styles.queueArtworkWrap, { backgroundColor: fallbackColor }]}>
          {item.artwork ? (
            <Image source={{ uri: item.artwork }} style={styles.queueArtwork} />
          ) : (
            <Icon name="music-note" size={22} color={C.accentFg} />
          )}
        </View>
        <View style={styles.queueInfo}>
          <View style={styles.queueHeader}>
            <Text style={styles.queueTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[styles.queueStatus, { color: statusColor }]}>
              {getQueueStatusLabel(item)}
            </Text>
          </View>
          <View style={styles.queueProgressTrack}>
            <Animated.View
              style={[
                styles.queueProgressFill,
                { width: progressWidth, backgroundColor: barColor },
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

      {done ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.queueDoneOutlineOverlay,
            { opacity: doneOutlineOpacity },
          ]}>
          {outlineGeometry.perimeter > 0 ? (
            <Svg width={outlineGeometry.width} height={outlineGeometry.height}>
              <AnimatedRect
                x={outlineGeometry.inset}
                y={outlineGeometry.inset}
                width={outlineGeometry.drawWidth}
                height={outlineGeometry.drawHeight}
                rx={outlineGeometry.radius}
                ry={outlineGeometry.radius}
                fill="none"
                stroke="#22c55e"
                strokeWidth={outlineGeometry.stroke}
                strokeDasharray={`${outlineGeometry.perimeter} ${outlineGeometry.perimeter}`}
                strokeDashoffset={outlineDashOffset}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
};

const areQueueItemsEquivalent = (left, right) => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    String(left.id || '') === String(right.id || '') &&
    String(left.status || '') === String(right.status || '') &&
    (Number(left.progress) || 0) === (Number(right.progress) || 0) &&
    (Number(left.updatedAt) || 0) === (Number(right.updatedAt) || 0) &&
    String(left.title || '') === String(right.title || '') &&
    String(left.artist || '') === String(right.artist || '') &&
    String(left.artwork || '') === String(right.artwork || '')
  );
};

export default React.memo(QueueItemCard, (prevProps, nextProps) => {
  return (
    prevProps.retrying === nextProps.retrying &&
    prevProps.canceling === nextProps.canceling &&
    prevProps.onRetry === nextProps.onRetry &&
    prevProps.onCancel === nextProps.onCancel &&
    areQueueItemsEquivalent(prevProps.item, nextProps.item)
  );
});
