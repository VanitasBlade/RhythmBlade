import { StyleSheet } from 'react-native';
import { MUSIC_HOME_THEME as C } from './musicHomeTheme';

/**
 * Shared modal styles used across Library, NowPlaying, and Playlists screens.
 * Import and spread into each screen's StyleSheet.create() call.
 */
export const createModalStyles = () =>
    StyleSheet.create({
        modalOverlay: {
            flex: 1,
            backgroundColor: C.modalOverlayBg,
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
        modalInput: {
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: 8,
            backgroundColor: C.bg,
            color: C.text,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginBottom: 10,
            fontSize: 14,
        },
        modalTextArea: {
            minHeight: 90,
            textAlignVertical: 'top',
        },
    });

/**
 * Shared empty state styles used across Home, Library, PlaylistDetail, and Playlists screens.
 */
export const createEmptyStateStyles = () =>
    StyleSheet.create({
        emptyContainer: {
            paddingTop: 80,
            alignItems: 'center',
            paddingHorizontal: 22,
        },
        emptyTitle: {
            marginTop: 12,
            color: '#f0eaff',
            fontSize: 19,
            fontWeight: '700',
        },
        emptySubtitle: {
            marginTop: 8,
            color: C.textDim,
            fontSize: 13,
            textAlign: 'center',
        },
    });
