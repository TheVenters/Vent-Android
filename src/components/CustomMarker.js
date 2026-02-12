import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Marker, Callout } from 'react-native-maps';
import { COLORS, SIZES, PIN_TYPES } from '../constants/theme';

const CustomMarker = ({ pin, onPress }) => {
  const formatTimestamp = (dateString) => {
    if (!dateString) return 'Just now';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Just now';

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const getMarkerColor = () => {
    switch (pin.type) {
      case PIN_TYPES.PHOTO:
        return COLORS.success;
      case PIN_TYPES.TEXT:
        return COLORS.warning;
      case PIN_TYPES.VIDEO:
        return COLORS.danger;
      default:
        return COLORS.primary;
    }
  };

  const getMarkerIcon = () => {
    switch (pin.type) {
      case PIN_TYPES.PHOTO:
      case 'photo':
        return '📷';
      case PIN_TYPES.TEXT:
      case 'text':
        return '📝';
      case PIN_TYPES.VIDEO:
      case 'video':
        return '🎬';
      case PIN_TYPES.MEDIA:
      case 'media':
        return pin.media_type === 'video' ? '🎬' : '📷';
      default:
        return '📍';
    }
  };

  return (
    <Marker
      coordinate={{
        latitude: pin.lat,
        longitude: pin.lng,
      }}
      onPress={() => onPress && onPress(pin)}
    >
      <View style={styles.markerWrap}>
        {pin.posted_from_current_location && <View style={styles.locationFlareRing} />}
        <View style={[styles.markerContainer, { backgroundColor: getMarkerColor() }]}>
          <Text style={styles.markerIcon}>{getMarkerIcon()}</Text>
        </View>
        {pin.posted_from_current_location && (
          <View style={styles.locationFlareBadge}>
            <Text style={styles.locationFlareBadgeText}>✦</Text>
          </View>
        )}
      </View>
      <Callout onPress={() => onPress && onPress(pin)}>
        <View style={styles.callout}>
          <Text style={styles.authorName}>
            {pin.author_name || 'Anonymous'}
          </Text>
          {pin.author_username && (
            <Text style={styles.username}>@{pin.author_username}</Text>
          )}
          <Text style={styles.title}>
            {pin.caption || 'Untitled'}
          </Text>
          <Text style={styles.content}>
            {pin.content || 'No caption'}
          </Text>
          {pin.posted_from_current_location && (
            <Text style={styles.locationFlareText}>Posted from current location</Text>
          )}
          {pin.media_url && (
            <Text style={styles.mediaLabel}>
              {pin.media_type === 'video' ? '🎬 Video' : '📷 Photo'}
            </Text>
          )}
          <Text style={styles.timestamp}>🕒 {formatTimestamp(pin.created_at)}</Text>
          <Text style={styles.tapHint}>Tap for details</Text>
        </View>
      </Callout>
    </Marker>
  );
};

const styles = StyleSheet.create({
  markerWrap: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationFlareRing: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: 'rgba(255, 122, 89, 0.75)',
    backgroundColor: 'rgba(255, 122, 89, 0.12)',
    top: 2,
    left: 2,
  },
  markerContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  markerIcon: {
    fontSize: 18,
  },
  locationFlareBadge: {
    position: 'absolute',
    top: 6,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FF7A59',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.white,
  },
  locationFlareBadgeText: {
    color: COLORS.white,
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 10,
  },
  callout: {
    minWidth: 200,
    padding: SIZES.md,
  },
  authorName: {
    fontSize: SIZES.md,
    fontWeight: '700',
    color: COLORS.dark,
    marginBottom: SIZES.xs,
  },
  username: {
    fontSize: SIZES.sm,
    color: COLORS.primary,
    marginBottom: SIZES.sm,
  },
  content: {
    fontSize: SIZES.sm,
    color: COLORS.dark,
    marginBottom: SIZES.sm,
  },
  title: {
    fontSize: SIZES.sm,
    fontWeight: '700',
    color: COLORS.dark,
    marginBottom: SIZES.xs,
  },
  mediaLabel: {
    fontSize: SIZES.xs,
    color: COLORS.gray,
    fontStyle: 'italic',
  },
  locationFlareText: {
    fontSize: SIZES.xs,
    color: '#FF7A59',
    fontWeight: '700',
    marginBottom: SIZES.xs,
  },
  timestamp: {
    fontSize: SIZES.xs,
    color: COLORS.gray,
    marginTop: SIZES.xs,
  },
  tapHint: {
    fontSize: SIZES.xs,
    color: COLORS.primary,
    marginTop: SIZES.sm,
    fontWeight: '600',
  },
});

export default CustomMarker;
