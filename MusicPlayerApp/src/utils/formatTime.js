/**
 * Shared time formatter for playback UI.
 * Returns '--:--' for zero, NaN, or invalid values.
 */
export const formatTime = value => {
    const total = Math.max(0, Math.floor(Number(value) || 0));
    if (!total) return '--:--';
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
