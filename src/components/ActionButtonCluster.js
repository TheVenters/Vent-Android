import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  TextInput,
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

const ActionButtonCluster = ({
  navigation,
  mapRef,
  pins,
  layers,
  selectedLayerId,
  layersLoading,
  onSelectLayer,
  onOpenLayerPosts,
  onToggleLayer,
  onMoveLayer,
  onRefreshLayers,
  onPostSubmit,
  userLocation,
  onSearch,
  mapMode,
  onToggleMapMode,
}) => {
  const { palette } = useAppTheme();
  const styles = createStyles(palette);
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showPostForm, setShowPostForm] = useState(false);
  const [showLayersPanel, setShowLayersPanel] = useState(false);

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

  const goToRandomPin = useCallback(() => {
    if (!pins || pins.length === 0) return;
    const randomPin = pins[Math.floor(Math.random() * pins.length)];
    if (mapRef?.current) {
      mapRef.current.animateToRegion(
        {
          latitude: randomPin.lat,
          longitude: randomPin.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500,
      );
    }
  }, [pins, mapRef]);

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

  const searchBarStyle = useAnimatedStyle(() => {
    const width = interpolate(
      expandProgress.value,
      [0, 1],
      [0, 240],
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
  const menuItems = ["Communities", "Friends", "Account", "Layers", "Add"];

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
              key={item}
              style={styles.menuItem}
              onPress={() => handleMenuPress(item)}
            >
              <Text style={styles.menuItemText}>{item}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.mapModeRow}>
            <TouchableOpacity
              style={[
                styles.mapModePill,
                mapMode !== "explore" && styles.mapModePillActive,
              ]}
              onPress={() =>
                mapMode === "explore" && onToggleMapMode && onToggleMapMode()
              }
            >
              <Text
                style={[
                  styles.mapModePillText,
                  mapMode !== "explore" && styles.mapModePillTextActive,
                ]}
              >
                UserMap
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.mapModePill,
                mapMode === "explore" && styles.mapModePillActive,
              ]}
              onPress={() =>
                mapMode !== "explore" && onToggleMapMode && onToggleMapMode()
              }
            >
              <Text
                style={[
                  styles.mapModePillText,
                  mapMode === "explore" && styles.mapModePillTextActive,
                ]}
              >
                Explore
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        <Animated.View style={arrowButtonStyle}>
          <TouchableOpacity
            style={[styles.button, styles.arrowButton]}
            onPress={goToRandomPin}
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
            <Text style={styles.aButtonText}>Vent</Text>
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
      backgroundColor: palette.primary,
    },
    buttonText: {
      fontSize: 22,
      fontWeight: "700",
      color: palette.text,
    },
    aButtonText: {
      fontSize: 18,
      fontWeight: "700",
      color: palette.onPrimary,
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
      marginBottom: 2,
      zIndex: 1000,
      elevation: 1000,
    },
    mapModeRow: {
      flexDirection: "row",
      backgroundColor: palette.surface,
      borderRadius: 999,
      padding: 4,
      marginBottom: 2,
      borderWidth: 1,
      borderColor: palette.border,
      gap: 4,
    },
    mapModePill: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
    },
    mapModePillActive: {
      backgroundColor: palette.primary,
    },
    mapModePillText: {
      fontSize: 12,
      fontWeight: "700",
      color: palette.subtext,
    },
    mapModePillTextActive: {
      color: palette.onPrimary,
    },
    menuItem: {
      backgroundColor: palette.surface,
      borderRadius: ACTION_BUTTON.SIZE / 2,
      paddingHorizontal: 20,
      paddingVertical: 12,
      marginBottom: 2,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 6,
      elevation: 1000,
      minWidth: ACTION_BUTTON.SIZE,
      alignItems: "center",
      zIndex: 1000,
    },
    menuItemText: {
      fontSize: 14,
      fontWeight: "600",
      color: palette.text,
    },
  });

export default ActionButtonCluster;
