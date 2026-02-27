import React, {useEffect, useMemo, useState} from 'react';
import {Modal, Pressable, Text, TouchableOpacity, View} from 'react-native';
import {MUSIC_HOME_THEME as C} from '../theme/musicHomeTheme';
import appDialogService from '../services/ui/AppDialogService';

const FALLBACK_BUTTON = [{text: 'OK'}];

const AppDialogHost = () => {
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    const unsubscribe = appDialogService.setPresenter(payload => {
      setQueue(prev => [...prev, payload]);
    });
    return unsubscribe;
  }, []);

  const current = queue[0] || null;
  const buttons = useMemo(() => {
    const input = Array.isArray(current?.buttons) ? current.buttons : FALLBACK_BUTTON;
    return input.length > 0 ? input : FALLBACK_BUTTON;
  }, [current]);

  const closeCurrent = () => {
    setQueue(prev => prev.slice(1));
  };

  const onBackdropPress = () => {
    if (!current?.options?.cancelable) {
      return;
    }
    closeCurrent();
    if (typeof current?.options?.onDismiss === 'function') {
      current.options.onDismiss();
    }
  };

  const onPressAction = button => {
    closeCurrent();
    if (typeof button?.onPress === 'function') {
      setTimeout(() => {
        button.onPress();
      }, 0);
    }
  };

  return (
    <Modal
      visible={Boolean(current)}
      transparent
      animationType="fade"
      onRequestClose={onBackdropPress}>
      <Pressable style={styles.overlay} onPress={onBackdropPress}>
        <Pressable style={styles.card} onPress={() => {}}>
          {current?.title ? <Text style={styles.title}>{current.title}</Text> : null}
          {current?.message ? (
            <Text style={styles.message}>{current.message}</Text>
          ) : null}

          <View style={styles.actionsWrap}>
            {buttons.map((button, index) => {
              const style = String(button?.style || '').toLowerCase();
              const isDestructive = style === 'destructive';
              const isCancel = style === 'cancel';

              return (
                <TouchableOpacity
                  key={`${String(button?.text || 'ok')}-${index}`}
                  style={[
                    styles.actionButton,
                    isCancel && styles.actionButtonCancel,
                    isDestructive && styles.actionButtonDanger,
                  ]}
                  onPress={() => onPressAction(button)}>
                  <Text
                    style={[
                      styles.actionText,
                      isCancel && styles.actionTextCancel,
                      isDestructive && styles.actionTextDanger,
                    ]}>
                    {String(button?.text || 'OK')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = {
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 5, 18, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
  },
  title: {
    color: C.text,
    fontSize: 19,
    fontWeight: '700',
  },
  message: {
    marginTop: 8,
    color: C.textDim,
    fontSize: 14,
    lineHeight: 20,
  },
  actionsWrap: {
    marginTop: 14,
    gap: 8,
  },
  actionButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  actionButtonCancel: {
    backgroundColor: '#1d1337',
  },
  actionButtonDanger: {
    borderColor: '#6c2a41',
    backgroundColor: '#2c162d',
  },
  actionText: {
    color: C.accentFg,
    fontSize: 14,
    fontWeight: '700',
  },
  actionTextCancel: {
    color: C.textDim,
  },
  actionTextDanger: {
    color: '#f7a8cf',
  },
};

export default AppDialogHost;

