// File purpose: Memoized map marker component that renders pin thumbnails, emojis, labels, and selection state.

import React, { forwardRef, memo, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Image, Platform } from "react-native";
import { Marker, Callout } from "react-native-maps";
import { COLORS } from "../constants/theme";

const CustomMarkerComponent = (
  { pin, onPress, onMarkerPress, onSelect, onDeselect },
  ref,
) => {
  const [tracksViewChanges, setTracksViewChanges] = useState(
    Boolean(pin?.author_avatar_url),
  );

  useEffect(() => {
    if (!pin?.author_avatar_url) {
      setTracksViewChanges(false);
      return undefined;
    }
    setTracksViewChanges(true);
    const timer = setTimeout(() => {
      setTracksViewChanges(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [pin?.author_avatar_url, pin?.id]);

  useEffect(() => {
    setTracksViewChanges(true);
    const timer = setTimeout(() => {
      setTracksViewChanges(false);
    }, 220);
    return () => clearTimeout(timer);
  }, [pin?.layer_emoji, pin?.geometry?.layer_id]);

  const markerInitial = useMemo(() => {
    const source = String(pin.author_username || pin.author_name || "?").trim();
    return source ? source.charAt(0).toUpperCase() : "?";
  }, [pin.author_name, pin.author_username]);

  const calloutMediaUrl = useMemo(() => {
    const mediaList = Array.isArray(pin?.media_urls)
      ? pin.media_urls
      : Array.isArray(pin?.geometry?.media_urls)
        ? pin.geometry.media_urls
        : [];
    const firstFromList = mediaList
      .map((value) => String(value || "").trim())
      .find((value) => value && !value.startsWith("storage://"));
    if (firstFromList) return firstFromList;
    const fallback = String(pin?.media_url || "").trim();
    if (!fallback || fallback.startsWith("storage://")) return null;
    return fallback;
  }, [pin?.geometry?.media_urls, pin?.media_url, pin?.media_urls]);

  return (
    <Marker
      ref={ref}
      coordinate={{
        latitude: pin.lat,
        longitude: pin.lng,
      }}
      title={pin.caption || "Untitled"}
      description={(pin.author_name || "Anonymous").trim()}
      tappable
      onPress={() => onMarkerPress && onMarkerPress(pin)}
      onCalloutPress={() => onPress && onPress(pin)}
      tracksViewChanges={tracksViewChanges}
      onSelect={() => {
        onMarkerPress && onMarkerPress(pin);
        onSelect && onSelect(pin);
      }}
      onDeselect={() => onDeselect && onDeselect(pin)}
    >
      <View collapsable={false} style={styles.markerWrap}>
        {pin.posted_from_current_location && (
          <View style={styles.locationFlareRing} />
        )}
        <View
          style={[
            styles.markerContainer,
            { backgroundColor: COLORS.primary },
          ]}
        >
          {pin.layer_emoji ? (
            <Text style={styles.markerIcon}>{pin.layer_emoji}</Text>
          ) : pin.author_avatar_url ? (
            <Image
              source={{ uri: pin.author_avatar_url }}
              style={styles.avatarImage}
              onLoadEnd={() => setTracksViewChanges(false)}
            />
          ) : (
            <Text style={styles.markerInitial}>{markerInitial}</Text>
          )}
        </View>
        {pin.posted_from_current_location && (
          <View style={styles.locationFlareBadge}>
            <Text style={styles.locationFlareBadgeText}>{"\u2726"}</Text>
          </View>
        )}
      </View>
      {Platform.OS !== "android" ? (
        <Callout tooltip onPress={() => onPress && onPress(pin)}>
          <View style={styles.callout}>
            {calloutMediaUrl ? (
              <Image
                source={{ uri: calloutMediaUrl }}
                style={styles.calloutImage}
                resizeMode="cover"
              />
            ) : null}
            <Text style={styles.calloutTitle}>{pin.caption || "Untitled"}</Text>
            <Text style={styles.calloutMeta}>
              {(pin.author_name || "Anonymous").trim()}
            </Text>
            <Text style={styles.calloutHint}>Tap to open post details</Text>
          </View>
        </Callout>
      ) : null}
    </Marker>
  );
};

// Prevents unnecessary marker re-renders by comparing meaningful marker props.
const areMarkerPropsEqual = (prevProps, nextProps) => {
  const prevPin = prevProps.pin || {};
  const nextPin = nextProps.pin || {};
  return (
    prevPin.id === nextPin.id &&
    prevPin.lat === nextPin.lat &&
    prevPin.lng === nextPin.lng &&
    prevPin.caption === nextPin.caption &&
    prevPin.author_name === nextPin.author_name &&
    prevPin.author_username === nextPin.author_username &&
    prevPin.author_avatar_url === nextPin.author_avatar_url &&
    prevPin.media_url === nextPin.media_url &&
    JSON.stringify(prevPin.media_urls || []) ===
      JSON.stringify(nextPin.media_urls || []) &&
    prevPin.layer_emoji === nextPin.layer_emoji &&
    prevPin.posted_from_current_location === nextPin.posted_from_current_location
  );
};

const styles = StyleSheet.create({
  markerWrap: {
    width: Platform.OS === "android" ? 36 : 60,
    height: Platform.OS === "android" ? 36 : 60,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  locationFlareRing: {
    position: "absolute",
    width: Platform.OS === "android" ? 34 : 40,
    height: Platform.OS === "android" ? 34 : 40,
    borderRadius: Platform.OS === "android" ? 17 : 20,
    borderWidth: Platform.OS === "android" ? 1 : 2,
    borderColor: "rgba(255, 122, 89, 0.75)",
    backgroundColor: "rgba(255, 122, 89, 0.12)",
    top: Platform.OS === "android" ? 1 : 10,
    left: Platform.OS === "android" ? 1 : 10,
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
    top: Platform.OS === "android" ? 2 : 18,
    right: Platform.OS === "android" ? 2 : 18,
    width: Platform.OS === "android" ? 10 : 12,
    height: Platform.OS === "android" ? 10 : 12,
    borderRadius: Platform.OS === "android" ? 5 : 6,
    backgroundColor: "#FF7A59",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.white,
  },
  locationFlareBadgeText: {
    color: COLORS.white,
    fontSize: Platform.OS === "android" ? 6 : 7,
    fontWeight: "700",
    lineHeight: Platform.OS === "android" ? 7 : 8,
  },
  callout: {
    minWidth: 180,
    maxWidth: 240,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.14)",
    backgroundColor: "#ffffff",
  },
  calloutImage: {
    width: "100%",
    height: 92,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: "#d1d5db",
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

const ForwardedCustomMarker = forwardRef(CustomMarkerComponent);
ForwardedCustomMarker.displayName = "CustomMarker";

export default memo(ForwardedCustomMarker, areMarkerPropsEqual);
