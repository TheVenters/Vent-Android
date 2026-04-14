import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  TextInput,
  Image,
  Platform,
  StatusBar as RNStatusBar,
  Keyboard,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { isCoordinateWithinRegionBounds } from "../screens/map/mapVisualEngine";

const HOLD_DRAG_OPEN_THRESHOLD = 34;
const HOLD_RECORD_DELAY_MS = 700;
const HOLD_LONG_PRESS_DELAY_MS = 180;
const HOLD_AUTO_OPEN_DELAY_MS = 280;
const DEBUG_VENT_HOLD = true;
const HOLD_RELEASE_OPEN_THRESHOLD = 18;

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
  mapCenter,
  mapRegion,
  focusedPinId,
  arrowNavigationResetToken = 0,
  onSearch,
  onArrowPinFocus,
  onPrepareOverlay,
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
  const insets = useSafeAreaInsets();
  const brandAssets = useMemo(() => getBrandAssetsForTheme(isDark), [isDark]);
  const styles = createStyles(palette);
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showPostForm, setShowPostForm] = useState(false);
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [holdRecordStartToken, setHoldRecordStartToken] = useState(0);
  const [holdRecordStopToken, setHoldRecordStopToken] = useState(0);
  const lastArrowTargetIdRef = useRef(null);
  const visitedArrowPinIdsRef = useRef(new Set());
  const visitedArrowLocationKeysRef = useRef(new Set());
  const suppressActionPressRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const autoOpenTimerRef = useRef(null);
  const suppressResetTimerRef = useRef(null);
  const holdGestureRef = useRef({
    isPressing: false,
    isLongPress: false,
    startPageX: 0,
    startPageY: 0,
    lastPageX: 0,
    lastPageY: 0,
    cameraOpened: false,
    recordStarted: false,
    recordTimer: null,
  });

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

  const distanceOrigin = useMemo(() => {
    const hasMapCenter =
      Number.isFinite(Number(mapCenter?.latitude)) &&
      Number.isFinite(Number(mapCenter?.longitude));
    return hasMapCenter ? mapCenter : userLocation;
  }, [mapCenter, userLocation]);

  const nearestPinTargets = useMemo(() => {
    const sourcePins = Array.isArray(pins)
      ? pins
      : Array.isArray(allPins)
        ? allPins
        : [];
    const focusedPinIdText = String(focusedPinId || "");
    const validPins = sourcePins.filter((pin) => {
      const lat = Number(pin?.lat);
      const lng = Number(pin?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      if (focusedPinIdText && String(pin?.id || "") === focusedPinIdText) {
        return false;
      }
      return pin?.geometry?.visibility_mode !== "cloud_only";
    });
    const regionVisiblePins =
      mapRegion &&
      Number.isFinite(Number(mapRegion?.latitude)) &&
      Number.isFinite(Number(mapRegion?.longitude)) &&
      Number.isFinite(Number(mapRegion?.latitudeDelta)) &&
      Number.isFinite(Number(mapRegion?.longitudeDelta))
        ? validPins.filter((pin) =>
            isCoordinateWithinRegionBounds(
              { latitude: Number(pin?.lat), longitude: Number(pin?.lng) },
              mapRegion,
            ),
          )
        : validPins;
    const dedupedById = [];
    const seenIds = new Set();
    regionVisiblePins.forEach((pin) => {
      const id = String(pin?.id || "");
      if (!id || seenIds.has(id)) return;
      seenIds.add(id);
      dedupedById.push(pin);
    });

    const dedupedByLocation = [];
    const seenLocations = new Set();
    dedupedById.forEach((pin) => {
      const lat = Number(pin?.lat);
      const lng = Number(pin?.lng);
      const locationKey = `${lat.toFixed(5)}:${lng.toFixed(5)}`;
      if (seenLocations.has(locationKey)) return;
      seenLocations.add(locationKey);
      dedupedByLocation.push(pin);
    });

    const sorted = [...dedupedByLocation];
    if (
      Number.isFinite(Number(distanceOrigin?.latitude)) &&
      Number.isFinite(Number(distanceOrigin?.longitude))
    ) {
      sorted.sort((left, right) => {
        const delta =
          distanceMeters(distanceOrigin, left) - distanceMeters(distanceOrigin, right);
        if (Math.abs(delta) > 0.001) return delta;
        return String(left?.id || "").localeCompare(String(right?.id || ""));
      });
      return sorted;
    }

    sorted.sort((left, right) =>
      String(left?.id || "").localeCompare(String(right?.id || "")),
    );
    return sorted;
  }, [allPins, pins, focusedPinId, mapRegion, distanceOrigin, distanceMeters]);

  useEffect(() => {
    visitedArrowPinIdsRef.current = new Set();
    visitedArrowLocationKeysRef.current = new Set();
    lastArrowTargetIdRef.current = null;
  }, [arrowNavigationResetToken]);

  const goToNearestPin = useCallback(() => {
    if (!nearestPinTargets.length) return;
    let targetPin =
      nearestPinTargets.find(
        (pin) => {
          const pinId = String(pin?.id || "");
          const lat = Number(pin?.lat);
          const lng = Number(pin?.lng);
          const locationKey = `${lat.toFixed(5)}:${lng.toFixed(5)}`;
          return (
            !visitedArrowPinIdsRef.current.has(pinId) &&
            !visitedArrowLocationKeysRef.current.has(locationKey)
          );
        },
      ) || null;
    if (!targetPin) {
      visitedArrowPinIdsRef.current = new Set();
      visitedArrowLocationKeysRef.current = new Set();
      targetPin = nearestPinTargets[0] || null;
    }
    if (!targetPin) return;
    const targetPinId = String(targetPin?.id || "");
    const targetLocationKey = `${Number(targetPin?.lat).toFixed(5)}:${Number(
      targetPin?.lng,
    ).toFixed(5)}`;
    lastArrowTargetIdRef.current = targetPinId;
    visitedArrowPinIdsRef.current.add(targetPinId);
    visitedArrowLocationKeysRef.current.add(targetLocationKey);

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

  const centerOnUserLocation = useCallback(() => {
    const latitude = Number(userLocation?.latitude);
    const longitude = Number(userLocation?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    if (mapRef?.current?.animateToRegion) {
      mapRef.current.animateToRegion(
        {
          latitude,
          longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500,
      );
    }
  }, [mapRef, userLocation]);

  const handleMenuPress = useCallback(
    (item) => {
      onPrepareOverlay?.();
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
    [collapse, navigation, onPrepareOverlay],
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

  const clearHoldRecordTimer = useCallback(() => {
    const timer = holdGestureRef.current.recordTimer;
    if (timer) {
      clearTimeout(timer);
    }
    holdGestureRef.current.recordTimer = null;
  }, []);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const clearAutoOpenTimer = useCallback(() => {
    if (autoOpenTimerRef.current) {
      clearTimeout(autoOpenTimerRef.current);
      autoOpenTimerRef.current = null;
    }
  }, []);

  const logVentHold = (...args) => {
    if (!DEBUG_VENT_HOLD) return;
    console.log("[VentHold]", ...args);
  };

  const scheduleSuppressReset = useCallback(() => {
    if (suppressResetTimerRef.current) {
      clearTimeout(suppressResetTimerRef.current);
    }
    suppressResetTimerRef.current = setTimeout(() => {
      suppressActionPressRef.current = false;
      suppressResetTimerRef.current = null;
    }, 0);
  }, []);

  useEffect(
    () => () => {
      clearHoldRecordTimer();
      clearLongPressTimer();
      clearAutoOpenTimer();
      if (suppressResetTimerRef.current) {
        clearTimeout(suppressResetTimerRef.current);
        suppressResetTimerRef.current = null;
      }
    },
    [clearAutoOpenTimer, clearHoldRecordTimer, clearLongPressTimer],
  );

  const scheduleHoldRecording = useCallback(() => {
    clearHoldRecordTimer();
    holdGestureRef.current.recordTimer = setTimeout(() => {
      const gesture = holdGestureRef.current;
      gesture.recordTimer = null;
      if (!gesture.isPressing || !gesture.cameraOpened || gesture.recordStarted) return;
      gesture.recordStarted = true;
      setHoldRecordStartToken((value) => value + 1);
    }, HOLD_RECORD_DELAY_MS);
  }, [clearHoldRecordTimer]);

  const openCameraFromHold = useCallback(() => {
    const gesture = holdGestureRef.current;
    if (gesture.cameraOpened) return;
    gesture.cameraOpened = true;
    clearAutoOpenTimer();
    logVentHold("openCameraFromHold");
    onPrepareOverlay?.();
    suppressActionPressRef.current = true;
    setShowLayersPanel(false);
    setShowPostForm(true);
    collapse();
    scheduleHoldRecording();
  }, [clearAutoOpenTimer, collapse, onPrepareOverlay, scheduleHoldRecording]);

  const handleActionPressIn = useCallback(
    (event) => {
      clearHoldRecordTimer();
      clearLongPressTimer();
      clearAutoOpenTimer();
      holdGestureRef.current = {
        isPressing: true,
        isLongPress: false,
        startPageX: Number(event?.nativeEvent?.pageX || 0),
        startPageY: Number(event?.nativeEvent?.pageY || 0),
        lastPageX: Number(event?.nativeEvent?.pageX || 0),
        lastPageY: Number(event?.nativeEvent?.pageY || 0),
        cameraOpened: false,
        recordStarted: false,
        recordTimer: null,
      };
      logVentHold("pressIn", {
        x: Number(event?.nativeEvent?.pageX || 0),
        y: Number(event?.nativeEvent?.pageY || 0),
      });
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        const gesture = holdGestureRef.current;
        if (!gesture.isPressing) return;
        gesture.isLongPress = true;
        logVentHold("longPress armed");
        if (!expanded) {
          expandProgress.value = withTiming(1, { duration: 250 });
          setExpanded(true);
        }
        clearAutoOpenTimer();
        autoOpenTimerRef.current = setTimeout(() => {
          autoOpenTimerRef.current = null;
          const currentGesture = holdGestureRef.current;
          if (
            !currentGesture.isPressing ||
            currentGesture.cameraOpened ||
            !currentGesture.isLongPress
          ) {
            return;
          }
          logVentHold("auto open after hold");
          openCameraFromHold();
        }, HOLD_AUTO_OPEN_DELAY_MS);
      }, HOLD_LONG_PRESS_DELAY_MS);
    },
    [
      clearAutoOpenTimer,
      clearHoldRecordTimer,
      clearLongPressTimer,
      expandProgress,
      expanded,
      openCameraFromHold,
    ],
  );

  const handleActionLongPress = useCallback(() => {
    // Long-press state is driven by our own timer in handleActionPressIn.
  }, [expandProgress, expanded]);

  const handleActionTouchMove = useCallback(
    (event) => {
      const gesture = holdGestureRef.current;
      if (!gesture.isPressing || !gesture.isLongPress || gesture.cameraOpened) return;
      const currentX = Number(event?.nativeEvent?.pageX || 0);
      const currentY = Number(event?.nativeEvent?.pageY || 0);
      gesture.lastPageX = currentX;
      gesture.lastPageY = currentY;
      const deltaX = currentX - Number(gesture.startPageX || 0);
      const deltaY = currentY - Number(gesture.startPageY || 0);
      const dragDistance = Math.hypot(deltaX, deltaY);
      const movedTowardAdd =
        deltaY >= HOLD_DRAG_OPEN_THRESHOLD ||
        (deltaY >= 14 && dragDistance >= 24) ||
        dragDistance >= 42;
      logVentHold("move", {
        deltaX: Math.round(deltaX),
        deltaY: Math.round(deltaY),
        dragDistance: Math.round(dragDistance),
        movedTowardAdd,
      });
      if (movedTowardAdd) {
        logVentHold("drag triggered open", { deltaX, deltaY, dragDistance });
        openCameraFromHold();
      }
    },
    [openCameraFromHold],
  );

  const handleActionPressOut = useCallback((event) => {
    const gesture = holdGestureRef.current;
    const releaseX =
      Number(event?.nativeEvent?.pageX) || Number(gesture.lastPageX || 0);
    const releaseY =
      Number(event?.nativeEvent?.pageY) || Number(gesture.lastPageY || 0);
    const deltaX = releaseX - Number(gesture.startPageX || 0);
    const deltaY = releaseY - Number(gesture.startPageY || 0);
    clearHoldRecordTimer();
    clearLongPressTimer();
    clearAutoOpenTimer();
    logVentHold("pressOut", {
      cameraOpened: gesture.cameraOpened,
      isLongPress: gesture.isLongPress,
      recordStarted: gesture.recordStarted,
      deltaX: Math.round(deltaX),
      deltaY: Math.round(deltaY),
    });
    if (
      gesture.isLongPress &&
      !gesture.cameraOpened &&
      deltaY >= HOLD_RELEASE_OPEN_THRESHOLD
    ) {
      logVentHold("release fallback open", { deltaX, deltaY });
      openCameraFromHold();
    }
    if (gesture.cameraOpened || gesture.isLongPress) {
      suppressActionPressRef.current = true;
      scheduleSuppressReset();
    }
    if (gesture.recordStarted) {
      setHoldRecordStopToken((value) => value + 1);
    }
    holdGestureRef.current = {
      isPressing: false,
      isLongPress: false,
      startPageX: 0,
      startPageY: 0,
      lastPageX: 0,
      lastPageY: 0,
      cameraOpened: false,
      recordStarted: false,
      recordTimer: null,
    };
  }, [
    openCameraFromHold,
    clearAutoOpenTimer,
    clearHoldRecordTimer,
    clearLongPressTimer,
    scheduleSuppressReset,
  ]);

  const handleActionPress = useCallback(() => {
    if (suppressActionPressRef.current) {
      suppressActionPressRef.current = false;
      return;
    }
    toggleExpand();
  }, [toggleExpand]);

  const screenWidth = Dimensions.get("window").width;
  const rowButtonCount = 2;
  const searchBarMaxWidth =
    screenWidth -
    ACTION_BUTTON.MARGIN * 2 -
    ACTION_BUTTON.SIZE * rowButtonCount -
    ACTION_BUTTON.GAP * rowButtonCount;
  const hasUserLocation =
    Number.isFinite(Number(userLocation?.latitude)) &&
    Number.isFinite(Number(userLocation?.longitude));

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

  const bottomArrowIconStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      expandProgress.value,
      [0, 0.45, 1],
      [1, 0, 0],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      expandProgress.value,
      [0, 0.45, 1],
      [1, 0.72, 0.72],
      Extrapolation.CLAMP,
    );
    return { opacity, transform: [{ scale }] };
  });

  const bottomAddIconStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      expandProgress.value,
      [0, 0.45, 1],
      [0, 0, 1],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      expandProgress.value,
      [0, 0.45, 1],
      [0.72, 0.72, 1],
      Extrapolation.CLAMP,
    );
    return { opacity, transform: [{ scale }] };
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
    ],
    [brandAssets],
  );
  const isMenuInteractive = expanded && !showPostForm && !showLayersPanel;
  const isArrowInteractive = !expanded && !showPostForm && !showLayersPanel;
  const overlayInsetStyle = useMemo(
    () => ({
      paddingTop:
        ACTION_BUTTON.MARGIN +
        Math.max(
          Number(insets.top || 0),
          Platform.OS === "android" ? Number(RNStatusBar.currentHeight || 0) : 0,
        ),
      paddingBottom: ACTION_BUTTON.MARGIN + (insets.bottom || 0),
    }),
    [insets.bottom, insets.top],
  );

  return (
    <View style={[styles.overlay, overlayInsetStyle]} pointerEvents="box-none">
      {expanded && (
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={collapse}
        />
      )}

      <Animated.View
        style={[styles.column, keyboardShiftStyle]}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[styles.menuColumn, menuStyle]}
          pointerEvents={isMenuInteractive ? "auto" : "none"}
        >
          {menuItems.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={styles.menuItem}
              disabled={!isMenuInteractive}
              onPress={() => handleMenuPress(item.key)}
              accessibilityRole="button"
              accessibilityLabel={item.key}
            >
              <Image source={item.icon} style={styles.menuItemIcon} resizeMode="contain" />
            </TouchableOpacity>
          ))}
        </Animated.View>

        <Animated.View
          style={styles.topToggleWrap}
          pointerEvents={isArrowInteractive ? "auto" : "none"}
        >
          <TouchableOpacity
            style={[styles.button, styles.arrowButton]}
            disabled={!isArrowInteractive}
            onPress={handleActionPress}
            onPressIn={handleActionPressIn}
            onLongPress={handleActionLongPress}
            onTouchMove={handleActionTouchMove}
            onResponderMove={handleActionTouchMove}
            onPressOut={handleActionPressOut}
            delayLongPress={HOLD_LONG_PRESS_DELAY_MS}
          >
            <Image source={brandAssets.logo} style={styles.aButtonLogo} resizeMode="contain" />
          </TouchableOpacity>
        </Animated.View>

        <View style={styles.aRow} pointerEvents="box-none">
          <Animated.View
            style={[styles.searchBar, searchBarStyle]}
            pointerEvents={expanded ? "auto" : "none"}
          >
            <TextInput
              style={styles.searchInput}
              placeholder="Search..."
              placeholderTextColor={palette.subtext}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearchSubmit}
              returnKeyType="search"
              editable={expanded}
            />
          </Animated.View>

          <TouchableOpacity
            style={[
              styles.button,
              styles.aButton,
              styles.secondaryActionButton,
              !hasUserLocation && styles.buttonDisabled,
            ]}
            onPress={centerOnUserLocation}
            disabled={!hasUserLocation}
            accessibilityRole="button"
            accessibilityLabel="Go to current location"
          >
            <View style={styles.locationIcon}>
              <View style={styles.locationIconRing} />
              <View style={styles.locationIconCenter} />
              <View style={[styles.locationIconTick, styles.locationIconTickTop]} />
              <View style={[styles.locationIconTick, styles.locationIconTickRight]} />
              <View style={[styles.locationIconTick, styles.locationIconTickBottom]} />
              <View style={[styles.locationIconTick, styles.locationIconTickLeft]} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.aButton]}
            onPress={() => {
              if (expanded) {
                handleMenuPress("Add");
                return;
              }
              goToNearestPin();
            }}
          >
            <View style={styles.toggleIconWrap}>
              <Animated.Text style={[styles.buttonText, bottomArrowIconStyle]}>
                {"➜"}
              </Animated.Text>
              <Animated.View
                style={[styles.toggleIconAbsolute, bottomAddIconStyle]}
              >
                <Image
                  source={brandAssets.menu.add}
                  style={styles.bottomAddIcon}
                  resizeMode="contain"
                />
              </Animated.View>
            </View>
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
        holdRecordStartToken={holdRecordStartToken}
        holdRecordStopToken={holdRecordStopToken}
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
    topToggleWrap: {
      marginBottom: 8,
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
    toggleIconWrap: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
    },
    toggleIconAbsolute: {
      position: "absolute",
    },
    bottomAddIcon: {
      width: 42,
      height: 42,
    },
    aButtonLogo: {
      width: 34,
      height: 34,
    },
    secondaryActionButton: {
      marginRight: ACTION_BUTTON.GAP,
    },
    buttonDisabled: {
      opacity: 0.45,
    },
    locationIcon: {
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
    },
    locationIconRing: {
      position: "absolute",
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 3,
      borderColor: palette.primary,
    },
    locationIconCenter: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: palette.primary,
    },
    locationIconTick: {
      position: "absolute",
      backgroundColor: palette.primary,
    },
    locationIconTickTop: {
      width: 4,
      height: 7,
      top: -1,
      borderRadius: 2,
    },
    locationIconTickRight: {
      width: 7,
      height: 4,
      right: -1,
      borderRadius: 2,
    },
    locationIconTickBottom: {
      width: 4,
      height: 7,
      bottom: -1,
      borderRadius: 2,
    },
    locationIconTickLeft: {
      width: 7,
      height: 4,
      left: -1,
      borderRadius: 2,
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
