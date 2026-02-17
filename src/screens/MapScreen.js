import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Alert,
  Modal,
  ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import MapView, {
  Polyline,
  Polygon,
  PROVIDER_GOOGLE,
  Circle,
  Marker,
} from "react-native-maps";
import * as Location from "expo-location";
import {
  addPinCommentViaEdgeFunction,
  createPinsViaEdgeFunction,
  deletePinCommentViaEdgeFunction,
  deletePinViaEdgeFunction,
  fetchMyCommunityMembershipsViaEdgeFunction,
  fetchMyLayerPrefsViaEdgeFunction,
  fetchPinsViaEdgeFunction,
  getPinVoteSummaryViaEdgeFunction,
  listPinCommentsViaEdgeFunction,
  setLayerOrderViaEdgeFunction,
  setLayerPreferenceViaEdgeFunction,
  supabase,
  getCurrentUser,
  getActiveSession,
  votePinViaEdgeFunction,
  supabaseWithAccessToken,
} from "../services/supabase";
import {
  COLORS,
  SIZES,
  DEFAULT_REGION,
  GEOMETRY_TYPES,
} from "../constants/theme";
import PinDetailModal from "../components/PinDetailModal";
import CustomMarker from "../components/CustomMarker";
import ActionButtonCluster from "../components/ActionButtonCluster";
import { useAppTheme } from "../context/ThemeContext";
import { MAP_DARK_STYLE } from "../constants/mapDarkStyle";
import {
  getPinLayerKeyFromLayer,
  resolveNextSelectedLayerId,
  sortLayers,
} from "../utils/layers";
import { parseLayerKindMetadata } from "../utils/layerKind";

const formatUsernameForLayer = (user) => {
  const fromMeta =
    user?.user_metadata?.username || user?.user_metadata?.display_name || null;
  if (fromMeta) {
    return String(fromMeta).trim().replace(/\s+/g, "-").toLowerCase();
  }
  return String(user?.id || "user").slice(0, 8);
};

const makeUserPostingLayerName = (user) =>
  `user-${formatUsernameForLayer(user)}-posts`;
const CLOUD_MIN_POST_COUNT = 2;
const CLOUD_RADIUS_PADDING_METERS = 40;
const CLOUD_MIN_RADIUS_METERS = 120;
const CLOUD_MAX_RADIUS_METERS = 1000;
const CLUSTER_DISTANCE_PX = 52;
const CLUSTER_MERGE_DISTANCE_PX = 58;
const CLUSTER_VIEWPORT_PADDING_PX = 160;
const DEFAULT_MAP_SIZE = { width: 390, height: 780 };
const PIN_VOTE_PREFETCH_LIMIT = 6;
const PIN_VOTE_PREFETCH_DELAY_MS = 180;
const ERROR_LOG_COOLDOWN_MS = 120000;
const ERROR_ALERT_COOLDOWN_MS = 15000;
const NETWORK_BACKOFF_MS = 20000;
const MAP_POSTS_CACHE_KEY = "map_posts_cache_v1";
const PIN_COMMENT_MAX_LENGTH = 500;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

const haversineMeters = (a, b) => {
  const earthRadiusMeters = 6371000;
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const x =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2) *
      Math.cos(lat1) *
      Math.cos(lat2);
  const y = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return earthRadiusMeters * y;
};

const hasValidCoordinate = (post) =>
  typeof post?.lat === "number" &&
  Number.isFinite(post.lat) &&
  typeof post?.lng === "number" &&
  Number.isFinite(post.lng);

const normalizeLongitude = (longitude) => {
  if (!Number.isFinite(longitude)) return longitude;
  let next = longitude;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  return next;
};

const isLongitudeWithinBounds = (longitude, minLng, maxLng) => {
  if (minLng <= maxLng) {
    return longitude >= minLng && longitude <= maxLng;
  }
  return longitude >= minLng || longitude <= maxLng;
};

const isCoordinateWithinRegionBounds = (
  coordinate,
  mapRegion,
  paddingRatio = 0,
) => {
  if (
    !Number.isFinite(coordinate?.latitude) ||
    !Number.isFinite(coordinate?.longitude)
  ) {
    return false;
  }

  const centerLat = Number(mapRegion?.latitude);
  const centerLng = Number(mapRegion?.longitude);
  const latitudeDelta = Number(mapRegion?.latitudeDelta);
  const longitudeDelta = Number(mapRegion?.longitudeDelta);

  if (
    !Number.isFinite(centerLat) ||
    !Number.isFinite(centerLng) ||
    !Number.isFinite(latitudeDelta) ||
    !Number.isFinite(longitudeDelta) ||
    latitudeDelta <= 0 ||
    longitudeDelta <= 0
  ) {
    return true;
  }

  const latPadding = latitudeDelta * paddingRatio;
  const lngPadding = longitudeDelta * paddingRatio;

  const minLat = centerLat - latitudeDelta / 2 - latPadding;
  const maxLat = centerLat + latitudeDelta / 2 + latPadding;
  if (coordinate.latitude < minLat || coordinate.latitude > maxLat) {
    return false;
  }

  if (longitudeDelta + lngPadding * 2 >= 360) {
    return true;
  }

  const longitude = normalizeLongitude(coordinate.longitude);
  const minLng = normalizeLongitude(centerLng - longitudeDelta / 2 - lngPadding);
  const maxLng = normalizeLongitude(centerLng + longitudeDelta / 2 + lngPadding);
  return isLongitudeWithinBounds(longitude, minLng, maxLng);
};

const toScreenPoint = (coordinate, mapRegion, mapSize) => {
  const width = Number(mapSize?.width || 0);
  const height = Number(mapSize?.height || 0);
  const latitudeDelta = Number(mapRegion?.latitudeDelta || 0);
  const longitudeDelta = Number(mapRegion?.longitudeDelta || 0);
  const centerLat = Number(mapRegion?.latitude || 0);
  const centerLng = Number(mapRegion?.longitude || 0);

  if (
    width <= 0 ||
    height <= 0 ||
    latitudeDelta <= 0 ||
    longitudeDelta <= 0 ||
    !Number.isFinite(centerLat) ||
    !Number.isFinite(centerLng)
  ) {
    return null;
  }

  const minLat = centerLat - latitudeDelta / 2;
  const maxLat = centerLat + latitudeDelta / 2;
  const minLng = centerLng - longitudeDelta / 2;

  return {
    x: ((coordinate.longitude - minLng) / longitudeDelta) * width,
    y: ((maxLat - coordinate.latitude) / latitudeDelta) * height,
  };
};

const isScreenPointWithinClusterViewport = (
  screenPoint,
  mapSize,
  paddingPx = CLUSTER_VIEWPORT_PADDING_PX,
) => {
  if (!screenPoint) return false;
  const width = Number(mapSize?.width || 0);
  const height = Number(mapSize?.height || 0);
  if (width <= 0 || height <= 0) return false;

  return (
    screenPoint.x >= -paddingPx &&
    screenPoint.x <= width + paddingPx &&
    screenPoint.y >= -paddingPx &&
    screenPoint.y <= height + paddingPx
  );
};

const isCloudOnlyPost = (pin) => pin?.geometry?.visibility_mode === "cloud_only";
const isRlsPolicyError = (error) =>
  error?.code === "42501" ||
  String(error?.message || "")
    .toLowerCase()
    .includes("row-level security policy");
const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );

const formatErrorMessage = (error) => {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;

  const message = String(error?.message || "").trim();
  const code = String(error?.code || "").trim();
  const details = String(error?.details || "").trim();
  const hint = String(error?.hint || "").trim();

  const parts = [message, code && `code ${code}`, details, hint].filter(Boolean);
  if (parts.length > 0) return parts.join(" | ");

  try {
    return JSON.stringify(error);
  } catch (_) {
    return "Unknown error";
  }
};

const isTransientNetworkError = (error) => {
  const msg = formatErrorMessage(error).toLowerCase();
  const raw = String(error || "").toLowerCase();
  const stack = String(error?.stack || "").toLowerCase();
  const name = String(error?.name || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("network request failed") ||
    msg.includes("eai_again") ||
    msg.includes("timeout") ||
    raw.includes("network request failed") ||
    stack.includes("fetch.umd.js") ||
    (name === "typeerror" && !code)
  );
};

const getRandomCoordinateWithinRadius = (latitude, longitude, radiusMeters) => {
  const randomDistance = Math.sqrt(Math.random()) * radiusMeters;
  const randomAngle = Math.random() * Math.PI * 2;
  const metersPerLatDegree = 111320;
  const latAdjustment = (randomDistance * Math.cos(randomAngle)) / metersPerLatDegree;
  const lngDivider = Math.max(0.000001, Math.cos(toRadians(latitude)));
  const lngAdjustment =
    (randomDistance * Math.sin(randomAngle)) /
    (metersPerLatDegree * lngDivider);

  return {
    latitude: latitude + latAdjustment,
    longitude: longitude + lngAdjustment,
  };
};

const buildCloudFromPosts = (groupPosts) => {
  if (!Array.isArray(groupPosts) || groupPosts.length === 0) {
    return null;
  }

  const sum = groupPosts.reduce(
    (acc, post) => ({
      lat: acc.lat + post.lat,
      lng: acc.lng + post.lng,
    }),
    { lat: 0, lng: 0 },
  );
  const center = {
    latitude: sum.lat / groupPosts.length,
    longitude: sum.lng / groupPosts.length,
  };

  const farthest = groupPosts.reduce((maxDistance, post) => {
    const distance = haversineMeters(center, {
      latitude: post.lat,
      longitude: post.lng,
    });
    return Math.max(maxDistance, distance);
  }, 0);

  const computedRadius = Math.min(
    CLOUD_MAX_RADIUS_METERS,
    Math.max(CLOUD_MIN_RADIUS_METERS, farthest + CLOUD_RADIUS_PADDING_METERS),
  );

  const sortedPostIds = groupPosts
    .map((post) => String(post?.id || ""))
    .filter(Boolean)
    .sort();

  return {
    id: `cloud-${sortedPostIds.join("-")}`,
    center,
    radiusMeters: computedRadius,
    count: groupPosts.length,
    privacyCount: groupPosts.filter(isCloudOnlyPost).length,
    posts: groupPosts,
  };
};

const buildCloudsFromPosts = (posts, mapRegion, mapSize) => {
  const candidates = (posts || []).filter(hasValidCoordinate);
  if (candidates.length < CLOUD_MIN_POST_COUNT) return [];

  const clusterDistancePx = CLUSTER_DISTANCE_PX;
  const clusterDistancePxSq = clusterDistancePx * clusterDistancePx;
  const cellSize = clusterDistancePx;
  const toCell = (value) => Math.floor(value / cellSize);
  const cellKey = (x, y) => `${x}:${y}`;

  const points = candidates
    .map((post) => {
      const coord = { latitude: post.lat, longitude: post.lng };
      const screenPoint = toScreenPoint(coord, mapRegion, mapSize);
      if (
        !screenPoint ||
        !isScreenPointWithinClusterViewport(screenPoint, mapSize)
      ) {
        return null;
      }
      return {
        post,
        screenX: screenPoint.x,
        screenY: screenPoint.y,
        cellX: toCell(screenPoint.x),
        cellY: toCell(screenPoint.y),
      };
    })
    .filter(Boolean);

  if (points.length < CLOUD_MIN_POST_COUNT) return [];

  const grid = new Map();
  points.forEach((point, index) => {
    const key = cellKey(point.cellX, point.cellY);
    const bucket = grid.get(key) || [];
    bucket.push(index);
    grid.set(key, bucket);
  });

  const visited = new Array(points.length).fill(false);
  const clouds = [];

  for (let i = 0; i < points.length; i += 1) {
    if (visited[i]) continue;
    const queue = [i];
    const groupIndexes = [];
    visited[i] = true;

    while (queue.length > 0) {
      const sourceIndex = queue.shift();
      const source = points[sourceIndex];
      groupIndexes.push(sourceIndex);

      for (let x = source.cellX - 1; x <= source.cellX + 1; x += 1) {
        for (let y = source.cellY - 1; y <= source.cellY + 1; y += 1) {
          const neighborIndexes = grid.get(cellKey(x, y)) || [];
          for (let k = 0; k < neighborIndexes.length; k += 1) {
            const targetIndex = neighborIndexes[k];
            if (visited[targetIndex]) continue;
            const target = points[targetIndex];
            const deltaX = source.screenX - target.screenX;
            const deltaY = source.screenY - target.screenY;
            const distanceSq = deltaX * deltaX + deltaY * deltaY;
            if (distanceSq <= clusterDistancePxSq) {
              visited[targetIndex] = true;
              queue.push(targetIndex);
            }
          }
        }
      }
    }

    if (groupIndexes.length < CLOUD_MIN_POST_COUNT) continue;

    const groupPosts = groupIndexes.map((index) => points[index].post);
    const cloud = buildCloudFromPosts(groupPosts);
    if (cloud) {
      clouds.push(cloud);
    }
  }

  return clouds;
};

const mergeNearbyClouds = (clouds, mapRegion, mapSize) => {
  if (!Array.isArray(clouds) || clouds.length < 2) return clouds || [];

  const mergeDistanceSq = CLUSTER_MERGE_DISTANCE_PX * CLUSTER_MERGE_DISTANCE_PX;
  const visited = new Array(clouds.length).fill(false);
  const merged = [];

  const cloudNodes = clouds.map((cloud) => ({
    cloud,
    screenPoint: toScreenPoint(cloud.center, mapRegion, mapSize),
  }));

  for (let i = 0; i < cloudNodes.length; i += 1) {
    if (visited[i]) continue;
    visited[i] = true;
    const queue = [i];
    const groupIndexes = [];

    while (queue.length > 0) {
      const sourceIndex = queue.shift();
      groupIndexes.push(sourceIndex);
      const source = cloudNodes[sourceIndex];
      if (!source?.screenPoint) continue;

      for (let j = 0; j < cloudNodes.length; j += 1) {
        if (visited[j]) continue;
        const target = cloudNodes[j];
        if (!target?.screenPoint) continue;

        const deltaX = source.screenPoint.x - target.screenPoint.x;
        const deltaY = source.screenPoint.y - target.screenPoint.y;
        const distanceSq = deltaX * deltaX + deltaY * deltaY;
        if (distanceSq <= mergeDistanceSq) {
          visited[j] = true;
          queue.push(j);
        }
      }
    }

    if (groupIndexes.length === 1) {
      merged.push(cloudNodes[groupIndexes[0]].cloud);
      continue;
    }

    const mergedPosts = [];
    groupIndexes.forEach((index) => {
      mergedPosts.push(...(cloudNodes[index].cloud?.posts || []));
    });
    const mergedCloud = buildCloudFromPosts(mergedPosts);
    if (mergedCloud) {
      merged.push(mergedCloud);
    }
  }

  return merged;
};

const computeMapVisuals = (posts, mapRegion, mapSize, focusedPinId = null) => {
  const normalizedPosts = (Array.isArray(posts) ? posts : []).filter(
    hasValidCoordinate,
  );

  const baseClusters = buildCloudsFromPosts(
    normalizedPosts,
    mapRegion,
    mapSize,
  );
  const clusters = mergeNearbyClouds(baseClusters, mapRegion, mapSize);

  const visibleClouds = [];
  const clusteredPinnedIds = new Set();
  const clusteredPostIds = new Set();

  clusters.forEach((cloud) => {
    const pinnedCount = cloud.count - cloud.privacyCount;
    const hasPrivacyPosts = cloud.privacyCount > 0;
    const shouldShowCloud = hasPrivacyPosts || pinnedCount >= CLOUD_MIN_POST_COUNT;
    if (!shouldShowCloud) return;

    const cloudScreenPoint = toScreenPoint(cloud.center, mapRegion, mapSize);
    const isCloudVisible = isScreenPointWithinClusterViewport(
      cloudScreenPoint,
      mapSize,
      CLUSTER_VIEWPORT_PADDING_PX,
    );
    if (!isCloudVisible) return;

    (cloud.posts || []).forEach((post) => {
      if (post?.id) clusteredPostIds.add(post.id);
    });
    if (pinnedCount >= CLOUD_MIN_POST_COUNT) {
      (cloud.posts || []).forEach((post) => {
        if (post?.id && !isCloudOnlyPost(post)) {
          clusteredPinnedIds.add(post.id);
        }
      });
    }
    const badgeCount = pinnedCount > 0 ? pinnedCount : cloud.count;
    visibleClouds.push({ ...cloud, badgeCount });
  });

  // Cloud-only posts must always surface as a cloud, even when isolated.
  normalizedPosts
    .filter((post) => isCloudOnlyPost(post) && !clusteredPostIds.has(post.id))
    .forEach((post) => {
      const cloudCenter = { latitude: post.lat, longitude: post.lng };
      const cloudScreenPoint = toScreenPoint(cloudCenter, mapRegion, mapSize);
      if (
        !isScreenPointWithinClusterViewport(
          cloudScreenPoint,
          mapSize,
          CLUSTER_VIEWPORT_PADDING_PX,
        )
      ) {
        return;
      }
      visibleClouds.push({
        id: `cloud-single-${post.id}`,
        center: cloudCenter,
        radiusMeters: CLOUD_MIN_RADIUS_METERS,
        count: 1,
        privacyCount: 1,
        posts: [post],
        badgeCount: 1,
      });
    });

  // Hide only pins represented by visible clusters; this keeps transitions
  // stable while preserving cluster readability.
  const focusedPinIdText = String(focusedPinId || "");
  const visiblePins = normalizedPosts.filter(
    (post) => {
      if (isCloudOnlyPost(post)) return false;
      const postIdText = String(post?.id || "");
      const isFocusedPin = focusedPinIdText && postIdText === focusedPinIdText;
      return isFocusedPin || !clusteredPinnedIds.has(post.id);
    },
  );

  return { visiblePins, visibleClouds };
};

const haveSameEntityIds = (left, right) => {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i += 1) {
    if (String(left[i]?.id || "") !== String(right[i]?.id || "")) {
      return false;
    }
  }
  return true;
};

const toTitle = (value) => {
  const str = String(value || "").trim();
  if (!str) return "Unknown";
  return str.charAt(0).toUpperCase() + str.slice(1);
};

const normalizePinComment = (comment) => {
  if (!comment || typeof comment !== "object") return null;
  const id = String(comment.id || "");
  const pinId = String(comment.pin_id || "");
  const parentCommentIdRaw = String(comment.parent_comment_id || "");
  if (!id || !pinId) return null;

  return {
    id,
    pin_id: pinId,
    parent_comment_id: isUuid(parentCommentIdRaw) ? parentCommentIdRaw : null,
    user_id: String(comment.user_id || comment.author_id || ""),
    content: String(comment.content || comment.text || ""),
    created_at:
      comment.created_at || comment.updated_at || new Date().toISOString(),
    updated_at:
      comment.updated_at || comment.created_at || new Date().toISOString(),
    author_name: String(comment.author_name || "Anonymous"),
    author_username: String(comment.author_username || ""),
    author_avatar_url: comment.author_avatar_url || null,
  };
};

const collectCommentThreadIds = (comments, rootCommentId) => {
  const byParentId = new Map();
  (Array.isArray(comments) ? comments : []).forEach((comment) => {
    const parentId = String(comment?.parent_comment_id || "");
    const commentId = String(comment?.id || "");
    if (!parentId || !commentId) return;
    const existing = byParentId.get(parentId) || [];
    existing.push(commentId);
    byParentId.set(parentId, existing);
  });

  const ids = new Set([String(rootCommentId || "")]);
  const queue = [String(rootCommentId || "")];
  while (queue.length > 0) {
    const currentId = queue.shift();
    const children = byParentId.get(currentId) || [];
    children.forEach((childId) => {
      if (ids.has(childId)) return;
      ids.add(childId);
      queue.push(childId);
    });
  }
  return ids;
};

const isUserPostingLayer = (layer) => {
  const ownerType = layer?.owner_type || "system";
  const { baseKind } = parseLayerKindMetadata(layer?.kind);
  return ownerType === "user" && (baseKind || layer?.kind) === "user_posts";
};

const isFallbackLayer = (layer) =>
  String(layer?.id || "").startsWith("fallback-");

const buildFallbackLayers = (userId) => {
  const asEnabled = Boolean(userId);
  return [
    {
      id: "fallback-public",
      name: "Public",
      display_name: "Public",
      kind: "public",
      raw_kind: "public",
      owner_type: "system",
      owner_id: null,
      is_public: true,
      enabled: true,
      isEnabled: true,
      layer_icon: null,
      ownerCommunityName: null,
      sourceCommunityIds: [],
      viewerCanManage: true,
    },
    {
      id: "fallback-friends",
      name: "Friends",
      display_name: "Friends",
      kind: "friends",
      raw_kind: "friends",
      owner_type: "system",
      owner_id: null,
      is_public: false,
      enabled: true,
      isEnabled: asEnabled,
      layer_icon: null,
      ownerCommunityName: null,
      sourceCommunityIds: [],
      viewerCanManage: true,
    },
  ];
};

const ensureCoreSystemLayers = (inputLayers, userId) => {
  const nextLayers = Array.isArray(inputLayers) ? [...inputLayers] : [];
  const systemKinds = new Set(
    nextLayers
      .filter((layer) => (layer.owner_type || "system") === "system")
      .map((layer) => getPinLayerKeyFromLayer(layer)),
  );
  const fallbackByKind = new Map(
    buildFallbackLayers(userId).map((layer) => [
      getPinLayerKeyFromLayer(layer),
      layer,
    ]),
  );

  ["public", "friends"].forEach((kind) => {
    if (!systemKinds.has(kind) && fallbackByKind.has(kind)) {
      nextLayers.push(fallbackByKind.get(kind));
    }
  });

  return nextLayers;
};

const MapScreen = ({ navigation, route }) => {
  const { isDark, palette } = useAppTheme();
  const styles = createStyles(palette);

  const [region, setRegion] = useState(DEFAULT_REGION);
  const [mapVisuals, setMapVisuals] = useState({ pins: [], clouds: [] });
  const [currentUser, setCurrentUser] = useState(null);
  const [layers, setLayers] = useState([]);
  const [layersLoading, setLayersLoading] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedPin, setSelectedPin] = useState(null);
  const [pinVoteSummary, setPinVoteSummary] = useState({
    upvotes: 0,
    downvotes: 0,
    userVote: 0,
  });
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [pinComments, setPinComments] = useState([]);
  const [pinCommentsLoading, setPinCommentsLoading] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  const [mapType, setMapType] = useState("standard");
  const [mapMode, setMapMode] = useState("user");
  const [userLocation, setUserLocation] = useState(null);

  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [isPickingPostLocation, setIsPickingPostLocation] = useState(false);
  const [drawingCoords, setDrawingCoords] = useState([]);
  const [drawingType, setDrawingType] = useState(null);
  const [pendingPostData, setPendingPostData] = useState(null);
  const [communityMapContext, setCommunityMapContext] = useState(null);
  const [layerPostsModalVisible, setLayerPostsModalVisible] = useState(false);
  const [layerPostsTarget, setLayerPostsTarget] = useState(null);
  const [layerPosts, setLayerPosts] = useState([]);
  const [layerPostsLoading, setLayerPostsLoading] = useState(false);
  const [userPostingLayerId, setUserPostingLayerId] = useState(null);
  const [friendUserIds, setFriendUserIds] = useState([]);
  const [selectedPinLayers, setSelectedPinLayers] = useState([]);
  const [allLoadedPosts, setAllLoadedPosts] = useState([]);
  const [arrowFocusedPinId, setArrowFocusedPinId] = useState(null);
  const [cloudPostsModalVisible, setCloudPostsModalVisible] = useState(false);
  const [selectedCloud, setSelectedCloud] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mapSize, setMapSize] = useState(DEFAULT_MAP_SIZE);
  const pins = mapVisuals.pins;
  const clouds = mapVisuals.clouds;

  const mapRef = useRef(null);
  const selectedPinIdRef = useRef(null);
  const pinVoteSummaryCacheRef = useRef(new Map());
  const pinVoteRequestRef = useRef(new Map());
  const pinCommentsCacheRef = useRef(new Map());
  const pinCommentsRequestRef = useRef(new Map());
  const votePrefetchTimerRef = useRef(null);
  const layerFetchInFlightRef = useRef({ key: null, promise: null });
  const errorThrottleRef = useRef(new Map());
  const networkBackoffUntilRef = useRef(0);
  const markerRefsByIdRef = useRef(new Map());
  const arrowCalloutTimerRef = useRef(null);
  const lastArrowCalloutPinIdRef = useRef(null);
  const initialBackgroundLayerRefreshDoneRef = useRef(false);

  useEffect(() => {
    selectedPinIdRef.current = selectedPin?.id || null;
  }, [selectedPin?.id]);

  useEffect(() => {
    return () => {
      if (arrowCalloutTimerRef.current) {
        clearTimeout(arrowCalloutTimerRef.current);
        arrowCalloutTimerRef.current = null;
      }
    };
  }, []);

  const shouldThrottleError = useCallback((key, cooldownMs) => {
    const now = Date.now();
    const last = errorThrottleRef.current.get(key) || 0;
    if (now - last < cooldownMs) {
      return true;
    }
    errorThrottleRef.current.set(key, now);
    return false;
  }, []);

  const logErrorWithThrottle = useCallback(
    (key, label, error, cooldownMs = ERROR_LOG_COOLDOWN_MS) => {
      if (shouldThrottleError(`log:${key}`, cooldownMs)) return;
      console.error(label, formatErrorMessage(error));
    },
    [shouldThrottleError],
  );

  const warnWithThrottle = useCallback(
    (key, label, details = "", cooldownMs = ERROR_LOG_COOLDOWN_MS) => {
      if (shouldThrottleError(`warn:${key}`, cooldownMs)) return;
      const text = String(details || "").trim();
      if (text) {
        console.warn(label, text);
      } else {
        console.warn(label);
      }
    },
    [shouldThrottleError],
  );

  const alertWithThrottle = useCallback(
    (key, title, message, cooldownMs = ERROR_ALERT_COOLDOWN_MS) => {
      if (shouldThrottleError(`alert:${key}`, cooldownMs)) return;
      Alert.alert(title, message);
    },
    [shouldThrottleError],
  );

  const isNetworkBackoffActive = useCallback(() => {
    return Date.now() < networkBackoffUntilRef.current;
  }, []);

  const activateNetworkBackoff = useCallback(() => {
    networkBackoffUntilRef.current = Date.now() + NETWORK_BACKOFF_MS;
  }, []);

  const applyFallbackLayers = useCallback((userId) => {
    const fallback = buildFallbackLayers(userId);
    setLayers((prev) => {
      if (Array.isArray(prev) && prev.length > 0) return prev;
      return fallback;
    });
    setSelectedLayerId((prev) => resolveNextSelectedLayerId(fallback, prev));
  }, []);

  const restoreCachedPosts = useCallback(async () => {
    if (allLoadedPosts.length > 0) return;
    try {
      const raw = await AsyncStorage.getItem(MAP_POSTS_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setAllLoadedPosts(parsed);
      }
    } catch (_) {
      // Ignore cache parse/read failures.
    }
  }, [allLoadedPosts.length]);

  const resolveCurrentUserId = useCallback(async () => {
    // For RLS-gated writes, require an active auth session so auth.uid() is
    // guaranteed on PostgREST/RPC requests.
    let session = null;
    try {
      const {
        data: { session: current },
      } = await supabase.auth.getSession();
      session = current || null;
    } catch (error) {
      console.error("Error resolving current session:", error);
    }
    if (session?.user?.id) {
      if (currentUser?.id !== session.user.id) {
        setCurrentUser(session.user);
      }
      return session.user.id;
    }
    return null;
  }, [currentUser?.id]);

  const persistLayerOrderToSupabase = useCallback(async (nextLayers, userId) => {
    if (!userId || !Array.isArray(nextLayers)) return;
    const orderedLayerIds = nextLayers
      .map((layer) => String(layer?.id || ""))
      .filter((id) => isUuid(id));
    if (orderedLayerIds.length === 0) return;

    const session = await getActiveSession();
    const accessToken = session?.access_token || null;
    const refreshToken = session?.refresh_token || null;
    const actorUserId = session?.user?.id || userId;

    const edgeResult = await setLayerOrderViaEdgeFunction(
      orderedLayerIds,
      accessToken,
      refreshToken,
      actorUserId,
    );
    if (edgeResult.error) {
      throw edgeResult.error;
    }
  }, []);

  const selectedLayerMeta =
    layers.find((layer) => layer.id === selectedLayerId && layer.isEnabled) ||
    null;

  const enabledPinLayerKeys = useMemo(() => {
    const myPostsEnabled = layers.some(
      (layer) => layer.isEnabled && isUserPostingLayer(layer),
    );

    if (mapMode === "explore") {
      const keys = Array.from(
        new Set([
          "public",
          ...layers
            .filter((layer) => layer.isEnabled && !isUserPostingLayer(layer))
            .map((layer) => getPinLayerKeyFromLayer(layer)),
          ...(currentUser?.id && myPostsEnabled
            ? ["friends", "private"]
            : []),
        ]),
      );
      return keys.length > 0 ? keys : ["public"];
    }

    const keys = Array.from(
      new Set(
        layers
          .filter((layer) => layer.isEnabled && !isUserPostingLayer(layer))
          .map((layer) => getPinLayerKeyFromLayer(layer)),
      ),
    );
    if (currentUser?.id) {
      if (myPostsEnabled) {
        keys.push("public", "friends", "private");
      } else {
        keys.push("private");
      }
    }
    return Array.from(new Set(keys));
  }, [currentUser?.id, layers, mapMode]);

  const fetchAccessibleLayers = useCallback(
    async (userId, communityId) => {
      if (isNetworkBackoffActive()) {
        applyFallbackLayers(userId);
        return;
      }

      const requestKey = `${userId || "guest"}:${communityId || "none"}`;
      const inFlight = layerFetchInFlightRef.current;
      if (inFlight.key === requestKey && inFlight.promise) {
        return inFlight.promise;
      }

      const requestPromise = (async () => {
        setLayersLoading(true);

        try {
        const session = await getActiveSession();
        const resolvedUserId = userId || session?.user?.id || null;
        const resolvedUsername =
          String(
            session?.user?.user_metadata?.username ||
              session?.user?.user_metadata?.display_name ||
              currentUser?.user_metadata?.username ||
              currentUser?.user_metadata?.display_name ||
              "",
          )
            .trim()
            .toLowerCase() || null;
        const expectedUserLayerName = session?.user
          ? makeUserPostingLayerName(session.user).toLowerCase()
          : null;
        const expectedLegacyUserLayerName = resolvedUserId
          ? `user-${resolvedUserId}-posts`
          : null;
        const accessToken = session?.access_token || null;
        const refreshToken = session?.refresh_token || null;
        const actorUserId = session?.user?.id || resolvedUserId || null;

        const membershipsPromise = resolvedUserId && accessToken
          ? (async () => {
              const edgeResult = await fetchMyCommunityMembershipsViaEdgeFunction(
                accessToken,
                refreshToken,
                actorUserId,
              );
              return {
                data: edgeResult.data?.memberships || [],
                error: edgeResult.error || null,
              };
            })()
          : Promise.resolve({ data: [], error: null });

        const prefsPromise = resolvedUserId
          ? (async () => {
              let edgeError = null;
              if (accessToken) {
                const edgeResult = await fetchMyLayerPrefsViaEdgeFunction(
                  accessToken,
                  refreshToken,
                  actorUserId,
                );
                if (!edgeResult.error) {
                  return {
                    data: edgeResult.data?.prefs || [],
                    error: null,
                  };
                }
                edgeError = edgeResult.error;
              }

              const authed = accessToken
                ? supabaseWithAccessToken(accessToken)
                : supabase;
              const directRes = await authed
                .from("user_layer_prefs")
                .select("layer_id,hidden,sort_order")
                .eq("user_id", actorUserId || resolvedUserId);

              if (directRes.error) {
                return { data: [], error: edgeError || directRes.error };
              }

              return {
                data: directRes.data || [],
                error: null,
              };
            })()
          : Promise.resolve({ data: [], error: null });

        const [allLayersRes, membershipsRes, prefsRes] = await Promise.all([
          supabase
            .from("layers")
            .select(
              "id,name,kind,owner_type,owner_id,is_public,enabled,created_at",
            ),
          membershipsPromise,
          prefsPromise,
        ]);

        if (allLayersRes.error) throw allLayersRes.error;
        if (membershipsRes.error) {
          warnWithThrottle(
            "layers-memberships",
            "Community memberships unavailable, continuing with base layers:",
            formatErrorMessage(membershipsRes.error),
          );
        }
        if (prefsRes.error) {
          warnWithThrottle(
            "layers-prefs",
            "Layer preferences unavailable, continuing with defaults:",
            formatErrorMessage(prefsRes.error),
          );
        }

        const activeMemberships = (
          (membershipsRes.error ? [] : membershipsRes.data) || []
        ).filter((row) => {
          const status = String(row?.status || "")
            .trim()
            .toLowerCase();
          return status === "accepted" || status === "active";
        });
        const activeMembershipCommunityIdSet = new Set(
          activeMemberships.map((row) => row.community_id),
        );
        const activeCommunityIds = [
          ...new Set([
            ...activeMemberships.map((row) => row.community_id),
            ...(communityId ? [communityId] : []),
          ]),
        ];

        let communityLayerLinks = [];
        if (activeCommunityIds.length > 0) {
          const communityLayersRes = await supabase
            .from("community_layers")
            .select("community_id,layer_id,enabled,sort_order")
            .in("community_id", activeCommunityIds)
            .eq("enabled", true);

          if (communityLayersRes.error) throw communityLayersRes.error;
          communityLayerLinks = communityLayersRes.data || [];
        }

        const prefLayerIds = (prefsRes.data || []).map((row) => row.layer_id);
        const prefRows = prefsRes.error ? [] : prefsRes.data || [];
        const allLayerRows = allLayersRes.data || [];

        const layerIdSet = new Set([
          ...allLayerRows
            .filter((row) => {
              const ownerType = row.owner_type || "system";
              if (!(ownerType === "system" || ownerType === "user")) return false;
              const pinKey = getPinLayerKeyFromLayer({
                kind: row.kind,
                name: row.name,
                owner_type: row.owner_type || "system",
              });
              return pinKey !== "private";
            })
            .map((row) => row.id),
          ...allLayerRows
            .filter((row) => {
              const pinKey = getPinLayerKeyFromLayer({
                kind: row.kind,
                name: row.name,
                owner_type: row.owner_type || "system",
              });
              return ["public", "friends"].includes(pinKey);
            })
            .map((row) => row.id),
          ...communityLayerLinks.map((row) => row.layer_id),
          ...prefLayerIds,
        ]);

        if (layerIdSet.size === 0) {
          applyFallbackLayers(resolvedUserId);
          return;
        }

        const rawLayers = allLayerRows.filter((row) => layerIdSet.has(row.id));
        const ownerCommunityIds = Array.from(
          new Set(
            rawLayers
              .filter(
                (layer) => layer.owner_type === "community" && layer.owner_id,
              )
              .map((layer) => layer.owner_id),
          ),
        );

        const communityIdsToResolve = Array.from(
          new Set([...ownerCommunityIds, ...activeCommunityIds]),
        );

        let communitiesMap = new Map();
        if (communityIdsToResolve.length > 0) {
          const communitiesRes = await supabase
            .from("communities")
            .select("id,name,slug")
            .in("id", communityIdsToResolve);

          if (communitiesRes.error) throw communitiesRes.error;

          communitiesMap = new Map(
            (communitiesRes.data || []).map((community) => [
              community.id,
              community,
            ]),
          );
        }

        const prefByLayerId = new Map(
          prefRows.map((row) => [row.layer_id, row]),
        );

        const layerCommunitiesMap = new Map();
        communityLayerLinks.forEach((link) => {
          const existing = layerCommunitiesMap.get(link.layer_id) || [];
          existing.push(link.community_id);
          layerCommunitiesMap.set(link.layer_id, existing);
        });

        const forcedCommunityLayerIds = new Set(
          communityLayerLinks
            .filter((row) => row.community_id === communityId)
            .map((row) => row.layer_id),
        );

        const mappedLayers = rawLayers.map((layer) => {
          const ownerType = layer.owner_type || "system";
          const { baseKind, layerIcon } = parseLayerKindMetadata(layer.kind);
          const prefRow = prefByLayerId.get(layer.id) || null;
          const hasPref = Boolean(prefRow);
          const prefHidden = Boolean(prefRow?.hidden);
          const prefSortOrderRaw = Number(prefRow?.sort_order);
          const prefSortOrder = Number.isFinite(prefSortOrderRaw)
            ? prefSortOrderRaw
            : null;
          const isDbEnabled = layer.enabled !== false;
          const sourceCommunityIds = layerCommunitiesMap.get(layer.id) || [];
          const isLinkedToActiveCommunity =
            sourceCommunityIds.some((id) =>
              activeMembershipCommunityIdSet.has(id),
            ) ||
            (layer.owner_id
              ? activeMembershipCommunityIdSet.has(layer.owner_id)
              : false);
          const isEnabled = forcedCommunityLayerIds.has(layer.id)
            ? true
            : hasPref
              ? !prefHidden
              : isDbEnabled && (ownerType === "system" || ownerType === "user");

          const ownerCommunity = layer.owner_id
            ? communitiesMap.get(layer.owner_id)
            : null;
          const viewerCanManage =
            ownerType !== "community" ||
            isLinkedToActiveCommunity;

          return {
            ...layer,
            kind: baseKind || layer.kind,
            raw_kind: layer.kind,
            layer_icon: layerIcon,
            owner_type: ownerType,
            display_name:
              ownerType === "user" && (baseKind || layer.kind) === "user_posts"
                ? "My Posts"
                : layer.name,
            isEnabled,
            pref_sort_order: prefSortOrder,
            ownerCommunityName: ownerCommunity?.name || null,
            sourceCommunityIds,
            isCommunityAccessible: isLinkedToActiveCommunity,
            viewerCanManage,
          };
        });

        const collectionScopedLayers = mappedLayers.filter((layer) => {
          if (layer.owner_type !== "community") return true;
          if (forcedCommunityLayerIds.has(layer.id)) return true;
          return Boolean(layer.isCommunityAccessible);
        });

        const nonPrivateLayers = collectionScopedLayers.filter(
          (layer) => getPinLayerKeyFromLayer(layer) !== "private",
        );

        const ownUserLayersOnly = nonPrivateLayers.filter((layer) => {
          if (!(layer.owner_type === "user" && layer.kind === "user_posts")) {
            return true;
          }

          if (!resolvedUserId) return false;
          if (layer.owner_id && layer.owner_id === resolvedUserId) return true;
          if (userPostingLayerId && layer.id === userPostingLayerId)
            return true;

          const lowerName = String(layer.name || "").toLowerCase();
          if (expectedUserLayerName && lowerName === expectedUserLayerName) {
            return true;
          }
          if (
            expectedLegacyUserLayerName &&
            lowerName === expectedLegacyUserLayerName
          ) {
            return true;
          }
          if (resolvedUsername && lowerName.includes(`user-${resolvedUsername}-`)) {
            return true;
          }
          return lowerName.includes(String(resolvedUserId).toLowerCase());
        });

        const ownUserPostingCandidates = ownUserLayersOnly.filter(
          (layer) =>
            layer.owner_type === "user" && layer.kind === "user_posts",
        );
        const ownUserPostingById = new Map(
          ownUserPostingCandidates.map((layer) => [layer.id, layer]),
        );
        const ownUserPostingPrimaryId =
          (userPostingLayerId && ownUserPostingById.has(userPostingLayerId)
            ? userPostingLayerId
            : null) ||
          ownUserPostingCandidates.find(
            (layer) => layer.owner_id && layer.owner_id === resolvedUserId,
          )?.id ||
          ownUserPostingCandidates.find((layer) => {
            const lowerName = String(layer.name || "").toLowerCase();
            return (
              (expectedUserLayerName && lowerName === expectedUserLayerName) ||
              (expectedLegacyUserLayerName &&
                lowerName === expectedLegacyUserLayerName)
            );
          })?.id ||
          ownUserPostingCandidates[0]?.id ||
          null;

        const ownUserLayersCanonical = ownUserLayersOnly.filter((layer) => {
          if (!(layer.owner_type === "user" && layer.kind === "user_posts")) {
            return true;
          }
          return ownUserPostingPrimaryId && layer.id === ownUserPostingPrimaryId;
        });

        const withCoreSystemLayers = ensureCoreSystemLayers(
          ownUserLayersCanonical,
          resolvedUserId,
        );
        const sortedLayers = sortLayers(withCoreSystemLayers);
        const nextLayers = [...sortedLayers].sort((a, b) => {
          const rankA = Number.isFinite(a?.pref_sort_order)
            ? a.pref_sort_order
            : Number.MAX_SAFE_INTEGER;
          const rankB = Number.isFinite(b?.pref_sort_order)
            ? b.pref_sort_order
            : Number.MAX_SAFE_INTEGER;
          if (rankA !== rankB) return rankA - rankB;
          return 0;
        });
        setLayers(nextLayers);
        if (communityId) {
          const firstCommunityLayer = nextLayers.find((layer) =>
            forcedCommunityLayerIds.has(layer.id),
          );
          setSelectedLayerId(
            (prev) =>
              firstCommunityLayer?.id ||
              resolveNextSelectedLayerId(nextLayers, prev),
          );
        } else {
          setSelectedLayerId((prev) =>
            resolveNextSelectedLayerId(nextLayers, prev),
          );
        }
      } catch (error) {
        const transient = isTransientNetworkError(error);
        if (transient) {
          activateNetworkBackoff();
          applyFallbackLayers(userId || currentUser?.id || null);
          warnWithThrottle(
            "network-unavailable",
            "Network temporarily unavailable. Showing cached/offline data where possible.",
          );
          return;
        }

        logErrorWithThrottle("layers-load", "Error loading layers:", error);
        alertWithThrottle("layers-load", "Error", "Failed to load layers from Supabase.");
      } finally {
        setLayersLoading(false);
      }
    })();

      layerFetchInFlightRef.current = {
        key: requestKey,
        promise: requestPromise,
      };

      try {
        return await requestPromise;
      } finally {
        if (layerFetchInFlightRef.current.promise === requestPromise) {
          layerFetchInFlightRef.current = { key: null, promise: null };
        }
      }
    },
    [
      activateNetworkBackoff,
      alertWithThrottle,
      applyFallbackLayers,
      isNetworkBackoffActive,
      logErrorWithThrottle,
      warnWithThrottle,
      userPostingLayerId,
    ],
  );

  useEffect(() => {
    const initialize = async () => {
      const user = await getCurrentUser();
      setCurrentUser(user);
    };

    initialize();
    requestLocationPermission();
  }, []);

  useEffect(() => {
    restoreCachedPosts();
  }, [restoreCachedPosts]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user || null);
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!currentUser?.id) {
      setIsAdmin(false);
      return;
    }
    const fetchAdminStatus = async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("is_admin")
          .eq("id", currentUser.id)
          .maybeSingle();
        if (error) throw error;
        setIsAdmin(Boolean(data?.is_admin));
      } catch (error) {
        if (isTransientNetworkError(error)) {
          activateNetworkBackoff();
          warnWithThrottle(
            "network-unavailable",
            "Network temporarily unavailable. Showing cached/offline data where possible.",
          );
          return;
        }
        logErrorWithThrottle(
          "admin-status",
          "Error fetching admin status:",
          error,
        );
        setIsAdmin(false);
      }
    };
    fetchAdminStatus();
  }, [
    activateNetworkBackoff,
    currentUser?.id,
    logErrorWithThrottle,
    warnWithThrottle,
  ]);

  useEffect(() => {
    const incomingCommunityMap = route?.params?.communityMap;
    if (incomingCommunityMap?.id) {
      setCommunityMapContext(incomingCommunityMap);
    }
  }, [route?.params?.communityMap]);

  useEffect(() => {
    fetchAccessibleLayers(currentUser?.id, communityMapContext?.id);
  }, [currentUser?.id, communityMapContext?.id, fetchAccessibleLayers]);

  useEffect(() => {
    if (initialBackgroundLayerRefreshDoneRef.current) return;
    if (!currentUser?.id) return;

    initialBackgroundLayerRefreshDoneRef.current = true;
    const timer = setTimeout(() => {
      fetchAccessibleLayers(currentUser.id, communityMapContext?.id);
    }, 700);

    return () => clearTimeout(timer);
  }, [currentUser?.id, communityMapContext?.id, fetchAccessibleLayers]);

  useEffect(() => {
    const hasFallbackOnly =
      !Array.isArray(layers) ||
      layers.length === 0 ||
      layers.every((layer) => String(layer?.id || "").startsWith("fallback-"));
    if (!hasFallbackOnly) return undefined;

    const timer = setInterval(() => {
      if (isNetworkBackoffActive()) return;
      fetchAccessibleLayers(currentUser?.id, communityMapContext?.id);
    }, 12000);

    return () => clearInterval(timer);
  }, [
    communityMapContext?.id,
    currentUser?.id,
    fetchAccessibleLayers,
    isNetworkBackoffActive,
    layers,
  ]);

  useEffect(() => {
    const loadFriendIds = async () => {
      if (!currentUser?.id) {
        setFriendUserIds([]);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("friends")
          .select("user_id,friend_id,status")
          .or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`)
          .eq("status", "accepted");
        if (error) throw error;

        const ids = Array.from(
          new Set(
            (data || []).map((row) =>
              row.user_id === currentUser.id ? row.friend_id : row.user_id,
            ),
          ),
        );
        setFriendUserIds(ids);
      } catch (error) {
        if (isTransientNetworkError(error)) {
          activateNetworkBackoff();
          warnWithThrottle(
            "network-unavailable",
            "Network temporarily unavailable. Showing cached/offline data where possible.",
          );
          return;
        }
        logErrorWithThrottle("friend-ids", "Error loading friend ids:", error);
        setFriendUserIds([]);
      }
    };

    loadFriendIds();
  }, [
    activateNetworkBackoff,
    currentUser?.id,
    logErrorWithThrottle,
    warnWithThrottle,
  ]);

  const ensureUserPostingLayer = useCallback(async () => {
    if (!currentUser?.id) return null;
    if (userPostingLayerId) return userPostingLayerId;

    const layerName = makeUserPostingLayerName(currentUser);
    const legacyLayerName = `user-${currentUser.id}-posts`;
    try {
      const existingRes = await supabase
        .from("layers")
        .select("id,name,owner_id")
        .eq("owner_type", "user")
        .eq("kind", "user_posts")
        .eq("name", layerName)
        .maybeSingle();

      if (existingRes.error) throw existingRes.error;
      if (existingRes.data?.id) {
        if (!existingRes.data.owner_id) {
          const { error: backfillOwnerError } = await supabase
            .from("layers")
            .update({ owner_id: currentUser.id })
            .eq("id", existingRes.data.id);
          if (backfillOwnerError) throw backfillOwnerError;
        }
        setUserPostingLayerId(existingRes.data.id);
        return existingRes.data.id;
      }

      const legacyRes = await supabase
        .from("layers")
        .select("id,name,owner_id")
        .eq("owner_type", "user")
        .eq("kind", "user_posts")
        .eq("name", legacyLayerName)
        .maybeSingle();
      if (legacyRes.error) throw legacyRes.error;
      if (legacyRes.data?.id) {
        const { error: normalizeError } = await supabase
          .from("layers")
          .update({ name: layerName, owner_id: currentUser.id })
          .eq("id", legacyRes.data.id);
        if (normalizeError) throw normalizeError;
        setUserPostingLayerId(legacyRes.data.id);
        return legacyRes.data.id;
      }

      const createRes = await supabase
        .from("layers")
        .insert({
          kind: "user_posts",
          name: layerName,
          enabled: true,
          owner_type: "user",
          owner_id: currentUser.id,
          is_public: false,
        })
        .select("id")
        .single();

      if (createRes.error) throw createRes.error;
      setUserPostingLayerId(createRes.data.id);
      return createRes.data.id;
    } catch (error) {
      if (isTransientNetworkError(error)) {
        activateNetworkBackoff();
        warnWithThrottle(
          "network-unavailable",
          "Network temporarily unavailable. Showing cached/offline data where possible.",
        );
        return userPostingLayerId || null;
      }
      logErrorWithThrottle(
        "ensure-user-layer",
        "Error ensuring user posting layer:",
        error,
      );
      return null;
    }
  }, [
    activateNetworkBackoff,
    currentUser?.id,
    logErrorWithThrottle,
    userPostingLayerId,
    warnWithThrottle,
  ]);

  useEffect(() => {
    if (!currentUser?.id) return;
    ensureUserPostingLayer().then(() => {
      fetchAccessibleLayers(currentUser.id, communityMapContext?.id);
    });
  }, [
    currentUser?.id,
    communityMapContext?.id,
    ensureUserPostingLayer,
    fetchAccessibleLayers,
  ]);

  useFocusEffect(
    useCallback(() => {
      fetchAccessibleLayers(currentUser?.id, communityMapContext?.id);
    }, [currentUser?.id, communityMapContext?.id, fetchAccessibleLayers]),
  );

  const clearCommunityMapContext = () => {
    setCommunityMapContext(null);
    if (route?.params?.communityMap) {
      navigation.setParams({ communityMap: undefined });
    }
  };

  useEffect(() => {
    if (enabledPinLayerKeys.length === 0) {
      setMapVisuals({ pins: [], clouds: [] });
      restoreCachedPosts();
      return undefined;
    }

    loadPins(enabledPinLayerKeys);
    const unsubscribe = subscribeToPins(enabledPinLayerKeys);
    return unsubscribe;
  }, [enabledPinLayerKeys, restoreCachedPosts]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const { visiblePins, visibleClouds } = computeMapVisuals(
        allLoadedPosts,
        region,
        mapSize,
        arrowFocusedPinId,
      );
      setMapVisuals((prev) => {
        const samePins = haveSameEntityIds(prev.pins, visiblePins);
        const sameClouds = haveSameEntityIds(prev.clouds, visibleClouds);
        if (samePins && sameClouds) return prev;
        return { pins: visiblePins, clouds: visibleClouds };
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [allLoadedPosts, arrowFocusedPinId, mapSize, region]);

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const location = await Location.getCurrentPositionAsync({});
        const loc = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
        setUserLocation(loc);
        setRegion({
          ...loc,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        });
      }
    } catch (error) {
      console.error("Error getting location:", error);
    }
  };

  const loadPins = async (pinLayerKeys) => {
    if (!pinLayerKeys || pinLayerKeys.length === 0) {
      setMapVisuals({ pins: [], clouds: [] });
      setAllLoadedPosts([]);
      return;
    }

    try {
      const queryLayerKeys = pinLayerKeys;
      let readAccessToken = null;
      let readRefreshToken = null;
      let readActorUserId = currentUser?.id || null;
      const session = await getActiveSession();
      if (session?.access_token) {
        readAccessToken = session.access_token;
        readRefreshToken = session.refresh_token || null;
        readActorUserId = session?.user?.id || readActorUserId;
      } else {
        try {
          const {
            data: { session: fallbackSession },
          } = await supabase.auth.getSession();
          if (fallbackSession?.access_token) {
            readAccessToken = fallbackSession.access_token;
            readRefreshToken = fallbackSession.refresh_token || null;
            readActorUserId = fallbackSession?.user?.id || readActorUserId;
          }
        } catch (_) {
          // Ignore fallback session lookup errors and continue anon for reads.
        }
      }
      let data = null;
      let error = null;
      if (readAccessToken && readActorUserId) {
        const edgeResult = await fetchPinsViaEdgeFunction(
          queryLayerKeys,
          readAccessToken,
          readRefreshToken,
          readActorUserId,
          3000,
        );
        if (!edgeResult.error) {
          data = Array.isArray(edgeResult?.data?.pins) ? edgeResult.data.pins : [];
        } else {
          const edgeErrorText = String(
            edgeResult?.error?.message || "",
          ).toLowerCase();
          const canFallbackToDirectRead =
            edgeResult?.status === 404 ||
            edgeResult?.status === 405 ||
            edgeErrorText.includes("unsupported action") ||
            edgeErrorText.includes("edge function failed (404)") ||
            edgeErrorText.includes("edge function failed (405)");
          if (!canFallbackToDirectRead) {
            throw edgeResult.error;
          }
        }
      }

      if (!Array.isArray(data)) {
        const reader = readAccessToken
          ? supabaseWithAccessToken(readAccessToken)
          : supabase;
        const directRead = await reader
          .from("pins")
          .select("*")
          .in("layer", queryLayerKeys)
          .order("created_at", { ascending: false });
        data = directRead.data;
        error = directRead.error;
      }

      if (error) throw error;
      const enabledLayerIds = new Set(
        layers.filter((layer) => layer.isEnabled).map((layer) => layer.id),
      );
      const enabledUserPostingLayerId =
        layers.find((layer) => layer.isEnabled && isUserPostingLayer(layer))
          ?.id || null;
      const ownUserIdForMyPosts = readActorUserId || currentUser?.id || null;
      const layerById = new Map(layers.map((layer) => [layer.id, layer]));
      const systemLayerIdByKey = new Map();
      layers
        .filter((layer) => layer.owner_type === "system")
        .forEach((layer) => {
          const key = getPinLayerKeyFromLayer(layer);
          if (!systemLayerIdByKey.has(key)) {
            systemLayerIdByKey.set(key, layer.id);
          }
        });
      const resolveEffectiveLayerId = (pin) => {
        const explicit = String(pin?.geometry?.layer_id || "");
        if (explicit) return explicit;
        const legacyKey = String(pin?.layer || "").toLowerCase();
        return String(systemLayerIdByKey.get(legacyKey) || "");
      };
      const resolveRenderableLayerId = (pin) => {
        const effectiveLayerId = resolveEffectiveLayerId(pin);
        if (enabledLayerIds.has(effectiveLayerId)) {
          return effectiveLayerId;
        }
        if (
          enabledUserPostingLayerId &&
          ownUserIdForMyPosts &&
          String(pin?.user_id || "") === String(ownUserIdForMyPosts)
        ) {
          return enabledUserPostingLayerId;
        }
        return effectiveLayerId;
      };
      const filtered = (data || []).filter((pin) => {
        const layerId = resolveRenderableLayerId(pin);
        if (!layerId) return false;
        if (!enabledLayerIds.has(layerId)) return false;
        const layerMeta = layerById.get(layerId) || null;
        if (isUserPostingLayer(layerMeta)) {
          return (
            Boolean(ownUserIdForMyPosts) &&
            String(pin?.user_id || "") === String(ownUserIdForMyPosts)
          );
        }
        return true;
      });
      const deduped = [];
      const byGroup = new Map();
      const layerOrderIndex = new Map(
        layers.map((layer, index) => [layer.id, index]),
      );
      filtered.forEach((pin) => {
        const groupKey =
          pin?.geometry?.cross_post_group_id ||
          `${pin.user_id || "anon"}-${pin.caption || ""}-${pin.content || ""}-${pin.lat}-${pin.lng}-${pin.created_at || pin.id}`;
        const existing = byGroup.get(groupKey);
        if (!existing) {
          byGroup.set(groupKey, pin);
          return;
        }

        const existingLayerId = resolveRenderableLayerId(existing);
        const currentLayerId = resolveRenderableLayerId(pin);
        const existingRank = layerOrderIndex.has(existingLayerId)
          ? layerOrderIndex.get(existingLayerId)
          : Number.MAX_SAFE_INTEGER;
        const currentRank = layerOrderIndex.has(currentLayerId)
          ? layerOrderIndex.get(currentLayerId)
          : Number.MAX_SAFE_INTEGER;
        if (currentRank < existingRank) {
          byGroup.set(groupKey, pin);
        }
      });
      byGroup.forEach((pin) => deduped.push(pin));

      const userIds = Array.from(
        new Set(deduped.map((pin) => pin.user_id).filter(Boolean)),
      );
      const profileByUserId = new Map();
      if (userIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id,username,avatar_url")
          .in("id", userIds);
        if (profileError) throw profileError;
        (profiles || []).forEach((profile) =>
          profileByUserId.set(profile.id, profile),
        );
      }

      const layerIconById = new Map(
        layers.map((layer) => [layer.id, layer.layer_icon || null]),
      );
      const withLayerIcon = deduped
        .map((pin) => {
          const numericLat = Number(pin?.lat);
          const numericLng = Number(pin?.lng);
          const effectiveLayerId = resolveRenderableLayerId(pin);
          const baseGeometry =
            pin?.geometry && typeof pin.geometry === "object"
              ? pin.geometry
              : {};
          return {
            ...pin,
            lat: Number.isFinite(numericLat) ? numericLat : pin?.lat,
            lng: Number.isFinite(numericLng) ? numericLng : pin?.lng,
            geometry: {
              ...baseGeometry,
              layer_id:
                effectiveLayerId || String(baseGeometry?.layer_id || "") || null,
            },
            author_avatar_url:
              profileByUserId.get(pin.user_id)?.avatar_url ||
              (pin.user_id === currentUser?.id
                ? currentUser?.user_metadata?.avatar_url || null
                : null),
            author_username:
              pin.author_username ||
              profileByUserId.get(pin.user_id)?.username ||
              "",
            layer_emoji: effectiveLayerId
              ? layerIconById.get(effectiveLayerId) || null
              : null,
          };
        })
        .filter(hasValidCoordinate);
      setAllLoadedPosts(withLayerIcon);
      try {
        await AsyncStorage.setItem(
          MAP_POSTS_CACHE_KEY,
          JSON.stringify(withLayerIcon),
        );
      } catch (_) {
        // Ignore cache write failures.
      }
    } catch (error) {
      if (isTransientNetworkError(error)) {
        activateNetworkBackoff();
        warnWithThrottle(
          "network-unavailable",
          "Network temporarily unavailable. Showing cached/offline data where possible.",
        );
        restoreCachedPosts();
        return;
      }
      logErrorWithThrottle("pins-load", "Error loading pins:", error);
      setMapVisuals({ pins: [], clouds: [] });
      setAllLoadedPosts([]);
    }
  };

  const loadPinAssociations = async (pin) => {
    if (!pin) {
      setSelectedPinLayers([]);
      return;
    }

    try {
      const groupId = pin?.geometry?.cross_post_group_id;
      let relatedRows = [pin];
      if (groupId) {
        let associationRows = null;
        let lastError = null;

        // Try expression filter first (works for JSON/JSONB), then fallback.
        const byExpression = await supabase
          .from("pins")
          .select("id,layer,geometry")
          .eq("geometry->>cross_post_group_id", groupId);
        if (!byExpression.error) {
          associationRows = byExpression.data;
        } else {
          lastError = byExpression.error;
          const byContains = await supabase
            .from("pins")
            .select("id,layer,geometry")
            .contains("geometry", { cross_post_group_id: groupId });
          if (!byContains.error) {
            associationRows = byContains.data;
            lastError = null;
          } else {
            lastError = byContains.error;
          }
        }

        if (Array.isArray(associationRows) && associationRows.length > 0) {
          relatedRows = associationRows;
        } else if (lastError) {
          console.warn(
            "Pin association lookup failed, falling back to current pin only:",
            lastError?.message || lastError,
          );
        }
      }

      const layerIds = Array.from(
        new Set(
          relatedRows.map((row) => row?.geometry?.layer_id).filter(Boolean),
        ),
      );
      const inMemoryNameMap = new Map(
        layers.map((layer) => [layer.id, layer.name]),
      );
      const missingIds = layerIds.filter((id) => !inMemoryNameMap.has(id));
      if (missingIds.length > 0) {
        const { data, error } = await supabase
          .from("layers")
          .select("id,name")
          .in("id", missingIds);
        if (error) throw error;
        (data || []).forEach((layer) =>
          inMemoryNameMap.set(layer.id, layer.name),
        );
      }

      const labels = Array.from(
        new Set(
          relatedRows.map((row) => {
            const layerId = row?.geometry?.layer_id;
            if (layerId && inMemoryNameMap.has(layerId)) {
              return inMemoryNameMap.get(layerId);
            }
            return toTitle(row?.layer || "public");
          }),
        ),
      ).filter(Boolean);
      setSelectedPinLayers(labels);
    } catch (error) {
      console.error(
        "Error loading pin associations:",
        error?.message || error,
      );
      setSelectedPinLayers([]);
    }
  };

  const subscribeToPins = (pinLayerKeys) => {
    const keySet = new Set(pinLayerKeys);
    const subscription = supabase
      .channel(`pins-enabled-map`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pins",
        },
        (payload) => {
          const eventLayer =
            payload?.new?.layer ||
            payload?.old?.layer ||
            payload?.record?.layer;
          if (eventLayer && keySet.has(eventLayer)) {
            loadPins(pinLayerKeys);
          }
        },
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  };

  const handleToggleLayer = async (layerId, nextEnabled, options = {}) => {
    const userId = await resolveCurrentUserId();
    if (!userId) {
      Alert.alert("Sign In Required", "Please sign in to manage your layers.");
      return;
    }

    const previousLayers = layers;
    const previousSelectedLayerId = selectedLayerId;
    const optimisticLayers = layers.map((layer) =>
      layer.id === layerId ? { ...layer, isEnabled: nextEnabled } : layer,
    );

    const nextSelected = options.selectAfterToggle
      ? layerId
      : resolveNextSelectedLayerId(optimisticLayers, selectedLayerId);

    setLayers(optimisticLayers);
    setSelectedLayerId(nextSelected);

    try {
      const session = await getActiveSession();
      const accessToken = session?.access_token || null;
      const refreshToken = session?.refresh_token || null;
      const actorUserId = session?.user?.id || userId;

      const edgeResult = await setLayerPreferenceViaEdgeFunction(
        layerId,
        !nextEnabled,
        accessToken,
        refreshToken,
        actorUserId,
      );
      if (edgeResult.error) {
        throw edgeResult.error;
      }
    } catch (error) {
      setLayers(previousLayers);
      setSelectedLayerId(previousSelectedLayerId);
      console.error("Error updating layer preference:", error);
      Alert.alert("Error", "Failed to sync layer preference to Supabase.");
    }
  };

  const handleMoveLayer = useCallback(
    async (layerId, direction) => {
      const userId = await resolveCurrentUserId();
      if (!userId) return;
      const fromIndex = layers.findIndex((layer) => layer.id === layerId);
      if (fromIndex < 0) return;
      const toIndex = fromIndex + direction;
      if (toIndex < 0 || toIndex >= layers.length) return;

      const next = [...layers];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const previousLayers = layers;
      setLayers(next);
      try {
        await persistLayerOrderToSupabase(next, userId);
      } catch (error) {
        setLayers(previousLayers);
        console.error("Error syncing layer order:", error);
        Alert.alert("Error", "Failed to sync layer order to Supabase.");
      }
    },
    [layers, persistLayerOrderToSupabase, resolveCurrentUserId],
  );

  const handleMapPress = (event) => {
    if (isPickingPostLocation && pendingPostData) {
      const { latitude, longitude } = event.nativeEvent.coordinate;
      const nextPostData = {
        ...pendingPostData,
        location: { latitude, longitude },
      };
      setPendingPostData(nextPostData);
      setIsPickingPostLocation(false);
      handlePostSubmit(nextPostData);
      return;
    }

    if (isDrawingMode) {
      const { latitude, longitude } = event.nativeEvent.coordinate;
      setDrawingCoords((prev) => [...prev, { latitude, longitude }]);
    }
  };

  const handleStartDrawing = (geometryType) => {
    setIsDrawingMode(true);
    setDrawingType(geometryType);
    setDrawingCoords([]);
  };

  const handleFinishDrawing = () => {
    setIsDrawingMode(false);
  };

  const handlePostSubmit = async (postData) => {
    if (!currentUser) {
      Alert.alert("Sign In Required", "Please sign in to create posts");
      navigation.navigate("Account");
      return;
    }

    if (postData.locationMode === "pick_on_map" && !postData.location) {
      setPendingPostData(postData);
      setIsPickingPostLocation(true);
      Alert.alert("Select Location", "Tap on the map to place this post.");
      return;
    }

    const mediaSource = String(postData?.mediaSource || "").toLowerCase();
    if (
      mediaSource === "library" &&
      postData.locationMode === "current"
    ) {
      Alert.alert(
        "Choose On Map Required",
        "Library media must be posted by choosing a location on the map.",
      );
      return;
    }

    if (
      postData.geometryType !== GEOMETRY_TYPES.POINT &&
      drawingCoords.length === 0
    ) {
      setPendingPostData(postData);
      handleStartDrawing(postData.geometryType);
      return;
    }

    try {
      const session = await getActiveSession();
      const activeUser = session?.user || currentUser;
      const activeUserId = activeUser?.id || null;
      if (!activeUserId || !session?.access_token) {
        Alert.alert(
          "Sign In Required",
          "Your session is missing or expired. Please sign in again.",
        );
        navigation.navigate("Account");
        return;
      }
      const authed = supabaseWithAccessToken(session.access_token);

      const authorLayerId = await ensureUserPostingLayer();
      if (!authorLayerId) {
        Alert.alert("Error", "Unable to resolve your user posting layer.");
        return;
      }

      const baseLng =
        postData.location?.longitude ||
        userLocation?.longitude ||
        region.longitude;
      const baseLat =
        postData.location?.latitude ||
        userLocation?.latitude ||
        region.latitude;
      const storedLat = baseLat;
      const storedLng = baseLng;
      const baseAudienceRaw = String(postData?.baseAudience || "").toLowerCase();
      const baseAudience = ["friends", "public", "private", "community"].includes(
        baseAudienceRaw,
      )
        ? baseAudienceRaw
        : "friends";
      const basePublicLayerId =
        typeof postData?.basePublicLayerId === "string"
          ? postData.basePublicLayerId
          : null;
      const baseFriendsLayerId =
        typeof postData?.baseFriendsLayerId === "string"
          ? postData.baseFriendsLayerId
          : null;
      const baseCommunityLayerId =
        typeof postData?.baseCommunityLayerId === "string"
          ? postData.baseCommunityLayerId
          : null;
      const postableLayerRows = layers.filter((layer) => {
        const pinLayerKey = getPinLayerKeyFromLayer(layer);
        return (
          layer.owner_type !== "user" &&
          ["public", "friends"].includes(pinLayerKey)
        );
      });
      const postableLayerIdSet = new Set(postableLayerRows.map((layer) => layer.id));
      const communityLayerRows = layers.filter(
        (layer) => layer.owner_type === "community" && layer.isEnabled,
      );
      const communityLayerIdSet = new Set(
        communityLayerRows.map((layer) => layer.id),
      );
      const resolvedPublicBaseLayerId =
        baseAudience === "public"
          ? basePublicLayerId && postableLayerIdSet.has(basePublicLayerId)
            ? basePublicLayerId
            : postableLayerRows.find(
                  (layer) =>
                    postableLayerIdSet.has(layer.id) &&
                    layer.owner_type === "system" &&
                    getPinLayerKeyFromLayer(layer) === "public",
                )?.id ||
              postableLayerRows.find(
                (layer) =>
                  postableLayerIdSet.has(layer.id) &&
                  getPinLayerKeyFromLayer(layer) === "public",
                )?.id || null
          : null;
      const resolvedFriendsBaseLayerId =
        baseAudience === "friends"
          ? baseFriendsLayerId && postableLayerIdSet.has(baseFriendsLayerId)
            ? baseFriendsLayerId
            : postableLayerRows.find(
                  (layer) =>
                    postableLayerIdSet.has(layer.id) &&
                    layer.owner_type === "system" &&
                    getPinLayerKeyFromLayer(layer) === "friends",
                )?.id ||
              postableLayerRows.find(
                (layer) =>
                  postableLayerIdSet.has(layer.id) &&
                  getPinLayerKeyFromLayer(layer) === "friends",
                )?.id || null
          : null;
      const resolvedCommunityLayerId =
        baseAudience === "community"
          ? baseCommunityLayerId && communityLayerIdSet.has(baseCommunityLayerId)
            ? baseCommunityLayerId
            : null
          : null;
      if (baseAudience === "public" && !resolvedPublicBaseLayerId) {
        Alert.alert(
          "Public Layer Unavailable",
          "No public layer is available for posting right now.",
        );
        return;
      }
      if (baseAudience === "friends" && !resolvedFriendsBaseLayerId) {
        Alert.alert(
          "Friends Layer Unavailable",
          "No friends layer is available for posting right now.",
        );
        return;
      }
      if (baseAudience === "community" && !resolvedCommunityLayerId) {
        Alert.alert(
          "Community Layer Required",
          "Choose one of your added community layers before posting.",
        );
        return;
      }

      const layerMap = new Map(layers.map((layer) => [layer.id, layer]));
      let resolvedTargetLayerId = null;
      let resolvedLayerKey = "friends";
      if (baseAudience === "public") {
        resolvedTargetLayerId = resolvedPublicBaseLayerId;
        resolvedLayerKey = "public";
      } else if (baseAudience === "friends") {
        resolvedTargetLayerId = resolvedFriendsBaseLayerId;
        resolvedLayerKey = "friends";
      } else if (baseAudience === "private") {
        resolvedTargetLayerId = authorLayerId;
        resolvedLayerKey = "private";
      } else if (baseAudience === "community") {
        resolvedTargetLayerId = resolvedCommunityLayerId;
        const communityLayer =
          layerMap.get(resolvedCommunityLayerId) || null;
        resolvedLayerKey = getPinLayerKeyFromLayer(communityLayer);
      }
      if (!resolvedTargetLayerId) {
        Alert.alert("Error", "Unable to resolve a target layer for this post.");
        return;
      }

      const targetLayerIds = [resolvedTargetLayerId];
      const crossPostGroupId =
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

      const insertRows = targetLayerIds.map((targetLayerId) => {
        const targetLayer =
          layerMap.get(targetLayerId) ||
          (targetLayerId === authorLayerId
            ? { kind: "user_posts", owner_type: "user", name: "My Posts" }
            : null);
        const postPinLayerKey =
          resolvedLayerKey || getPinLayerKeyFromLayer(targetLayer || null);

        let geometry;
        if (postData.geometryType === GEOMETRY_TYPES.POINT) {
          geometry = {
            type: "Point",
            coordinates: [storedLng, storedLat],
            layer_id: targetLayerId,
            author_layer_id: authorLayerId,
            author_user_id: activeUserId,
            cross_post_group_id: crossPostGroupId,
            visibility_mode: "pinned",
          };
        } else if (drawingCoords.length > 0) {
          const coordinates = drawingCoords.map((coord) => [
            coord.longitude,
            coord.latitude,
          ]);
          geometry = {
            type:
              postData.geometryType === GEOMETRY_TYPES.PLANE
                ? "Polygon"
                : "LineString",
            coordinates:
              postData.geometryType === GEOMETRY_TYPES.PLANE
                ? [coordinates]
                : coordinates,
            layer_id: targetLayerId,
            author_layer_id: authorLayerId,
            author_user_id: activeUserId,
            cross_post_group_id: crossPostGroupId,
            visibility_mode: "pinned",
          };
        } else {
          geometry = {
            type: "Point",
            coordinates: [storedLng, storedLat],
            layer_id: targetLayerId,
            author_layer_id: authorLayerId,
            author_user_id: activeUserId,
            cross_post_group_id: crossPostGroupId,
            visibility_mode: "pinned",
          };
        }

        return {
          user_id: activeUserId,
          type: postData.mediaUrl ? "media" : "text",
          content: postData.content,
          caption: postData.title,
          media_url: postData.mediaUrl || null,
          media_type: postData.mediaType,
          lat: storedLat,
          lng: storedLng,
          layer: postPinLayerKey,
          author_name: activeUser?.user_metadata?.display_name || "Anonymous",
          author_username: activeUser?.user_metadata?.username || "",
          posted_from_current_location: postData.locationMode === "current",
          geometry,
        };
      });

      const edgeCreateResult = await createPinsViaEdgeFunction(
        insertRows,
        session.access_token,
        session.refresh_token || null,
        activeUserId,
      );
      if (edgeCreateResult.error) {
        const edgeErrorText = String(
          edgeCreateResult?.error?.message || "",
        ).toLowerCase();
        const canFallbackToDirectInsert =
          edgeCreateResult?.status === 404 ||
          edgeCreateResult?.status === 405 ||
          edgeErrorText.includes("unsupported action") ||
          edgeErrorText.includes("edge function failed (404)") ||
          edgeErrorText.includes("edge function failed (405)");
        if (!canFallbackToDirectInsert) {
          throw edgeCreateResult.error;
        }

        let { error } = await authed.from("pins").insert(insertRows);
        if (error && isRlsPolicyError(error)) {
          const {
            data: { session: refreshedSession },
            error: refreshError,
          } = await supabase.auth.refreshSession();
          if (!refreshError && refreshedSession?.access_token) {
            const retryAuthed = supabaseWithAccessToken(
              refreshedSession.access_token,
            );
            const retryResult = await retryAuthed.from("pins").insert(insertRows);
            error = retryResult.error;
          }
        }
        if (error) throw error;
      } else {
        const insertedCount = Number(edgeCreateResult?.data?.insertedCount || 0);
        if (insertedCount <= 0) {
          throw new Error("Create post returned no affected rows.");
        }
      }

      loadPins(enabledPinLayerKeys);
      if (postData.geometryType === GEOMETRY_TYPES.POINT) {
        const createdCoordinate = {
          latitude: storedLat,
          longitude: storedLng,
        };
        if (!isCoordinateWithinRegionBounds(createdCoordinate, region, 0)) {
          const targetRegion = {
            latitude: storedLat,
            longitude: storedLng,
            latitudeDelta: Math.min(region?.latitudeDelta || 0.02, 0.02),
            longitudeDelta: Math.min(region?.longitudeDelta || 0.02, 0.02),
          };
          setRegion(targetRegion);
          if (mapRef.current?.animateToRegion) {
            mapRef.current.animateToRegion(targetRegion, 320);
          }
        }
      }

      setDrawingCoords([]);
      setDrawingType(null);
      setPendingPostData(null);
      setIsPickingPostLocation(false);
      Alert.alert("Success", "Post created!");
    } catch (error) {
      console.error("Error creating post:", error);
      Alert.alert("Error", formatErrorMessage(error));
    }
  };

  const handleSearch = (query) => {
    Alert.alert("Search", `Searching for: ${query}`);
  };

  const openLayerPosts = async (layer) => {
    const pinLayerKey = getPinLayerKeyFromLayer(layer);
    setLayerPostsTarget({ ...layer, pinLayerKey });
    setLayerPostsModalVisible(true);
    setLayerPostsLoading(true);
    try {
      let rows = null;
      let lastError = null;

      const byExpression = await supabase
        .from("pins")
        .select("id,user_id,caption,content,author_name,created_at,layer,geometry")
        .eq("geometry->>layer_id", layer.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!byExpression.error) {
        rows = byExpression.data || [];
      } else {
        lastError = byExpression.error;
        const byContains = await supabase
          .from("pins")
          .select("id,user_id,caption,content,author_name,created_at,layer,geometry")
          .contains("geometry", { layer_id: layer.id })
          .order("created_at", { ascending: false })
          .limit(50);
        if (!byContains.error) {
          rows = byContains.data || [];
          lastError = null;
        } else {
          lastError = byContains.error;
        }
      }

      if (!rows && lastError) throw lastError;
      const exactLayerPosts = (rows || []).filter((post) => {
        if (isCloudOnlyPost(post)) return false;
        return String(post?.geometry?.layer_id || "") === String(layer.id || "");
      });
      setLayerPosts(exactLayerPosts);
    } catch (error) {
      console.error("Error loading layer posts:", error);
      setLayerPosts([]);
      Alert.alert("Error", "Failed to load posts for this layer.");
    } finally {
      setLayerPostsLoading(false);
    }
  };

  const loadPinComments = async (
    pinId,
    { preferCache = true, suppressState = false, backgroundRefresh = true } = {},
  ) => {
    if (!pinId) return [];

    const cached = pinCommentsCacheRef.current.get(pinId);
    if (cached && preferCache && !suppressState) {
      setPinComments(cached);
    }
    if (!suppressState && (!cached || !preferCache)) {
      setPinCommentsLoading(true);
    }

    const inFlight = pinCommentsRequestRef.current.get(pinId);
    if (inFlight) {
      if (cached && preferCache) {
        inFlight.catch(() => {});
        return cached;
      }
      return await inFlight;
    }

    const requestPromise = (async () => {
      try {
        const session = await getActiveSession();
        const activeUserId = session?.user?.id || currentUser?.id || null;
        let comments = null;
        let edgeError = null;

        if (session?.access_token && activeUserId) {
          const commentResult = await listPinCommentsViaEdgeFunction(
            pinId,
            session.access_token,
            session.refresh_token || null,
            activeUserId,
          );
          if (!commentResult.error) {
            const rawComments = Array.isArray(commentResult?.data?.comments)
              ? commentResult.data.comments
              : Array.isArray(commentResult?.data)
                ? commentResult.data
                : [];
            comments = rawComments
              .map((row) => normalizePinComment(row))
              .filter(Boolean);
          } else {
            edgeError = commentResult.error;
          }
        }

        if (!Array.isArray(comments)) {
          const reader = session?.access_token
            ? supabaseWithAccessToken(session.access_token)
            : supabase;
          const tableResult = await reader
            .from("pin_comments")
            .select("*")
            .eq("pin_id", pinId)
            .order("created_at", { ascending: true })
            .limit(200);
          if (tableResult.error) {
            if (edgeError) throw edgeError;
            throw tableResult.error;
          }

          const rows = Array.isArray(tableResult.data) ? tableResult.data : [];
          const userIds = Array.from(
            new Set(
              rows
                .map((row) => row?.user_id || row?.author_id)
                .filter(Boolean),
            ),
          );
          const profileByUserId = new Map();
          if (userIds.length > 0) {
            const profileResult = await supabase
              .from("profiles")
              .select("id,username,display_name,avatar_url")
              .in("id", userIds);
            if (profileResult.error) {
              if (edgeError) throw edgeError;
              throw profileResult.error;
            }
            (profileResult.data || []).forEach((profile) => {
              profileByUserId.set(profile.id, profile);
            });
          }

          comments = rows
            .map((row) => {
              const actorUserId = row?.user_id || row?.author_id || "";
              const profile = profileByUserId.get(actorUserId);
              return normalizePinComment({
                ...row,
                user_id: actorUserId,
                author_name: profile?.display_name || "Anonymous",
                author_username: profile?.username || "",
                author_avatar_url: profile?.avatar_url || null,
              });
            })
            .filter(Boolean);
        }

        pinCommentsCacheRef.current.set(pinId, comments);
        if (!suppressState && selectedPinIdRef.current === pinId) {
          setPinComments(comments);
        }
        return comments;
      } catch (error) {
        console.error("Error loading pin comments:", error);
        if (!suppressState && selectedPinIdRef.current === pinId && !cached) {
          setPinComments([]);
        }
        throw error;
      } finally {
        pinCommentsRequestRef.current.delete(pinId);
        if (!suppressState && selectedPinIdRef.current === pinId) {
          setPinCommentsLoading(false);
        }
      }
    })();

    pinCommentsRequestRef.current.set(pinId, requestPromise);

    if (cached && preferCache && backgroundRefresh) {
      requestPromise.catch(() => {});
      return cached;
    }
    return await requestPromise;
  };

  const loadPinVotes = async (
    pinId,
    { preferCache = true, suppressState = false, backgroundRefresh = true } = {},
  ) => {
    if (!pinId) return null;

    const cached = pinVoteSummaryCacheRef.current.get(pinId);
    if (cached && preferCache && !suppressState) {
      setPinVoteSummary(cached);
    }

    const inFlight = pinVoteRequestRef.current.get(pinId);
    if (inFlight) {
      if (cached && preferCache) {
        inFlight.catch(() => {});
        return cached;
      }
      return await inFlight;
    }

    const requestPromise = (async () => {
      try {
        const session = await getActiveSession();
        const activeUserId = session?.user?.id || currentUser?.id || null;
        const summaryResult = await getPinVoteSummaryViaEdgeFunction(
          pinId,
          session?.access_token || null,
          session?.refresh_token || null,
          activeUserId,
        );

        let summary = null;

        if (summaryResult.error) {
          // Local/dev fallback if edge function is unavailable.
          const authed = supabaseWithAccessToken(session?.access_token || null);
          const tableResult = await authed
            .from("pin_votes")
            .select("user_id, vote")
            .eq("pin_id", pinId);
          if (tableResult.error) throw summaryResult.error;

          summary = { upvotes: 0, downvotes: 0, userVote: 0 };
          (tableResult.data || []).forEach((voteRow) => {
            if (voteRow.vote === 1) summary.upvotes += 1;
            if (voteRow.vote === -1) summary.downvotes += 1;
            if (activeUserId && voteRow.user_id === activeUserId) {
              summary.userVote = voteRow.vote;
            }
          });
        } else {
          const summaryRow = Array.isArray(summaryResult.data)
            ? summaryResult.data[0]
            : summaryResult.data;
          summary = {
            upvotes: Number(summaryRow?.upvotes || 0),
            downvotes: Number(summaryRow?.downvotes || 0),
            userVote: Number(summaryRow?.user_vote || 0),
          };
        }

        pinVoteSummaryCacheRef.current.set(pinId, summary);
        if (!suppressState && selectedPinIdRef.current === pinId) {
          setPinVoteSummary(summary);
        }
        return summary;
      } catch (error) {
        console.error("Error loading pin votes:", error);
        if (!suppressState && selectedPinIdRef.current === pinId && !cached) {
          setPinVoteSummary({ upvotes: 0, downvotes: 0, userVote: 0 });
        }
        throw error;
      } finally {
        pinVoteRequestRef.current.delete(pinId);
      }
    })();

    pinVoteRequestRef.current.set(pinId, requestPromise);

    if (cached && preferCache && backgroundRefresh) {
      requestPromise.catch(() => {});
      return cached;
    }
    return await requestPromise;
  };

  const handlePinPress = (pin) => {
    selectedPinIdRef.current = pin.id;
    setSelectedPin(pin);
    const cached = pinVoteSummaryCacheRef.current.get(pin.id);
    const cachedComments = pinCommentsCacheRef.current.get(pin.id);
    setPinVoteSummary(
      cached || {
        upvotes: 0,
        downvotes: 0,
        userVote: 0,
      },
    );
    setPinComments(cachedComments || []);
    setPinCommentsLoading(!cachedComments);
    setDeletingCommentId(null);
    loadPinVotes(pin.id, {
      preferCache: true,
      suppressState: false,
      backgroundRefresh: true,
    }).catch(() => {});
    loadPinComments(pin.id, {
      preferCache: true,
      suppressState: false,
      backgroundRefresh: true,
    }).catch(() => {});
    loadPinAssociations(pin);
    setShowDetailModal(true);
  };

  useEffect(() => {
    if (!currentUser?.id || !Array.isArray(pins) || pins.length === 0) {
      if (votePrefetchTimerRef.current) {
        clearTimeout(votePrefetchTimerRef.current);
        votePrefetchTimerRef.current = null;
      }
      return;
    }

    if (votePrefetchTimerRef.current) {
      clearTimeout(votePrefetchTimerRef.current);
    }
    votePrefetchTimerRef.current = setTimeout(() => {
      const candidates = pins
        .slice(0, PIN_VOTE_PREFETCH_LIMIT)
        .map((pin) => pin?.id)
        .filter(
          (pinId) =>
            pinId &&
            !pinVoteSummaryCacheRef.current.has(pinId) &&
            !pinVoteRequestRef.current.has(pinId),
        );
      candidates.forEach((pinId) => {
        loadPinVotes(pinId, {
          preferCache: false,
          suppressState: true,
          backgroundRefresh: false,
        }).catch(() => {});
      });
    }, PIN_VOTE_PREFETCH_DELAY_MS);

    return () => {
      if (votePrefetchTimerRef.current) {
        clearTimeout(votePrefetchTimerRef.current);
        votePrefetchTimerRef.current = null;
      }
    };
  }, [pins, currentUser?.id]);

  const handleCloudPress = (cloud) => {
    setSelectedCloud(cloud);
    setCloudPostsModalVisible(true);
  };

  const handleCloudPostPress = (post) => {
    if (!post) return;

    setCloudPostsModalVisible(false);
    setSelectedCloud(null);

    const hasCoordinate =
      typeof post?.lat === "number" &&
      Number.isFinite(post.lat) &&
      typeof post?.lng === "number" &&
      Number.isFinite(post.lng);

    if (hasCoordinate) {
      const targetRegion = {
        latitude: post.lat,
        longitude: post.lng,
        latitudeDelta: Math.min(region?.latitudeDelta || 0.012, 0.012),
        longitudeDelta: Math.min(region?.longitudeDelta || 0.012, 0.012),
      };
      setRegion(targetRegion);
      if (mapRef.current?.animateToRegion) {
        mapRef.current.animateToRegion(targetRegion, 320);
      }
    }

    const selected = allLoadedPosts.find((item) => item.id === post.id) || post;
    setTimeout(() => {
      handlePinPress(selected);
    }, 180);
  };

  const handleRegionChangeComplete = useCallback((nextRegion) => {
    const normalizedRegion = {
      latitude: Number(nextRegion?.latitude),
      longitude: Number(nextRegion?.longitude),
      latitudeDelta: Number(nextRegion?.latitudeDelta),
      longitudeDelta: Number(nextRegion?.longitudeDelta),
    };
    if (
      !Number.isFinite(normalizedRegion.latitude) ||
      !Number.isFinite(normalizedRegion.longitude) ||
      !Number.isFinite(normalizedRegion.latitudeDelta) ||
      !Number.isFinite(normalizedRegion.longitudeDelta) ||
      normalizedRegion.latitudeDelta <= 0 ||
      normalizedRegion.longitudeDelta <= 0
    ) {
      return;
    }

    setRegion((prev) => {
      if (
        prev &&
        Math.abs((prev.latitude || 0) - normalizedRegion.latitude) < 1e-8 &&
        Math.abs((prev.longitude || 0) - normalizedRegion.longitude) < 1e-8 &&
        Math.abs((prev.latitudeDelta || 0) - normalizedRegion.latitudeDelta) <
          1e-8 &&
        Math.abs((prev.longitudeDelta || 0) - normalizedRegion.longitudeDelta) <
          1e-8
      ) {
        return prev;
      }
      return normalizedRegion;
    });
  }, []);

  const showArrowPinCallout = useCallback((pinId, attempt = 0) => {
    const marker = markerRefsByIdRef.current.get(pinId);
    if (marker?.showCallout) {
      marker.showCallout();
      lastArrowCalloutPinIdRef.current = pinId;
      return;
    }
    if (attempt >= 6) return;
    arrowCalloutTimerRef.current = setTimeout(() => {
      showArrowPinCallout(pinId, attempt + 1);
    }, 120);
  }, []);

  const handleArrowPinFocus = useCallback(
    (pin) => {
      const pinId = String(pin?.id || "");
      if (!pinId) return;

      setArrowFocusedPinId(pinId);

      const previousId = String(lastArrowCalloutPinIdRef.current || "");
      if (previousId && previousId !== pinId) {
        const previousMarker = markerRefsByIdRef.current.get(previousId);
        previousMarker?.hideCallout?.();
      }

      if (arrowCalloutTimerRef.current) {
        clearTimeout(arrowCalloutTimerRef.current);
        arrowCalloutTimerRef.current = null;
      }

      arrowCalloutTimerRef.current = setTimeout(() => {
        showArrowPinCallout(pinId, 0);
      }, 420);
    },
    [showArrowPinCallout],
  );

  const handleVotePin = async (vote) => {
    if (!selectedPin) return;

    const session = await getActiveSession();
    const userId = session?.user?.id || null;
    if (!userId || !session?.access_token) {
      Alert.alert("Sign In Required", "Please sign in to vote on pins");
      return;
    }
    if (selectedPin.user_id === userId) {
      Alert.alert("Not Allowed", "You cannot vote on your own pin.");
      return;
    }

    const previousSummary = {
      upvotes: Number(pinVoteSummary?.upvotes || 0),
      downvotes: Number(pinVoteSummary?.downvotes || 0),
      userVote: Number(pinVoteSummary?.userVote || 0),
    };
    const nextUserVote = previousSummary.userVote === vote ? 0 : vote;
    const optimisticSummary = {
      upvotes: previousSummary.upvotes,
      downvotes: previousSummary.downvotes,
      userVote: nextUserVote,
    };

    if (previousSummary.userVote === 1) {
      optimisticSummary.upvotes = Math.max(0, optimisticSummary.upvotes - 1);
    } else if (previousSummary.userVote === -1) {
      optimisticSummary.downvotes = Math.max(0, optimisticSummary.downvotes - 1);
    }
    if (nextUserVote === 1) {
      optimisticSummary.upvotes += 1;
    } else if (nextUserVote === -1) {
      optimisticSummary.downvotes += 1;
    }

    pinVoteSummaryCacheRef.current.set(selectedPin.id, optimisticSummary);
    setPinVoteSummary(optimisticSummary);

    try {
      setIsSubmittingVote(true);

      const toggleResult = await votePinViaEdgeFunction(
        selectedPin.id,
        vote,
        session.access_token,
        session.refresh_token || null,
        userId,
      );

      if (toggleResult.error) {
        throw toggleResult.error;
      }

      const summaryRow = Array.isArray(toggleResult.data)
        ? toggleResult.data[0]
        : toggleResult.data;
      if (summaryRow) {
        const confirmedSummary = {
          upvotes: Number(summaryRow?.upvotes || 0),
          downvotes: Number(summaryRow?.downvotes || 0),
          userVote: Number(summaryRow?.user_vote || 0),
        };
        pinVoteSummaryCacheRef.current.set(selectedPin.id, confirmedSummary);
        setPinVoteSummary(confirmedSummary);
      } else {
        loadPinVotes(selectedPin.id);
      }
    } catch (error) {
      pinVoteSummaryCacheRef.current.set(selectedPin.id, previousSummary);
      setPinVoteSummary(previousSummary);
      console.error("Error voting on pin:", error);
      const authRequired =
        error?.code === "42501" &&
        String(error?.message || "")
          .toLowerCase()
          .includes("authentication required");
      Alert.alert(
        "Error",
        authRequired
          ? "Your session token is missing or expired. Please sign out and sign back in."
          : error?.message || "Failed to submit vote. Please try again.",
      );
    } finally {
      setIsSubmittingVote(false);
    }
  };

  const handleAddPinComment = async (content, options = {}) => {
    if (!selectedPin?.id) return false;

    const pinId = selectedPin.id;
    const trimmedContent = String(content || "").trim();
    const parentCommentIdRaw = String(options?.parentCommentId || "").trim();
    const parentCommentId = parentCommentIdRaw
      ? isUuid(parentCommentIdRaw)
        ? parentCommentIdRaw
        : null
      : null;
    if (!trimmedContent) return false;
    if (trimmedContent.length > PIN_COMMENT_MAX_LENGTH) {
      Alert.alert(
        "Comment Too Long",
        `Comments are limited to ${PIN_COMMENT_MAX_LENGTH} characters.`,
      );
      return false;
    }
    if (parentCommentIdRaw && !parentCommentId) {
      Alert.alert("Error", "Invalid parent comment reference.");
      return false;
    }

    const session = await getActiveSession();
    const userId = session?.user?.id || null;
    if (!userId || !session?.access_token) {
      Alert.alert("Sign In Required", "Please sign in to add comments.");
      return false;
    }
    if (parentCommentId) {
      const existing = pinCommentsCacheRef.current.get(pinId) || pinComments || [];
      const parentComment = existing.find((comment) => comment?.id === parentCommentId);
      if (!parentComment) {
        Alert.alert(
          "Error",
          "The comment you are replying to no longer exists.",
        );
        return false;
      }
    }

    const optimisticComment = normalizePinComment({
      id: `temp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      pin_id: pinId,
      parent_comment_id: parentCommentId,
      user_id: userId,
      content: trimmedContent,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      author_name:
        session?.user?.user_metadata?.display_name ||
        currentUser?.user_metadata?.display_name ||
        "Anonymous",
      author_username:
        session?.user?.user_metadata?.username ||
        currentUser?.user_metadata?.username ||
        "",
      author_avatar_url:
        session?.user?.user_metadata?.avatar_url ||
        currentUser?.user_metadata?.avatar_url ||
        null,
    });
    if (!optimisticComment) return false;

    const previousComments = Array.isArray(pinCommentsCacheRef.current.get(pinId))
      ? pinCommentsCacheRef.current.get(pinId)
      : Array.isArray(pinComments)
        ? pinComments
        : [];
    const optimisticComments = [...previousComments, optimisticComment];
    pinCommentsCacheRef.current.set(pinId, optimisticComments);
    if (selectedPinIdRef.current === pinId) {
      setPinComments(optimisticComments);
    }

    try {
      setIsSubmittingComment(true);

      let confirmedComment = null;
      const createResult = await addPinCommentViaEdgeFunction(
        pinId,
        trimmedContent,
        session.access_token,
        session.refresh_token || null,
        userId,
        parentCommentId,
      );

      if (!createResult.error) {
        const rawComment = createResult?.data?.comment || createResult?.data;
        confirmedComment = normalizePinComment(rawComment);
      } else {
        const edgeErrorText = String(
          createResult?.error?.message || "",
        ).toLowerCase();
        const canFallbackToDirectInsert =
          createResult?.status === 404 ||
          createResult?.status === 405 ||
          edgeErrorText.includes("unsupported action") ||
          edgeErrorText.includes("edge function failed (404)") ||
          edgeErrorText.includes("edge function failed (405)") ||
          edgeErrorText.includes('null value in column "author_id"') ||
          edgeErrorText.includes('null value in column "user_id"') ||
          edgeErrorText.includes('null value in column "parent_comment_id"') ||
          edgeErrorText.includes('null value in column "text"') ||
          edgeErrorText.includes('null value in column "content"') ||
          edgeErrorText.includes('column "author_id"') ||
          edgeErrorText.includes('column "user_id"') ||
          edgeErrorText.includes('column "parent_comment_id"') ||
          edgeErrorText.includes('column "text"') ||
          edgeErrorText.includes('column "content"');
        if (!canFallbackToDirectInsert) {
          throw createResult.error;
        }

        const authed = supabaseWithAccessToken(session.access_token);
        const baseInsertVariants = [
          {
            pin_id: pinId,
            user_id: userId,
            author_id: userId,
            content: trimmedContent,
            text: trimmedContent,
          },
          {
            pin_id: pinId,
            user_id: userId,
            author_id: userId,
            content: trimmedContent,
          },
          {
            pin_id: pinId,
            user_id: userId,
            author_id: userId,
            text: trimmedContent,
          },
          { pin_id: pinId, user_id: userId, content: trimmedContent, text: trimmedContent },
          { pin_id: pinId, user_id: userId, content: trimmedContent },
          { pin_id: pinId, user_id: userId, text: trimmedContent },
          {
            pin_id: pinId,
            author_id: userId,
            content: trimmedContent,
            text: trimmedContent,
          },
          { pin_id: pinId, author_id: userId, content: trimmedContent },
          { pin_id: pinId, author_id: userId, text: trimmedContent },
        ];
        const insertVariants = parentCommentId
          ? baseInsertVariants.map((row) => ({
              ...row,
              parent_comment_id: parentCommentId,
            }))
          : baseInsertVariants;
        let insertResult = null;
        let insertError = null;
        for (const row of insertVariants) {
          const attempt = await authed
            .from("pin_comments")
            .insert([row])
            .select("*")
            .maybeSingle();
          if (!attempt.error && attempt.data) {
            insertResult = attempt;
            insertError = null;
            break;
          }
          insertError = attempt.error;
          const message = String(attempt?.error?.message || "").toLowerCase();
          const code = String(attempt?.error?.code || "");
          const isSchemaCompatibilityError =
            code === "42703" ||
            message.includes('column "user_id"') ||
            message.includes('column "author_id"') ||
            message.includes('column "parent_comment_id"') ||
            message.includes('column "text"') ||
            message.includes('column "content"') ||
            message.includes('null value in column "user_id"') ||
            message.includes('null value in column "author_id"') ||
            message.includes('null value in column "parent_comment_id"') ||
            message.includes('null value in column "text"') ||
            message.includes('null value in column "content"');
          if (!isSchemaCompatibilityError) {
            throw attempt.error;
          }
        }

        if (insertError) {
          const code = String(insertError?.code || "");
          if (code === "42501") {
            throw new Error(
              "Comment insert was blocked by row-level security. Deploy the latest `social-actions` edge function and run latest Supabase migrations.",
            );
          }
          throw insertError;
        }
        if (!insertResult?.data) {
          throw new Error("Comment insert returned no affected rows.");
        }

        confirmedComment = normalizePinComment({
          ...insertResult.data,
          parent_comment_id:
            insertResult.data?.parent_comment_id || parentCommentId || null,
          user_id:
            insertResult.data?.user_id || insertResult.data?.author_id || userId,
          author_name: optimisticComment.author_name,
          author_username: optimisticComment.author_username,
          author_avatar_url: optimisticComment.author_avatar_url,
        });
      }

      if (!confirmedComment) {
        throw new Error("Comment insert returned no affected rows.");
      }

      const nextComments = (pinCommentsCacheRef.current.get(pinId) || []).map(
        (item) => (item.id === optimisticComment.id ? confirmedComment : item),
      );
      pinCommentsCacheRef.current.set(pinId, nextComments);
      if (selectedPinIdRef.current === pinId) {
        setPinComments(nextComments);
      }
      return true;
    } catch (error) {
      const rollbackComments = (pinCommentsCacheRef.current.get(pinId) || []).filter(
        (item) => item.id !== optimisticComment.id,
      );
      pinCommentsCacheRef.current.set(pinId, rollbackComments);
      if (selectedPinIdRef.current === pinId) {
        setPinComments(rollbackComments);
      }
      console.error("Error adding pin comment:", error);
      Alert.alert("Error", formatErrorMessage(error));
      return false;
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleDeletePinComment = async (commentId) => {
    const normalizedCommentId = String(commentId || "");
    if (!isUuid(normalizedCommentId)) return false;
    if (!selectedPin?.id) return false;

    const pinId = selectedPin.id;
    const session = await getActiveSession();
    const userId = session?.user?.id || null;
    if (!userId || !session?.access_token) {
      Alert.alert("Sign In Required", "Please sign in to delete comments.");
      return false;
    }
    const isPinOwner = String(selectedPin?.user_id || "") === String(userId || "");

    const existing = pinCommentsCacheRef.current.get(pinId) || pinComments || [];
    const target = existing.find((comment) => comment?.id === normalizedCommentId);
    if (!target) {
      return false;
    }
    const isCommentOwner = String(target?.user_id || "") === String(userId || "");
    if (!isCommentOwner && !isPinOwner) {
      Alert.alert(
        "Not Allowed",
        "You can only delete your own comments or comments on your own pin.",
      );
      return false;
    }

    const threadCommentIds = collectCommentThreadIds(existing, normalizedCommentId);
    const optimisticComments = existing.filter(
      (comment) => !threadCommentIds.has(String(comment?.id || "")),
    );
    pinCommentsCacheRef.current.set(pinId, optimisticComments);
    if (selectedPinIdRef.current === pinId) {
      setPinComments(optimisticComments);
    }

    try {
      setDeletingCommentId(normalizedCommentId);
      const deleteResult = await deletePinCommentViaEdgeFunction(
        normalizedCommentId,
        session.access_token,
        session.refresh_token || null,
        userId,
      );
      if (deleteResult.error) {
        const edgeErrorText = String(
          deleteResult?.error?.message || "",
        ).toLowerCase();
        const canFallbackToDirectDelete =
          deleteResult?.status === 404 ||
          deleteResult?.status === 405 ||
          edgeErrorText.includes("unsupported action") ||
          edgeErrorText.includes("edge function failed (404)") ||
          edgeErrorText.includes("edge function failed (405)");
        if (!canFallbackToDirectDelete) {
          throw deleteResult.error;
        }

        let directAccessToken = session.access_token;
        const performDirectDelete = async () => {
          const authed = supabaseWithAccessToken(directAccessToken);
          return await authed
            .from("pin_comments")
            .delete()
            .eq("id", normalizedCommentId)
            .select("id")
            .maybeSingle();
        };

        let fallbackDelete = await performDirectDelete();
        if (!fallbackDelete.error && fallbackDelete.data?.id) {
          return true;
        }

        const {
          data: { session: refreshedSession },
          error: refreshError,
        } = await supabase.auth.refreshSession();
        if (!refreshError && refreshedSession?.access_token) {
          directAccessToken = refreshedSession.access_token;
          fallbackDelete = await performDirectDelete();
          if (!fallbackDelete.error && fallbackDelete.data?.id) {
            return true;
          }
        }

        if (fallbackDelete.error) {
          throw fallbackDelete.error;
        }

        const verifyRes = await supabaseWithAccessToken(directAccessToken)
          .from("pin_comments")
          .select("id,user_id,pin_id")
          .eq("id", normalizedCommentId)
          .maybeSingle();
        if (verifyRes.error) {
          throw verifyRes.error;
        }
        if (!verifyRes.data?.id) {
          return true;
        }
        const verifyCommentOwner =
          String(verifyRes.data.user_id || "") === String(userId || "");
        const verifyPinOwner =
          String(verifyRes.data.pin_id || "") === String(pinId || "") && isPinOwner;
        if (!verifyCommentOwner && !verifyPinOwner) {
          throw new Error(
            "You can only delete your own comments or comments on your own pin.",
          );
        }
        throw new Error(
          "Comment delete was blocked by backend policy. Run latest Supabase migrations and deploy the latest social-actions edge function.",
        );
      }

      return true;
    } catch (error) {
      pinCommentsCacheRef.current.set(pinId, existing);
      if (selectedPinIdRef.current === pinId) {
        setPinComments(existing);
      }
      console.error("Error deleting comment:", error);
      Alert.alert("Error", formatErrorMessage(error));
      return false;
    } finally {
      setDeletingCommentId((prev) =>
        prev === normalizedCommentId ? null : prev,
      );
    }
  };

  const handleUpdatePin = async (pinId, updates) => {
    try {
      const normalizedUpdates = { ...(updates || {}) };
      if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "layer")) {
        const nextLayer = String(normalizedUpdates.layer || "").toLowerCase();
        if (!["public", "friends", "private"].includes(nextLayer)) {
          Alert.alert("Error", "Invalid visibility option.");
          return;
        } else {
          normalizedUpdates.layer = nextLayer;
        }
      }

      let session = await getActiveSession();
      if (!session?.access_token) {
        try {
          const {
            data: { session: fallbackSession },
          } = await supabase.auth.getSession();
          session = fallbackSession || session;
        } catch (_) {
          // Ignore fallback session lookup errors.
        }
      }
      if (!session?.access_token) {
        Alert.alert("Sign In Required", "Please sign in to edit your posts.");
        return;
      }

      const authed = supabaseWithAccessToken(session.access_token);
      const { data: updatedPin, error } = await authed
        .from("pins")
        .update(normalizedUpdates)
        .eq("id", pinId)
        .select("*")
        .maybeSingle();

      if (error) throw error;
      const appliedUpdates = updatedPin || normalizedUpdates;

      setAllLoadedPosts((prev) =>
        prev.map((pin) => (pin.id === pinId ? { ...pin, ...appliedUpdates } : pin)),
      );
      setSelectedPin((prev) => (prev ? { ...prev, ...appliedUpdates } : null));
      if (selectedPinIdRef.current === pinId) {
        loadPinAssociations({
          ...(selectedPin || {}),
          id: pinId,
          ...appliedUpdates,
        });
      }

      if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "layer")) {
        await loadPins(enabledPinLayerKeys);
      }

      Alert.alert("Success", "Pin updated!");
    } catch (error) {
      console.error("Error updating pin:", error);
      Alert.alert("Error", formatErrorMessage(error));
    }
  };

  const handleDeletePin = async (pinId) => {
    const applyDeletedPinIds = (ids) => {
      const deletedIdSet = new Set(ids);
      setAllLoadedPosts((prev) =>
        prev.filter((pin) => !deletedIdSet.has(pin.id)),
      );
      ids.forEach((id) => {
        pinVoteSummaryCacheRef.current.delete(id);
        pinVoteRequestRef.current.delete(id);
        pinCommentsCacheRef.current.delete(id);
        pinCommentsRequestRef.current.delete(id);
      });
      setShowDetailModal(false);
      setSelectedPin(null);
      setPinComments([]);
      setPinCommentsLoading(false);
      setIsSubmittingComment(false);
      setDeletingCommentId(null);
    };

    const showDeleteResultAlert = (deletedCount, requestedCount) => {
      if (deletedCount < requestedCount) {
        Alert.alert(
          "Partially Deleted",
          `Deleted ${deletedCount} of ${requestedCount} linked pins.`,
        );
        return;
      }
      Alert.alert(
        "Success",
        deletedCount > 1
          ? `Post deleted across ${deletedCount} linked pins.`
          : "Pin deleted!",
      );
    };

    try {
      const session = await getActiveSession();
      const activeUserId = session?.user?.id || currentUser?.id || null;
      if (!activeUserId || !session?.access_token) {
        Alert.alert("Sign In Required", "Please sign in to delete posts.");
        return;
      }

      const edgeResult = await deletePinViaEdgeFunction(
        pinId,
        session.access_token,
        session.refresh_token || null,
        activeUserId,
      );
      if (!edgeResult.error) {
        const deletedIds = Array.isArray(edgeResult?.data?.deletedPinIds)
          ? edgeResult.data.deletedPinIds
              .map((id) => String(id || ""))
              .filter(Boolean)
          : [];
        const requestedCount = Math.max(
          deletedIds.length,
          Number(edgeResult?.data?.requestedCount || deletedIds.length),
        );
        if (deletedIds.length === 0) {
          Alert.alert(
            "Delete Not Applied",
            "Delete returned no affected rows. Please try again.",
          );
          return;
        }

        applyDeletedPinIds(deletedIds);
        showDeleteResultAlert(deletedIds.length, requestedCount);
        loadPins(enabledPinLayerKeys);
        return;
      }

      const edgeErrorText = String(edgeResult?.error?.message || "").toLowerCase();
      const canFallbackToDirectDelete =
        edgeResult?.status === 404 ||
        edgeResult?.status === 405 ||
        edgeErrorText.includes("unsupported action") ||
        edgeErrorText.includes("edge function failed (404)") ||
        edgeErrorText.includes("edge function failed (405)");
      if (!canFallbackToDirectDelete) {
        throw edgeResult.error;
      }

      const authed = supabaseWithAccessToken(session.access_token);

      const targetPin =
        allLoadedPosts.find((pin) => pin.id === pinId) ||
        (selectedPin?.id === pinId ? selectedPin : null);
      const groupId = targetPin?.geometry?.cross_post_group_id || null;
      let pinIdsToDelete = [pinId];

      if (groupId) {
        let relatedRows = null;
        const byExpression = await authed
          .from("pins")
          .select("id")
          .eq("geometry->>cross_post_group_id", groupId);

        if (!byExpression.error) {
          relatedRows = byExpression.data;
        } else {
          const byContains = await authed
            .from("pins")
            .select("id")
            .contains("geometry", { cross_post_group_id: groupId });
          if (!byContains.error) {
            relatedRows = byContains.data;
          } else {
            console.warn(
              "Group delete lookup failed; falling back to single pin delete:",
              formatErrorMessage(byContains.error),
            );
          }
        }

        if (Array.isArray(relatedRows) && relatedRows.length > 0) {
          pinIdsToDelete = Array.from(
            new Set(
              relatedRows
                .map((row) => row?.id)
                .filter((id) => typeof id === "string" && id.length > 0),
            ),
          );
        }
      }

      const { data: deletedRows, error } = await authed
        .from("pins")
        .delete()
        .in("id", pinIdsToDelete)
        .select("id");

      if (error) throw error;
      const deletedIds = (deletedRows || [])
        .map((row) => row?.id)
        .filter((id) => typeof id === "string" && id.length > 0);

      if (deletedIds.length === 0) {
        const { data: stillExists, error: verifyError } = await authed
          .from("pins")
          .select("id,user_id")
          .eq("id", pinId)
          .maybeSingle();
        if (verifyError) throw verifyError;

        if (stillExists?.id) {
          Alert.alert(
            "Delete Not Applied",
            stillExists.user_id && stillExists.user_id !== activeUserId
              ? "This post was not deleted because your account does not have permission to delete it."
              : "Delete returned no affected rows. Please try again.",
          );
        } else {
          Alert.alert("Delete Not Applied", "Post could not be deleted.");
        }
        return;
      }

      applyDeletedPinIds(deletedIds);
      showDeleteResultAlert(deletedIds.length, pinIdsToDelete.length);
      loadPins(enabledPinLayerKeys);
    } catch (error) {
      console.error("Error deleting pin:", error);
      Alert.alert("Error", formatErrorMessage(error));
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={region}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout || {};
          if (
            !Number.isFinite(width) ||
            !Number.isFinite(height) ||
            width <= 0 ||
            height <= 0
          ) {
            return;
          }
          setMapSize((prev) => {
            if (
              Math.abs((prev?.width || 0) - width) < 1 &&
              Math.abs((prev?.height || 0) - height) < 1
            ) {
              return prev;
            }
            return { width, height };
          });
        }}
        onRegionChangeComplete={handleRegionChangeComplete}
        mapType={mapType}
        customMapStyle={isDark ? MAP_DARK_STYLE : []}
        onPress={
          isDrawingMode || isPickingPostLocation ? handleMapPress : undefined
        }
        zoomEnabled
        scrollEnabled
        scrollDuringRotateOrZoomEnabled={true}
        rotateEnabled={false}
        pitchEnabled={false}
        moveOnMarkerPress={false}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {pins.map((pin) => (
          <CustomMarker
            key={pin.id}
            ref={(markerRef) => {
              if (markerRef) {
                markerRefsByIdRef.current.set(String(pin.id), markerRef);
              } else {
                markerRefsByIdRef.current.delete(String(pin.id));
              }
            }}
            pin={pin}
            onPress={handlePinPress}
          />
        ))}
        {clouds.map((cloud) => (
          <React.Fragment key={cloud.id}>
            <Circle
              center={cloud.center}
              radius={cloud.radiusMeters}
              strokeColor="rgba(129, 140, 248, 0.55)"
              fillColor="rgba(129, 140, 248, 0.16)"
              strokeWidth={2}
            />
            <Marker
              coordinate={cloud.center}
              onPress={() => handleCloudPress(cloud)}
              tracksViewChanges={false}
            >
              <View style={styles.cloudCountBadge}>
                <Text style={styles.cloudCountText}>
                  {cloud.badgeCount || cloud.count}
                </Text>
              </View>
            </Marker>
          </React.Fragment>
        ))}

        {isDrawingMode &&
          drawingCoords.length >= 2 &&
          drawingType === GEOMETRY_TYPES.LINE && (
            <Polyline
              coordinates={drawingCoords}
              strokeColor={COLORS.primary}
              strokeWidth={3}
            />
          )}
        {isDrawingMode &&
          drawingCoords.length >= 3 &&
          drawingType === GEOMETRY_TYPES.PLANE && (
            <Polygon
              coordinates={drawingCoords}
              strokeColor={COLORS.primary}
              fillColor="rgba(102, 126, 234, 0.2)"
              strokeWidth={2}
            />
          )}
      </MapView>

      {communityMapContext?.id && (
        <View style={styles.communityMapBanner}>
          <View style={styles.communityMapBannerLeft}>
            <Text style={styles.communityMapBannerTitle}>Community Map</Text>
            <Text style={styles.communityMapBannerSubtext}>
              {communityMapContext.name || "Selected community"}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.communityMapBannerBtn}
            onPress={clearCommunityMapContext}
          >
            <Text style={styles.communityMapBannerBtnText}>Exit</Text>
          </TouchableOpacity>
        </View>
      )}

      {isDrawingMode && (
        <View style={styles.drawingBar}>
          <Text style={styles.drawingBarText}>
            Tap map to add points ({drawingCoords.length} placed)
          </Text>
          <TouchableOpacity
            style={styles.drawingDoneBtn}
            onPress={() => {
              handleFinishDrawing();
              if (pendingPostData) {
                handlePostSubmit(pendingPostData);
              }
            }}
          >
            <Text style={styles.drawingDoneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {isPickingPostLocation && (
        <View style={styles.drawingBar}>
          <Text style={styles.drawingBarText}>
            Tap on the map where you want to place this post
          </Text>
          <TouchableOpacity
            style={styles.drawingDoneBtn}
            onPress={() => {
              setIsPickingPostLocation(false);
              setPendingPostData(null);
            }}
          >
            <Text style={styles.drawingDoneBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isDrawingMode && !isPickingPostLocation && (
        <ActionButtonCluster
          navigation={navigation}
          mapRef={mapRef}
          pins={pins}
          allPins={allLoadedPosts}
          layers={layers}
          selectedLayerId={selectedLayerId}
          layersLoading={layersLoading}
          onSelectLayer={setSelectedLayerId}
          onOpenLayerPosts={openLayerPosts}
          onToggleLayer={handleToggleLayer}
          onMoveLayer={handleMoveLayer}
          onRefreshLayers={() =>
            fetchAccessibleLayers(currentUser?.id, communityMapContext?.id)
          }
          onPostSubmit={handlePostSubmit}
          userLocation={userLocation}
          onSearch={handleSearch}
          mapMode={mapMode}
          onToggleMapMode={() =>
            setMapMode((prev) => (prev === "explore" ? "user" : "explore"))
          }
          onArrowPinFocus={handleArrowPinFocus}
        />
      )}

      <Modal
        visible={layerPostsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLayerPostsModalVisible(false)}
      >
        <View style={styles.postsOverlay}>
          <TouchableOpacity
            style={styles.postsBackdrop}
            activeOpacity={1}
            onPress={() => setLayerPostsModalVisible(false)}
          />
          <View style={styles.postsSheet}>
            <View style={styles.postsHeader}>
              <View>
                <Text style={styles.postsTitle}>
                  {layerPostsTarget?.name || "Layer"} Posts
                </Text>
                <Text style={styles.postsSubtitle}>
                  Mapped to {layerPostsTarget?.pinLayerKey || "public"}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setLayerPostsModalVisible(false)}
              >
                <Text style={styles.postsCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.postsList}>
              {layerPostsLoading ? (
                <Text style={styles.postsEmptyText}>Loading posts...</Text>
              ) : layerPosts.length === 0 ? (
                <Text style={styles.postsEmptyText}>
                  No posts in this layer yet.
                </Text>
              ) : (
                layerPosts.map((post) => (
                  <View key={post.id} style={styles.postRow}>
                    <Text style={styles.postTitle}>
                      {post.caption || "Untitled"}
                    </Text>
                    <Text style={styles.postMeta}>
                      {post.author_name || "Anonymous"} •{" "}
                      {new Date(post.created_at).toLocaleString()}
                    </Text>
                    {post.content ? (
                      <Text style={styles.postContent} numberOfLines={3}>
                        {post.content}
                      </Text>
                    ) : null}
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={cloudPostsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setCloudPostsModalVisible(false);
          setSelectedCloud(null);
        }}
      >
        <View style={styles.postsOverlay}>
          <TouchableOpacity
            style={styles.postsBackdrop}
            activeOpacity={1}
            onPress={() => {
              setCloudPostsModalVisible(false);
              setSelectedCloud(null);
            }}
          />
          <View style={styles.postsSheet}>
            <View style={styles.postsHeader}>
              <View>
                <Text style={styles.postsTitle}>Cloud Posts</Text>
                <Text style={styles.postsSubtitle}>
                  {selectedCloud?.count || 0} posts in this area
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setCloudPostsModalVisible(false);
                  setSelectedCloud(null);
                }}
              >
                <Text style={styles.postsCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.postsList}>
              {selectedCloud?.posts?.length ? (
                selectedCloud.posts.map((post) => {
                  const privacyProtected = isCloudOnlyPost(post);
                  const authorUsername = String(
                    post?.author_username || "",
                  ).trim();
                  const fallbackHandle = String(
                    post?.author_name || "anonymous",
                  )
                    .trim()
                    .replace(/\s+/g, "")
                    .toLowerCase();
                  const authorHandle = authorUsername
                    ? `@${authorUsername}`
                    : `@${fallbackHandle || "anonymous"}`;
                  return (
                    <TouchableOpacity
                      key={post.id}
                      style={styles.postRow}
                      activeOpacity={0.85}
                      onPress={() => handleCloudPostPress(post)}
                    >
                      <View style={styles.cloudPostHeaderRow}>
                        <Text style={styles.postTitle}>
                          {post.caption || "Untitled"}
                        </Text>
                        <Text
                          style={[
                            styles.cloudPrivacyBadge,
                            privacyProtected
                              ? styles.cloudPrivacyBadgePrivate
                              : styles.cloudPrivacyBadgePinned,
                          ]}
                        >
                          {privacyProtected ? "Privacy Protected" : "Pinned"}
                        </Text>
                      </View>
                      <Text style={styles.cloudPostAuthor}>{authorHandle}</Text>
                      {post.content ? (
                        <Text style={styles.postContent} numberOfLines={4}>
                          {post.content}
                        </Text>
                      ) : null}
                      <Text style={styles.postMeta}>
                        {new Date(post.created_at).toLocaleString()}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              ) : (
                <Text style={styles.postsEmptyText}>
                  No posts in this cloud yet.
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <PinDetailModal
        visible={showDetailModal}
        pin={selectedPin}
        currentUserId={currentUser?.id}
        isAdmin={isAdmin}
        pinVoteSummary={pinVoteSummary}
        isSubmittingVote={isSubmittingVote}
        pinComments={pinComments}
        isLoadingComments={pinCommentsLoading}
        isSubmittingComment={isSubmittingComment}
        deletingCommentId={deletingCommentId}
        associatedLayers={selectedPinLayers}
        onVote={handleVotePin}
        onAddComment={handleAddPinComment}
        onDeleteComment={handleDeletePinComment}
        onClose={() => {
          selectedPinIdRef.current = null;
          setShowDetailModal(false);
          setSelectedPin(null);
          setSelectedPinLayers([]);
          setPinVoteSummary({ upvotes: 0, downvotes: 0, userVote: 0 });
          setPinComments([]);
          setPinCommentsLoading(false);
          setIsSubmittingComment(false);
          setDeletingCommentId(null);
        }}
        onUpdate={handleUpdatePin}
        onDelete={handleDeletePin}
      />
    </View>
  );
};

const createStyles = (palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.background,
    },
    map: {
      flex: 1,
    },
    communityMapBanner: {
      position: "absolute",
      top: 52,
      right: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: palette.surface,
      borderColor: palette.border,
      borderWidth: 1,
      borderRadius: SIZES.radiusLg,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    communityMapBannerLeft: {
      maxWidth: 150,
    },
    communityMapBannerTitle: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "800",
    },
    communityMapBannerSubtext: {
      color: palette.subtext,
      fontSize: 11,
      fontWeight: "600",
      marginTop: 1,
    },
    communityMapBannerBtn: {
      backgroundColor: palette.mutedSurface,
      borderRadius: SIZES.radius,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    communityMapBannerBtnText: {
      color: palette.text,
      fontSize: 11,
      fontWeight: "700",
    },
    drawingBar: {
      position: "absolute",
      top: 120,
      left: 20,
      right: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: palette.surface,
      borderRadius: SIZES.radiusLg,
      paddingHorizontal: 16,
      paddingVertical: 12,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 6,
      elevation: 5,
    },
    drawingBarText: {
      fontSize: 14,
      fontWeight: "600",
      color: palette.text,
      flex: 1,
    },
    drawingDoneBtn: {
      backgroundColor: palette.primary,
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderRadius: SIZES.radius,
      marginLeft: 12,
    },
    drawingDoneBtnText: {
      color: palette.onPrimary,
      fontSize: 14,
      fontWeight: "700",
    },
    cloudCountBadge: {
      minWidth: 36,
      height: 36,
      borderRadius: 18,
      paddingHorizontal: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(17, 24, 39, 0.9)",
      borderWidth: 2,
      borderColor: "rgba(129, 140, 248, 0.9)",
    },
    cloudCountText: {
      color: "#eef2ff",
      fontSize: 14,
      fontWeight: "800",
    },
    postsOverlay: {
      flex: 1,
      justifyContent: "flex-end",
    },
    postsBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    postsSheet: {
      backgroundColor: palette.surface,
      borderTopLeftRadius: SIZES.radiusXl,
      borderTopRightRadius: SIZES.radiusXl,
      borderTopWidth: 1,
      borderTopColor: palette.border,
      maxHeight: "75%",
      paddingBottom: 10,
    },
    postsHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    postsTitle: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "800",
    },
    postsSubtitle: {
      color: palette.subtext,
      fontSize: 12,
      fontWeight: "600",
      marginTop: 2,
    },
    postsCloseText: {
      color: palette.primary,
      fontSize: 13,
      fontWeight: "700",
    },
    postsList: {
      paddingHorizontal: 16,
      paddingTop: 10,
    },
    postsEmptyText: {
      color: palette.subtext,
      fontSize: 13,
      textAlign: "center",
      marginTop: 20,
      marginBottom: 20,
    },
    postRow: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      backgroundColor: palette.mutedSurface,
      padding: 10,
      marginBottom: 8,
    },
    postTitle: {
      color: palette.text,
      fontSize: 14,
      fontWeight: "700",
    },
    cloudPostHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      marginBottom: 4,
    },
    cloudPrivacyBadge: {
      borderRadius: SIZES.radiusFull,
      paddingHorizontal: 10,
      paddingVertical: 4,
      fontSize: 10,
      fontWeight: "800",
      overflow: "hidden",
    },
    cloudPrivacyBadgePrivate: {
      color: "#fde68a",
      backgroundColor: "rgba(180, 83, 9, 0.32)",
    },
    cloudPrivacyBadgePinned: {
      color: "#bfdbfe",
      backgroundColor: "rgba(30, 64, 175, 0.32)",
    },
    cloudPostAuthor: {
      color: palette.primary,
      fontSize: 12,
      fontWeight: "700",
      marginBottom: 4,
    },
    postMeta: {
      color: palette.subtext,
      fontSize: 11,
      fontWeight: "600",
      marginTop: 6,
      marginBottom: 4,
    },
    postContent: {
      color: palette.text,
      fontSize: 12,
      lineHeight: 17,
    },
  });

export default MapScreen;
