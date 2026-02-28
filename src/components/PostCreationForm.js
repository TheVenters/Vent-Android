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
const MEDIA_SOURCE = {
  LIBRARY: "library",
  CAMERA: "camera",
};

const POST_AUDIENCE = {
  FRIENDS: "friends",
  PUBLIC: "public",
  PRIVATE: "private",
};

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
  const [selectedCommunityLayerId, setSelectedCommunityLayerId] =
    useState(null);
  const [locationMode, setLocationMode] = useState(LOCATION_MODES.CURRENT);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [mediaType, setMediaType] = useState(null);
  const [mediaSource, setMediaSource] = useState(null);
  const [baseAudience, setBaseAudience] = useState(POST_AUDIENCE.FRIENDS);

  const availableLayers = useMemo(
    () => (Array.isArray(layers) ? layers : []),
    [layers],
  );

  const communityAudienceLayers = useMemo(
    () =>
      availableLayers
        .filter((layer) => layer.owner_type === "community" && layer.isEnabled)
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [availableLayers],
  );
  const friendsBaseLayer = useMemo(
    () =>
      availableLayers.find(
        (layer) =>
          getPinLayerKeyFromLayer(layer) === "friends" &&
          layer.owner_type === "system",
      ) ||
      availableLayers.find(
        (layer) => getPinLayerKeyFromLayer(layer) === "friends",
      ) || null,
    [availableLayers],
  );
  const publicBaseLayer = useMemo(
    () =>
      availableLayers.find(
        (layer) =>
          getPinLayerKeyFromLayer(layer) === "public" &&
          layer.owner_type === "system",
      ) ||
      availableLayers.find(
        (layer) =>
          layer.owner_type !== "user" &&
          getPinLayerKeyFromLayer(layer) === "public",
      ) || null,
    [availableLayers],
  );

  useEffect(() => {
    if (!visible) return;
    setBaseAudience(POST_AUDIENCE.FRIENDS);
    setSelectedCommunityLayerId(null);
  }, [communityAudienceLayers, visible]);

  const resetForm = () => {
    setTitle("");
    setContent("");
    setGeometryType(GEOMETRY_TYPES.POINT);
    setShowGeometryOptions(false);
    setSelectedCommunityLayerId(null);
    setLocationMode(LOCATION_MODES.CURRENT);
    setMediaUrl(null);
    setMediaType(null);
    setMediaSource(null);
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
      mediaSource,
      baseAudience,
      basePublicLayerId:
        baseAudience === POST_AUDIENCE.PUBLIC ? publicBaseLayer?.id || null : null,
      baseFriendsLayerId:
        baseAudience === POST_AUDIENCE.FRIENDS
          ? friendsBaseLayer?.id || null
          : null,
      extraCommunityLayerId: selectedCommunityLayerId || null,
    });

    resetForm();
  };

  const applyPickedMedia = (result, source) => {
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setMediaUrl(asset.uri);
    setMediaType(asset.type === "video" ? "video" : "photo");
    setMediaSource(source || null);
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
      applyPickedMedia(result, MEDIA_SOURCE.LIBRARY);
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
      applyPickedMedia(result, MEDIA_SOURCE.CAMERA);
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
                    setMediaSource(null);
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
            <View style={styles.audienceRow}>
              <TouchableOpacity
                style={[
                  styles.audienceBtn,
                  baseAudience === POST_AUDIENCE.FRIENDS &&
                    styles.audienceBtnActive,
                ]}
                onPress={() => setBaseAudience(POST_AUDIENCE.FRIENDS)}
              >
                <Text
                  style={[
                    styles.audienceBtnText,
                    baseAudience === POST_AUDIENCE.FRIENDS &&
                      styles.audienceBtnTextActive,
                  ]}
                >
                  Friends
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.audienceBtn,
                  baseAudience === POST_AUDIENCE.PUBLIC &&
                    styles.audienceBtnActive,
                ]}
                onPress={() => setBaseAudience(POST_AUDIENCE.PUBLIC)}
              >
                <Text
                  style={[
                    styles.audienceBtnText,
                    baseAudience === POST_AUDIENCE.PUBLIC &&
                      styles.audienceBtnTextActive,
                  ]}
                >
                  Public
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.audienceBtn,
                  baseAudience === POST_AUDIENCE.PRIVATE &&
                    styles.audienceBtnActive,
                ]}
                onPress={() => setBaseAudience(POST_AUDIENCE.PRIVATE)}
              >
                <Text
                  style={[
                    styles.audienceBtnText,
                    baseAudience === POST_AUDIENCE.PRIVATE &&
                      styles.audienceBtnTextActive,
                  ]}
                >
                  Private
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.inlineHint}>
              {baseAudience === POST_AUDIENCE.FRIENDS
                ? "Posts to your friends layer."
                : baseAudience === POST_AUDIENCE.PUBLIC
                  ? "Posts to the public layer (and friends)."
                  : "Private is route-controlled: visible only in layers you attach."}
            </Text>
            <Text style={styles.sectionLabel}>Optional Community Layer</Text>
            {communityAudienceLayers.length === 0 ? (
              <Text style={styles.emptyStateText}>
                You have no added community layers yet.
              </Text>
            ) : (
              <View style={styles.layerList}>
                <TouchableOpacity
                  style={[
                    styles.layerRow,
                    !selectedCommunityLayerId && styles.layerRowSelected,
                  ]}
                  onPress={() => setSelectedCommunityLayerId(null)}
                >
                  <View style={styles.layerRowLeft}>
                    <Text style={styles.layerName}>None</Text>
                    <Text style={styles.layerMeta}>
                      Do not add an extra community layer
                    </Text>
                  </View>
                  <Text style={styles.chooseText}>
                    {!selectedCommunityLayerId ? "Selected" : "Select"}
                  </Text>
                </TouchableOpacity>
                {communityAudienceLayers.map((layer) => {
                  const isSelected =
                    selectedCommunityLayerId === layer.id;
                  return (
                    <TouchableOpacity
                      key={layer.id}
                      style={[
                        styles.layerRow,
                        isSelected && styles.layerRowSelected,
                      ]}
                      onPress={() => setSelectedCommunityLayerId(layer.id)}
                    >
                      <View style={styles.layerRowLeft}>
                        <Text style={styles.layerName}>{layer.name}</Text>
                        <Text style={styles.layerMeta}>
                          {OWNER_LABELS[layer.owner_type] || "Community"}{" "}
                          • {layer.ownerCommunityName || "Community"}
                        </Text>
                      </View>

                      <Text style={styles.chooseText}>
                        {isSelected ? "Selected" : "Select"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

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
            {mediaSource === MEDIA_SOURCE.LIBRARY && (
              <Text style={styles.inlineHint}>
                Library media can use current location, but it will not be marked
                as location-verified.
              </Text>
            )}
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
    audienceRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 8,
    },
    audienceBtn: {
      width: "48%",
      paddingVertical: 9,
      backgroundColor: palette.mutedSurface,
      borderRadius: SIZES.radius,
      alignItems: "center",
      borderWidth: 1,
      borderColor: palette.border,
    },
    audienceBtnActive: {
      backgroundColor: palette.primary,
      borderColor: palette.primary,
    },
    audienceBtnText: {
      fontSize: 12,
      fontWeight: "700",
      color: palette.text,
    },
    audienceBtnTextActive: {
      color: palette.onPrimary,
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
