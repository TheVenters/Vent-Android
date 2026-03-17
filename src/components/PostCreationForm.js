import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Constants from "expo-constants";
import * as MediaLibrary from "expo-media-library";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
} from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GestureHandlerRootView,
  PinchGestureHandler,
  State,
} from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { GEOMETRY_TYPES, SIZES } from "../constants/theme";
import { useAppTheme } from "../context/ThemeContext";
import { getBrandAssetsForTheme } from "../constants/brandAssets";
import { getPinLayerKeyFromLayer } from "../utils/layers";

const LOCATION_MODES = {
  CURRENT: "current",
  PICK_ON_MAP: "pick_on_map",
};

const MEDIA_SOURCE = {
  LIBRARY: "library",
  CAMERA: "camera",
};

const SHUTTER_RECORD_LONG_PRESS_DELAY_MS = 220;
const CAMERA_ZOOM_STEP = 0.12;
const CAMERA_READY_STABILIZE_MS = 20;
const CAMERA_MODE_SWITCH_TIMEOUT_MS = 1400;
const PHOTO_CAPTURE_ANDROID_STABILIZE_MS = 320;
const PHOTO_CAPTURE_RETRY_DELAY_MS = 220;
const RECORD_RETRY_DELAY_MS = 160;
const MIN_VIDEO_RECORDING_MS = 1300;
const STOP_FINALIZE_TIMEOUT_MS = 12000;
const SECONDARY_STOP_PULSE_DELAY_MS = 1400;
const DEBUG_CAPTURE_GESTURES = true;
const IS_EXPO_GO =
  Platform.OS === "android" && String(Constants?.appOwnership || "") === "expo";

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

const AUDIENCE_VISUALS = {
  friends: { icon: "👥", label: "Friends" },
  public: { icon: "🌐", label: "Public" },
  private: { icon: "🔒", label: "Private" },
};

const DROPDOWN_IDS = {
  GEOMETRY: "geometry",
};

const normalizePickedAsset = (asset, fallbackSource) => {
  if (!asset || typeof asset !== "object") return null;

  const isVideo = String(asset.type || "").toLowerCase() === "video";
  const mediaType = isVideo ? "video" : "photo";
  const source = String(fallbackSource || "").trim() || MEDIA_SOURCE.LIBRARY;
  let mediaUrl = String(asset.uri || "").trim();
  if (!mediaUrl) return null;

  // Keep photos in-memory as data URIs so uploads do not rely on
  // temporary file permissions.
  if (!isVideo && asset.base64) {
    const mimeType = String(asset.mimeType || "").trim() || "image/jpeg";
    mediaUrl = `data:${mimeType};base64,${asset.base64}`;
  }

  const uniqueSuffix = `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  return {
    id: `${String(asset.assetId || asset.uri || "media").trim()}-${uniqueSuffix}`,
    mediaUrl,
    mediaType,
    mediaSource: source,
  };
};

const clampNormalizedZoom = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const PostCreationForm = ({
  visible,
  onClose,
  onSubmit,
  layers,
  userLocation,
  holdRecordStartToken = 0,
  holdRecordStopToken = 0,
}) => {
  const { palette, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(palette, isDark, insets);
  const brandAssets = useMemo(() => getBrandAssetsForTheme(isDark), [isDark]);
  const cameraRef = useRef(null);
  const optionsExpandProgress = useSharedValue(0);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] =
    useMicrophonePermissions();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [geometryType, setGeometryType] = useState(GEOMETRY_TYPES.POINT);
  const [selectedCommunityLayerId, setSelectedCommunityLayerId] =
    useState(null);
  const [locationMode, setLocationMode] = useState(LOCATION_MODES.CURRENT);
  const [mediaItems, setMediaItems] = useState([]);
  const [baseAudience, setBaseAudience] = useState(POST_AUDIENCE.FRIENDS);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [showOptionsPanel, setShowOptionsPanel] = useState(false);
  const [activeOptionsTab, setActiveOptionsTab] = useState("settings");
  const [cameraFacing, setCameraFacing] = useState("back");
  const [cameraFlashMode, setCameraFlashMode] = useState("off");
  const [cameraMode, setCameraMode] = useState("video");
  const [cameraZoom, setCameraZoom] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [isVideoFinalizing, setIsVideoFinalizing] = useState(false);
  const [pendingHoldRecordStart, setPendingHoldRecordStart] = useState(false);
  const [recordRetryTick, setRecordRetryTick] = useState(0);
  const [isPhotoPreviewVisible, setIsPhotoPreviewVisible] = useState(false);
  const [photoPreviewIndex, setPhotoPreviewIndex] = useState(0);
  const [videoPreviewItem, setVideoPreviewItem] = useState(null);
  const [stackTopIndex, setStackTopIndex] = useState(0);
  const photoPreviewScrollRef = useRef(null);
  const prevMediaCountRef = useRef(0);
  const lastHoldStartTokenRef = useRef(0);
  const lastHoldStopTokenRef = useRef(0);
  const pendingVentHoldRecordRef = useRef(false);
  const shutterHoldTimerRef = useRef(null);
  const recordRetryTimerRef = useRef(null);
  const recordStartInFlightRef = useRef(false);
  const cameraReadyAtRef = useRef(0);
  const cameraModeSwitchAtRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const activeRecordPromiseRef = useRef(null);
  const stopRecordingRequestedRef = useRef(false);
  const forceStopFinalizeTimerRef = useRef(null);
  const scheduledStopTimerRef = useRef(null);
  const shutterPressActiveRef = useRef(false);
  const shutterLongPressActiveRef = useRef(false);
  const suppressNextShutterTapRef = useRef(false);
  const cameraModeRef = useRef("video");
  const cameraReadyRef = useRef(false);
  const isVideoRecordingRef = useRef(false);
  const isVideoFinalizingRef = useRef(false);
  const pinchStartZoomRef = useRef(0);
  const pinchLastLogAtRef = useRef(0);

  const logCapture = (...args) => {
    if (!DEBUG_CAPTURE_GESTURES) return;
    console.log("[CaptureFlow]", ...args);
  };

  const previewVideoSource = String(videoPreviewItem?.mediaUrl || "").trim() || null;
  const videoPreviewPlayer = useVideoPlayer(previewVideoSource, (player) => {
    player.loop = true;
    player.play();
  });

  const ensureMediaLibraryPermission = async () => {
    try {
      const current = await MediaLibrary.getPermissionsAsync();
      if (current?.granted) return true;
      const next = await MediaLibrary.requestPermissionsAsync();
      return Boolean(next?.granted);
    } catch (_error) {
      return false;
    }
  };

  const persistCapturedMediaLocally = async (mediaUri, mediaType) => {
    const uri = String(mediaUri || "").trim();
    if (!uri) return;
    try {
      const granted = await ensureMediaLibraryPermission();
      if (!granted) {
        logCapture("local save skipped: permission denied", { mediaType });
        return;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
      logCapture("saved media locally", { mediaType });
    } catch (error) {
      logCapture("local save failed", {
        mediaType,
        message: String(error?.message || error || ""),
      });
    }
  };

  const waitForCameraReadyInMode = async (
    targetMode,
    reason = "unknown",
    minimumReadyMs = CAMERA_READY_STABILIZE_MS,
  ) => {
    const normalizedTargetMode = String(targetMode || "").trim() || "picture";
    const switchStartedAt = Date.now();

    if (cameraModeRef.current !== normalizedTargetMode) {
      logCapture("switching camera mode", {
        reason,
        from: cameraModeRef.current,
        to: normalizedTargetMode,
      });
      cameraReadyRef.current = false;
      setCameraReady(false);
      cameraReadyAtRef.current = 0;
      cameraModeSwitchAtRef.current = switchStartedAt;
      setCameraMode(normalizedTargetMode);
    }

    while (Date.now() - switchStartedAt < CAMERA_MODE_SWITCH_TIMEOUT_MS) {
      const readyElapsedMs =
        cameraReadyAtRef.current > 0
          ? Date.now() - Number(cameraReadyAtRef.current)
          : null;
      const modeSettled = cameraModeRef.current === normalizedTargetMode;
      if (
        modeSettled &&
        cameraReadyRef.current &&
        Number.isFinite(readyElapsedMs) &&
        Number(readyElapsedMs || 0) >= minimumReadyMs &&
        cameraRef.current
      ) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    throw new Error(
      `Camera did not become ready in ${normalizedTargetMode} mode.`,
    );
  };

  const clearRecordRetryTimer = () => {
    if (recordRetryTimerRef.current) {
      clearTimeout(recordRetryTimerRef.current);
      recordRetryTimerRef.current = null;
    }
  };

  useEffect(() => {
    isVideoRecordingRef.current = isVideoRecording;
  }, [isVideoRecording]);

  useEffect(() => {
    cameraModeRef.current = cameraMode;
  }, [cameraMode]);

  useEffect(() => {
    cameraReadyRef.current = cameraReady;
  }, [cameraReady]);

  useEffect(() => {
    isVideoFinalizingRef.current = isVideoFinalizing;
  }, [isVideoFinalizing]);

  const clearForceStopFinalizeTimer = () => {
    if (forceStopFinalizeTimerRef.current) {
      clearTimeout(forceStopFinalizeTimerRef.current);
      forceStopFinalizeTimerRef.current = null;
    }
  };

  const clearScheduledStopTimer = () => {
    if (scheduledStopTimerRef.current) {
      clearTimeout(scheduledStopTimerRef.current);
      scheduledStopTimerRef.current = null;
    }
  };

  const scheduleRecordRetry = (reason) => {
    if (recordRetryTimerRef.current) return;
    const shouldRetry =
      pendingVentHoldRecordRef.current || shutterPressActiveRef.current;
    if (!shouldRetry) return;
    recordRetryTimerRef.current = setTimeout(() => {
      recordRetryTimerRef.current = null;
      const stillHolding =
        pendingVentHoldRecordRef.current || shutterPressActiveRef.current;
      if (!stillHolding) return;
      logCapture("retry pending record", { reason });
      setPendingHoldRecordStart(true);
      setRecordRetryTick((value) => value + 1);
    }, RECORD_RETRY_DELAY_MS);
  };

  const safelyStopRecording = () => {
    const stopRecording = cameraRef.current?.stopRecording;
    if (typeof stopRecording !== "function") {
      logCapture("stopRecording function missing");
      return false;
    }
    try {
      const stopResult = cameraRef.current.stopRecording();
      if (stopResult && typeof stopResult.then === "function") {
        stopResult.catch(() => {});
      }
      logCapture("stopRecording invoked");
      return true;
    } catch (error) {
      logCapture("stopRecording threw", {
        message: String(error?.message || error || ""),
      });
      return false;
    }
  };

  const availableLayers = useMemo(
    () => (Array.isArray(layers) ? layers : []),
    [layers],
  );

  const communityAudienceLayers = useMemo(
    () =>
      availableLayers
        .filter((layer) => layer.owner_type === "community")
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
      ) ||
      null,
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
      ) ||
      null,
    [availableLayers],
  );
  const selectedCommunityLayer = useMemo(
    () =>
      communityAudienceLayers.find((layer) => layer.id === selectedCommunityLayerId) ||
      null,
    [communityAudienceLayers, selectedCommunityLayerId],
  );

  useEffect(() => {
    if (!visible) return;
    setTitle("");
    setDescription("");
    setBaseAudience(POST_AUDIENCE.FRIENDS);
    setSelectedCommunityLayerId(null);
    setOpenDropdown(null);
    setShowOptionsPanel(false);
    setActiveOptionsTab("settings");
    setCameraFacing("back");
    setCameraFlashMode("off");
    setCameraMode("video");
    setCameraZoom(0);
    setCameraReady(false);
    setIsVideoRecording(false);
    setIsVideoFinalizing(false);
    setPendingHoldRecordStart(false);
    setRecordRetryTick(0);
    setIsPhotoPreviewVisible(false);
    setPhotoPreviewIndex(0);
    setVideoPreviewItem(null);
    setStackTopIndex(0);
    if (!cameraPermission?.granted) {
      requestCameraPermission().catch(() => {});
    }
    if (!microphonePermission?.granted) {
      requestMicrophonePermission().catch(() => {});
    }
  }, [
    visible,
    cameraPermission?.granted,
    requestCameraPermission,
    microphonePermission?.granted,
    requestMicrophonePermission,
  ]);

  useEffect(() => {
    optionsExpandProgress.value = withTiming(showOptionsPanel ? 1 : 0, {
      duration: 250,
    });
  }, [showOptionsPanel, optionsExpandProgress]);

  const normalizedMediaItems = useMemo(
    () =>
      (Array.isArray(mediaItems) ? mediaItems : [])
        .map((item) => ({
          id: String(item?.id || "").trim(),
          mediaUrl: String(item?.mediaUrl || "").trim(),
          mediaType: String(item?.mediaType || "photo").toLowerCase(),
          mediaSource: String(item?.mediaSource || "").toLowerCase(),
        }))
        .filter((item) => item.mediaUrl.length > 0),
    [mediaItems],
  );
  const previewableMediaItems = useMemo(
    () => normalizedMediaItems.filter((item) => item.mediaType === "photo"),
    [normalizedMediaItems],
  );
  const stackMediaItems = useMemo(() => normalizedMediaItems, [normalizedMediaItems]);

  const primaryMediaItem = normalizedMediaItems[0] || null;
  const primaryMediaUrl = primaryMediaItem?.mediaUrl || null;
  const primaryMediaType = primaryMediaItem?.mediaType || null;
  const primaryMediaSource = useMemo(() => {
    if (normalizedMediaItems.length === 0) return null;
    if (
      normalizedMediaItems.some(
        (item) => item.mediaSource === MEDIA_SOURCE.LIBRARY,
      )
    ) {
      return MEDIA_SOURCE.LIBRARY;
    }
    return MEDIA_SOURCE.CAMERA;
  }, [normalizedMediaItems]);

  const resetForm = () => {
    safelyStopRecording();
    if (shutterHoldTimerRef.current) {
      clearTimeout(shutterHoldTimerRef.current);
      shutterHoldTimerRef.current = null;
    }
    clearRecordRetryTimer();
    clearForceStopFinalizeTimer();
    clearScheduledStopTimer();
    setTitle("");
    setDescription("");
    setGeometryType(GEOMETRY_TYPES.POINT);
    setSelectedCommunityLayerId(null);
    setLocationMode(LOCATION_MODES.CURRENT);
    setMediaItems([]);
    setBaseAudience(POST_AUDIENCE.FRIENDS);
    setOpenDropdown(null);
    setShowOptionsPanel(false);
    setActiveOptionsTab("settings");
    setCameraFacing("back");
    setCameraFlashMode("off");
    setCameraMode("video");
    setCameraZoom(0);
    setCameraReady(false);
    setIsVideoRecording(false);
    setPendingHoldRecordStart(false);
    setIsPhotoPreviewVisible(false);
    setPhotoPreviewIndex(0);
    setVideoPreviewItem(null);
    setStackTopIndex(0);
    shutterPressActiveRef.current = false;
    shutterLongPressActiveRef.current = false;
    suppressNextShutterTapRef.current = false;
    pendingVentHoldRecordRef.current = false;
    recordStartInFlightRef.current = false;
    pinchStartZoomRef.current = 0;
    cameraReadyAtRef.current = 0;
    cameraModeSwitchAtRef.current = 0;
    recordingStartedAtRef.current = 0;
    activeRecordPromiseRef.current = null;
    stopRecordingRequestedRef.current = false;
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = () => {
    if (!title.trim() && normalizedMediaItems.length === 0) {
      Alert.alert(
        "Post Required",
        "Add a photo, a video, or a title before posting.",
      );
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
      title: title.trim(),
      content: description.trim(),
      geometryType,
      locationMode,
      location:
        locationMode === LOCATION_MODES.CURRENT && userLocation
          ? {
              latitude: userLocation.latitude,
              longitude: userLocation.longitude,
            }
          : null,
      mediaItems: normalizedMediaItems,
      mediaUrl: primaryMediaUrl,
      mediaType: primaryMediaType,
      mediaSource: primaryMediaSource,
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
    if (result.canceled || !Array.isArray(result.assets) || result.assets.length === 0)
      return;

    const nextItems = result.assets
      .map((asset) => normalizePickedAsset(asset, source))
      .filter(Boolean);
    if (nextItems.length === 0) return;

    setMediaItems((prev) => {
      const existing = Array.isArray(prev) ? prev : [];
      return [...existing, ...nextItems];
    });
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
        allowsMultipleSelection: true,
        selectionLimit: 8,
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });
      applyPickedMedia(result, MEDIA_SOURCE.LIBRARY);
    } catch (error) {
      console.error("Error picking media:", error);
      Alert.alert("Error", "Failed to pick media.");
    }
  };

  const capturePhotoViaSystemCamera = async () => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.8,
      base64: false,
    });
    if (result.canceled || !Array.isArray(result.assets) || result.assets.length === 0) {
      return null;
    }
    return normalizePickedAsset(result.assets[0], MEDIA_SOURCE.CAMERA);
  };

  const captureFromLiveCamera = async () => {
    if (isCapturing || isVideoRecording || isVideoFinalizing) return;

    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission?.granted) {
        Alert.alert("Permission Needed", "Please grant camera permissions.");
        return;
      }
    }
    if (!cameraRef.current) {
      Alert.alert("Camera Not Ready", "Camera is still initializing.");
      return;
    }

    try {
      setIsCapturing(true);
      await waitForCameraReadyInMode(
        "picture",
        "photo_capture",
        Platform.OS === "android"
          ? PHOTO_CAPTURE_ANDROID_STABILIZE_MS
          : CAMERA_READY_STABILIZE_MS,
      );
      const takePhoto = async () =>
        (await cameraRef.current?.takePictureAsync?.({
          quality: 0.8,
          skipProcessing: false,
        })) ||
        (await cameraRef.current?.takePicture?.({
          quality: 0.8,
          skipProcessing: false,
        }));

      let photo = null;
      try {
        photo = await takePhoto();
      } catch (firstError) {
        const firstMessage = String(firstError?.message || firstError || "");
        const isRetryableAndroidCaptureFailure =
          Platform.OS === "android" &&
          /failed to capture image|capture image/i.test(firstMessage);
        if (!isRetryableAndroidCaptureFailure) {
          throw firstError;
        }

        logCapture("photo capture retry scheduled", {
          message: firstMessage,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, PHOTO_CAPTURE_RETRY_DELAY_MS),
        );
        await waitForCameraReadyInMode(
          "picture",
          "photo_capture_retry",
          PHOTO_CAPTURE_ANDROID_STABILIZE_MS,
        );
        photo = await takePhoto();
      }

      if (!photo?.uri) return;
      const normalized = normalizePickedAsset(
        {
          uri: photo.uri,
          mimeType: "image/jpeg",
          type: "image",
        },
        MEDIA_SOURCE.CAMERA,
      );
      if (!normalized) return;
      setMediaItems((prev) => [...(Array.isArray(prev) ? prev : []), normalized]);
      logCapture("photo appended", { uri: String(photo.uri || "").slice(0, 160) });
      persistCapturedMediaLocally(photo.uri, "photo");
    } catch (error) {
      if (IS_EXPO_GO) {
        try {
          logCapture("photo capture fallback to system camera", {
            message: String(error?.message || error || ""),
          });
          const fallbackPhoto = await capturePhotoViaSystemCamera();
          if (fallbackPhoto) {
            setMediaItems((prev) => [
              ...(Array.isArray(prev) ? prev : []),
              fallbackPhoto,
            ]);
            logCapture("system camera photo appended", {
              uri: String(fallbackPhoto.mediaUrl || "").slice(0, 160),
            });
            return;
          }
        } catch (fallbackError) {
          logCapture("system camera fallback failed", {
            message: String(fallbackError?.message || fallbackError || ""),
          });
        }
      }
      logCapture("photo capture failed", {
        cameraMode,
        cameraReady,
        readyElapsedMs:
          cameraReadyAtRef.current > 0
            ? Date.now() - Number(cameraReadyAtRef.current)
            : null,
        message: String(error?.message || error || ""),
      });
      console.error("Error capturing photo:", error);
      Alert.alert("Capture Failed", "Unable to capture photo right now.");
    } finally {
      setIsCapturing(false);
      if (cameraMode !== "video") {
        setCameraReady(false);
        cameraReadyAtRef.current = 0;
        cameraModeSwitchAtRef.current = Date.now();
        setCameraMode("video");
      }
    }
  };

  const stopVideoRecording = () => {
    logCapture("stopVideoRecording", {
      isVideoRecording: isVideoRecordingRef.current,
      stopAlreadyRequested: stopRecordingRequestedRef.current,
      hasActiveRecordPromise: Boolean(activeRecordPromiseRef.current),
    });
    setPendingHoldRecordStart(false);
    clearRecordRetryTimer();
    if (stopRecordingRequestedRef.current) {
      return;
    }
    stopRecordingRequestedRef.current = true;
    setIsVideoFinalizing(true);
    isVideoFinalizingRef.current = true;

    const performNativeStop = () => {
      const stopInvoked = safelyStopRecording();
      if (!stopInvoked) {
        logCapture("native stop failed to invoke");
      }
      // Some iOS builds miss the first stop signal; send one more if unresolved.
      setTimeout(() => {
        if (!activeRecordPromiseRef.current || !stopRecordingRequestedRef.current) return;
        logCapture("issuing secondary stop pulse");
        safelyStopRecording();
      }, SECONDARY_STOP_PULSE_DELAY_MS);
      clearForceStopFinalizeTimer();
      forceStopFinalizeTimerRef.current = setTimeout(() => {
        logCapture("force stop finalize fallback");
        forceStopFinalizeTimerRef.current = null;
        recordStartInFlightRef.current = false;
        activeRecordPromiseRef.current = null;
        stopRecordingRequestedRef.current = false;
        recordingStartedAtRef.current = 0;
        setIsVideoRecording(false);
        setIsVideoFinalizing(false);
        isVideoRecordingRef.current = false;
        isVideoFinalizingRef.current = false;
        setCameraReady(false);
        cameraReadyAtRef.current = 0;
        cameraModeSwitchAtRef.current = Date.now();
        setCameraMode("video");
      }, STOP_FINALIZE_TIMEOUT_MS);
    };

    const activeRecordPromise = activeRecordPromiseRef.current;
    if (!activeRecordPromise) {
      stopRecordingRequestedRef.current = false;
      recordingStartedAtRef.current = 0;
      setIsVideoRecording(false);
      setIsVideoFinalizing(false);
      isVideoRecordingRef.current = false;
      isVideoFinalizingRef.current = false;
      setCameraReady(false);
      cameraReadyAtRef.current = 0;
      cameraModeSwitchAtRef.current = Date.now();
      setCameraMode("video");
      return;
    }

    const elapsedMs =
      recordingStartedAtRef.current > 0
        ? Date.now() - Number(recordingStartedAtRef.current)
        : null;
    const needsDelay =
      Number.isFinite(elapsedMs) && Number(elapsedMs) < MIN_VIDEO_RECORDING_MS;
    if (needsDelay) {
      const waitMs = Math.max(0, MIN_VIDEO_RECORDING_MS - Number(elapsedMs));
      logCapture("delaying stop for minimum video duration", {
        elapsedMs,
        waitMs,
      });
      clearScheduledStopTimer();
      scheduledStopTimerRef.current = setTimeout(() => {
        scheduledStopTimerRef.current = null;
        performNativeStop();
      }, waitMs);
      return;
    }

    performNativeStop();
  };

  const startVideoRecording = async ({ source = "unknown" } = {}) => {
    if (
      recordStartInFlightRef.current ||
      isVideoRecordingRef.current ||
      isCapturing ||
      isVideoFinalizingRef.current
    ) {
      logCapture("skip start: busy", {
        source,
        recordStartInFlight: recordStartInFlightRef.current,
        isVideoRecording: isVideoRecordingRef.current,
        isCapturing,
        isVideoFinalizing: isVideoFinalizingRef.current,
      });
      return;
    }

    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission?.granted) {
        setPendingHoldRecordStart(false);
        Alert.alert(
          "Permission Needed",
          "Please grant camera permissions before recording.",
        );
        return;
      }
    }
    if (!microphonePermission?.granted) {
      const micPermission = await requestMicrophonePermission();
      if (!micPermission?.granted) {
        setPendingHoldRecordStart(false);
        Alert.alert(
          "Permission Needed",
          "Please grant microphone permissions before recording video.",
        );
        return;
      }
    }

    if (!cameraRef.current) {
      logCapture("camera ref missing", { source });
      setPendingHoldRecordStart(true);
      scheduleRecordRetry("camera_ref_missing");
      return;
    }

    if (cameraMode !== "video") {
      logCapture("switching mode to video for recording", { source, cameraMode });
      setCameraReady(false);
      cameraReadyAtRef.current = 0;
      cameraModeSwitchAtRef.current = Date.now();
      setCameraMode("video");
      setPendingHoldRecordStart(true);
      scheduleRecordRetry("switch_mode_video");
      return;
    }

    const readyElapsedMs =
      cameraReadyAtRef.current > 0
        ? Date.now() - Number(cameraReadyAtRef.current)
        : null;
    if (
      !cameraReady ||
      !Number.isFinite(readyElapsedMs) ||
      Number(readyElapsedMs || 0) < CAMERA_READY_STABILIZE_MS
    ) {
      logCapture("waiting for camera ready", {
        source,
        cameraReady,
        readyElapsedMs,
        sinceModeSwitchMs:
          cameraModeSwitchAtRef.current > 0
            ? Date.now() - Number(cameraModeSwitchAtRef.current)
            : null,
      });
      setPendingHoldRecordStart(true);
      scheduleRecordRetry("await_camera_ready");
      return;
    }
    logCapture("attempt record start", {
      source,
      cameraReady,
      readyElapsedMs,
    });

    let shouldStayInVideoMode = false;
    try {
      clearRecordRetryTimer();
      setPendingHoldRecordStart(false);
      recordStartInFlightRef.current = true;
      stopRecordingRequestedRef.current = false;
      setIsVideoFinalizing(false);
      const recordOptions = {
        maxDuration: 60,
        ...(Platform.OS === "ios" ? { codec: "avc1" } : {}),
      };
      const recordPromise =
        (typeof cameraRef.current?.recordAsync === "function"
          ? cameraRef.current.recordAsync({
              ...recordOptions,
            })
          : null) ||
        (typeof cameraRef.current?.record === "function"
          ? cameraRef.current.record({
              ...recordOptions,
            })
          : null);
      if (!recordPromise || typeof recordPromise.then !== "function") {
        throw new Error("record promise is unavailable");
      }
      activeRecordPromiseRef.current = recordPromise;
      recordingStartedAtRef.current = Date.now();
      setIsVideoRecording(true);
      isVideoRecordingRef.current = true;
      logCapture("recording started", { source });
      const video = await recordPromise;
      logCapture("record promise resolved", {
        source,
        hasUri: Boolean(video?.uri),
        stopRequested: stopRecordingRequestedRef.current,
      });
      if (!video?.uri) return;
      const normalized = normalizePickedAsset(
        {
          uri: video.uri,
          type: "video",
        },
        MEDIA_SOURCE.CAMERA,
      );
      if (!normalized) return;
      setMediaItems((prev) => [...(Array.isArray(prev) ? prev : []), normalized]);
      logCapture("video appended", { uri: String(video.uri || "").slice(0, 160) });
      persistCapturedMediaLocally(video.uri, "video");
    } catch (error) {
      const message = String(error?.message || "");
      logCapture("record failed", { source, message });
      if (/camera is not ready yet|not ready/i.test(message)) {
        logCapture("record not ready error", { source, message });
        setPendingHoldRecordStart(true);
        scheduleRecordRetry("camera_not_ready_error");
        shouldStayInVideoMode = true;
        return;
      }
      if (!/stop|cancel|abort|not recording/i.test(message)) {
        console.error("Error recording video:", error);
        Alert.alert("Recording Failed", "Unable to record video right now.");
      }
    } finally {
      clearForceStopFinalizeTimer();
      clearScheduledStopTimer();
      activeRecordPromiseRef.current = null;
      recordingStartedAtRef.current = 0;
      recordStartInFlightRef.current = false;
      setIsVideoRecording(false);
      isVideoRecordingRef.current = false;
      stopRecordingRequestedRef.current = false;
      setIsVideoFinalizing(false);
      isVideoFinalizingRef.current = false;
      if (shouldStayInVideoMode) {
        logCapture("record finalize keep video mode", { source });
        return;
      }
      if (cameraMode !== "video") {
        setCameraReady(false);
        cameraReadyAtRef.current = 0;
        cameraModeSwitchAtRef.current = Date.now();
        setCameraMode("video");
      } else {
        cameraReadyAtRef.current = Date.now();
        setCameraReady(true);
      }
      logCapture("record finalize keep camera video-ready", { source });
    }
  };

  useEffect(() => {
    if (!visible) return;
    const nextToken = Number(holdRecordStartToken || 0);
    if (!Number.isFinite(nextToken)) return;
    if (nextToken === lastHoldStartTokenRef.current) return;
    lastHoldStartTokenRef.current = nextToken;
    pendingVentHoldRecordRef.current = true;
    logCapture("vent hold record token received");
    setPendingHoldRecordStart(true);
  }, [holdRecordStartToken, visible]);

  useEffect(() => {
    if (!pendingHoldRecordStart || !visible) return;
    if (isVideoFinalizing) return;
    if (
      !pendingVentHoldRecordRef.current &&
      !shutterPressActiveRef.current &&
      !isVideoRecording
    ) {
      return;
    }
    startVideoRecording({ source: "pending_effect" });
  }, [
    pendingHoldRecordStart,
    recordRetryTick,
    visible,
    cameraReady,
    cameraPermission?.granted,
    microphonePermission?.granted,
    isVideoRecording,
    isCapturing,
    isVideoFinalizing,
  ]);

  useEffect(() => {
    const nextToken = Number(holdRecordStopToken || 0);
    if (!Number.isFinite(nextToken)) return;
    if (nextToken === lastHoldStopTokenRef.current) return;
    lastHoldStopTokenRef.current = nextToken;
    pendingVentHoldRecordRef.current = false;
    logCapture("vent hold stop token received");
    stopVideoRecording();
  }, [holdRecordStopToken]);

  const cycleAudience = () => {
    setBaseAudience((prev) => {
      if (prev === POST_AUDIENCE.FRIENDS) return POST_AUDIENCE.PUBLIC;
      if (prev === POST_AUDIENCE.PUBLIC) return POST_AUDIENCE.PRIVATE;
      return POST_AUDIENCE.FRIENDS;
    });
  };

  const handleShutterPressIn = () => {
    if (isVideoFinalizingRef.current) {
      logCapture("shutter press in ignored during video finalize");
      return;
    }
    logCapture("shutter press in");
    shutterPressActiveRef.current = true;
    shutterLongPressActiveRef.current = false;
    if (shutterHoldTimerRef.current) {
      clearTimeout(shutterHoldTimerRef.current);
    }
    shutterHoldTimerRef.current = setTimeout(() => {
      shutterHoldTimerRef.current = null;
      if (
        !shutterPressActiveRef.current ||
        isCapturing ||
        isVideoRecordingRef.current ||
        isVideoFinalizingRef.current
      ) {
        return;
      }
      shutterLongPressActiveRef.current = true;
      suppressNextShutterTapRef.current = true;
      logCapture("shutter hold threshold reached");
      startVideoRecording({ source: "shutter_hold" });
    }, SHUTTER_RECORD_LONG_PRESS_DELAY_MS);
  };

  const handleShutterPressOut = () => {
    logCapture("shutter press out", {
      isVideoRecording: isVideoRecordingRef.current,
      isLongPress: shutterLongPressActiveRef.current,
    });
    shutterPressActiveRef.current = false;
    setPendingHoldRecordStart(false);
    if (shutterHoldTimerRef.current) {
      clearTimeout(shutterHoldTimerRef.current);
      shutterHoldTimerRef.current = null;
    }
    if (isVideoFinalizingRef.current) {
      shutterLongPressActiveRef.current = false;
      return;
    }
    if (
      shutterLongPressActiveRef.current ||
      isVideoRecordingRef.current
    ) {
      suppressNextShutterTapRef.current = true;
      stopVideoRecording();
      shutterLongPressActiveRef.current = false;
      return;
    }
    void captureFromLiveCamera();
    shutterLongPressActiveRef.current = false;
  };

  const handleShutterPress = () => {
    if (suppressNextShutterTapRef.current) {
      suppressNextShutterTapRef.current = false;
      return;
    }
  };

  const adjustCameraZoom = (direction) => {
    setCameraZoom((prev) => {
      const delta = direction === "in" ? CAMERA_ZOOM_STEP : -CAMERA_ZOOM_STEP;
      const next = Number(prev || 0) + delta;
      return clampNormalizedZoom(next);
    });
  };

  const handlePinchGestureEvent = (event) => {
    const scale = Number(event?.nativeEvent?.scale || 1);
    const nextZoom = pinchStartZoomRef.current + (scale - 1) * 0.35;
    const clampedZoom = clampNormalizedZoom(nextZoom);
    setCameraZoom(clampedZoom);
    const now = Date.now();
    if (now - pinchLastLogAtRef.current >= 180) {
      pinchLastLogAtRef.current = now;
      logCapture("pinch move", { scale, clampedZoom });
    }
  };

  const handlePinchStateChange = (event) => {
    const nextState = Number(event?.nativeEvent?.state);
    const scale = Number(event?.nativeEvent?.scale || 1);
    if (nextState === State.BEGAN) {
      pinchStartZoomRef.current = cameraZoom;
      logCapture("pinch began", { cameraZoom });
      return;
    }
    if (
      nextState === State.END ||
      nextState === State.CANCELLED ||
      nextState === State.FAILED
    ) {
      const nextZoom = pinchStartZoomRef.current + (scale - 1) * 0.35;
      pinchStartZoomRef.current = clampNormalizedZoom(nextZoom);
      logCapture("pinch ended", { nextZoom: pinchStartZoomRef.current });
    }
  };

  const renderDropdown = (
    id,
    label,
    selectedLabel,
    selectedValue,
    options,
    onSelect,
  ) => {
    const isOpen = openDropdown === id;
    return (
      <View style={styles.dropdownWrap}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TouchableOpacity
          style={styles.dropdownTrigger}
          onPress={() => setOpenDropdown(isOpen ? null : id)}
        >
          <Text style={styles.dropdownTriggerText}>{selectedLabel}</Text>
          <Text style={styles.dropdownChevron}>{isOpen ? "▲" : "▼"}</Text>
        </TouchableOpacity>
        {isOpen ? (
          <View style={styles.dropdownMenu}>
            {options.map((option) => {
              const isSelected = option.value === selectedValue;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.dropdownOption,
                    isSelected && styles.dropdownOptionSelected,
                  ]}
                  onPress={() => {
                    onSelect(option.value);
                    setOpenDropdown(null);
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownOptionText,
                      isSelected && styles.dropdownOptionTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  };

  const geometryLabel =
    geometryType.charAt(0).toUpperCase() + geometryType.slice(1);
  const postButtonLabel = "Post";
  const mediaCountLabel =
    normalizedMediaItems.length > 0
      ? `${normalizedMediaItems.length} media item${
          normalizedMediaItems.length === 1 ? "" : "s"
        } selected`
      : "No media selected";
  const isPickOnMap = locationMode === LOCATION_MODES.PICK_ON_MAP;
  const audienceOptions = [
    { label: "Friends", value: POST_AUDIENCE.FRIENDS },
    { label: "Public", value: POST_AUDIENCE.PUBLIC },
    { label: "Private", value: POST_AUDIENCE.PRIVATE },
  ];
  const activeAudienceVisual =
    AUDIENCE_VISUALS[baseAudience] || AUDIENCE_VISUALS[POST_AUDIENCE.FRIENDS];

  const toggleOptionsPanel = () => {
    setOpenDropdown(null);
    setShowOptionsPanel((prev) => {
      if (prev) return false;
      setActiveOptionsTab("settings");
      return true;
    });
  };

  const optionsMenuAnimatedStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      optionsExpandProgress.value,
      [0, 1],
      [100, 0],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      optionsExpandProgress.value,
      [0, 0.3, 1],
      [0, 0, 1],
      Extrapolation.CLAMP,
    );
    return { transform: [{ translateY }], opacity };
  });

  const optionsPanelAnimatedStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      optionsExpandProgress.value,
      [0, 1],
      [80, 0],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      optionsExpandProgress.value,
      [0, 0.3, 1],
      [0, 0, 1],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      optionsExpandProgress.value,
      [0, 1],
      [0.96, 1],
      Extrapolation.CLAMP,
    );
    return {
      opacity,
      transform: [{ translateY }, { scale }],
    };
  });

  const showLiveCamera = true;
  const screenWidth = Dimensions.get("window").width;

  useEffect(() => {
    if (stackMediaItems.length === 0) {
      setStackTopIndex(0);
      prevMediaCountRef.current = 0;
      return;
    }
    const previousCount = Number(prevMediaCountRef.current || 0);
    if (stackMediaItems.length > previousCount) {
      setStackTopIndex(stackMediaItems.length - 1);
      prevMediaCountRef.current = stackMediaItems.length;
      return;
    }
    setStackTopIndex((prev) =>
      Math.max(0, Math.min(stackMediaItems.length - 1, Number(prev) || 0)),
    );
    prevMediaCountRef.current = stackMediaItems.length;
  }, [stackMediaItems.length]);

  const stackedPreviewItems = useMemo(() => {
    if (stackMediaItems.length === 0) return [];
    const clampedTop = Math.max(
      0,
      Math.min(stackMediaItems.length - 1, Number(stackTopIndex) || 0),
    );
    let start = Math.max(0, clampedTop - 2);
    let end = clampedTop + 1;
    while (end - start < 3 && end < stackMediaItems.length) {
      end += 1;
    }
    while (end - start < 3 && start > 0) {
      start -= 1;
    }
    return stackMediaItems.slice(start, end);
  }, [stackMediaItems, stackTopIndex]);

  useEffect(() => {
    if (!isPhotoPreviewVisible) return;
    const targetX = Math.max(0, photoPreviewIndex) * screenWidth;
    requestAnimationFrame(() => {
      photoPreviewScrollRef.current?.scrollTo?.({
        x: targetX,
        y: 0,
        animated: false,
      });
    });
  }, [isPhotoPreviewVisible, photoPreviewIndex, screenWidth]);

  useEffect(() => {
    try {
      if (videoPreviewItem) {
        videoPreviewPlayer.play();
      } else {
        videoPreviewPlayer.pause();
      }
    } catch (_error) {}
  }, [videoPreviewItem, videoPreviewPlayer]);

  const openMediaPreviewFromStack = (index = 0) => {
    if (stackMediaItems.length === 0) return;
    const clampedIndex = Math.max(
      0,
      Math.min(stackMediaItems.length - 1, Number(index) || 0),
    );
    const stackItem = stackMediaItems[clampedIndex];
    if (!stackItem) {
      return;
    }
    if (stackItem.mediaType === "video") {
      setIsPhotoPreviewVisible(false);
      setVideoPreviewItem(stackItem);
      return;
    }
    if (stackItem.mediaType !== "photo") {
      return;
    }
    const photoIndex = previewableMediaItems.findIndex(
      (item) => String(item.id || "") === String(stackItem.id || ""),
    );
    if (photoIndex < 0) return;
    setVideoPreviewItem(null);
    setPhotoPreviewIndex(photoIndex);
    setIsPhotoPreviewVisible(true);
  };

  const stackPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, gestureState) =>
          Math.abs(Number(gestureState?.dx || 0)) > 4 &&
          Math.abs(Number(gestureState?.dx || 0)) >
            Math.abs(Number(gestureState?.dy || 0)),
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: (_evt, gestureState) => {
          const dx = Number(gestureState?.dx || 0);
          const dy = Number(gestureState?.dy || 0);
          if (Math.abs(dx) < 16 && Math.abs(dy) < 16) {
            openMediaPreviewFromStack(stackTopIndex);
            return;
          }
          const count = stackMediaItems.length;
          if (Math.abs(dx) < 14 || count <= 1) return;
          setStackTopIndex((prev) => {
            const current = Math.max(0, Math.min(count - 1, Number(prev) || 0));
            if (dx < 0) return (current + 1) % count;
            return (current - 1 + count) % count;
          });
        },
        onPanResponderTerminate: (_evt, gestureState) => {
          const dx = Number(gestureState?.dx || 0);
          const count = stackMediaItems.length;
          if (Math.abs(dx) < 14 || count <= 1) return;
          setStackTopIndex((prev) => {
            const current = Math.max(0, Math.min(count - 1, Number(prev) || 0));
            if (dx < 0) return (current + 1) % count;
            return (current - 1 + count) % count;
          });
        },
      }),
    [stackMediaItems, previewableMediaItems, stackTopIndex],
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <GestureHandlerRootView style={styles.gestureRoot}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.overlay}
        >
          <View style={styles.stage}>
          {showLiveCamera ? (
            cameraPermission?.granted ? (
              <PinchGestureHandler
                onGestureEvent={handlePinchGestureEvent}
                onHandlerStateChange={handlePinchStateChange}
              >
                <View style={styles.cameraGestureSurface}>
                  <CameraView
                    key={`camera-${cameraFacing}-${cameraMode}`}
                    ref={cameraRef}
                    style={styles.cameraFill}
                    facing={cameraFacing}
                    flash={cameraFlashMode}
                    mode={cameraMode}
                    zoom={cameraZoom}
                    onCameraReady={() => {
                      cameraReadyAtRef.current = Date.now();
                      cameraReadyRef.current = true;
                      setCameraReady(true);
                      logCapture("camera ready", { cameraFacing, cameraMode });
                    }}
                    onMountError={(event) => {
                      cameraReadyRef.current = false;
                      logCapture("camera mount error", {
                        message: String(event?.nativeEvent?.message || ""),
                      });
                    }}
                  />
                </View>
              </PinchGestureHandler>
            ) : (
              <View style={styles.cameraFallback}>
                <Text style={styles.cameraFallbackTitle}>Camera Access Needed</Text>
                <Text style={styles.cameraFallbackSubtext}>
                  Enable camera to start in capture mode.
                </Text>
                <TouchableOpacity
                  style={styles.enableBtn}
                  onPress={() => requestCameraPermission()}
                >
                  <Text style={styles.enableBtnText}>Enable Camera</Text>
                </TouchableOpacity>
              </View>
            )
          ) : null}

          <View style={styles.shade} pointerEvents="none" />

          <View style={styles.topBar}>
            <TouchableOpacity style={styles.topChip} onPress={handleClose}>
              <Text style={styles.topChipText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.audienceChip} onPress={cycleAudience}>
              <Text style={styles.audienceChipIcon}>{activeAudienceVisual.icon}</Text>
              <Text style={styles.audienceChipText}>{activeAudienceVisual.label}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.topPrimaryChip} onPress={handleSubmit}>
              <Text style={styles.topPrimaryChipText}>{postButtonLabel}</Text>
            </TouchableOpacity>
          </View>
          {isVideoRecording ? (
            <View style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingBadgeText}>Recording</Text>
            </View>
          ) : null}

          <View style={styles.cameraQuickControls}>
            <View style={styles.zoomControls}>
              <TouchableOpacity
                style={styles.cameraQuickControlBtn}
                onPress={() => adjustCameraZoom("out")}
              >
                <Text style={styles.cameraQuickControlText}>-</Text>
              </TouchableOpacity>
              <View style={styles.zoomBadge}>
                <Text style={styles.zoomBadgeLabel}>Zoom</Text>
                <Text style={styles.zoomBadgeValue}>
                  {Math.round(cameraZoom * 100)}%
                </Text>
              </View>
              <TouchableOpacity
                style={styles.cameraQuickControlBtn}
                onPress={() => adjustCameraZoom("in")}
              >
                <Text style={styles.cameraQuickControlText}>+</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.cameraQuickControlBtn}
              onPress={() => {
                setCameraReady(false);
                cameraReadyAtRef.current = 0;
                setCameraFacing((prev) => (prev === "back" ? "front" : "back"));
              }}
            >
              <Text style={styles.cameraQuickControlText}>⇄</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.cameraQuickControlBtn,
                cameraFlashMode === "on" && styles.cameraQuickControlBtnActive,
              ]}
              onPress={() =>
                setCameraFlashMode((prev) => (prev === "on" ? "off" : "on"))
              }
            >
              <Text style={styles.cameraQuickControlText}>
                {cameraFlashMode === "on" ? "⚡" : "⚡︎"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.mediaCountBadge}>
            <Text style={styles.mediaCountBadgeText}>{mediaCountLabel}</Text>
          </View>

          <View style={styles.captureHintBadge}>
            <Text style={styles.captureHintText}>
              Tap for photo. Hold for video. Pinch to zoom.
            </Text>
          </View>

          <View style={styles.composerText}>
            <TextInput
              style={styles.headlineInput}
              placeholder="Title"
              placeholderTextColor="rgba(255,255,255,0.76)"
              value={title}
              onChangeText={setTitle}
              maxLength={90}
            />
            <TextInput
              style={styles.descriptionInput}
              placeholder="Description"
              placeholderTextColor="rgba(255,255,255,0.7)"
              value={description}
              onChangeText={setDescription}
              maxLength={500}
              multiline
              textAlignVertical="top"
            />
          </View>

          {stackedPreviewItems.length > 0 ? (
            <View
              style={styles.photoStackDock}
              {...stackPanResponder.panHandlers}
            >
              <View style={styles.photoStackStage}>
                {stackedPreviewItems.map((item, index) => {
                  const backOffset = stackedPreviewItems.length - index - 1;
                  return (
                    item.mediaType === "video" ? (
                      <View
                        key={`${item.id || "media"}-${index}`}
                        style={[
                          styles.photoStackCard,
                          styles.videoStackCard,
                          {
                            left: backOffset * 10,
                            bottom: backOffset * 6,
                            transform: [{ rotate: `${(backOffset - 1) * -5}deg` }],
                            zIndex: index + 1,
                          },
                        ]}
                      >
                        <Text style={styles.videoStackEmoji}>🎬</Text>
                        <Text style={styles.videoStackLabel}>Video</Text>
                      </View>
                    ) : (
                      <Image
                        key={`${item.id || "media"}-${index}`}
                        source={{ uri: item.mediaUrl }}
                        style={[
                          styles.photoStackCard,
                          {
                            left: backOffset * 10,
                            bottom: backOffset * 6,
                            transform: [{ rotate: `${(backOffset - 1) * -5}deg` }],
                            zIndex: index + 1,
                          },
                        ]}
                        resizeMode="cover"
                      />
                    )
                  );
                })}
              </View>
              {stackMediaItems.length > 1 ? (
                <View style={styles.photoStackCountChip}>
                  <Text style={styles.photoStackCountText}>
                    {stackMediaItems.length}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <Animated.View
            style={[styles.optionsPanel, optionsPanelAnimatedStyle]}
            pointerEvents={showOptionsPanel ? "auto" : "none"}
          >
              <ScrollView
                style={styles.optionsScroll}
                contentContainerStyle={styles.optionsContent}
                keyboardShouldPersistTaps="handled"
              >
                {activeOptionsTab === "settings" ? (
                  <>
                    <View style={styles.section}>
                      <Text style={styles.sectionLabel}>Audience</Text>
                      <View style={styles.segmentRow}>
                        {audienceOptions.map((option) => {
                          const isSelected = option.value === baseAudience;
                          return (
                            <TouchableOpacity
                              key={option.value}
                              style={[
                                styles.segmentChip,
                                isSelected && styles.segmentChipActive,
                              ]}
                              onPress={() => setBaseAudience(option.value)}
                            >
                              <Text
                                style={[
                                  styles.segmentChipText,
                                  isSelected && styles.segmentChipTextActive,
                                ]}
                              >
                                {option.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>

                    <View style={styles.section}>
                      <Text style={styles.sectionLabel}>Location</Text>
                      <View style={styles.locationToggleRow}>
                        <TouchableOpacity
                          style={[
                            styles.locationToggleChip,
                            !isPickOnMap && styles.locationToggleChipActive,
                          ]}
                          onPress={() => setLocationMode(LOCATION_MODES.CURRENT)}
                        >
                          <Text
                            style={[
                              styles.locationToggleText,
                              !isPickOnMap && styles.locationToggleTextActive,
                            ]}
                          >
                            Current
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.locationToggleChip,
                            isPickOnMap && styles.locationToggleChipActive,
                          ]}
                          onPress={() => setLocationMode(LOCATION_MODES.PICK_ON_MAP)}
                        >
                          <Text
                            style={[
                              styles.locationToggleText,
                              isPickOnMap && styles.locationToggleTextActive,
                            ]}
                          >
                            Choose
                          </Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.locationSwitchHint}>
                        {isPickOnMap
                          ? "Tap map after post to place it."
                          : "Post uses your live location."}
                      </Text>
                    </View>

                    <View style={styles.section}>
                      <Text style={styles.sectionLabel}>Geometry</Text>
                      {renderDropdown(
                        DROPDOWN_IDS.GEOMETRY,
                        "Geometry",
                        geometryLabel,
                        geometryType,
                        [
                          { label: "Point", value: GEOMETRY_TYPES.POINT },
                          { label: "Line", value: GEOMETRY_TYPES.LINE },
                          { label: "Plane", value: GEOMETRY_TYPES.PLANE },
                        ],
                        setGeometryType,
                      )}
                    </View>

                    <View style={styles.section}>
                      <Text style={styles.sectionLabel}>Selected Media</Text>
                      {normalizedMediaItems.length === 0 ? (
                        <Text style={styles.inlineHint}>
                          No media selected. You can still post with a title only.
                        </Text>
                      ) : (
                        <View style={styles.mediaItemList}>
                          {normalizedMediaItems.map((item, index) => (
                            <View
                              key={`${item.id || "media"}-${index}`}
                              style={styles.mediaItemRow}
                            >
                              {item.mediaType === "video" ? (
                                <TouchableOpacity
                                  style={styles.videoThumbPlaceholder}
                                  onPress={() => {
                                    setIsPhotoPreviewVisible(false);
                                    setVideoPreviewItem(item);
                                  }}
                                >
                                  <Text style={styles.videoThumbPlaceholderText}>
                                    Tap to play
                                  </Text>
                                </TouchableOpacity>
                              ) : (
                                <Image
                                  source={{ uri: item.mediaUrl }}
                                  style={styles.mediaThumb}
                                  resizeMode="cover"
                                />
                              )}
                              <View style={styles.mediaItemMeta}>
                                <Text style={styles.mediaItemTitle}>
                                  {item.mediaType === "video" ? "Video" : "Photo"}{" "}
                                  {index + 1}
                                </Text>
                                <Text style={styles.mediaItemSubtitle}>
                                  {item.mediaSource === MEDIA_SOURCE.LIBRARY
                                    ? "From library"
                                    : "From camera"}
                                </Text>
                              </View>
                              <TouchableOpacity
                                style={styles.mediaItemRemove}
                                onPress={() =>
                                  setMediaItems((prev) =>
                                    (Array.isArray(prev) ? prev : []).filter(
                                      (entry) =>
                                        String(entry?.id || "") !==
                                        String(item.id || ""),
                                    ),
                                  )
                                }
                              >
                                <Text style={styles.mediaItemRemoveText}>Remove</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>

                    {primaryMediaSource === MEDIA_SOURCE.LIBRARY ? (
                      <Text style={styles.inlineHint}>
                        Library media can use current location, but it is not
                        location-verified.
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Other Layers (Optional)</Text>
                    {communityAudienceLayers.length === 0 ? (
                      <Text style={styles.inlineHint}>
                        You have no joined community layers yet.
                      </Text>
                    ) : (
                      <>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.layerPillRow}
                        >
                          <TouchableOpacity
                            style={[
                              styles.layerPill,
                              !selectedCommunityLayerId && styles.layerPillSelected,
                            ]}
                            onPress={() => setSelectedCommunityLayerId(null)}
                          >
                            <Text
                              style={[
                                styles.layerPillText,
                                !selectedCommunityLayerId &&
                                  styles.layerPillTextSelected,
                              ]}
                            >
                              No extra layer
                            </Text>
                          </TouchableOpacity>
                          {communityAudienceLayers.map((layer) => {
                            const isSelected =
                              selectedCommunityLayerId === layer.id;
                            return (
                              <TouchableOpacity
                                key={layer.id}
                                style={[
                                  styles.layerPill,
                                  isSelected && styles.layerPillSelected,
                                ]}
                                onPress={() => setSelectedCommunityLayerId(layer.id)}
                              >
                                <Text
                                  style={[
                                    styles.layerPillText,
                                    isSelected && styles.layerPillTextSelected,
                                  ]}
                                >
                                  {layer.name}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                        {selectedCommunityLayer ? (
                          <Text style={styles.inlineHint}>
                            {`${OWNER_LABELS[selectedCommunityLayer.owner_type] || "Community"} | ${
                              selectedCommunityLayer.ownerCommunityName || "Community"
                            }`}
                          </Text>
                        ) : null}
                      </>
                    )}
                  </View>
                )}
              </ScrollView>
          </Animated.View>

          {videoPreviewItem ? (
            <View style={styles.photoPreviewOverlay}>
              <View style={styles.photoPreviewTopBar}>
                <Text style={styles.photoPreviewCount}>Video preview</Text>
                <TouchableOpacity
                  style={styles.photoPreviewCloseBtn}
                  onPress={() => setVideoPreviewItem(null)}
                >
                  <Text style={styles.photoPreviewCloseText}>Close</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.videoPreviewBody}>
                <VideoView
                  player={videoPreviewPlayer}
                  style={styles.videoPreviewPlayer}
                  nativeControls
                  contentFit="contain"
                />
              </View>
            </View>
          ) : null}

          {isPhotoPreviewVisible ? (
            <View style={styles.photoPreviewOverlay}>
              <View style={styles.photoPreviewTopBar}>
                <Text style={styles.photoPreviewCount}>
                  {photoPreviewIndex + 1} / {previewableMediaItems.length}
                </Text>
                <TouchableOpacity
                  style={styles.photoPreviewCloseBtn}
                  onPress={() => setIsPhotoPreviewVisible(false)}
                >
                  <Text style={styles.photoPreviewCloseText}>Close</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                ref={photoPreviewScrollRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                directionalLockEnabled
                onMomentumScrollEnd={(event) => {
                  const offsetX = Number(event?.nativeEvent?.contentOffset?.x || 0);
                  const nextIndex = Math.round(offsetX / Math.max(1, screenWidth));
                  if (Number.isFinite(nextIndex)) {
                    setPhotoPreviewIndex(
                      Math.max(
                        0,
                        Math.min(previewableMediaItems.length - 1, nextIndex),
                      ),
                    );
                  }
                }}
              >
                {previewableMediaItems.map((item, index) => (
                  <View
                    key={`preview-${item.id || "media"}-${index}`}
                    style={[styles.photoPreviewPage, { width: screenWidth }]}
                  >
                    <Image
                      source={{ uri: item.mediaUrl }}
                      style={styles.photoPreviewImage}
                      resizeMode="contain"
                    />
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.rightCluster}>
            <Animated.View
              style={[styles.menuColumn, optionsMenuAnimatedStyle]}
              pointerEvents={showOptionsPanel ? "auto" : "none"}
            >
                <TouchableOpacity
                  style={[
                    styles.menuItem,
                    activeOptionsTab === "settings" && styles.menuItemActive,
                  ]}
                  onPress={() => {
                    setOpenDropdown(null);
                    setActiveOptionsTab("settings");
                  }}
                >
                  <Text style={styles.menuItemText}>⚙</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.menuItem,
                    activeOptionsTab === "layers" && styles.menuItemActive,
                  ]}
                  onPress={() => {
                    setOpenDropdown(null);
                    setActiveOptionsTab("layers");
                  }}
                >
                  <Image
                    source={brandAssets.menu.layers}
                    style={styles.menuIconImage}
                    resizeMode="contain"
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={pickMediaFromLibrary}
                >
                  <Image
                    source={brandAssets.menu.add}
                    style={styles.menuIconImage}
                    resizeMode="contain"
                  />
                </TouchableOpacity>
            </Animated.View>

            <TouchableOpacity
              style={[
                styles.ventButton,
                showOptionsPanel && styles.ventButtonActive,
              ]}
              onPress={toggleOptionsPanel}
            >
              <Image
                source={brandAssets.logo}
                style={styles.ventButtonLogo}
                resizeMode="contain"
              />
              <View
                style={[
                  styles.ventIndicator,
                  showOptionsPanel && styles.ventIndicatorActive,
                ]}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shutterButton}
              onPress={handleShutterPress}
              onPressIn={handleShutterPressIn}
              onPressOut={handleShutterPressOut}
              disabled={isCapturing || isVideoFinalizing}
            >
              <View style={styles.shutterCore}>
                <Text style={styles.shutterText}>
                  {isVideoRecording
                    ? "■"
                    : isCapturing
                      ? "..."
                      : "◉"}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
          </View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
};

const createStyles = (palette, isDark, insets = { top: 0, bottom: 0 }) =>
  StyleSheet.create({
    gestureRoot: {
      flex: 1,
    },
    overlay: {
      flex: 1,
      backgroundColor: "#060b14",
    },
    stage: {
      flex: 1,
      backgroundColor: "#0b1220",
    },
    cameraGestureSurface: {
      ...StyleSheet.absoluteFillObject,
    },
    cameraFill: {
      ...StyleSheet.absoluteFillObject,
    },
    cameraFallback: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
      backgroundColor: "#111827",
    },
    cameraFallbackTitle: {
      color: "#f8fafc",
      fontSize: 20,
      fontWeight: "800",
      marginBottom: 8,
    },
    cameraFallbackSubtext: {
      color: "rgba(248,250,252,0.82)",
      fontSize: 13,
      fontWeight: "600",
      textAlign: "center",
      marginBottom: 16,
    },
    enableBtn: {
      backgroundColor: palette.primary,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    enableBtnText: {
      color: palette.onPrimary,
      fontSize: 13,
      fontWeight: "800",
    },
    shade: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(2, 6, 23, 0.3)",
    },
    topBar: {
      position: "absolute",
      top: (insets?.top || 0) + (Platform.OS === "ios" ? 8 : 18),
      left: 14,
      right: 14,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
    },
    topChip: {
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.38)",
      backgroundColor: "rgba(15,23,42,0.56)",
      borderRadius: 999,
      paddingHorizontal: 13,
      paddingVertical: 8,
    },
    topChipText: {
      color: "#f8fafc",
      fontSize: 12,
      fontWeight: "800",
    },
    topPrimaryChip: {
      backgroundColor: palette.primary,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      maxWidth: "44%",
    },
    topPrimaryChipText: {
      color: palette.onPrimary,
      fontSize: 11,
      fontWeight: "800",
      textAlign: "center",
    },
    audienceChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.38)",
      backgroundColor: "rgba(15,23,42,0.56)",
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      minWidth: 104,
      justifyContent: "center",
      flexShrink: 1,
    },
    audienceChipIcon: {
      fontSize: 12,
    },
    audienceChipText: {
      color: "#f8fafc",
      fontSize: 11,
      fontWeight: "800",
    },
    recordingBadge: {
      position: "absolute",
      top: (insets?.top || 0) + (Platform.OS === "ios" ? 58 : 68),
      alignSelf: "center",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: "rgba(248,113,113,0.8)",
      backgroundColor: "rgba(127,29,29,0.9)",
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
      zIndex: 13,
    },
    recordingDot: {
      width: 7,
      height: 7,
      borderRadius: 999,
      backgroundColor: "#ef4444",
    },
    recordingBadgeText: {
      color: "#fee2e2",
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.2,
      textTransform: "uppercase",
    },
    cameraQuickControls: {
      position: "absolute",
      right: 84,
      bottom: (insets?.bottom || 0) + (Platform.OS === "ios" ? 12 : 30),
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      zIndex: 11,
    },
    zoomControls: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginRight: 2,
    },
    zoomBadge: {
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.36)",
      borderRadius: 999,
      backgroundColor: "rgba(15,23,42,0.62)",
      paddingHorizontal: 12,
      paddingVertical: 7,
      alignItems: "center",
      justifyContent: "center",
      minWidth: 68,
    },
    zoomBadgeLabel: {
      color: "rgba(248,250,252,0.74)",
      fontSize: 9,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.3,
    },
    zoomBadgeValue: {
      color: "#f8fafc",
      fontSize: 11,
      fontWeight: "800",
    },
    cameraQuickControlBtn: {
      width: 38,
      height: 38,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.36)",
      backgroundColor: "rgba(15,23,42,0.62)",
      alignItems: "center",
      justifyContent: "center",
    },
    cameraQuickControlBtnActive: {
      borderColor: palette.primary,
      backgroundColor: isDark ? "rgba(102,126,234,0.26)" : "rgba(102,126,234,0.18)",
    },
    cameraQuickControlText: {
      color: "#f8fafc",
      fontSize: 14,
      fontWeight: "800",
    },
    mediaCountBadge: {
      position: "absolute",
      left: 14,
      top: (insets?.top || 0) + (Platform.OS === "ios" ? 56 : 66),
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.28)",
      backgroundColor: "rgba(15,23,42,0.58)",
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      maxWidth: "70%",
    },
    mediaCountBadgeText: {
      color: "#f8fafc",
      fontSize: 11,
      fontWeight: "700",
    },
    captureHintBadge: {
      position: "absolute",
      left: 14,
      top: (insets?.top || 0) + (Platform.OS === "ios" ? 98 : 108),
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.22)",
      backgroundColor: "rgba(15,23,42,0.48)",
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 7,
      maxWidth: 220,
    },
    captureHintText: {
      color: "rgba(248,250,252,0.84)",
      fontSize: 10,
      fontWeight: "700",
      lineHeight: 14,
    },
    photoStackDock: {
      position: "absolute",
      left: 14,
      bottom: (insets?.bottom || 0) + (Platform.OS === "ios" ? 120 : 134),
      width: 92,
      height: 88,
      justifyContent: "flex-end",
      zIndex: 9,
    },
    photoStackStage: {
      width: 86,
      height: 68,
      justifyContent: "flex-end",
    },
    photoStackCard: {
      position: "absolute",
      width: 54,
      height: 64,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: "rgba(255,255,255,0.72)",
      backgroundColor: "#0f172a",
      shadowColor: "#000",
      shadowOpacity: 0.24,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 6,
    },
    videoStackCard: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(2,6,23,0.96)",
      borderColor: "rgba(129,140,248,0.9)",
    },
    videoStackEmoji: {
      fontSize: 16,
      marginBottom: 3,
    },
    videoStackLabel: {
      color: "#e2e8f0",
      fontSize: 9,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    photoStackCountChip: {
      position: "absolute",
      right: 2,
      bottom: 2,
      minWidth: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.5)",
      backgroundColor: "rgba(15,23,42,0.9)",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 6,
    },
    photoStackCountText: {
      color: "#f8fafc",
      fontSize: 11,
      fontWeight: "800",
    },
    photoPreviewOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(2,6,23,0.94)",
      zIndex: 30,
      justifyContent: "center",
    },
    photoPreviewTopBar: {
      position: "absolute",
      top: (insets?.top || 0) + (Platform.OS === "ios" ? 8 : 18),
      left: 14,
      right: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      zIndex: 31,
    },
    photoPreviewCount: {
      color: "#f8fafc",
      fontSize: 12,
      fontWeight: "800",
    },
    photoPreviewCloseBtn: {
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.34)",
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
      backgroundColor: "rgba(15,23,42,0.55)",
    },
    photoPreviewCloseText: {
      color: "#f8fafc",
      fontSize: 12,
      fontWeight: "800",
    },
    photoPreviewPage: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 10,
      paddingTop: (insets?.top || 0) + (Platform.OS === "ios" ? 12 : 22),
      paddingBottom: (insets?.bottom || 0) + (Platform.OS === "ios" ? 0 : 18),
    },
    photoPreviewImage: {
      width: "100%",
      height: "100%",
      maxHeight: "86%",
    },
    videoPreviewBody: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 10,
      paddingTop: (insets?.top || 0) + (Platform.OS === "ios" ? 12 : 22),
      paddingBottom: (insets?.bottom || 0) + (Platform.OS === "ios" ? 0 : 18),
    },
    videoPreviewPlayer: {
      width: "100%",
      height: "86%",
      backgroundColor: "#020617",
      borderRadius: 14,
    },
    composerText: {
      position: "absolute",
      left: 14,
      right: 84,
      bottom: (insets?.bottom || 0) + 24,
      gap: 8,
    },
    headlineInput: {
      color: "#ffffff",
      fontSize: 24,
      lineHeight: 30,
      fontWeight: "800",
      textShadowColor: "rgba(0,0,0,0.45)",
      textShadowOffset: { width: 0, height: 2 },
      textShadowRadius: 5,
      minHeight: 34,
      paddingTop: 2,
      paddingBottom: 2,
    },
    descriptionInput: {
      color: "rgba(255,255,255,0.94)",
      fontSize: 15,
      lineHeight: 21,
      fontWeight: "600",
      textShadowColor: "rgba(0,0,0,0.35)",
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
      minHeight: 72,
      maxHeight: 132,
      paddingTop: 2,
      paddingBottom: 2,
    },
    rightCluster: {
      position: "absolute",
      right: 16,
      bottom: (insets?.bottom || 0) + (Platform.OS === "ios" ? 0 : 18),
      alignItems: "center",
      gap: 8,
    },
    menuColumn: {
      position: "absolute",
      right: 0,
      bottom: 132,
      alignItems: "center",
      gap: 8,
      zIndex: 20,
    },
    menuItem: {
      width: 52,
      height: 52,
      borderRadius: 26,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOpacity: 0.14,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    menuItemActive: {
      borderColor: palette.primary,
      backgroundColor: isDark ? "rgba(102,126,234,0.22)" : "rgba(102,126,234,0.14)",
    },
    menuItemText: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "800",
    },
    menuIconImage: {
      width: 62,
      height: 62,
    },
    shutterButton: {
      width: 62,
      height: 62,
      borderRadius: 31,
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.8)",
      backgroundColor: "rgba(255,255,255,0.28)",
      alignItems: "center",
      justifyContent: "center",
    },
    shutterCore: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: "#ffffff",
      alignItems: "center",
      justifyContent: "center",
    },
    shutterText: {
      color: "#0f172a",
      fontSize: 16,
      fontWeight: "800",
    },
    ventButton: {
      width: 56,
      height: 56,
      borderRadius: 28,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    ventButtonActive: {
      borderColor: palette.primary,
      shadowColor: palette.primary,
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    ventButtonLogo: {
      width: 34,
      height: 34,
    },
    ventIndicator: {
      position: "absolute",
      top: 8,
      right: 8,
      width: 7,
      height: 7,
      borderRadius: 999,
      backgroundColor: palette.subtext,
      opacity: 0.65,
    },
    ventIndicatorActive: {
      backgroundColor: palette.primary,
      opacity: 1,
    },
    optionsPanel: {
      position: "absolute",
      left: 14,
      right: 126,
      bottom: (insets?.bottom || 0) + (Platform.OS === "ios" ? 90 : 106),
      maxHeight: "56%",
      borderRadius: SIZES.radiusLg,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: isDark ? "rgba(22,27,37,0.98)" : "rgba(255,255,255,0.98)",
      overflow: "hidden",
      zIndex: 12,
    },
    optionsScroll: {
      flex: 1,
    },
    optionsContent: {
      paddingTop: 12,
      paddingHorizontal: 12,
      paddingBottom: 12,
      gap: 12,
    },
    section: {
      gap: 8,
    },
    segmentRow: {
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
    },
    segmentChip: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 999,
      backgroundColor: isDark ? "#1f2633" : "#f8fbff",
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    segmentChipActive: {
      borderColor: palette.primary,
      backgroundColor: isDark ? "rgba(102,126,234,0.22)" : "rgba(102,126,234,0.14)",
    },
    segmentChipText: {
      color: palette.text,
      fontSize: 11,
      fontWeight: "800",
    },
    segmentChipTextActive: {
      color: palette.primary,
    },
    locationToggleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    locationToggleChip: {
      flex: 1,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 999,
      backgroundColor: isDark ? "#1f2633" : "#f8fbff",
      paddingHorizontal: 12,
      paddingVertical: 9,
      alignItems: "center",
    },
    locationToggleChipActive: {
      borderColor: palette.primary,
      backgroundColor: isDark ? "rgba(102,126,234,0.22)" : "rgba(102,126,234,0.14)",
    },
    locationToggleText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "800",
    },
    locationToggleTextActive: {
      color: palette.primary,
    },
    locationSwitchHint: {
      color: palette.subtext,
      fontSize: 11,
      fontWeight: "600",
      lineHeight: 16,
    },
    sectionLabel: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.2,
    },
    inlineHint: {
      color: palette.subtext,
      fontSize: 12,
      fontWeight: "600",
      lineHeight: 17,
    },
    layerList: {
      gap: 8,
    },
    layerPillRow: {
      gap: 8,
      paddingRight: 8,
    },
    layerPill: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 999,
      backgroundColor: isDark ? "#1f2633" : "#f8fbff",
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    layerPillSelected: {
      borderColor: palette.primary,
      backgroundColor: isDark ? "rgba(102,126,234,0.22)" : "rgba(102,126,234,0.14)",
    },
    layerPillText: {
      color: palette.text,
      fontSize: 11,
      fontWeight: "800",
    },
    layerPillTextSelected: {
      color: palette.primary,
    },
    layerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      paddingHorizontal: 10,
      paddingVertical: 9,
      backgroundColor: isDark ? "#1f2633" : "#f8fbff",
      gap: 8,
    },
    layerRowSelected: {
      borderColor: palette.primary,
      backgroundColor: "rgba(102, 126, 234, 0.14)",
    },
    layerMain: {
      flex: 1,
      gap: 2,
      paddingRight: 8,
    },
    layerName: {
      color: palette.text,
      fontSize: 13,
      fontWeight: "800",
    },
    layerMeta: {
      color: palette.subtext,
      fontSize: 11,
      fontWeight: "600",
    },
    layerAction: {
      color: palette.primary,
      fontSize: 11,
      fontWeight: "800",
    },
    dropdownWrap: {
      gap: 5,
    },
    fieldLabel: {
      color: palette.text,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.2,
    },
    dropdownTrigger: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      backgroundColor: isDark ? "#1f2633" : "#f8fbff",
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    dropdownTriggerText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "700",
    },
    dropdownChevron: {
      color: palette.subtext,
      fontSize: 10,
      fontWeight: "800",
    },
    dropdownMenu: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      overflow: "hidden",
    },
    dropdownOption: {
      paddingHorizontal: 10,
      paddingVertical: 9,
      backgroundColor: isDark ? "#1f2633" : "#f8fbff",
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    dropdownOptionSelected: {
      backgroundColor: "rgba(102, 126, 234, 0.14)",
    },
    dropdownOptionText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "700",
    },
    dropdownOptionTextSelected: {
      color: palette.primary,
    },
    quickActionRow: {
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
    },
    quickAction: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 999,
      backgroundColor: isDark ? "#1f2633" : "#f8fbff",
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    quickActionText: {
      color: palette.text,
      fontSize: 11,
      fontWeight: "800",
    },
    mediaItemList: {
      gap: 8,
    },
    mediaItemRow: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      backgroundColor: isDark ? "#1f2633" : "#f8fbff",
      padding: 8,
      gap: 8,
    },
    mediaThumb: {
      width: 44,
      height: 44,
      borderRadius: 8,
      backgroundColor: "#111827",
    },
    videoThumbPlaceholder: {
      width: 44,
      height: 44,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: isDark ? "#141b2a" : "#e2e8f0",
      alignItems: "center",
      justifyContent: "center",
    },
    videoThumbPlaceholderText: {
      color: palette.text,
      fontSize: 9,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.25,
    },
    mediaItemMeta: {
      flex: 1,
      gap: 2,
    },
    mediaItemTitle: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "700",
    },
    mediaItemSubtitle: {
      color: palette.subtext,
      fontSize: 11,
      fontWeight: "600",
    },
    mediaItemRemove: {
      borderWidth: 1,
      borderColor: "rgba(239,68,68,0.4)",
      borderRadius: 999,
      backgroundColor: "rgba(239,68,68,0.12)",
      paddingHorizontal: 9,
      paddingVertical: 6,
    },
    mediaItemRemoveText: {
      color: "#ef4444",
      fontSize: 10,
      fontWeight: "800",
    },
  });

export default PostCreationForm;
