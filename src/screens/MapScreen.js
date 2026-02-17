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
const CLUSTER_VIEWPORT_PADDING_PX = 64;
const PIN_VIEWPORT_PADDING_RATIO = 1.2;
const DEFAULT_MAP_SIZE = { width: 390, height: 780 };
const PIN_VOTE_PREFETCH_LIMIT = 6;
const PIN_VOTE_PREFETCH_DELAY_MS = 180;
const ERROR_LOG_COOLDOWN_MS = 120000;
const ERROR_ALERT_COOLDOWN_MS = 15000;
const NETWORK_BACKOFF_MS = 20000;
const MAP_POSTS_CACHE_KEY = "map_posts_cache_v1";
const PIN_COMMENT_MAX_LENGTH = 500;
const LAYER_TRACE_ENABLED =
  __DEV__ && Boolean(globalThis?.__VENT_LAYER_TRACE__ === true);
const REGION_LAT_LNG_EPS = 0.00008;
const REGION_DELTA_EPS = 0.00008;
const REGION_UPDATE_MIN_INTERVAL_MS = 90;

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

const computeMapVisuals = (posts, mapRegion, mapSize) => {
  const normalizedPosts = Array.isArray(posts) ? posts : [];
  const viewportPosts = normalizedPosts.filter(
    (post) =>
      hasValidCoordinate(post) &&
      isCoordinateWithinRegionBounds(
        { latitude: post.lat, longitude: post.lng },
        mapRegion,
        PIN_VIEWPORT_PADDING_RATIO,
      ),
  );

  const baseClusters = buildCloudsFromPosts(viewportPosts, mapRegion, mapSize);
  const clusters = mergeNearbyClouds(baseClusters, mapRegion, mapSize);

  const visibleClouds = [];
  const clusteredPinnedIds = new Set();
  const clusteredPostIds = new Set();

  clusters.forEach((cloud) => {
    const pinnedCount = cloud.count - cloud.privacyCount;
    const hasPrivacyPosts = cloud.privacyCount > 0;
    const cloudScreenPoint = toScreenPoint(cloud.center, mapRegion, mapSize);
    const isCloudCenterVisible = isScreenPointWithinClusterViewport(
      cloudScreenPoint,
      mapSize,
      0,
    );
    const shouldShowCloud =
      isCloudCenterVisible &&
      (hasPrivacyPosts || pinnedCount >= CLOUD_MIN_POST_COUNT);
    const shouldHidePinnedPosts =
      isCloudCenterVisible && pinnedCount >= CLOUD_MIN_POST_COUNT;

    if (!shouldShowCloud && !shouldHidePinnedPosts) return;
    (cloud.posts || []).forEach((post) => {
      if (post?.id) {
        clusteredPostIds.add(post.id);
      }
    });
    const badgeCount = pinnedCount > 0 ? pinnedCount : cloud.count;
    if (shouldShowCloud) {
      visibleClouds.push({ ...cloud, badgeCount });
    }

    if (shouldHidePinnedPosts) {
      cloud.posts.forEach((post) => {
        if (!isCloudOnlyPost(post)) {
          clusteredPinnedIds.add(post.id);
        }
      });
    }
  });

  // Cloud-only posts must always surface as a cloud, even when isolated.
  viewportPosts
    .filter((post) => isCloudOnlyPost(post) && !clusteredPostIds.has(post.id))
    .forEach((post) => {
      const cloudCenter = { latitude: post.lat, longitude: post.lng };
      const cloudScreenPoint = toScreenPoint(cloudCenter, mapRegion, mapSize);
      if (!isScreenPointWithinClusterViewport(cloudScreenPoint, mapSize, 0)) {
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

  const visiblePins = viewportPosts.filter(
    (post) =>
      hasValidCoordinate(post) &&
      !isCloudOnlyPost(post) &&
      !clusteredPinnedIds.has(post.id),
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
  const layersRef = useRef([]);
  const allLoadedPostsRef = useRef([]);
  const pinsLoadRequestRef = useRef(0);
  const isLayerTogglePendingRef = useRef(false);
  const layerTraceCounterRef = useRef(0);
  const refreshLayersInFlightRef = useRef(null);
  const lastRegionUpdateAtRef = useRef(0);

  const layerTrace = useCallback((event, payload = null) => {
    if (!LAYER_TRACE_ENABLED) return;
    const seq = ++layerTraceCounterRef.current;
    if (payload && typeof payload === "object") {
      console.log(`[LayerTrace #${seq}] ${event}`, payload);
      return;
    }
    if (payload !== null && payload !== undefined) {
      console.log(`[LayerTrace #${seq}] ${event}`, payload);
      return;
    }
    console.log(`[LayerTrace #${seq}] ${event}`);
  }, []);

  useEffect(() => {
    selectedPinIdRef.current = selectedPin?.id || null;
  }, [selectedPin?.id]);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    allLoadedPostsRef.current = allLoadedPosts;
  }, [allLoadedPosts]);

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
    if (allLoadedPostsRef.current.length > 0) return;
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
  }, []);

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

    let session = await getActiveSession();
    if (!session?.user?.id) {
      try {
        const {
          data: { session: fallbackSession },
        } = await supabase.auth.getSession();
        session = fallbackSession || null;
      } catch (_) {
        session = null;
      }
    }
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
    if (mapMode === "explore") {
      const keys = Array.from(
        new Set([
          "public",
          ...layers
            .filter((layer) => layer.isEnabled)
            .map((layer) => getPinLayerKeyFromLayer(layer)),
        ]),
      );
      return keys.length > 0 ? keys : ["public"];
    }

    const keys = Array.from(
      new Set(
        layers
          .filter((layer) => layer.isEnabled)
          .map((layer) => getPinLayerKeyFromLayer(layer)),
      ),
    );
    return keys;
  }, [layers, mapMode]);

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
          let effectiveUserId = userId || null;
          let readClient = supabase;
          let sessionUser = null;
          if (effectiveUserId) {
            let session = await getActiveSession();
            if (!session?.user?.id) {
              try {
                const {
                  data: { session: fallbackSession },
                } = await supabase.auth.getSession();
                session = fallbackSession || null;
              } catch (_) {
                session = null;
              }
            }

            const accessToken = session?.access_token || null;
            const sessionUserId = session?.user?.id || null;
            sessionUser = session?.user || null;
            if (sessionUserId) {
              effectiveUserId = sessionUserId;
              if (currentUser?.id !== sessionUserId) {
                setCurrentUser(session.user);
              }
            }
            if (accessToken) {
              readClient = supabaseWithAccessToken(accessToken);
            }
          }

          const previousLayerById = new Map(
            (layersRef.current || []).map((layer) => [layer.id, layer]),
          );

        const [allLayersRes, membershipsRes, prefsRes] = await Promise.all([
          readClient
            .from("layers")
            .select(
              "id,name,kind,owner_type,owner_id,is_public,enabled,created_at",
            ),
          effectiveUserId
            ? readClient
                .from("community_members")
                .select("community_id,role,status")
                .eq("user_id", effectiveUserId)
            : Promise.resolve({ data: [], error: null }),
          effectiveUserId
            ? readClient
                .from("user_layer_prefs")
                .select("layer_id,hidden,sort_order")
                .eq("user_id", effectiveUserId)
            : Promise.resolve({ data: [], error: null }),
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
        ).filter(
          (row) => row.status === "active" || row.status === "accepted",
        );
        const activeCommunityIds = [
          ...new Set([
            ...activeMemberships.map((row) => row.community_id),
            ...(communityId ? [communityId] : []),
          ]),
        ];

        let communityLayerLinks = [];
        if (activeCommunityIds.length > 0) {
          const communityLayersRes = await readClient
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
          applyFallbackLayers(effectiveUserId);
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
          const communitiesRes = await readClient
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
          const isForcedEnabled = forcedCommunityLayerIds.has(layer.id);
          const previousLayer = previousLayerById.get(layer.id);
          const fallbackEnabled =
            typeof previousLayer?.isEnabled === "boolean"
              ? previousLayer.isEnabled
              : isDbEnabled && (ownerType === "system" || ownerType === "user");
          const isEnabled = isForcedEnabled
            ? true
            : hasPref
              ? !prefHidden
              : fallbackEnabled;

          const ownerCommunity = layer.owner_id
            ? communitiesMap.get(layer.owner_id)
            : null;

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
            isForcedEnabled,
            pref_sort_order: prefSortOrder,
            ownerCommunityName: ownerCommunity?.name || null,
            sourceCommunityIds: layerCommunitiesMap.get(layer.id) || [],
          };
        });

        const nonPrivateLayers = mappedLayers.filter(
          (layer) => getPinLayerKeyFromLayer(layer) !== "private",
        );

        const ownUserLayersOnly = nonPrivateLayers.filter((layer) => {
          if (!(layer.owner_type === "user" && layer.kind === "user_posts")) {
            return true;
          }

          if (!effectiveUserId) return false;
          if (userPostingLayerId && layer.id === userPostingLayerId)
            return true;

          const expectedName = makeUserPostingLayerName(
            sessionUser || currentUser || { id: effectiveUserId },
          ).toLowerCase();
          const expectedLegacyName = `user-${String(effectiveUserId)}-posts`.toLowerCase();
          const lowerName = String(layer.name || "").toLowerCase();
          return lowerName === expectedName || lowerName === expectedLegacyName;
        });

        const withCoreSystemLayers = ensureCoreSystemLayers(
          ownUserLayersOnly,
          effectiveUserId,
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
          applyFallbackLayers(userId);
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
      currentUser?.id,
      warnWithThrottle,
      userPostingLayerId,
    ],
  );

  const refreshAccessibleLayers = useCallback(async () => {
    if (refreshLayersInFlightRef.current) {
      layerTrace("refreshAccessibleLayers:join-inflight");
      return refreshLayersInFlightRef.current;
    }

    const startedAt = Date.now();
    layerTrace("refreshAccessibleLayers:start", {
      communityId: communityMapContext?.id || null,
      currentUserId: currentUser?.id || null,
    });

    const run = (async () => {
      const resolvedUserId = await resolveCurrentUserId();
      const result = await fetchAccessibleLayers(
        resolvedUserId,
        communityMapContext?.id,
      );
      layerTrace("refreshAccessibleLayers:end", {
        tookMs: Date.now() - startedAt,
        resolvedUserId: resolvedUserId || null,
        layerCount: layersRef.current?.length || 0,
      });
      return result;
    })();

    refreshLayersInFlightRef.current = run;
    try {
      return await run;
    } finally {
      if (refreshLayersInFlightRef.current === run) {
        refreshLayersInFlightRef.current = null;
      }
    }
  }, [
    communityMapContext?.id,
    currentUser?.id,
    fetchAccessibleLayers,
    layerTrace,
    resolveCurrentUserId,
  ]);

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
    refreshAccessibleLayers();
  }, [refreshAccessibleLayers]);

  useEffect(() => {
    const hasFallbackOnly =
      !Array.isArray(layers) ||
      layers.length === 0 ||
      layers.every((layer) => String(layer?.id || "").startsWith("fallback-"));
    if (!hasFallbackOnly) return undefined;

    const timer = setInterval(() => {
      if (isNetworkBackoffActive()) return;
      refreshAccessibleLayers();
    }, 12000);

    return () => clearInterval(timer);
  }, [
    refreshAccessibleLayers,
    isNetworkBackoffActive,
    layers,
  ]);

  useEffect(() => {
    const loadFriendIds = async () => {
      if (!currentUser?.id) {
        setFriendUserIds([]);
        layerTrace("friendIds:skip-no-current-user");
        return;
      }
      try {
        const startedAt = Date.now();
        let viewerId = currentUser.id;
        let reader = supabase;

        let session = await getActiveSession();
        if (!session?.user?.id) {
          try {
            const {
              data: { session: fallbackSession },
            } = await supabase.auth.getSession();
            session = fallbackSession || null;
          } catch (_) {
            session = null;
          }
        }
        if (session?.user?.id) {
          viewerId = session.user.id;
          if (currentUser?.id !== session.user.id) {
            setCurrentUser(session.user);
          }
        }
        if (session?.access_token) {
          reader = supabaseWithAccessToken(session.access_token);
        }

        const { data, error } = await reader
          .from("friends")
          .select("user_id,friend_id,status")
          .or(`user_id.eq.${viewerId},friend_id.eq.${viewerId}`)
          .eq("status", "accepted");
        if (error) throw error;

        const ids = Array.from(
          new Set(
            (data || []).map((row) =>
              row.user_id === viewerId ? row.friend_id : row.user_id,
            ),
          ),
        );
        setFriendUserIds(ids);
        layerTrace("friendIds:loaded", {
          viewerId,
          count: ids.length,
          tookMs: Date.now() - startedAt,
        });
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
        layerTrace("friendIds:error", formatErrorMessage(error));
        setFriendUserIds([]);
      }
    };

    loadFriendIds();
  }, [
    activateNetworkBackoff,
    currentUser?.id,
    layerTrace,
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
        .select("id,name")
        .eq("owner_type", "user")
        .eq("kind", "user_posts")
        .eq("name", layerName)
        .maybeSingle();

      if (existingRes.error) throw existingRes.error;
      if (existingRes.data?.id) {
        setUserPostingLayerId(existingRes.data.id);
        return existingRes.data.id;
      }

      const legacyRes = await supabase
        .from("layers")
        .select("id,name")
        .eq("owner_type", "user")
        .eq("kind", "user_posts")
        .eq("name", legacyLayerName)
        .maybeSingle();
      if (legacyRes.error) throw legacyRes.error;
      if (legacyRes.data?.id) {
        const { error: renameError } = await supabase
          .from("layers")
          .update({ name: layerName })
          .eq("id", legacyRes.data.id);
        if (renameError) {
          // If policy blocks rename, continue using the legacy row id.
          console.warn("Legacy user layer rename skipped:", renameError);
          setUserPostingLayerId(legacyRes.data.id);
          return legacyRes.data.id;
        }
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
      refreshAccessibleLayers();
    });
  }, [
    currentUser?.id,
    ensureUserPostingLayer,
    refreshAccessibleLayers,
  ]);

  useFocusEffect(
    useCallback(() => {
      refreshAccessibleLayers();
    }, [refreshAccessibleLayers]),
  );

  const clearCommunityMapContext = () => {
    setCommunityMapContext(null);
    if (route?.params?.communityMap) {
      navigation.setParams({ communityMap: undefined });
    }
  };

  useEffect(() => {
    if (enabledPinLayerKeys.length === 0) {
      setMapVisuals((prev) =>
        prev.pins.length === 0 && prev.clouds.length === 0
          ? prev
          : { pins: [], clouds: [] },
      );
      setAllLoadedPosts((prev) => (prev.length === 0 ? prev : []));
      return undefined;
    }

    loadPins(enabledPinLayerKeys);
    const unsubscribe = subscribeToPins(enabledPinLayerKeys);
    return unsubscribe;
  }, [enabledPinLayerKeys]);

  useEffect(() => {
    if (enabledPinLayerKeys.length === 0) {
      setMapVisuals((prev) =>
        prev.pins.length === 0 && prev.clouds.length === 0
          ? prev
          : { pins: [], clouds: [] },
      );
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      const { visiblePins, visibleClouds } = computeMapVisuals(
        allLoadedPosts,
        region,
        mapSize,
      );
      setMapVisuals((prev) => {
        const samePins = haveSameEntityIds(prev.pins, visiblePins);
        const sameClouds = haveSameEntityIds(prev.clouds, visibleClouds);
        if (samePins && sameClouds) return prev;
        return { pins: visiblePins, clouds: visibleClouds };
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [allLoadedPosts, enabledPinLayerKeys.length, mapSize, region]);

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
      layerTrace("loadPins:skip-empty-keys");
      return;
    }

    const requestId = ++pinsLoadRequestRef.current;
    const startedAt = Date.now();
    layerTrace("loadPins:start", {
      requestId,
      pinLayerKeys,
      enabledLayerIds: (layers || [])
        .filter((layer) => layer.isEnabled)
        .map((layer) => layer.id),
      enabledLayerNames: (layers || [])
        .filter((layer) => layer.isEnabled)
        .map((layer) => layer.display_name || layer.name),
    });

    try {
      const hasFallbackLayers =
        Array.isArray(layers) && layers.some((layer) => isFallbackLayer(layer));
      const friendsLayerEnabled = layers.some(
        (layer) =>
          layer.isEnabled && getPinLayerKeyFromLayer(layer) === "friends",
      );
      const enabledLayers = layers.filter((layer) => layer.isEnabled);
      const enabledLayerIds = new Set(enabledLayers.map((layer) => layer.id));
      const userPostingLayerEnabled = enabledLayers.some((layer) =>
        isUserPostingLayer(layer),
      );
      const enabledSystemPinLayerSet = new Set(
        enabledLayers
          .filter((layer) => (layer.owner_type || "system") === "system")
          .map((layer) => getPinLayerKeyFromLayer(layer)),
      );
      const onlyOwnUserLayerEnabled =
        enabledLayers.length === 1 && isUserPostingLayer(enabledLayers[0]);
      const queryLayerKeys = userPostingLayerEnabled
        ? Array.from(new Set([...(pinLayerKeys || []), "public", "friends"]))
        : pinLayerKeys;
      let readAccessToken = null;
      let readRefreshToken = null;
      let readActorUserId = currentUser?.id || null;
      let pinsFromEdge = false;
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
          pinsFromEdge = true;
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
      const activeViewerUserId = readActorUserId || currentUser?.id || null;
      const friendUserIdSet = new Set(
        (friendUserIds || []).map((id) => String(id || "")).filter(Boolean),
      );
      const filtered = (data || []).filter((pin) => {
        const pinLayer = String(pin?.layer || "").toLowerCase();
        const postLayerId = String(pin?.geometry?.layer_id || "");
        const authorUserId = String(
          pin?.geometry?.author_user_id || pin?.user_id || "",
        );
        const pinUserId = String(pin?.user_id || "");

        // "My Posts" should always include your own authored posts, regardless
        // of the post's target layer_id.
        if (
          userPostingLayerEnabled &&
          activeViewerUserId &&
          authorUserId === activeViewerUserId
        ) {
          return true;
        }

        // Friends layer shows posts authored by accepted friends, regardless of
        // whether those posts are in public/friends target layers.
        if (friendsLayerEnabled && pinUserId && friendUserIdSet.has(pinUserId)) {
          return true;
        }

        // Prefer explicit layer-id mapping whenever present.
        if (postLayerId && !hasFallbackLayers) {
          return enabledLayerIds.has(postLayerId);
        }

        if (pinLayer === "friends") {
          if (onlyOwnUserLayerEnabled) {
            return pinUserId === activeViewerUserId;
          }
          if (!friendsLayerEnabled) return false;
          if (!pinUserId) return false;

          // Friends layer should show accepted friends only (not self).
          if (friendUserIdSet.has(pinUserId)) return true;

          // If friend list is still hydrating, trust edge-filtered payload as a
          // temporary fallback while still excluding self rows.
          if (
            friendUserIdSet.size === 0 &&
            pinsFromEdge &&
            activeViewerUserId &&
            pinUserId !== activeViewerUserId
          ) {
            return true;
          }

          return false;
        }

        if (pinLayer === "public") {
          if (mapMode === "explore") return true;
          return enabledSystemPinLayerSet.has("public");
        }

        return enabledSystemPinLayerSet.has(pinLayer);
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

        const existingLayerId = existing?.geometry?.layer_id;
        const currentLayerId = pin?.geometry?.layer_id;
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
          return {
            ...pin,
            lat: Number.isFinite(numericLat) ? numericLat : pin?.lat,
            lng: Number.isFinite(numericLng) ? numericLng : pin?.lng,
            author_avatar_url:
              profileByUserId.get(pin.user_id)?.avatar_url ||
              (pin.user_id === currentUser?.id
                ? currentUser?.user_metadata?.avatar_url || null
                : null),
            author_username:
              pin.author_username ||
              profileByUserId.get(pin.user_id)?.username ||
              "",
            layer_emoji: pin?.geometry?.layer_id
              ? layerIconById.get(pin.geometry.layer_id) || null
              : null,
          };
        })
        .filter(hasValidCoordinate);
      if (requestId !== pinsLoadRequestRef.current) {
        layerTrace("loadPins:stale-discarded", { requestId });
        return;
      }
      setAllLoadedPosts(withLayerIcon);
      layerTrace("loadPins:done", {
        requestId,
        fetchedCount: Array.isArray(data) ? data.length : 0,
        filteredCount: filtered.length,
        dedupedCount: deduped.length,
        finalCount: withLayerIcon.length,
        tookMs: Date.now() - startedAt,
      });
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
        layerTrace("loadPins:network-fallback", {
          requestId,
          tookMs: Date.now() - startedAt,
          error: formatErrorMessage(error),
        });
        return;
      }
      logErrorWithThrottle("pins-load", "Error loading pins:", error);
      layerTrace("loadPins:error", {
        requestId,
        tookMs: Date.now() - startedAt,
        error: formatErrorMessage(error),
      });
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
    if (isLayerTogglePendingRef.current) {
      layerTrace("toggleLayer:ignored-while-pending", { layerId, nextEnabled });
      return;
    }
    isLayerTogglePendingRef.current = true;
    const startedAt = Date.now();
    layerTrace("toggleLayer:start", { layerId, nextEnabled });
    const targetLayer = layers.find((layer) => layer.id === layerId) || null;
    if (targetLayer?.isForcedEnabled && !nextEnabled && communityMapContext?.id) {
      Alert.alert(
        "Layer Required",
        "This layer is pinned while viewing this community map.",
      );
      isLayerTogglePendingRef.current = false;
      layerTrace("toggleLayer:blocked-forced-layer", { layerId });
      return;
    }

    const userId = await resolveCurrentUserId();
    if (!userId) {
      Alert.alert("Sign In Required", "Please sign in to manage your layers.");
      isLayerTogglePendingRef.current = false;
      layerTrace("toggleLayer:blocked-no-user", { layerId });
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
      let session = await getActiveSession();
      if (!session?.user?.id) {
        try {
          const {
            data: { session: fallbackSession },
          } = await supabase.auth.getSession();
          session = fallbackSession || null;
        } catch (_) {
          session = null;
        }
      }
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
      layerTrace("toggleLayer:success", {
        layerId,
        nextEnabled,
        tookMs: Date.now() - startedAt,
      });
    } catch (error) {
      setLayers(previousLayers);
      setSelectedLayerId(previousSelectedLayerId);
      console.error("Error updating layer preference:", error);
      layerTrace("toggleLayer:error", {
        layerId,
        nextEnabled,
        tookMs: Date.now() - startedAt,
        error: formatErrorMessage(error),
      });
      Alert.alert("Error", "Failed to sync layer preference to Supabase.");
    } finally {
      isLayerTogglePendingRef.current = false;
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

    if (
      postData.postVisibilityMode !== "cloud_only" &&
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
      const postVisibilityMode =
        postData.postVisibilityMode === "cloud_only" ? "cloud_only" : "pinned";
      const privacyRadiusMeters = Math.max(
        100,
        Math.min(1000, Number(postData.privacyRadiusMeters || 250)),
      );
      const randomizedCoordinate =
        postVisibilityMode === "cloud_only"
          ? getRandomCoordinateWithinRadius(baseLat, baseLng, privacyRadiusMeters)
          : { latitude: baseLat, longitude: baseLng };
      const storedLat = randomizedCoordinate.latitude;
      const storedLng = randomizedCoordinate.longitude;
      const requestedLayerIds = Array.isArray(postData.layerIds)
        ? postData.layerIds
        : [];
      const baseAudience =
        postData?.baseAudience === "public" ? "public" : "friends";
      const basePublicLayerId =
        typeof postData?.basePublicLayerId === "string"
          ? postData.basePublicLayerId
          : null;
      const baseFriendsLayerId =
        typeof postData?.baseFriendsLayerId === "string"
          ? postData.baseFriendsLayerId
          : null;
      const postableLayerRows = layers.filter((layer) => {
        const pinLayerKey = getPinLayerKeyFromLayer(layer);
        return (
          layer.owner_type !== "user" &&
          ["public", "friends"].includes(pinLayerKey)
        );
      });
      const postableLayerIdSet = new Set(postableLayerRows.map((layer) => layer.id));
      const resolvedPublicBaseLayerId =
        baseAudience === "public"
          ? basePublicLayerId && postableLayerIdSet.has(basePublicLayerId)
            ? basePublicLayerId
            : postableLayerRows.find(
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
                    getPinLayerKeyFromLayer(layer) === "friends",
                )?.id || null
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
      const baseLayerIds =
        baseAudience === "public"
          ? [
              resolvedPublicBaseLayerId,
              // Product rule: public posts are also in friends.
              resolvedFriendsBaseLayerId,
            ].filter(Boolean)
          : [resolvedFriendsBaseLayerId];
      const extraLayerIds = requestedLayerIds.filter(
        (layerId) =>
          postableLayerIdSet.has(layerId) && !baseLayerIds.includes(layerId),
      );
      const targetLayerIds = [...new Set([...baseLayerIds, ...extraLayerIds])];

      const layerMap = new Map(layers.map((layer) => [layer.id, layer]));
      const crossPostGroupId =
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

      const insertRows = targetLayerIds.map((targetLayerId) => {
        const targetLayer =
          layerMap.get(targetLayerId) ||
          (targetLayerId === authorLayerId
            ? { kind: "user_posts", owner_type: "user", name: "My Posts" }
            : null);
        const rawPinLayerKey = getPinLayerKeyFromLayer(targetLayer || null);
        const postPinLayerKey =
          rawPinLayerKey === "friends" ? "friends" : "public";

        let geometry;
        if (postVisibilityMode === "cloud_only") {
          geometry = {
            type: "Point",
            coordinates: [storedLng, storedLat],
            layer_id: targetLayerId,
            author_layer_id: authorLayerId,
            author_user_id: activeUserId,
            cross_post_group_id: crossPostGroupId,
            visibility_mode: "cloud_only",
            privacy_radius_m: privacyRadiusMeters,
          };
        } else if (postData.geometryType === GEOMETRY_TYPES.POINT) {
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
      if (
        postVisibilityMode !== "cloud_only" &&
        postData.geometryType === GEOMETRY_TYPES.POINT
      ) {
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
      const { data, error } = await supabase
        .from("pins")
        .select("id,user_id,caption,content,author_name,created_at,layer,geometry")
        .eq("layer", pinLayerKey)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      const exactLayerPosts = (data || []).filter((post) => {
        if (isCloudOnlyPost(post)) return false;

        const ownerType = layer?.owner_type || "system";
        const isSystemCoreLayer =
          ownerType === "system" &&
          ["public", "friends"].includes(pinLayerKey);
        if (isSystemCoreLayer) {
          return post?.layer === pinLayerKey;
        }

        if (post?.geometry?.layer_id) {
          return post.geometry.layer_id === layer.id;
        }
        return false;
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
    const now = Date.now();
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
      if (!prev) {
        lastRegionUpdateAtRef.current = now;
        return normalizedRegion;
      }

      const latDiff = Math.abs((prev.latitude || 0) - normalizedRegion.latitude);
      const lngDiff = Math.abs((prev.longitude || 0) - normalizedRegion.longitude);
      const latDeltaDiff = Math.abs(
        (prev.latitudeDelta || 0) - normalizedRegion.latitudeDelta,
      );
      const lngDeltaDiff = Math.abs(
        (prev.longitudeDelta || 0) - normalizedRegion.longitudeDelta,
      );

      const sameEnough =
        latDiff < REGION_LAT_LNG_EPS &&
        lngDiff < REGION_LAT_LNG_EPS &&
        latDeltaDiff < REGION_DELTA_EPS &&
        lngDeltaDiff < REGION_DELTA_EPS;
      if (sameEnough) {
        return prev;
      }

      const updatedTooRecently =
        now - lastRegionUpdateAtRef.current < REGION_UPDATE_MIN_INTERVAL_MS;
      const smallMove =
        latDiff < REGION_LAT_LNG_EPS * 4 &&
        lngDiff < REGION_LAT_LNG_EPS * 4 &&
        latDeltaDiff < REGION_DELTA_EPS * 4 &&
        lngDeltaDiff < REGION_DELTA_EPS * 4;
      if (updatedTooRecently && smallMove) {
        return prev;
      }

      lastRegionUpdateAtRef.current = now;

      if (
        prev &&
        latDiff < REGION_LAT_LNG_EPS &&
        lngDiff < REGION_LAT_LNG_EPS &&
        latDeltaDiff < REGION_DELTA_EPS &&
        lngDeltaDiff < REGION_DELTA_EPS
      ) {
        return prev;
      }
      return normalizedRegion;
    });
  }, []);

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
        if (nextLayer === "private") {
          normalizedUpdates.layer = "friends";
        } else if (!["public", "friends"].includes(nextLayer)) {
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
          <CustomMarker key={pin.id} pin={pin} onPress={handlePinPress} />
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
          layers={layers}
          selectedLayerId={selectedLayerId}
          layersLoading={layersLoading}
          onSelectLayer={setSelectedLayerId}
          onOpenLayerPosts={openLayerPosts}
          onToggleLayer={handleToggleLayer}
          onMoveLayer={handleMoveLayer}
          onRefreshLayers={refreshAccessibleLayers}
          onPostSubmit={handlePostSubmit}
          userLocation={userLocation}
          onSearch={handleSearch}
          mapMode={mapMode}
          onToggleMapMode={() =>
            setMapMode((prev) => (prev === "explore" ? "user" : "explore"))
          }
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
