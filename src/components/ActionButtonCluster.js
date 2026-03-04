import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  TextInput,
  Image,
  Platform,
  Keyboard,
  Dimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { ACTION_BUTTON } from "../constants/theme";
import PostCreationForm from "./PostCreationForm";
import LayersControlPanel from "./LayersControlPanel";
import { useAppTheme } from "../context/ThemeContext";
import { getBrandAssetsForTheme } from "../constants/brandAssets";

const ActionButtonCluster = ({
  navigation,
  mapRef,
  pins,
  allPins,
  layers,
  selectedLayerId,
  layersLoading,
  onSelectLayer,
  onOpenLayerPosts,
  onToggleLayer,
  onMoveLayer,
  onRemoveLayer,
  onRefreshLayers,
  onPostSubmit,
  userLocation,
  onSearch,
  onArrowPinFocus,
}) => {
  const toRadians = useCallback((degrees) => (degrees * Math.PI) / 180, []);
  const distanceMeters = useCallback(
    (origin, pin) => {
      const originLat = Number(origin?.latitude);
      const originLng = Number(origin?.longitude);
      const pinLat = Number(pin?.lat);
      const pinLng = Number(pin?.lng);
      if (
        !Number.isFinite(originLat) ||
        !Number.isFinite(originLng) ||
        !Number.isFinite(pinLat) ||
        !Number.isFinite(pinLng)
      ) {
        return Number.POSITIVE_INFINITY;
      }
      const earthRadiusMeters = 6371000;
      const deltaLat = toRadians(pinLat - originLat);
      const deltaLng = toRadians(pinLng - originLng);
      const lat1 = toRadians(originLat);
      const lat2 = toRadians(pinLat);
      const x =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.sin(deltaLng / 2) *
          Math.sin(deltaLng / 2) *
          Math.cos(lat1) *
          Math.cos(lat2);
      const y = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
      return earthRadiusMeters * y;
    },
    [toRadians],
  );

  const { palette, isDark } = useAppTheme();
  const brandAssets = useMemo(() => getBrandAssetsForTheme(isDark), [isDark]);
  const styles = createStyles(palette);
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showPostForm, setShowPostForm] = useState(false);
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const lastArrowTargetIdRef = useRef(null);

  const expandProgress = useSharedValue(0);
  const keyboardOffset = useSharedValue(0);

  useEffect(() => {
    const animateToOffset = (offset, duration = 250) => {
      keyboardOffset.value = withTiming(offset, { duration });
    };

    const handleKeyboardChange = (event) => {
      const screenHeight = Dimensions.get("window").height;
      const endY = event?.endCoordinates?.screenY ?? screenHeight;
      const nextOffset = Math.max(0, screenHeight - endY);
      animateToOffset(nextOffset, event?.duration ?? 250);
    };

    const handleKeyboardHide = (event) => {
      animateToOffset(0, event?.duration ?? 250);
    };

    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const frameEvent = Platform.OS === "ios" ? "keyboardWillChangeFrame" : null;

    const showListener = Keyboard.addListener(showEvent, handleKeyboardChange);
    const hideListener = Keyboard.addListener(hideEvent, handleKeyboardHide);
    const frameListener = frameEvent
      ? Keyboard.addListener(frameEvent, handleKeyboardChange)
      : null;

    return () => {
      showListener.remove();
      hideListener.remove();
      frameListener?.remove();
    };
  }, [keyboardOffset]);

  const collapse = useCallback(() => {
    setExpanded(false);
    expandProgress.value = withTiming(0, { duration: 250 });
    Keyboard.dismiss();
  }, [expandProgress]);

  const toggleExpand = useCallback(() => {
    if (showPostForm) {
      setShowPostForm(false);
      return;
    }

    if (showLayersPanel) {
      setShowLayersPanel(false);
    }

    if (expanded) {
      collapse();
      return;
    }

    expandProgress.value = withTiming(1, { duration: 250 });
    setExpanded(true);
  }, [collapse, expanded, expandProgress, showLayersPanel, showPostForm]);

  const nearestPinTargets = useMemo(() => {
    const sourcePins =
      Array.isArray(pins) && pins.length > 0
        ? pins
        : Array.isArray(allPins)
          ? allPins
          : [];
    const validPins = sourcePins.filter((pin) => {
      const lat = Number(pin?.lat);
      const lng = Number(pin?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      return pin?.geometry?.visibility_mode !== "cloud_only";
    });
    const dedupedById = [];
    const seenIds = new Set();
    validPins.forEach((pin) => {
      const id = String(pin?.id || "");
      if (!id || seenIds.has(id)) return;
      seenIds.add(id);
      dedupedById.push(pin);
    });

    const sorted = [...dedupedById];
    if (Number.isFinite(Number(userLocation?.latitude))) {
      sorted.sort((left, right) => {
        const delta =
          distanceMeters(userLocation, left) - distanceMeters(userLocation, right);
        if (Math.abs(delta) > 0.001) return delta;
        return String(left?.id || "").localeCompare(String(right?.id || ""));
      });
      return sorted;
    }

    sorted.sort((left, right) =>
      String(left?.id || "").localeCompare(String(right?.id || "")),
    );
    return sorted;
  }, [allPins, pins, userLocation, distanceMeters]);

  const goToNearestPin = useCallback(() => {
    if (!nearestPinTargets.length) return;
    const lastTargetId = lastArrowTargetIdRef.current;
    const currentIndex = nearestPinTargets.findIndex(
      (pin) => String(pin?.id || "") === String(lastTargetId || ""),
    );
    const nextIndex =
      currentIndex >= 0
        ? (currentIndex + 1) % nearestPinTargets.length
        : 0;
    const targetPin = nearestPinTargets[nextIndex];
    if (!targetPin) return;
    lastArrowTargetIdRef.current = String(targetPin?.id || "");

    if (mapRef?.current) {
      mapRef.current.animateToRegion(
        {
          latitude: Number(targetPin.lat),
          longitude: Number(targetPin.lng),
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500,
      );
    }
    if (onArrowPinFocus) {
      onArrowPinFocus(targetPin);
    }
  }, [nearestPinTargets, mapRef, onArrowPinFocus]);

  const handleMenuPress = useCallback(
    (item) => {
      switch (item) {
        case "Communities":
          navigation.navigate("Communities");
          collapse();
          break;
        case "Friends":
          navigation.navigate("Friends");
          collapse();
          break;
        case "Account":
          navigation.navigate("Account");
          collapse();
          break;
        case "Layers":
          setShowLayersPanel(true);
          collapse();
          break;
        case "Add":
          setShowPostForm(true);
          collapse();
          break;
      }
    },
    [navigation, collapse],
  );

  const handleSearchSubmit = useCallback(() => {
    if (searchQuery.trim() && onSearch) {
      onSearch(searchQuery);
    }
  }, [searchQuery, onSearch]);

  const handlePostFormClose = useCallback(() => {
    setShowPostForm(false);
  }, []);

  const handlePostFormSubmit = useCallback(
    (postData) => {
      if (onPostSubmit) {
        onPostSubmit(postData);
      }
      setShowPostForm(false);
    },
    [onPostSubmit],
  );

  const screenWidth = Dimensions.get("window").width;
  const searchBarMaxWidth =
    screenWidth - ACTION_BUTTON.MARGIN * 2 - ACTION_BUTTON.SIZE - ACTION_BUTTON.GAP;

  const searchBarStyle = useAnimatedStyle(() => {
    const width = interpolate(
      expandProgress.value,
      [0, 1],
      [0, searchBarMaxWidth],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      expandProgress.value,
      [0, 0.3, 1],
      [0, 0, 1],
      Extrapolation.CLAMP,
    );
    return { width, opacity, overflow: "hidden" };
  });

  const arrowButtonStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      expandProgress.value,
      [0, 0.5, 1],
      [1, 0, 0],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      expandProgress.value,
      [0, 0.5, 1],
      [1, 0.5, 0.5],
      Extrapolation.CLAMP,
    );
    const height = interpolate(
      expandProgress.value,
      [0, 1],
      [ACTION_BUTTON.SIZE + 2, 0],
      Extrapolation.CLAMP,
    );
    const marginBottom = interpolate(
      expandProgress.value,
      [0, 1],
      [2, 0],
      Extrapolation.CLAMP,
    );
    return {
      opacity,
      transform: [{ scale }],
      height,
      marginBottom,
      overflow: "hidden",
    };
  });

  const menuStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      expandProgress.value,
      [0, 1],
      [100, 0],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      expandProgress.value,
      [0, 0.3, 1],
      [0, 0, 1],
      Extrapolation.CLAMP,
    );
    return { transform: [{ translateY }], opacity };
  });
  const keyboardShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboardOffset.value }],
  }));
  const menuItems = useMemo(
    () => [
      {
        key: "Communities",
        icon: brandAssets.menu.communities,
      },
      {
        key: "Friends",
        icon: brandAssets.menu.friends,
      },
      {
        key: "Account",
        icon: brandAssets.menu.account,
      },
      {
        key: "Layers",
        icon: brandAssets.menu.layers,
      },
      {
        key: "Add",
        icon: brandAssets.menu.add,
      },
    ],
    [brandAssets],
  );

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {expanded && (
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={collapse}
        />
      )}

      <Animated.View style={[styles.column, keyboardShiftStyle]}>
        <Animated.View style={[styles.menuColumn, menuStyle]}>
          {menuItems.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={styles.menuItem}
              onPress={() => handleMenuPress(item.key)}
              accessibilityRole="button"
              accessibilityLabel={item.key}
            >
              <Image source={item.icon} style={styles.menuItemIcon} resizeMode="contain" />
            </TouchableOpacity>
          ))}
        </Animated.View>

        <Animated.View style={arrowButtonStyle}>
          <TouchableOpacity
            style={[styles.button, styles.arrowButton]}
            onPress={goToNearestPin}
          >
            <Text style={styles.buttonText}>{"➜"}</Text>
          </TouchableOpacity>
        </Animated.View>

        <View style={styles.aRow}>
          <Animated.View style={[styles.searchBar, searchBarStyle]}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search..."
              placeholderTextColor={palette.subtext}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearchSubmit}
              returnKeyType="search"
            />
          </Animated.View>

          <TouchableOpacity
            style={[styles.button, styles.aButton]}
            onPress={toggleExpand}
          >
            <Image source={brandAssets.logo} style={styles.aButtonLogo} resizeMode="contain" />
          </TouchableOpacity>
        </View>
      </Animated.View>

      <LayersControlPanel
        visible={showLayersPanel}
        onClose={() => setShowLayersPanel(false)}
        layers={layers}
        selectedLayerId={selectedLayerId}
        isLoading={layersLoading}
        onSelectLayer={(layerId) => {
          onSelectLayer(layerId);
        }}
        onOpenLayerPosts={onOpenLayerPosts}
        onToggleLayer={onToggleLayer}
        onMoveLayer={onMoveLayer}
        onRemoveLayer={onRemoveLayer}
        onRefresh={onRefreshLayers}
      />

      <PostCreationForm
        visible={showPostForm}
        onClose={handlePostFormClose}
        onSubmit={handlePostFormSubmit}
        layers={layers}
        selectedLayerId={selectedLayerId}
        userLocation={userLocation}
      />
    </View>
  );
};

const createStyles = (palette) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "flex-end",
      alignItems: "flex-end",
      padding: ACTION_BUTTON.MARGIN,
      paddingBottom: ACTION_BUTTON.MARGIN + (Platform.OS === "ios" ? 20 : 0),
      zIndex: 999,
      elevation: 999,
    },
    column: {
      alignItems: "flex-end",
      zIndex: 999,
      elevation: 999,
    },
    aRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    button: {
      width: ACTION_BUTTON.SIZE,
      height: ACTION_BUTTON.SIZE,
      borderRadius: ACTION_BUTTON.SIZE / 2,
      justifyContent: "center",
      alignItems: "center",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 8,
    },
    arrowButton: {
      backgroundColor: palette.surface,
      shadowColor: "transparent",
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    aButton: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    buttonText: {
      fontSize: 22,
      fontWeight: "700",
      color: palette.text,
    },
    aButtonLogo: {
      width: 34,
      height: 34,
    },
    searchBar: {
      height: ACTION_BUTTON.SIZE,
      backgroundColor: palette.surface,
      borderRadius: ACTION_BUTTON.SIZE / 2,
      marginRight: ACTION_BUTTON.GAP,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 6,
      elevation: 5,
      justifyContent: "center",
    },
    searchInput: {
      paddingHorizontal: 20,
      fontSize: 15,
      color: palette.text,
    },
    menuColumn: {
      alignItems: "flex-end",
      marginBottom: 4,
      zIndex: 1000,
      elevation: 1000,
    },
    menuItem: {
      backgroundColor: palette.surface,
      width: ACTION_BUTTON.SIZE,
      height: ACTION_BUTTON.SIZE,
      borderRadius: ACTION_BUTTON.SIZE / 2,
      marginBottom: 8,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 6,
      elevation: 1000,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    },
    menuItemIcon: {
      width: 70,
      height: 70,
    },
  });

export default ActionButtonCluster;
