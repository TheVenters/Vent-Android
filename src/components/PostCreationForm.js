import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { SIZES, GEOMETRY_TYPES } from "../constants/theme";
import { useAppTheme } from "../context/ThemeContext";
import { getPinLayerKeyFromLayer } from "../utils/layers";

const LOCATION_MODES = {
  CURRENT: "current",
  PICK_ON_MAP: "pick_on_map",
};

const POST_VISIBILITY_MODES = {
  PINNED: "pinned",
  CLOUD_ONLY: "cloud_only",
};

const POST_AUDIENCE = {
  FRIENDS: "friends",
  PUBLIC: "public",
};

const CLOUD_RADIUS_OPTIONS_METERS = [100, 250, 500, 1000];

const OWNER_LABELS = {
  system: "System",
  community: "Community",
  user: "User",
};

const PostCreationForm = ({
  visible,
  onClose,
  onSubmit,
  layers,
  userLocation,
}) => {
  const { palette, isDark } = useAppTheme();
  const styles = createStyles(palette, isDark);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [geometryType, setGeometryType] = useState(GEOMETRY_TYPES.POINT);
  const [showGeometryOptions, setShowGeometryOptions] = useState(false);
  const [selectedLayerIds, setSelectedLayerIds] = useState([]);
  const [postVisibilityMode, setPostVisibilityMode] = useState(
    POST_VISIBILITY_MODES.PINNED,
  );
  const [privacyRadiusMeters, setPrivacyRadiusMeters] = useState(250);
  const [locationMode, setLocationMode] = useState(LOCATION_MODES.CURRENT);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [mediaType, setMediaType] = useState(null);
  const [baseAudience, setBaseAudience] = useState(POST_AUDIENCE.FRIENDS);

  const availableLayers = useMemo(
    () => (Array.isArray(layers) ? layers : []),
    [layers],
  );

  const userPostingLayer = useMemo(
    () =>
      availableLayers.find(
        (layer) =>
          layer.owner_type === "user" &&
          String(layer.kind || "").startsWith("user_posts"),
      ) || null,
    [availableLayers],
  );
  const selectableLayers = useMemo(
    () =>
      availableLayers.filter(
        (layer) => {
          const pinLayerKey = getPinLayerKeyFromLayer(layer);
          return (
            layer.id !== userPostingLayer?.id &&
            layer.owner_type !== "user" &&
            pinLayerKey === "public"
          );
        },
      ),
    [availableLayers, userPostingLayer?.id],
  );
  const friendsBaseLayer = useMemo(
    () =>
      availableLayers.find(
        (layer) => getPinLayerKeyFromLayer(layer) === "friends",
      ) || null,
    [availableLayers],
  );
  const publicBaseLayer = useMemo(
    () =>
      selectableLayers.find(
        (layer) => getPinLayerKeyFromLayer(layer) === "public",
      ) || null,
    [selectableLayers],
  );

  useEffect(() => {
    if (!visible) return;
    setSelectedLayerIds([]);
    setBaseAudience(POST_AUDIENCE.FRIENDS);
  }, [visible]);

  const resetForm = () => {
    setTitle("");
    setContent("");
    setGeometryType(GEOMETRY_TYPES.POINT);
    setShowGeometryOptions(false);
    setPostVisibilityMode(POST_VISIBILITY_MODES.PINNED);
    setPrivacyRadiusMeters(250);
    setLocationMode(LOCATION_MODES.CURRENT);
    setMediaUrl(null);
    setMediaType(null);
    setBaseAudience(POST_AUDIENCE.FRIENDS);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      Alert.alert("Error", "Please enter a title.");
      return;
    }

    if (locationMode === LOCATION_MODES.CURRENT && !userLocation) {
      Alert.alert(
        "Location Unavailable",
        "Unable to read your current location right now.",
      );
      return;
    }
    if (baseAudience === POST_AUDIENCE.PUBLIC && !publicBaseLayer?.id) {
      Alert.alert(
        "Public Layer Unavailable",
        "No public layer is available right now. Please refresh layers and try again.",
      );
      return;
    }
    if (baseAudience === POST_AUDIENCE.FRIENDS && !friendsBaseLayer?.id) {
      Alert.alert(
        "Friends Layer Unavailable",
        "No friends layer is available right now. Please refresh layers and try again.",
      );
      return;
    }

    onSubmit({
      title,
      content,
      geometryType,
      layerIds: selectedLayerIds,
      postVisibilityMode,
      privacyRadiusMeters:
        postVisibilityMode === POST_VISIBILITY_MODES.CLOUD_ONLY
          ? privacyRadiusMeters
          : null,
      locationMode,
      location:
        locationMode === LOCATION_MODES.CURRENT && userLocation
          ? {
              latitude: userLocation.latitude,
              longitude: userLocation.longitude,
            }
          : null,
      mediaUrl,
      mediaType,
      baseAudience,
      basePublicLayerId:
        baseAudience === POST_AUDIENCE.PUBLIC ? publicBaseLayer?.id || null : null,
      baseFriendsLayerId:
        baseAudience === POST_AUDIENCE.FRIENDS
          ? friendsBaseLayer?.id || null
          : null,
    });

    resetForm();
  };

  const toggleLayer = (layerId) => {
    setSelectedLayerIds((prev) =>
      prev.includes(layerId)
        ? prev.filter((id) => id !== layerId)
        : [...prev, layerId],
    );
  };

  const applyPickedMedia = (result) => {
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setMediaUrl(asset.uri);
    setMediaType(asset.type === "video" ? "video" : "photo");
  };

  const pickMediaFromLibrary = async () => {
    try {
      const permissionResult =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert(
          "Permission Needed",
          "Please grant media library permissions.",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsEditing: false,
        quality: 0.8,
      });
      applyPickedMedia(result);
    } catch (error) {
      console.error("Error picking media:", error);
      Alert.alert("Error", "Failed to pick media.");
    }
  };

  const capturePhotoWithCamera = async () => {
    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert("Permission Needed", "Please grant camera permissions.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: "images",
        allowsEditing: false,
        quality: 0.8,
      });
      applyPickedMedia(result);
    } catch (error) {
      console.error("Error taking photo:", error);
      Alert.alert("Error", "Failed to open camera.");
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleClose}
        />

        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>New Post</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>X</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <TextInput
              style={styles.titleInput}
              placeholder="Title"
              placeholderTextColor={palette.subtext}
              value={title}
              onChangeText={setTitle}
            />

            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Content"
              placeholderTextColor={palette.subtext}
              value={content}
              onChangeText={setContent}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <Text style={styles.sectionLabel}>Media (Optional)</Text>
            <View style={styles.mediaRow}>
              <TouchableOpacity
                style={styles.mediaBtn}
                onPress={pickMediaFromLibrary}
              >
                <Text style={styles.mediaBtnText}>
                  {mediaUrl ? "Change Library Media" : "Choose from Library"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mediaBtn}
                onPress={capturePhotoWithCamera}
              >
                <Text style={styles.mediaBtnText}>
                  {mediaUrl ? "Retake Photo" : "Take Photo"}
                </Text>
              </TouchableOpacity>
            </View>
            {mediaUrl ? (
              <View style={styles.mediaRemoveRow}>
                <TouchableOpacity
                  style={styles.mediaClearBtn}
                  onPress={() => {
                    setMediaUrl(null);
                    setMediaType(null);
                  }}
                >
                  <Text style={styles.mediaClearBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {mediaUrl ? (
              <Text style={styles.inlineHint}>
                Attached {mediaType === "video" ? "video" : "photo"}
              </Text>
            ) : null}

            <Text style={styles.sectionLabel}>Post To</Text>
            <View style={styles.locationModeRow}>
              <TouchableOpacity
                style={[
                  styles.locationModeBtn,
                  baseAudience === POST_AUDIENCE.FRIENDS &&
                    styles.locationModeBtnActive,
                ]}
                onPress={() => setBaseAudience(POST_AUDIENCE.FRIENDS)}
              >
                <Text
                  style={[
                    styles.locationModeBtnText,
                    baseAudience === POST_AUDIENCE.FRIENDS &&
                      styles.locationModeBtnTextActive,
                  ]}
                >
                  Friends
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.locationModeBtn,
                  baseAudience === POST_AUDIENCE.PUBLIC &&
                    styles.locationModeBtnActive,
                ]}
                onPress={() => setBaseAudience(POST_AUDIENCE.PUBLIC)}
              >
                <Text
                  style={[
                    styles.locationModeBtnText,
                    baseAudience === POST_AUDIENCE.PUBLIC &&
                      styles.locationModeBtnTextActive,
                  ]}
                >
                  Public
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.inlineHint}>
              {baseAudience === POST_AUDIENCE.FRIENDS
                ? "Posts to your friends layer by default."
                : "Posts to a public layer by default."}
            </Text>

            <Text style={styles.sectionLabel}>Geometry Type</Text>
            <TouchableOpacity
              style={styles.geometryDropdownTrigger}
              onPress={() => setShowGeometryOptions((prev) => !prev)}
            >
              <Text style={styles.geometryDropdownText}>
                {geometryType.charAt(0).toUpperCase() + geometryType.slice(1)}
              </Text>
              <Text style={styles.geometryDropdownArrow}>
                {showGeometryOptions ? "▲" : "▼"}
              </Text>
            </TouchableOpacity>
            {showGeometryOptions && (
              <View style={styles.geometryDropdownMenu}>
                {Object.values(GEOMETRY_TYPES).map((type) => {
                  const isActive = geometryType === type;
                  return (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.geometryOption,
                        isActive && styles.geometryOptionActive,
                      ]}
                      onPress={() => {
                        setGeometryType(type);
                        setShowGeometryOptions(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.geometryOptionText,
                          isActive && styles.geometryOptionTextActive,
                        ]}
                      >
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <Text style={styles.sectionLabel}>Post Visibility</Text>
            <View style={styles.locationModeRow}>
              <TouchableOpacity
                style={[
                  styles.locationModeBtn,
                  postVisibilityMode === POST_VISIBILITY_MODES.PINNED &&
                    styles.locationModeBtnActive,
                ]}
                onPress={() =>
                  setPostVisibilityMode(POST_VISIBILITY_MODES.PINNED)
                }
              >
                <Text
                  style={[
                    styles.locationModeBtnText,
                    postVisibilityMode === POST_VISIBILITY_MODES.PINNED &&
                      styles.locationModeBtnTextActive,
                  ]}
                >
                  Post at location
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.locationModeBtn,
                  postVisibilityMode === POST_VISIBILITY_MODES.CLOUD_ONLY &&
                    styles.locationModeBtnActive,
                ]}
                onPress={() =>
                  setPostVisibilityMode(POST_VISIBILITY_MODES.CLOUD_ONLY)
                }
              >
                <Text
                  style={[
                    styles.locationModeBtnText,
                    postVisibilityMode === POST_VISIBILITY_MODES.CLOUD_ONLY &&
                      styles.locationModeBtnTextActive,
                  ]}
                >
                  Post within an area
                </Text>
              </TouchableOpacity>
            </View>

            {postVisibilityMode === POST_VISIBILITY_MODES.CLOUD_ONLY && (
              <>
                <Text style={styles.sectionLabel}>Privacy Radius</Text>
                <Text style={styles.inlineHint}>
                  Exact location is hidden. A random internal point is used
                  within this radius.
                </Text>
                <View style={styles.radiusRow}>
                  {CLOUD_RADIUS_OPTIONS_METERS.map((radius) => {
                    const isActive = privacyRadiusMeters === radius;
                    return (
                      <TouchableOpacity
                        key={radius}
                        style={[
                          styles.radiusChip,
                          isActive && styles.radiusChipActive,
                        ]}
                        onPress={() => setPrivacyRadiusMeters(radius)}
                      >
                        <Text
                          style={[
                            styles.radiusChipText,
                            isActive && styles.radiusChipTextActive,
                          ]}
                        >
                          {radius >= 1000
                            ? `${radius / 1000}km`
                            : `${radius}m`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            <Text style={styles.sectionLabel}>Also Post To (Optional)</Text>
            <Text style={styles.inlineHint}>
              Add any extra non-friends layers in addition to the target above.
            </Text>
            {availableLayers.length === 0 ? (
              <Text style={styles.emptyStateText}>
                No layers are currently available.
              </Text>
            ) : !userPostingLayer ? (
              <Text style={styles.emptyStateText}>
                Your posting layer is unavailable right now.
              </Text>
            ) : selectableLayers.length === 0 ? (
              <Text style={styles.emptyStateText}>
                No additional postable layers found. This post will go to your
                selected audience layer only.
              </Text>
            ) : (
              <View style={styles.layerList}>
                {selectableLayers.map((layer) => {
                  const isSelected = selectedLayerIds.includes(layer.id);
                  const pinLayer = getPinLayerKeyFromLayer(layer);

                  return (
                    <TouchableOpacity
                      key={layer.id}
                      style={[
                        styles.layerRow,
                        isSelected && styles.layerRowSelected,
                      ]}
                      onPress={() => toggleLayer(layer.id)}
                    >
                      <View style={styles.layerRowLeft}>
                        <Text style={styles.layerName}>{layer.name}</Text>
                        <Text style={styles.layerMeta}>
                          {OWNER_LABELS[layer.owner_type] || "System"} • posts
                          as {pinLayer}
                        </Text>
                      </View>

                      <Text style={styles.chooseText}>
                        {isSelected ? "Added" : "Add"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <Text style={styles.sectionLabel}>Location</Text>
            <View style={styles.locationModeRow}>
              <TouchableOpacity
                style={[
                  styles.locationModeBtn,
                  locationMode === LOCATION_MODES.CURRENT &&
                    styles.locationModeBtnActive,
                ]}
                onPress={() => setLocationMode(LOCATION_MODES.CURRENT)}
              >
                <Text
                  style={[
                    styles.locationModeBtnText,
                    locationMode === LOCATION_MODES.CURRENT &&
                      styles.locationModeBtnTextActive,
                  ]}
                >
                  Current
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.locationModeBtn,
                  locationMode === LOCATION_MODES.PICK_ON_MAP &&
                    styles.locationModeBtnActive,
                ]}
                onPress={() => setLocationMode(LOCATION_MODES.PICK_ON_MAP)}
              >
                <Text
                  style={[
                    styles.locationModeBtnText,
                    locationMode === LOCATION_MODES.PICK_ON_MAP &&
                      styles.locationModeBtnTextActive,
                  ]}
                >
                  Choose on Map
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
              <Text style={styles.submitBtnText}>Post</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const createStyles = (palette, isDark) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: "flex-end",
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
    },
    container: {
      backgroundColor: palette.surface,
      borderTopLeftRadius: SIZES.radiusXl,
      borderTopRightRadius: SIZES.radiusXl,
      maxHeight: "84%",
      borderTopWidth: 1,
      borderTopColor: palette.border,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "800",
      color: palette.text,
    },
    closeBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: palette.mutedSurface,
      justifyContent: "center",
      alignItems: "center",
    },
    closeBtnText: {
      fontSize: 14,
      fontWeight: "700",
      color: palette.subtext,
    },
    scrollContent: {
      padding: 16,
    },
    titleInput: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      padding: 12,
      fontSize: 16,
      fontWeight: "600",
      marginBottom: 10,
      color: palette.text,
      backgroundColor: isDark ? "#202632" : "#ffffff",
    },
    input: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      padding: 12,
      fontSize: 14,
      marginBottom: 10,
      color: palette.text,
      backgroundColor: isDark ? "#202632" : "#ffffff",
    },
    textArea: {
      minHeight: 90,
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.text,
      marginBottom: 6,
      marginTop: 6,
    },
    inlineHint: {
      fontSize: 12,
      color: palette.subtext,
      marginBottom: 8,
      marginTop: -2,
    },
    mediaRow: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 10,
    },
    mediaRemoveRow: {
      alignItems: "flex-start",
      marginBottom: 10,
    },
    mediaBtn: {
      flex: 1,
      paddingVertical: 9,
      backgroundColor: palette.mutedSurface,
      borderRadius: SIZES.radius,
      alignItems: "center",
      borderWidth: 1,
      borderColor: palette.border,
    },
    mediaBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.text,
    },
    mediaClearBtn: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      backgroundColor: "rgba(239, 68, 68, 0.14)",
      borderWidth: 1,
      borderColor: "rgba(239, 68, 68, 0.35)",
      borderRadius: SIZES.radius,
      alignItems: "center",
      justifyContent: "center",
    },
    mediaClearBtnText: {
      color: "#ef4444",
      fontSize: 12,
      fontWeight: "700",
    },
    geometryDropdownTrigger: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      backgroundColor: isDark ? "#202632" : "#f9fbff",
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
    },
    geometryDropdownText: {
      fontSize: 13,
      color: palette.text,
      fontWeight: "700",
    },
    geometryDropdownArrow: {
      fontSize: 11,
      color: palette.subtext,
      fontWeight: "700",
    },
    geometryDropdownMenu: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      overflow: "hidden",
      marginBottom: 10,
    },
    geometryOption: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: isDark ? "#202632" : "#f9fbff",
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    geometryOptionActive: {
      backgroundColor: "rgba(129, 140, 248, 0.22)",
    },
    geometryOptionText: {
      color: palette.text,
      fontSize: 13,
      fontWeight: "700",
    },
    geometryOptionTextActive: {
      color: palette.primary,
    },
    layerList: {
      marginBottom: 10,
      gap: 8,
    },
    layerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      padding: 10,
      backgroundColor: isDark ? "#202632" : "#f9fbff",
      gap: 8,
    },
    layerRowSelected: {
      borderColor: palette.primary,
    },
    layerRowLeft: {
      flex: 1,
      paddingRight: 10,
    },
    layerName: {
      fontSize: 14,
      fontWeight: "700",
      color: palette.text,
      marginBottom: 2,
    },
    layerMeta: {
      fontSize: 12,
      color: palette.subtext,
      fontWeight: "600",
    },
    chooseText: {
      fontSize: 12,
      fontWeight: "700",
      color: palette.primary,
    },
    emptyStateText: {
      color: palette.subtext,
      fontSize: 13,
      marginBottom: 8,
    },
    locationModeRow: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 8,
    },
    radiusRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 10,
    },
    radiusChip: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radiusFull,
      paddingHorizontal: 12,
      paddingVertical: 7,
      backgroundColor: isDark ? "#202632" : "#f9fbff",
    },
    radiusChipActive: {
      borderColor: palette.primary,
      backgroundColor: "rgba(129, 140, 248, 0.2)",
    },
    radiusChipText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "700",
    },
    radiusChipTextActive: {
      color: palette.primary,
    },
    locationModeBtn: {
      flex: 1,
      paddingVertical: 9,
      backgroundColor: palette.mutedSurface,
      borderRadius: SIZES.radius,
      alignItems: "center",
      borderWidth: 1,
      borderColor: palette.border,
    },
    locationModeBtnActive: {
      backgroundColor: palette.primary,
      borderColor: palette.primary,
    },
    locationModeBtnText: {
      fontSize: 12,
      fontWeight: "700",
      color: palette.text,
    },
    locationModeBtnTextActive: {
      color: palette.onPrimary,
    },
    actions: {
      flexDirection: "row",
      padding: 12,
      gap: 8,
      borderTopWidth: 1,
      borderTopColor: palette.border,
    },
    cancelBtn: {
      flex: 1,
      paddingVertical: 10,
      backgroundColor: palette.mutedSurface,
      borderRadius: SIZES.radius,
      alignItems: "center",
    },
    cancelBtnText: {
      fontSize: 14,
      fontWeight: "700",
      color: palette.text,
    },
    submitBtn: {
      flex: 1,
      paddingVertical: 10,
      backgroundColor: palette.primary,
      borderRadius: SIZES.radius,
      alignItems: "center",
    },
    submitBtnText: {
      fontSize: 14,
      fontWeight: "700",
      color: palette.onPrimary,
    },
  });

export default PostCreationForm;
