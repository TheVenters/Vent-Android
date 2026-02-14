import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { Marker, Callout } from "react-native-maps";
import { COLORS } from "../constants/theme";

const CustomMarker = ({ pin, onPress }) => {
  const getMarkerColor = () => {
    return COLORS.primary;
  };

  const getInitial = () => {
    const source = String(pin.author_username || pin.author_name || "?").trim();
    return source ? source.charAt(0).toUpperCase() : "?";
  };

  return (
    <Marker
      coordinate={{
        latitude: pin.lat,
        longitude: pin.lng,
      }}
    >
      <View style={styles.markerWrap}>
        {pin.posted_from_current_location && (
          <View style={styles.locationFlareRing} />
        )}
        <View
          style={[
            styles.markerContainer,
            { backgroundColor: getMarkerColor() },
          ]}
        >
          {pin.layer_emoji ? (
            <Text style={styles.markerIcon}>{pin.layer_emoji}</Text>
          ) : pin.author_avatar_url ? (
            <Image
              source={{ uri: pin.author_avatar_url }}
              style={styles.avatarImage}
            />
          ) : (
            <Text style={styles.markerInitial}>{getInitial()}</Text>
          )}
        </View>
        {pin.posted_from_current_location && (
          <View style={styles.locationFlareBadge}>
            <Text style={styles.locationFlareBadgeText}>✦</Text>
          </View>
        )}
      </View>
      <Callout onPress={() => onPress && onPress(pin)}>
        <View style={styles.callout}>
          <Text style={styles.calloutTitle}>{pin.caption || "Untitled"}</Text>
          <Text style={styles.calloutMeta}>
            {(pin.author_name || "Anonymous").trim()}
          </Text>
          <Text style={styles.calloutHint}>Tap to open post details</Text>
        </View>
      </Callout>
    </Marker>
  );
};

const styles = StyleSheet.create({
  markerWrap: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  locationFlareRing: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "rgba(255, 122, 89, 0.75)",
    backgroundColor: "rgba(255, 122, 89, 0.12)",
    top: 2,
    left: 2,
  },
  markerContainer: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: COLORS.white,
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  markerIcon: {
    fontSize: 17,
  },
  markerInitial: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.white,
  },
  avatarImage: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  locationFlareBadge: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#FF7A59",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.white,
  },
  locationFlareBadgeText: {
    color: COLORS.white,
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 10,
  },
  callout: {
    minWidth: 180,
    maxWidth: 240,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  calloutTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.dark,
    marginBottom: 2,
  },
  calloutMeta: {
    fontSize: 12,
    color: COLORS.gray,
  },
  calloutHint: {
    fontSize: 12,
    color: COLORS.primary,
    marginTop: 6,
    fontWeight: "600",
  },
});

export default CustomMarker;
