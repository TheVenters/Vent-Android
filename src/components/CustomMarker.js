import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Marker, Callout } from 'react-native-maps';
import { COLORS, SIZES, PIN_TYPES } from '../constants/theme';

const CustomMarker = ({ pin }) => {
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
    >
      <View style={[styles.markerContainer, { backgroundColor: getMarkerColor() }]}>
        <Text style={styles.markerIcon}>{getMarkerIcon()}</Text>
      </View>
      <Callout>
        <View style={styles.callout}>
          <Text style={styles.authorName}>
            {pin.author_name || 'Anonymous'}
          </Text>
          {pin.author_username && (
            <Text style={styles.username}>@{pin.author_username}</Text>
          )}
          <Text style={styles.content}>
            {pin.content || pin.caption || 'No content'}
          </Text>
          {pin.media_url && (
            <Text style={styles.mediaLabel}>
              {pin.media_type === 'video' ? '🎬 Video' : '📷 Photo'}
            </Text>
          )}
        </View>
      </Callout>
    </Marker>
  );
};

const styles = StyleSheet.create({
  markerContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  markerIcon: {
    fontSize: 18,
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
  mediaLabel: {
    fontSize: SIZES.xs,
    color: COLORS.gray,
    fontStyle: 'italic',
  },
});

export default CustomMarker;
