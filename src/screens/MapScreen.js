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
  Platform,
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
  ensureUserPostingLayerViaEdgeFunction,
  fetchFriendListsViaEdgeFunction,
  fetchMyCommunityMembershipsViaEdgeFunction,
  fetchMyLayerPrefsViaEdgeFunction,
  getPinVoteSummaryViaEdgeFunction,
  listPinCommentsViaEdgeFunction,
  setLayerOrderViaEdgeFunction,
  setLayerPreferenceViaEdgeFunction,
  supabase,
  getCurrentUser,
  getActiveSession,
  uploadPostMediaToStorage,
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
  formatLayerDisplayName,
  getUserPostsLayerSlug,
  isNamedUserPostsLayer,
  getPinLayerKeyFromLayer,
  resolveNextSelectedLayerId,
  sortLayers,
} from "../utils/layers";
import { parseLayerKindMetadata } from "../utils/layerKind";
import {
  computeMapVisuals,
  getCloudVisualSignature,
  getPinVisualSignature,
  haveSameEntitySignatures,
  isCloudOnlyPost,
} from "./map/mapVisualEngine";
import {
  buildFallbackLayers,
  getEnabledAudienceKeysForMap,
  ensureCoreSystemLayers,
  getEnabledLayerIdsForMap,
  isUuid,
  shouldKeepPinsWhenNoUuidLayers,
  toNormalizedLayerIdKey,
} from "./map/layerRuntime";
import { resolvePinsForMap } from "./map/pinFeedResolver";
import { readRemovedLayerIds, setLayerRemovedState } from "../utils/removedLayerIds";

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
const normalizeLayerIdentityToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
const DEFAULT_MAP_SIZE = { width: 390, height: 780 };
const PIN_VOTE_PREFETCH_LIMIT = 6;
const PIN_VOTE_PREFETCH_DELAY_MS = 180;
const ERROR_LOG_COOLDOWN_MS = 120000;
const ERROR_ALERT_COOLDOWN_MS = 15000;
const NETWORK_BACKOFF_MS = 20000;
const MAP_POSTS_CACHE_KEY = "map_posts_cache_v1";
const PIN_COMMENT_MAX_LENGTH = 500;
const PIN_VIEWPORT_PADDING_RATIO = 0.1;
const LAYER_TRACE_ENABLED = false;
const COMMUNITY_MAP_TRACE_ENABLED = false;
const DRAW_POINT_MIN_DISTANCE_METERS = 6;
const DRAW_SIMPLIFY_TOLERANCE_METERS = 9;
const DRAW_MAX_LINE_POINTS = 80;
const DRAW_MAX_PLANE_POINTS = 60;
const DRAW_SINGLE_TOUCH_GESTURE_BUFFER_MS = 120;
const PLANE_EDGE_INSERT_THRESHOLD_METERS = 24;
const PLANE_CORNER_MERGE_THRESHOLD_METERS = 14;
const PLANE_CORNER_MERGE_HOLD_MS = 550;
const PLANE_RECT_DRAG_END_DEBOUNCE_MS = 140;

const normalizeAudienceKeys = (audienceKeys) =>
  Array.from(
    new Set(
      (Array.isArray(audienceKeys) ? audienceKeys : [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort();

const buildLayerRequestKey = (layerIds, audienceKeys) =>
  `${toNormalizedLayerIdKey(layerIds)}::${normalizeAudienceKeys(audienceKeys).join("|")}`;

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

const getLineMidpointCoordinate = (coords) => {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (coords.length === 1) return coords[0];

  const segments = [];
  let totalDistance = 0;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const start = coords[i];
    const end = coords[i + 1];
    const distance = haversineMeters(start, end);
    if (!Number.isFinite(distance) || distance <= 0) continue;
    segments.push({ start, end, distance });
    totalDistance += distance;
  }
  if (totalDistance <= 0 || segments.length === 0) {
    return coords[Math.floor(coords.length / 2)] || coords[0];
  }

  const halfway = totalDistance / 2;
  let traversed = 0;
  for (const segment of segments) {
    if (traversed + segment.distance >= halfway) {
      const ratio = (halfway - traversed) / segment.distance;
      return {
        latitude:
          segment.start.latitude +
          (segment.end.latitude - segment.start.latitude) * ratio,
        longitude:
          segment.start.longitude +
          (segment.end.longitude - segment.start.longitude) * ratio,
      };
    }
    traversed += segment.distance;
  }

  return coords[coords.length - 1];
};

const getPolygonCenterCoordinate = (coords) => {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  const valid = coords.filter(
    (coord) =>
      Number.isFinite(coord?.latitude) && Number.isFinite(coord?.longitude),
  );
  if (valid.length === 0) return null;
  const sum = valid.reduce(
    (acc, coord) => ({
      latitude: acc.latitude + coord.latitude,
      longitude: acc.longitude + coord.longitude,
    }),
    { latitude: 0, longitude: 0 },
  );
  return {
    latitude: sum.latitude / valid.length,
    longitude: sum.longitude / valid.length,
  };
};

const douglasPeucker = (points, epsilonMeters) => {
  if (!Array.isArray(points) || points.length <= 2) {
    return Array.isArray(points) ? points : [];
  }

  let maxDistance = 0;
  let splitIndex = -1;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = distancePointToSegmentMeters(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = i;
    }
  }

  if (splitIndex >= 0 && maxDistance > epsilonMeters) {
    const left = douglasPeucker(points.slice(0, splitIndex + 1), epsilonMeters);
    const right = douglasPeucker(points.slice(splitIndex), epsilonMeters);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
};

const downsampleCoordinates = (coords, maxPoints, isClosed = false) => {
  if (!Array.isArray(coords) || coords.length <= maxPoints) {
    return Array.isArray(coords) ? coords : [];
  }
  if (!Number.isFinite(maxPoints) || maxPoints < 2) return coords;

  if (!isClosed) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    const interior = coords.slice(1, -1);
    const keepInterior = Math.max(0, maxPoints - 2);
    if (interior.length <= keepInterior) return coords;
    const step = interior.length / keepInterior;
    const sampled = [];
    for (let i = 0; i < keepInterior; i += 1) {
      sampled.push(interior[Math.floor(i * step)]);
    }
    return [first, ...sampled, last];
  }

  const step = coords.length / maxPoints;
  const sampled = [];
  for (let i = 0; i < maxPoints; i += 1) {
    sampled.push(coords[Math.floor(i * step)]);
  }
  return sampled;
};

const simplifyLineCoordinates = (coords) => {
  if (!Array.isArray(coords) || coords.length < 2) return [];
  const simplified = douglasPeucker(coords, DRAW_SIMPLIFY_TOLERANCE_METERS);
  return downsampleCoordinates(simplified, DRAW_MAX_LINE_POINTS, false);
};

const getPlaneOuterBoundary = (coords) => {
  if (!Array.isArray(coords) || coords.length < 3) {
    return Array.isArray(coords) ? coords : [];
  }
  const points = coords
    .filter(
      (coord) =>
        Number.isFinite(coord?.latitude) && Number.isFinite(coord?.longitude),
    )
    .map((coord) => ({
      latitude: coord.latitude,
      longitude: coord.longitude,
    }));
  if (points.length < 3) return points;

  const unique = [];
  const seen = new Set();
  for (const point of points) {
    const key = `${point.longitude.toFixed(7)}:${point.latitude.toFixed(7)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(point);
  }
  if (unique.length < 3) return unique;

  const sorted = [...unique].sort((a, b) => {
    if (a.longitude === b.longitude) return a.latitude - b.latitude;
    return a.longitude - b.longitude;
  });
  const cross = (o, a, b) =>
    (a.longitude - o.longitude) * (b.latitude - o.latitude) -
    (a.latitude - o.latitude) * (b.longitude - o.longitude);

  const lower = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.length >= 3 ? hull : unique;
};

const simplifyPlaneCoordinates = (coords) => {
  if (!Array.isArray(coords) || coords.length < 3) return [];
  const outerBoundary = getPlaneOuterBoundary(coords);
  if (!Array.isArray(outerBoundary) || outerBoundary.length < 3) return [];
  const closed = [...outerBoundary, outerBoundary[0]];
  const simplifiedClosed = douglasPeucker(closed, DRAW_SIMPLIFY_TOLERANCE_METERS);
  const opened = simplifiedClosed.slice(0, -1);
  if (opened.length < 3) {
    return downsampleCoordinates(outerBoundary, DRAW_MAX_PLANE_POINTS, true);
  }
  return downsampleCoordinates(opened, DRAW_MAX_PLANE_POINTS, true);
};

const buildRectangleFromDiagonal = (anchor, target) => {
  if (
    !Number.isFinite(anchor?.latitude) ||
    !Number.isFinite(anchor?.longitude) ||
    !Number.isFinite(target?.latitude) ||
    !Number.isFinite(target?.longitude)
  ) {
    return [];
  }

  const minLat = Math.min(anchor.latitude, target.latitude);
  const maxLat = Math.max(anchor.latitude, target.latitude);
  const minLng = Math.min(anchor.longitude, target.longitude);
  const maxLng = Math.max(anchor.longitude, target.longitude);

  return [
    { latitude: maxLat, longitude: minLng },
    { latitude: maxLat, longitude: maxLng },
    { latitude: minLat, longitude: maxLng },
    { latitude: minLat, longitude: minLng },
  ];
};

const distancePointToSegmentMeters = (point, start, end) => {
  if (
    !point ||
    !start ||
    !end ||
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    !Number.isFinite(start.latitude) ||
    !Number.isFinite(start.longitude) ||
    !Number.isFinite(end.latitude) ||
    !Number.isFinite(end.longitude)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const originLat = (point.latitude + start.latitude + end.latitude) / 3;
  const metersPerDegLat = 111320;
  const metersPerDegLng = metersPerDegLat * Math.cos(toRadians(originLat));
  if (!Number.isFinite(metersPerDegLng) || Math.abs(metersPerDegLng) < 1e-8) {
    return Number.POSITIVE_INFINITY;
  }

  const px = point.longitude * metersPerDegLng;
  const py = point.latitude * metersPerDegLat;
  const ax = start.longitude * metersPerDegLng;
  const ay = start.latitude * metersPerDegLat;
  const bx = end.longitude * metersPerDegLng;
  const by = end.latitude * metersPerDegLat;

  const abx = bx - ax;
  const aby = by - ay;
  const abLenSq = abx * abx + aby * aby;
  if (!Number.isFinite(abLenSq) || abLenSq <= 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const apx = px - ax;
  const apy = py - ay;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;
  return Math.hypot(px - closestX, py - closestY);
};

const findNearestPlaneEdgeIndex = (coords, point, thresholdMeters) => {
  if (!Array.isArray(coords) || coords.length < 2) return -1;

  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < coords.length; i += 1) {
    const start = coords[i];
    const end = coords[(i + 1) % coords.length];
    const distance = distancePointToSegmentMeters(point, start, end);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestDistance <= thresholdMeters ? bestIndex : -1;
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

const isFiniteLngLatPair = (value) =>
  Array.isArray(value) &&
  value.length >= 2 &&
  Number.isFinite(Number(value[0])) &&
  Number.isFinite(Number(value[1]));
const toMapCoordinate = (value) => ({
  longitude: Number(value[0]),
  latitude: Number(value[1]),
});
const getPersistedShapeGeometry = (pin) => {
  const geometry = pin?.geometry;
  if (!geometry || typeof geometry !== "object") return null;
  const type = String(geometry.type || "").toLowerCase();
  const coordinates = geometry.coordinates;

  if (type === "linestring" && Array.isArray(coordinates)) {
    const parsed = coordinates
      .filter(isFiniteLngLatPair)
      .map(toMapCoordinate);
    if (parsed.length >= 2) {
      return { kind: "line", coordinates: parsed };
    }
    return null;
  }

  if (type === "polygon" && Array.isArray(coordinates) && Array.isArray(coordinates[0])) {
    const outerRing = coordinates[0];
    const parsed = outerRing
      .filter(isFiniteLngLatPair)
      .map(toMapCoordinate);
    if (parsed.length >= 3) {
      return { kind: "plane", coordinates: parsed };
    }
  }

  return null;
};
const isRlsPolicyError = (error) =>
  error?.code === "42501" ||
  String(error?.message || "")
    .toLowerCase()
    .includes("row-level security policy");

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

const logLayerTrace = (label, payload = null) => {
  if (!LAYER_TRACE_ENABLED) return;
  if (payload === null) {
    console.log(`[LayerTrace] ${label}`);
    return;
  }
  console.log(`[LayerTrace] ${label}`, payload);
};

const logCommunityMapTrace = (label, payload = null) => {
  if (!COMMUNITY_MAP_TRACE_ENABLED) return;
  if (payload === null) {
    console.log(`[CommunityMapTrace] ${label}`);
    return;
  }
  console.log(`[CommunityMapTrace] ${label}`, payload);
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

const toGuestPublicOnlyLayers = (layerRows) => {
  const source = Array.isArray(layerRows) ? layerRows : [];
  const publicSystemLayers = source.filter((layer) => {
    const ownerType = layer?.owner_type || "system";
    if (ownerType !== "system") return false;
    return getPinLayerKeyFromLayer(layer) === "public";
  });

  const preferredPublicLayer =
    publicSystemLayers.find(
      (layer) => String(layer?.name || "").trim().toLowerCase() === "public",
    ) || publicSystemLayers[0];

  const fallbackPublicLayer = buildFallbackLayers(null)[0] || null;
  const selected = preferredPublicLayer || fallbackPublicLayer;
  if (!selected) return [];

  return [
    {
      ...selected,
      isEnabled: true,
      enabled: true,
      viewerCanManage: true,
    },
  ];
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

const MapScreen = ({ navigation, route }) => {
  const { isDark, palette } = useAppTheme();
  const styles = createStyles(palette);
  const mapProvider = Platform.OS === "android" ? PROVIDER_GOOGLE : undefined;
  const appleMapInterfaceStyle = isDark ? "dark" : "light";

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
  const [userLocation, setUserLocation] = useState(null);

  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [isPickingPostLocation, setIsPickingPostLocation] = useState(false);
  const [drawingCoords, setDrawingCoords] = useState([]);
  const [isMapMultiTouchActive, setIsMapMultiTouchActive] = useState(false);
  const [drawingType, setDrawingType] = useState(null);
  const [pendingPostData, setPendingPostData] = useState(null);
  const [communityMapContext, setCommunityMapContext] = useState(null);
  const [layerPostsModalVisible, setLayerPostsModalVisible] = useState(false);
  const [layerPostsTarget, setLayerPostsTarget] = useState(null);
  const [layerPosts, setLayerPosts] = useState([]);
  const [layerPostsLoading, setLayerPostsLoading] = useState(false);
  const [userPostingLayerId, setUserPostingLayerId] = useState(null);
  const [selectedPinLayers, setSelectedPinLayers] = useState([]);
  const [allLoadedPosts, setAllLoadedPosts] = useState([]);
  const [arrowFocusedPinId, setArrowFocusedPinId] = useState(null);
  const [cloudPostsModalVisible, setCloudPostsModalVisible] = useState(false);
  const [selectedCloud, setSelectedCloud] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mapSize, setMapSize] = useState(DEFAULT_MAP_SIZE);
  const pins = mapVisuals.pins;
  const clouds = mapVisuals.clouds;
  const persistedShapes = useMemo(
    () =>
      allLoadedPosts
        .filter((pin) => !isCloudOnlyPost(pin))
        .map((pin) => {
          const shape = getPersistedShapeGeometry(pin);
          if (!shape) return null;
          if (
            hasValidCoordinate(pin) &&
            !isCoordinateWithinRegionBounds(
              { latitude: pin.lat, longitude: pin.lng },
              region,
              PIN_VIEWPORT_PADDING_RATIO,
            )
          ) {
            return null;
          }
          return {
            id: String(pin.id || ""),
            kind: shape.kind,
            coordinates: shape.coordinates,
            pin,
          };
        })
        .filter((shape) => shape && shape.id && shape.pin),
    [allLoadedPosts, region],
  );

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
  const initialAppOpenRefreshDoneRef = useRef(false);
  const lastCommunityMapRefreshIdRef = useRef(null);
  const pinLoadRequestSeqRef = useRef(0);
  const latestEnabledLayerKeyRef = useRef("");
  const allLoadedPostsRef = useRef([]);
  const localFallbackEnabledByAudienceRef = useRef(new Map());

  useEffect(() => {
    allLoadedPostsRef.current = allLoadedPosts;
  }, [allLoadedPosts]);
  useEffect(() => {
    const nextFallbackState = new Map(localFallbackEnabledByAudienceRef.current);
    (Array.isArray(layers) ? layers : []).forEach((layer) => {
      if (isUuid(String(layer?.id || ""))) return;
      if ((layer?.owner_type || "system") !== "system") return;
      const key = getPinLayerKeyFromLayer(layer);
      if (!["public", "friends"].includes(key)) return;
      nextFallbackState.set(key, Boolean(layer?.isEnabled));
    });
    localFallbackEnabledByAudienceRef.current = nextFallbackState;
  }, [layers]);
  const planeRectAnchorRef = useRef(null);
  const planeRectStopTimerRef = useRef(null);
  const planeMergeHoldTimerRef = useRef(null);
  const planeMergeTargetRef = useRef(null);
  const activeMapTouchCountRef = useRef(0);
  const multiTouchGestureLockedRef = useRef(false);
  const suppressDrawUntilRef = useRef(0);
  const regionGestureSuppressUntilRef = useRef(0);
  const singleTouchDrawReadyAtRef = useRef(0);
  const drawingCoordsRef = useRef([]);
  const activeLineStrokeStartIndexRef = useRef(null);
  const lineStrokeStartIndicesRef = useRef([]);
  const activePlaneStrokeStartIndexRef = useRef(null);
  const planeStrokeStartIndicesRef = useRef([]);

  useEffect(() => {
    selectedPinIdRef.current = selectedPin?.id || null;
  }, [selectedPin?.id]);
  useEffect(() => {
    drawingCoordsRef.current = Array.isArray(drawingCoords) ? drawingCoords : [];
  }, [drawingCoords]);

  useEffect(() => {
    return () => {
      if (arrowCalloutTimerRef.current) {
        clearTimeout(arrowCalloutTimerRef.current);
        arrowCalloutTimerRef.current = null;
      }
    };
  }, []);
  useEffect(
    () => () => {
      if (planeRectStopTimerRef.current) {
        clearTimeout(planeRectStopTimerRef.current);
        planeRectStopTimerRef.current = null;
      }
      if (planeMergeHoldTimerRef.current) {
        clearTimeout(planeMergeHoldTimerRef.current);
        planeMergeHoldTimerRef.current = null;
      }
    },
    [],
  );

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
    return fallback;
  }, []);

  const restoreCachedPosts = useCallback(async () => {
    if ((allLoadedPostsRef.current || []).length > 0) return;
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

  const enabledPinLayerKeys = useMemo(() => getEnabledLayerIdsForMap(layers), [layers]);
  const enabledAudienceKeys = useMemo(
    () => getEnabledAudienceKeysForMap(layers),
    [layers],
  );

  const fetchAccessibleLayers = useCallback(
    async (userId, communityId) => {
      if (isNetworkBackoffActive()) {
        return applyFallbackLayers(userId);
      }

      const effectiveCommunityId =
        communityId ||
        communityMapContext?.id ||
        route?.params?.communityMap?.id ||
        null;
      const requestKey = `${userId || "guest"}:${effectiveCommunityId || "none"}`;
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
        const resolvedDisplayName = String(
          session?.user?.user_metadata?.display_name ||
            currentUser?.user_metadata?.display_name ||
            currentUser?.user_metadata?.username ||
            "",
        ).trim();
        const expectedUserLayerName = session?.user
          ? makeUserPostingLayerName(session.user).toLowerCase()
          : null;
        const expectedLegacyUserLayerName = resolvedUserId
          ? `user-${resolvedUserId}-posts`
          : null;
        const accessToken = session?.access_token || null;
        const refreshToken = session?.refresh_token || null;
        const actorUserId = session?.user?.id || resolvedUserId || null;
        const friendLayerIdentityTokens = new Set(
          [resolvedUserId, resolvedUsername]
            .map((value) => normalizeLayerIdentityToken(value))
            .filter(Boolean),
        );

        if (resolvedUserId && actorUserId) {
          const authedReader = accessToken
            ? supabaseWithAccessToken(accessToken)
            : supabase;
          let acceptedFriendIds = [];
          let acceptedFriendUsernames = [];
          let directFriendLookupFailed = false;
          const acceptedFriendsRes = await authedReader
            .from("friends")
            .select("user_id,friend_id,status")
            .or(`user_id.eq.${actorUserId},friend_id.eq.${actorUserId}`)
            .in("status", ["accepted", "active"]);
          if (acceptedFriendsRes.error) {
            directFriendLookupFailed = true;
            warnWithThrottle(
              "layers-friends",
              "Friend relationship lookup unavailable, trying edge fallback:",
              formatErrorMessage(acceptedFriendsRes.error),
            );
          } else {
            acceptedFriendIds = (acceptedFriendsRes.data || [])
              .map((row) =>
                row.user_id === actorUserId ? row.friend_id : row.user_id,
              )
              .filter(Boolean)
              .filter((id) => id !== actorUserId);
          }

          if (directFriendLookupFailed && accessToken) {
            const friendListsRes = await fetchFriendListsViaEdgeFunction(
              accessToken,
              refreshToken,
              actorUserId,
            );
            if (!friendListsRes?.error) {
              const acceptedFriends = Array.isArray(friendListsRes?.data?.friends)
                ? friendListsRes.data.friends
                : [];
              acceptedFriendIds = acceptedFriends
                .map((row) => row?.friend?.id || row?.friend_id || row?.user_id || null)
                .filter(Boolean);
              acceptedFriendUsernames = acceptedFriends
                .map(
                  (row) =>
                    row?.friend?.username ||
                    row?.username ||
                    row?.friend_username ||
                    null,
                )
                .filter(Boolean);
            }
          }

          const uniqueFriendIds = Array.from(new Set(acceptedFriendIds));
          uniqueFriendIds.forEach((id) =>
            friendLayerIdentityTokens.add(normalizeLayerIdentityToken(id)),
          );
          acceptedFriendUsernames.forEach((username) =>
            friendLayerIdentityTokens.add(
              normalizeLayerIdentityToken(username),
            ),
          );

          if (uniqueFriendIds.length > 0) {
            const profilesRes = await authedReader
              .from("profiles")
              .select("id,username")
              .in("id", uniqueFriendIds);
            if (!profilesRes.error) {
              (profilesRes.data || []).forEach((profile) => {
                friendLayerIdentityTokens.add(
                  normalizeLayerIdentityToken(profile?.id),
                );
                friendLayerIdentityTokens.add(
                  normalizeLayerIdentityToken(profile?.username),
                );
              });
            }
          }
        }

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
            ...(effectiveCommunityId ? [effectiveCommunityId] : []),
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
          return applyFallbackLayers(resolvedUserId);
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
            .filter((row) => row.community_id === effectiveCommunityId)
            .map((row) => row.layer_id),
        );
        if (effectiveCommunityId) {
          rawLayers
            .filter(
              (layer) =>
                (layer.owner_type || "system") === "community" &&
                layer.owner_id === effectiveCommunityId,
            )
            .forEach((layer) => forcedCommunityLayerIds.add(layer.id));
        }
        logCommunityMapTrace("refreshAccessibleLayers:forcedCandidates", {
          communityId: effectiveCommunityId || null,
          forcedCommunityLayerIds: Array.from(forcedCommunityLayerIds),
          linkedRows: communityLayerLinks.length,
          rawCommunityLayerCount: rawLayers.filter(
            (layer) => (layer.owner_type || "system") === "community",
          ).length,
        });

        const mappedLayers = rawLayers.map((layer) => {
          const ownerType = layer.owner_type || "system";
          const { baseKind, layerIcon } = parseLayerKindMetadata(layer.kind);
          const lowerName = String(layer.name || "").toLowerCase();
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
              : isDbEnabled &&
                (ownerType === "system" ||
                  ownerType === "user" ||
                  isLinkedToActiveCommunity);

          const ownerCommunity = layer.owner_id
            ? communitiesMap.get(layer.owner_id)
            : null;
          const viewerCanManage =
            ownerType !== "community" ||
            isLinkedToActiveCommunity;
          const isOwnUserPostsLayer = Boolean(resolvedUserId) && (
            (ownerType === "user" &&
              layer.kind === "user_posts" &&
              layer.owner_id === resolvedUserId) ||
            (expectedUserLayerName && lowerName === expectedUserLayerName) ||
            (expectedLegacyUserLayerName &&
              lowerName === expectedLegacyUserLayerName) ||
            (resolvedUsername &&
              lowerName === `user-${resolvedUsername}-posts`)
          );

          return {
            ...layer,
            kind: baseKind || layer.kind,
            raw_kind: layer.kind,
            layer_icon: layerIcon,
            owner_type: ownerType,
            display_name: formatLayerDisplayName(layer, {
              currentUserId: resolvedUserId,
              currentUsername: resolvedUsername,
              currentDisplayName: resolvedDisplayName,
            }),
            isEnabled,
            pref_hidden: prefHidden,
            pref_sort_order: prefSortOrder,
            ownerCommunityName: ownerCommunity?.name || null,
            sourceCommunityIds,
            isCommunityAccessible: isLinkedToActiveCommunity,
            viewerCanManage,
            isOwnUserPostsLayer,
          };
        });

        const friendScopedFilteredLayers = mappedLayers.filter((layer) => {
          if (!isNamedUserPostsLayer(layer)) return true;
          if (layer.isOwnUserPostsLayer) return true;
          const slug = getUserPostsLayerSlug(layer);
          return Boolean(slug) && friendLayerIdentityTokens.has(slug);
        });

        logLayerTrace("refreshAccessibleLayers:mappedLayers", {
          total: friendScopedFilteredLayers.length,
          layers: friendScopedFilteredLayers.map((layer) => ({
            id: layer.id,
            name: layer.display_name || layer.name,
            owner_type: layer.owner_type,
            owner_id: layer.owner_id || null,
            kind: layer.kind,
            raw_kind: layer.raw_kind || layer.kind,
            isEnabled: Boolean(layer.isEnabled),
            viewerCanManage: layer.viewerCanManage !== false,
          })),
        });

        const removedLayerIds = await readRemovedLayerIds(resolvedUserId);

        const collectionScopedLayers = friendScopedFilteredLayers.filter((layer) => {
          if (layer.owner_type !== "community") return true;
          if (forcedCommunityLayerIds.has(layer.id)) return true;
          if (removedLayerIds.has(layer.id)) return false;
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
        const nextLayersByPref = [...sortedLayers].sort((a, b) => {
          const rankA = Number.isFinite(a?.pref_sort_order)
            ? a.pref_sort_order
            : Number.MAX_SAFE_INTEGER;
          const rankB = Number.isFinite(b?.pref_sort_order)
            ? b.pref_sort_order
            : Number.MAX_SAFE_INTEGER;
          if (rankA !== rankB) return rankA - rankB;
          return 0;
        });
        const nextLayersBase = effectiveCommunityId
          ? nextLayersByPref.map((layer) => ({
              ...layer,
              isEnabled: forcedCommunityLayerIds.has(layer.id),
            }))
          : nextLayersByPref;
        const nextLayersBaseForAudience = !effectiveCommunityId
          ? nextLayersBase.map((layer) => {
              if (isUuid(String(layer?.id || ""))) return layer;
              if ((layer?.owner_type || "system") !== "system") return layer;
              const key = getPinLayerKeyFromLayer(layer);
              if (!["public", "friends"].includes(key)) return layer;
              if (!localFallbackEnabledByAudienceRef.current.has(key)) return layer;
              return {
                ...layer,
                isEnabled: Boolean(localFallbackEnabledByAudienceRef.current.get(key)),
              };
            })
          : nextLayersBase;
        const nextLayers = resolvedUserId
          ? nextLayersBaseForAudience
          : toGuestPublicOnlyLayers(nextLayersBaseForAudience);

        logLayerTrace("refreshAccessibleLayers:finalLayers", {
          total: nextLayers.length,
          enabled: nextLayers.filter((layer) => layer.isEnabled).length,
          layers: nextLayers.map((layer) => ({
            id: layer.id,
            name: layer.display_name || layer.name,
            owner_type: layer.owner_type,
            kind: layer.kind,
            isEnabled: Boolean(layer.isEnabled),
          })),
        });

        setLayers(nextLayers);
        if (effectiveCommunityId) {
          const firstCommunityLayer = nextLayers.find((layer) =>
            forcedCommunityLayerIds.has(layer.id),
          );
          logCommunityMapTrace("refreshAccessibleLayers:selectedLayer", {
            communityId: effectiveCommunityId,
            selected: firstCommunityLayer?.id || null,
            enabledForcedLayers: nextLayers
              .filter(
                (layer) =>
                  forcedCommunityLayerIds.has(layer.id) && layer.isEnabled,
              )
              .map((layer) => layer.id),
            enabledNonCommunityLayers: nextLayers
              .filter(
                (layer) =>
                  !forcedCommunityLayerIds.has(layer.id) && layer.isEnabled,
              )
              .map((layer) => layer.id),
          });
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
        return nextLayers;
      } catch (error) {
        const transient = isTransientNetworkError(error);
        if (transient) {
          activateNetworkBackoff();
          warnWithThrottle(
            "network-unavailable",
            "Network temporarily unavailable. Showing cached/offline data where possible.",
          );
          return applyFallbackLayers(userId || currentUser?.id || null);
        }

        logErrorWithThrottle("layers-load", "Error loading layers:", error);
        alertWithThrottle("layers-load", "Error", "Failed to load layers from Supabase.");
        return null;
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
      communityMapContext?.id,
      isNetworkBackoffActive,
      logErrorWithThrottle,
      route?.params?.communityMap?.id,
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
    logCommunityMapTrace("route:communityMapParam", incomingCommunityMap || null);
    if (incomingCommunityMap?.id) {
      setCommunityMapContext(incomingCommunityMap);
      fetchAccessibleLayers(currentUser?.id, incomingCommunityMap.id);
    }
  }, [currentUser?.id, fetchAccessibleLayers, route?.params?.communityMap]);

  useEffect(() => {
    fetchAccessibleLayers(currentUser?.id, communityMapContext?.id);
  }, [currentUser?.id, communityMapContext?.id, fetchAccessibleLayers]);

  useEffect(() => {
    if (initialBackgroundLayerRefreshDoneRef.current) return;
    if (!currentUser?.id) return;
    if (communityMapContext?.id) return;

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

  const ensureUserPostingLayer = useCallback(async () => {
    if (!currentUser?.id) return null;
    if (userPostingLayerId) return userPostingLayerId;

    const layerName = makeUserPostingLayerName(currentUser);
    const legacyLayerName = `user-${currentUser.id}-posts`;
    const isRecoverableOwnershipConstraintError = (error) => {
      const message = String(error?.message || "").toLowerCase();
      return (
        message.includes("layers_owner_consistency_check") ||
        message.includes("layers_owner_shape_check") ||
        message.includes("layers_owner_id_fkey")
      );
    };

    try {
      const session = await getActiveSession();
      const token = session?.access_token || null;
      const actorUserId = session?.user?.id || currentUser.id;
      const writer = token ? supabaseWithAccessToken(token) : supabase;

      if (token && actorUserId === currentUser.id) {
        const edgeResult = await ensureUserPostingLayerViaEdgeFunction(
          layerName,
          legacyLayerName,
          "user_posts",
          token,
          session?.refresh_token || null,
          actorUserId,
        );
        if (!edgeResult.error) {
          const edgeLayerId = String(edgeResult.data?.layer?.id || "");
          if (edgeLayerId) {
            setUserPostingLayerId(edgeLayerId);
            return edgeLayerId;
          }
        } else {
          const message = String(edgeResult.error?.message || "").toLowerCase();
          const shouldFallback =
            message.includes("unsupported action") ||
            isRecoverableOwnershipConstraintError(edgeResult.error);
          if (!shouldFallback) {
            throw edgeResult.error;
          }
        }
      }

      const existingUserLayerRes = await writer
        .from("layers")
        .select("id,name")
        .eq("owner_type", "user")
        .eq("kind", "user_posts")
        .in("name", [layerName, legacyLayerName])
        .order("created_at", { ascending: true })
        .limit(10);
      if (existingUserLayerRes.error) throw existingUserLayerRes.error;
      if (Array.isArray(existingUserLayerRes.data) && existingUserLayerRes.data.length > 0) {
        const preferred =
          existingUserLayerRes.data.find((layer) => layer?.name === layerName) ||
          existingUserLayerRes.data[0];
        if (preferred?.id) {
          setUserPostingLayerId(preferred.id);
          return preferred.id;
        }
      }

      const legacySystemRes = await writer
        .from("layers")
        .select("id,name")
        .eq("owner_type", "system")
        .eq("kind", "user_posts")
        .in("name", [layerName, legacyLayerName])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (legacySystemRes.error) throw legacySystemRes.error;
      if (legacySystemRes.data?.id) {
        if (legacySystemRes.data.name !== layerName) {
          await writer.from("layers").update({ name: layerName }).eq(
            "id",
            legacySystemRes.data.id,
          );
        }
        setUserPostingLayerId(legacySystemRes.data.id);
        return legacySystemRes.data.id;
      }

      let createRes = await writer
        .from("layers")
        .insert({
          kind: "user_posts",
          name: layerName,
          enabled: true,
          owner_type: "user",
          // DB currently enforces non-community owner_id as NULL.
          owner_id: null,
          is_public: false,
        })
        .select("id")
        .single();
      if (createRes.error && isRecoverableOwnershipConstraintError(createRes.error)) {
        createRes = await writer
          .from("layers")
          .insert({
            kind: "user_posts",
            name: layerName,
            enabled: true,
            owner_type: "system",
            is_public: false,
          })
          .select("id")
          .single();
      }

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

  useFocusEffect(
    useCallback(() => {
      return () => {
        // Ensure map-only overlays never leak across tabs/screens.
        setLayerPostsModalVisible(false);
        setCloudPostsModalVisible(false);
        setShowDetailModal(false);
      };
    }, []),
  );

  const clearCommunityMapContext = () => {
    setCommunityMapContext(null);
    if (route?.params?.communityMap) {
      navigation.setParams({ communityMap: undefined });
    }
  };

useEffect(() => {
  latestEnabledLayerKeyRef.current = buildLayerRequestKey(
    enabledPinLayerKeys,
    enabledAudienceKeys,
  );

  // When layer IDs are unavailable (e.g., offline fallback layers like
  // `fallback-public` / `fallback-friends`), `enabledPinLayerKeys` will be empty
  // because it only contains UUID layer IDs.
  if (enabledPinLayerKeys.length === 0 && enabledAudienceKeys.length === 0) {
    // Invalidate any in-flight load so stale responses cannot repopulate pins.
    pinLoadRequestSeqRef.current += 1;
    const keepPins = shouldKeepPinsWhenNoUuidLayers(layers);
    if (keepPins) {
      // Offline/fallback-only mode: keep cached data.
      restoreCachedPosts();
    } else {
      // User intentionally disabled everything: show an empty map.
      setAllLoadedPosts([]);
      setMapVisuals({ pins: [], clouds: [] });
    }
    return undefined;
  }

  loadPins(enabledPinLayerKeys, enabledAudienceKeys);
  const unsubscribe = subscribeToPins(enabledPinLayerKeys);
  return unsubscribe;
}, [enabledAudienceKeys, enabledPinLayerKeys, layers, restoreCachedPosts]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const { visiblePins, visibleClouds } = computeMapVisuals(
        allLoadedPosts,
        region,
        mapSize,
        arrowFocusedPinId,
      );
      setMapVisuals((prev) => {
        const samePins = haveSameEntitySignatures(
          prev.pins,
          visiblePins,
          getPinVisualSignature,
        );
        const sameClouds = haveSameEntitySignatures(
          prev.clouds,
          visibleClouds,
          getCloudVisualSignature,
        );
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

  const loadPins = async (
    enabledLayerIdsInput,
    enabledAudienceKeysInput = enabledAudienceKeys,
  ) => {
    const requestSeq = ++pinLoadRequestSeqRef.current;
    const requestLayerKey = buildLayerRequestKey(
      enabledLayerIdsInput,
      enabledAudienceKeysInput,
    );
    const isStaleRequest = () =>
      requestSeq !== pinLoadRequestSeqRef.current ||
      requestLayerKey !== latestEnabledLayerKeyRef.current;

    if (
      (!enabledLayerIdsInput || enabledLayerIdsInput.length === 0) &&
      (!enabledAudienceKeysInput || enabledAudienceKeysInput.length === 0)
    ) {
      if (isStaleRequest()) return;
      if (shouldKeepPinsWhenNoUuidLayers(layers)) {
        restoreCachedPosts();
      } else {
        setAllLoadedPosts([]);
        setMapVisuals({ pins: [], clouds: [] });
      }
      return;
    }

    try {
      // Resolve an authenticated reader if possible (needed for RLS-friendly reads).
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
          // Ignore fallback session lookup errors.
        }
      }

      const reader = readAccessToken
        ? supabaseWithAccessToken(readAccessToken)
        : supabase;

      let resolvedRequestUserId = null;
      try {
        const actorProbe = await reader.rpc("request_user_id");
        if (!actorProbe.error) {
          resolvedRequestUserId = actorProbe.data || null;
        }
      } catch (_) {
        // Optional probe for debugging auth context; ignore failures.
      }

      const enabledLayerIds = Array.from(
        new Set(
          (enabledLayerIdsInput || []).filter((id) => isUuid(String(id || ""))),
        ),
      );
      const normalizedAudienceKeys = normalizeAudienceKeys(enabledAudienceKeysInput);
      logLayerTrace("loadPins:enabledLayerIds", {
        requestSeq,
        readActorUserId,
        resolvedRequestUserId,
        hasAccessToken: Boolean(readAccessToken),
        enabledLayerIds,
        enabledAudienceKeys: normalizedAudienceKeys,
        enabledLayers: layers
          .filter((layer) => enabledLayerIds.includes(layer.id))
          .map((layer) => ({
            id: layer.id,
            name: layer.display_name || layer.name,
            owner_type: layer.owner_type,
            kind: layer.kind,
          })),
      });
      if (enabledLayerIds.length === 0 && normalizedAudienceKeys.length === 0) {
        if (isStaleRequest()) return;
        if (shouldKeepPinsWhenNoUuidLayers(layers)) {
          restoreCachedPosts();
        } else {
          setAllLoadedPosts([]);
          setMapVisuals({ pins: [], clouds: [] });
        }
        return;
      }

      const ownUserId = readActorUserId || currentUser?.id || null;
      const withLayerIcon = await resolvePinsForMap({
        reader,
        layers,
        enabledLayerIds,
        enabledAudienceKeys: normalizedAudienceKeys,
        ownUserId,
        accessToken: readAccessToken,
        refreshToken: readRefreshToken,
        resolvedRequestUserId,
      });
      logLayerTrace("loadPins:resolvedPins", {
        requestSeq,
        pinCount: withLayerIcon.length,
        sample: withLayerIcon.slice(0, 25).map((pin) => ({
          id: pin.id,
          user_id: pin.user_id,
          caption: pin.caption || null,
          layer_id: pin?.geometry?.layer_id || null,
          layer_emoji: pin.layer_emoji || null,
          base_audience: pin.base_audience || pin.layer || null,
        })),
      });

      if (withLayerIcon.length === 0) {
        if (isStaleRequest()) return;
        setAllLoadedPosts([]);
        try {
          await AsyncStorage.setItem(MAP_POSTS_CACHE_KEY, JSON.stringify([]));
        } catch (_) {
          // Ignore cache write failures.
        }
        return;
      }

      if (isStaleRequest()) return;
      setAllLoadedPosts(withLayerIcon);
      try {
        await AsyncStorage.setItem(MAP_POSTS_CACHE_KEY, JSON.stringify(withLayerIcon));
      } catch (_) {
        // Ignore cache write failures.
      }
    } catch (error) {
      if (isStaleRequest()) return;
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

  const handleRefreshLayersAndPins = useCallback(async () => {
    const refreshedLayers = await fetchAccessibleLayers(
      currentUser?.id,
      communityMapContext?.id,
    );
    const sourceLayers =
      Array.isArray(refreshedLayers) && refreshedLayers.length > 0
        ? refreshedLayers
        : layers;
    const refreshedEnabledLayerIds = getEnabledLayerIdsForMap(
      sourceLayers,
    );
    const refreshedEnabledAudienceKeys = getEnabledAudienceKeysForMap(
      sourceLayers,
    );
    if (
      refreshedEnabledLayerIds.length === 0 &&
      refreshedEnabledAudienceKeys.length === 0
    ) {
      if (shouldKeepPinsWhenNoUuidLayers(sourceLayers)) {
        // Offline/fallback-only state.
        restoreCachedPosts();
      } else {
        // User intentionally disabled all layers.
        setAllLoadedPosts([]);
        setMapVisuals({ pins: [], clouds: [] });
      }
      return;
    }
    await loadPins(refreshedEnabledLayerIds, refreshedEnabledAudienceKeys);
  }, [
    communityMapContext?.id,
    currentUser?.id,
    fetchAccessibleLayers,
    layers,
    restoreCachedPosts,
  ]);

  useEffect(() => {
    const communityId = communityMapContext?.id || null;
    if (!communityId) return;
    if (lastCommunityMapRefreshIdRef.current === communityId) return;
    lastCommunityMapRefreshIdRef.current = communityId;
    handleRefreshLayersAndPins();
  }, [communityMapContext?.id, handleRefreshLayersAndPins]);

  useEffect(() => {
    if (initialAppOpenRefreshDoneRef.current) return;
    if (!currentUser?.id) return;
    if (layersLoading) return;

    initialAppOpenRefreshDoneRef.current = true;
    const timer = setTimeout(() => {
      handleRefreshLayersAndPins();
    }, 550);

    return () => clearTimeout(timer);
  }, [currentUser?.id, handleRefreshLayersAndPins, layersLoading]);

  const loadPinAssociations = async (pin) => {
    if (!pin) {
      setSelectedPinLayers([]);
      return;
    }

    try {
      const pinId = String(pin?.id || "");
      if (!pinId) {
        setSelectedPinLayers([]);
        return;
      }
      if (!isUuid(pinId)) {
        setSelectedPinLayers([]);
        return;
      }

      const membershipsRes = await supabase
        .from("pin_layer_memberships")
        .select("layer_id")
        .eq("pin_id", pinId);
      if (membershipsRes.error) throw membershipsRes.error;

      const layerIds = Array.from(
        new Set(
          (membershipsRes.data || [])
            .map((row) => row?.layer_id)
            .filter(Boolean),
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

      const labels = layerIds
        .map((layerId) => inMemoryNameMap.get(layerId) || null)
        .filter(Boolean);
      setSelectedPinLayers(labels);
    } catch (error) {
      console.error(
        "Error loading pin associations:",
        error?.message || error,
      );
      setSelectedPinLayers([]);
    }
  };

  const subscribeToPins = (enabledLayerIds) => {
    const idSet = new Set(
      (enabledLayerIds || []).filter((id) => isUuid(String(id || ""))),
    );
    const subscription = supabase
      .channel(`pins-enabled-map`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pins",
        },
        () => {
          loadPins(enabledLayerIds);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pin_layer_memberships",
        },
        (payload) => {
          const eventLayerId =
            payload?.new?.layer_id ||
            payload?.old?.layer_id ||
            payload?.record?.layer_id;
          if (!eventLayerId || idSet.has(String(eventLayerId))) {
            loadPins(enabledLayerIds);
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
      if (!isUuid(String(layerId || ""))) {
        // Fallback system audiences (`fallback-public` / `fallback-friends`)
        // are local-only toggles when canonical system UUID layers are absent.
        const toggledLayer = optimisticLayers.find((layer) => layer.id === layerId);
        const key = getPinLayerKeyFromLayer(toggledLayer);
        if (["public", "friends"].includes(key)) {
          localFallbackEnabledByAudienceRef.current.set(key, Boolean(nextEnabled));
        }
        return;
      }

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

  const handleRemoveLayer = useCallback(
    async (layer) => {
      if (!layer?.id) return;
      if ((layer.owner_type || "system") === "system") {
        Alert.alert("Not Allowed", "System layers cannot be removed.");
        return;
      }

      Alert.alert(
        "Remove Layer",
        `Remove '${layer.display_name || layer.name}' from your Layers list?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              try {
                const userId = await resolveCurrentUserId();
                if (!userId) return;

                const session = await getActiveSession();
                const accessToken = session?.access_token || null;
                const refreshToken = session?.refresh_token || null;
                const actorUserId = session?.user?.id || userId;

                const edgeResult = await setLayerPreferenceViaEdgeFunction(
                  layer.id,
                  true,
                  accessToken,
                  refreshToken,
                  actorUserId,
                );
                if (edgeResult.error) throw edgeResult.error;
                await setLayerRemovedState(userId, layer.id, true);

                await handleRefreshLayersAndPins();
              } catch (error) {
                console.error("Error removing layer from list:", error);
                Alert.alert("Error", "Failed to remove layer from your list.");
              }
            },
          },
        ],
      );
    },
    [handleRefreshLayersAndPins, resolveCurrentUserId],
  );
  const clearPlaneInteractionTimers = () => {
    if (planeRectStopTimerRef.current) {
      clearTimeout(planeRectStopTimerRef.current);
      planeRectStopTimerRef.current = null;
    }
    if (planeMergeHoldTimerRef.current) {
      clearTimeout(planeMergeHoldTimerRef.current);
      planeMergeHoldTimerRef.current = null;
    }
    planeMergeTargetRef.current = null;
  };

  const resetLineStrokeTracking = () => {
    activeLineStrokeStartIndexRef.current = null;
    lineStrokeStartIndicesRef.current = [];
  };

  const resetPlaneStrokeTracking = () => {
    activePlaneStrokeStartIndexRef.current = null;
    planeStrokeStartIndicesRef.current = [];
  };

  const beginActiveLineStroke = () => {
    const startIndex = drawingCoordsRef.current.length;
    activeLineStrokeStartIndexRef.current = startIndex;
    const starts = lineStrokeStartIndicesRef.current;
    const lastStart = starts.length > 0 ? starts[starts.length - 1] : null;
    if (lastStart !== startIndex) {
      lineStrokeStartIndicesRef.current = [...starts, startIndex];
    }
  };

  const finalizeActiveLineStroke = () => {
    const startIndex = activeLineStrokeStartIndexRef.current;
    if (!Number.isInteger(startIndex) || startIndex < 0) {
      activeLineStrokeStartIndexRef.current = null;
      return;
    }
    const endIndex = drawingCoordsRef.current.length;
    // If the stroke never added points, discard its stack entry.
    if (endIndex <= startIndex) {
      const starts = lineStrokeStartIndicesRef.current;
      if (starts.length > 0 && starts[starts.length - 1] === startIndex) {
        lineStrokeStartIndicesRef.current = starts.slice(0, -1);
      }
    }
    activeLineStrokeStartIndexRef.current = null;
  };

  const beginActivePlaneStroke = () => {
    const startIndex = drawingCoordsRef.current.length;
    activePlaneStrokeStartIndexRef.current = startIndex;
    const starts = planeStrokeStartIndicesRef.current;
    const lastStart = starts.length > 0 ? starts[starts.length - 1] : null;
    if (lastStart !== startIndex) {
      planeStrokeStartIndicesRef.current = [...starts, startIndex];
    }
  };

  const finalizeActivePlaneStroke = () => {
    const startIndex = activePlaneStrokeStartIndexRef.current;
    if (!Number.isInteger(startIndex) || startIndex < 0) {
      activePlaneStrokeStartIndexRef.current = null;
      return;
    }
    const endIndex = drawingCoordsRef.current.length;
    // If the stroke never added points, discard its stack entry.
    if (endIndex <= startIndex) {
      const starts = planeStrokeStartIndicesRef.current;
      if (starts.length > 0 && starts[starts.length - 1] === startIndex) {
        planeStrokeStartIndicesRef.current = starts.slice(0, -1);
      }
    }
    activePlaneStrokeStartIndexRef.current = null;
  };

  const updateMapTouchState = (event, phase = "move") => {
    const now = Date.now();
    const previousTouchCount = activeMapTouchCountRef.current;
    const touchesLength = event?.nativeEvent?.touches?.length;
    const changedTouchesLength = event?.nativeEvent?.changedTouches?.length;
    // `touches` is authoritative when present, including `0` on touch end.
    let touchCount = Number(
      Number.isFinite(touchesLength)
        ? touchesLength
        : Number.isFinite(changedTouchesLength)
          ? changedTouchesLength
          : 0,
    );
    // Some platforms report only changedTouches during simultaneous starts.
    // Infer count transitions from phase + previous count to avoid false single-touch.
    if (phase === "start" && previousTouchCount >= 1 && touchCount <= 1) {
      touchCount = previousTouchCount + 1;
    } else if (
      (phase === "end" || phase === "cancel") &&
      previousTouchCount > 0 &&
      touchCount >= previousTouchCount
    ) {
      touchCount = previousTouchCount - 1;
    }
    activeMapTouchCountRef.current = touchCount;
    if (touchCount > 1) {
      multiTouchGestureLockedRef.current = true;
    } else if (touchCount === 0) {
      multiTouchGestureLockedRef.current = false;
    }
    setIsMapMultiTouchActive((prev) => {
      const next = touchCount > 1 || multiTouchGestureLockedRef.current;
      return prev === next ? prev : next;
    });

    if (previousTouchCount === 0 && touchCount > 0) {
      // New gesture started: wait briefly before allowing draw to avoid
      // simultaneous two-finger starts being interpreted as single-touch.
      singleTouchDrawReadyAtRef.current =
        now + DRAW_SINGLE_TOUCH_GESTURE_BUFFER_MS;
      suppressDrawUntilRef.current = Math.max(
        suppressDrawUntilRef.current,
        singleTouchDrawReadyAtRef.current,
      );
    } else if (touchCount !== 1) {
      singleTouchDrawReadyAtRef.current = 0;
    }

    if (isDrawingMode && drawingType === GEOMETRY_TYPES.LINE) {
      if (touchCount > 1 && activeLineStrokeStartIndexRef.current !== null) {
        finalizeActiveLineStroke();
      } else if (
        (touchCount === 0 && previousTouchCount > 0) ||
        ((phase === "end" || phase === "cancel") &&
          previousTouchCount === 1 &&
          activeLineStrokeStartIndexRef.current !== null)
      ) {
        finalizeActiveLineStroke();
      }
    } else if (isDrawingMode && drawingType === GEOMETRY_TYPES.PLANE) {
      if (touchCount > 1 && activePlaneStrokeStartIndexRef.current !== null) {
        finalizeActivePlaneStroke();
      } else if (
        (touchCount === 0 && previousTouchCount > 0) ||
        ((phase === "end" || phase === "cancel") &&
          previousTouchCount === 1 &&
          activePlaneStrokeStartIndexRef.current !== null)
      ) {
        finalizeActivePlaneStroke();
      }
    } else if (activeLineStrokeStartIndexRef.current !== null) {
      activeLineStrokeStartIndexRef.current = null;
    } else if (activePlaneStrokeStartIndexRef.current !== null) {
      activePlaneStrokeStartIndexRef.current = null;
    }

    if (touchCount > 1) {
      // Ignore pan-draw callbacks briefly after multi-touch (pinch/two-finger tap).
      suppressDrawUntilRef.current = now + 260;
    } else if (touchCount === 0) {
      // Small cooldown right after ending a two-finger gesture.
      suppressDrawUntilRef.current = Math.max(suppressDrawUntilRef.current, now + 80);
    }
  };

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
    }
  };

  const handleMapLongPress = (event) => {
    if (!isDrawingMode || drawingType !== GEOMETRY_TYPES.PLANE) return;
    const { latitude, longitude } = event.nativeEvent.coordinate || {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const nextCoord = { latitude, longitude };

    if (Array.isArray(drawingCoords) && drawingCoords.length >= 3) {
      const edgeIndex = findNearestPlaneEdgeIndex(
        drawingCoords,
        nextCoord,
        PLANE_EDGE_INSERT_THRESHOLD_METERS,
      );
      if (edgeIndex >= 0) {
        setDrawingCoords((prev) => {
          if (!Array.isArray(prev) || prev.length < 3) return prev;
          const updated = [...prev];
          updated.splice(edgeIndex + 1, 0, nextCoord);
          return updated;
        });
      }
      return;
    }

    planeRectAnchorRef.current = nextCoord;
    clearPlaneInteractionTimers();
    setDrawingCoords(buildRectangleFromDiagonal(nextCoord, nextCoord));
  };

  const handleMapPanDrag = (event) => {
    if (!isDrawingMode) return;
    if (activeMapTouchCountRef.current > 1) return;
    if (multiTouchGestureLockedRef.current) return;
    if (Date.now() < regionGestureSuppressUntilRef.current) return;
    if (Date.now() < suppressDrawUntilRef.current) return;
    if (Date.now() < singleTouchDrawReadyAtRef.current) return;
    if (
      drawingType === GEOMETRY_TYPES.LINE &&
      activeLineStrokeStartIndexRef.current === null
    ) {
      beginActiveLineStroke();
    } else if (
      drawingType === GEOMETRY_TYPES.PLANE &&
      activePlaneStrokeStartIndexRef.current === null
    ) {
      beginActivePlaneStroke();
    }
    const { latitude, longitude } = event.nativeEvent.coordinate || {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const nextCoord = { latitude, longitude };

    if (
      drawingType === GEOMETRY_TYPES.LINE ||
      drawingType === GEOMETRY_TYPES.PLANE
    ) {
      setDrawingCoords((prev) => {
        if (!Array.isArray(prev) || prev.length === 0) return [nextCoord];
        const lastCoord = prev[prev.length - 1];
        const distanceMeters = haversineMeters(lastCoord, nextCoord);
        if (!Number.isFinite(distanceMeters)) return prev;
        if (distanceMeters < DRAW_POINT_MIN_DISTANCE_METERS) return prev;
        return [...prev, nextCoord];
      });
      return;
    }
  };

  const handlePlaneCornerDragStart = () => {
    if (planeMergeHoldTimerRef.current) {
      clearTimeout(planeMergeHoldTimerRef.current);
      planeMergeHoldTimerRef.current = null;
    }
    planeMergeTargetRef.current = null;
  };

  const handlePlaneCornerDrag = (index, event) => {
    const { latitude, longitude } = event?.nativeEvent?.coordinate || {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const draggedCoord = { latitude, longitude };

    setDrawingCoords((prev) => {
      if (!Array.isArray(prev) || prev.length < 3) return prev;
      if (index < 0 || index >= prev.length) return prev;
      const updated = [...prev];
      updated[index] = draggedCoord;

      if (updated.length <= 3) {
        if (planeMergeHoldTimerRef.current) {
          clearTimeout(planeMergeHoldTimerRef.current);
          planeMergeHoldTimerRef.current = null;
        }
        planeMergeTargetRef.current = null;
        return updated;
      }

      let nearestIndex = -1;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < updated.length; i += 1) {
        if (i === index) continue;
        const distance = haversineMeters(draggedCoord, updated[i]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = i;
        }
      }

      const canMerge =
        nearestIndex >= 0 &&
        nearestDistance <= PLANE_CORNER_MERGE_THRESHOLD_METERS &&
        updated.length > 3;

      if (!canMerge) {
        if (planeMergeHoldTimerRef.current) {
          clearTimeout(planeMergeHoldTimerRef.current);
          planeMergeHoldTimerRef.current = null;
        }
        planeMergeTargetRef.current = null;
        return updated;
      }

      if (planeMergeTargetRef.current !== nearestIndex) {
        if (planeMergeHoldTimerRef.current) {
          clearTimeout(planeMergeHoldTimerRef.current);
        }
        planeMergeTargetRef.current = nearestIndex;
        planeMergeHoldTimerRef.current = setTimeout(() => {
          setDrawingCoords((current) => {
            if (!Array.isArray(current) || current.length <= 3) return current;
            if (index < 0 || index >= current.length) return current;
            const withoutDragged = current.filter((_, i) => i !== index);
            return withoutDragged.length >= 3 ? withoutDragged : current;
          });
          planeMergeHoldTimerRef.current = null;
          planeMergeTargetRef.current = null;
        }, PLANE_CORNER_MERGE_HOLD_MS);
      }

      return updated;
    });
  };

  const handlePlaneCornerDragEnd = (index, event) => {
    const { latitude, longitude } = event?.nativeEvent?.coordinate || {};
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      setDrawingCoords((prev) => {
        if (!Array.isArray(prev) || index < 0 || index >= prev.length) return prev;
        const updated = [...prev];
        updated[index] = { latitude, longitude };
        return updated;
      });
    }

    if (planeMergeHoldTimerRef.current) {
      clearTimeout(planeMergeHoldTimerRef.current);
      planeMergeHoldTimerRef.current = null;
    }
    planeMergeTargetRef.current = null;
  };

  const handleStartDrawing = (geometryType) => {
    clearPlaneInteractionTimers();
    resetLineStrokeTracking();
    resetPlaneStrokeTracking();
    planeRectAnchorRef.current = null;
    setIsDrawingMode(true);
    setDrawingType(geometryType);
    setDrawingCoords([]);
  };

  const handleFinishDrawing = () => {
    clearPlaneInteractionTimers();
    resetLineStrokeTracking();
    resetPlaneStrokeTracking();
    planeRectAnchorRef.current = null;
    setIsDrawingMode(false);
  };

  const handlePostSubmit = async (postData) => {
    if (!currentUser) {
      Alert.alert("Sign In Required", "Please sign in to create posts");
      navigation.navigate("Account");
      return;
    }

    if (
      postData.locationMode === "pick_on_map" &&
      !postData.location &&
      postData.geometryType === GEOMETRY_TYPES.POINT
    ) {
      setPendingPostData(postData);
      setIsPickingPostLocation(true);
      Alert.alert("Select Location", "Tap on the map to place this post.");
      return;
    }

    const mediaSource = String(postData?.mediaSource || "").toLowerCase();

    const rawDrawingCoords = Array.isArray(drawingCoords) ? drawingCoords : [];
    const finalizedDrawingCoords =
      postData.geometryType === GEOMETRY_TYPES.LINE
        ? simplifyLineCoordinates(rawDrawingCoords)
        : postData.geometryType === GEOMETRY_TYPES.PLANE
          ? simplifyPlaneCoordinates(rawDrawingCoords)
          : rawDrawingCoords;

    if (
      postData.geometryType !== GEOMETRY_TYPES.POINT &&
      finalizedDrawingCoords.length === 0
    ) {
      setPendingPostData(postData);
      handleStartDrawing(postData.geometryType);
      return;
    }
    if (
      String(postData?.postVisibilityMode || "pinned").toLowerCase() !==
        "cloud_only" &&
      postData.geometryType === GEOMETRY_TYPES.LINE &&
      finalizedDrawingCoords.length < 2
    ) {
      Alert.alert("Add More Path Points", "Drag to draw at least a short path.");
      return;
    }
    if (
      String(postData?.postVisibilityMode || "pinned").toLowerCase() !==
        "cloud_only" &&
      postData.geometryType === GEOMETRY_TYPES.PLANE &&
      finalizedDrawingCoords.length < 3
    ) {
      Alert.alert(
        "Add More Plane Points",
        "Draw at least 3 points for a plane.",
      );
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
      let storedLat = baseLat;
      let storedLng = baseLng;
      const postVisibilityMode = String(
        postData?.postVisibilityMode || "pinned",
      ).toLowerCase();
      const crossPostGroupId = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      const baseAudienceRaw = String(postData?.baseAudience || "").toLowerCase();
      const baseAudience = ["friends", "public", "private"].includes(
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
      const extraCommunityLayerId =
        typeof postData?.extraCommunityLayerId === "string"
          ? postData.extraCommunityLayerId
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
        (layer) => layer.owner_type === "community",
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
      const resolvedExtraCommunityLayerId =
        extraCommunityLayerId && communityLayerIdSet.has(extraCommunityLayerId)
          ? extraCommunityLayerId
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
      if (extraCommunityLayerId && !resolvedExtraCommunityLayerId) {
        Alert.alert(
          "Community Layer Unavailable",
          "That community layer is not available right now.",
        );
        return;
      }
      const targetLayerIdForGeometry =
        resolvedExtraCommunityLayerId || authorLayerId;
      if (
        postData.geometryType === GEOMETRY_TYPES.LINE &&
        finalizedDrawingCoords.length >= 2
      ) {
        const lineMidpoint = getLineMidpointCoordinate(finalizedDrawingCoords);
        if (lineMidpoint) {
          storedLat = lineMidpoint.latitude;
          storedLng = lineMidpoint.longitude;
        }
      } else if (
        postData.geometryType === GEOMETRY_TYPES.PLANE &&
        finalizedDrawingCoords.length >= 3
      ) {
        const planeCenter = getPolygonCenterCoordinate(finalizedDrawingCoords);
        if (planeCenter) {
          storedLat = planeCenter.latitude;
          storedLng = planeCenter.longitude;
        }
      }
      let geometry;
      if (postData.geometryType === GEOMETRY_TYPES.POINT) {
        geometry = {
          type: "Point",
          coordinates: [storedLng, storedLat],
          layer_id: targetLayerIdForGeometry,
          author_layer_id: authorLayerId,
          author_user_id: activeUserId,
          visibility_mode: postVisibilityMode,
        };
      } else if (finalizedDrawingCoords.length > 0) {
        const coordinates = finalizedDrawingCoords.map((coord) => [
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
          layer_id: targetLayerIdForGeometry,
          author_layer_id: authorLayerId,
          author_user_id: activeUserId,
          visibility_mode: postVisibilityMode,
        };
      } else {
        geometry = {
          type: "Point",
          coordinates: [storedLng, storedLat],
          layer_id: targetLayerIdForGeometry,
          author_layer_id: authorLayerId,
          author_user_id: activeUserId,
          visibility_mode: postVisibilityMode,
        };
      }

      let persistedMediaUrl = postData.mediaUrl || null;
      if (persistedMediaUrl) {
        const uploadResult = await uploadPostMediaToStorage({
          session,
          userId: activeUserId,
          mediaUrl: persistedMediaUrl,
          mediaType: postData.mediaType,
        });
        persistedMediaUrl = uploadResult?.mediaPointer || null;
      }

      const insertRows = [
        {
          user_id: activeUserId,
          type: postData.mediaUrl ? "media" : "text",
          content: postData.content,
          caption: postData.title,
          media_url: persistedMediaUrl,
          media_type: postData.mediaType,
          lat: storedLat,
          lng: storedLng,
          layer: baseAudience,
          base_audience: baseAudience,
          author_layer_id: authorLayerId,
          explicit_layer_id: resolvedExtraCommunityLayerId,
          author_name: activeUser?.user_metadata?.display_name || "Anonymous",
          author_username: activeUser?.user_metadata?.username || "",
          posted_from_current_location:
            postData.locationMode === "current" && mediaSource !== "library",
          geometry,
        },
      ];

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

      const layerIconById = new Map(
        layers.map((layer) => [layer.id, layer.layer_icon || null]),
      );
      const optimisticCreatedAt = new Date().toISOString();
      const optimisticMediaUrl = postData.mediaUrl || persistedMediaUrl || null;
      const optimisticRows = insertRows.map((row, index) => ({
        ...row,
        media_url: optimisticMediaUrl,
        id: `temp-${crossPostGroupId}-${index}`,
        created_at: optimisticCreatedAt,
        updated_at: optimisticCreatedAt,
        author_avatar_url: activeUser?.user_metadata?.avatar_url || null,
        layer_emoji: row?.geometry?.layer_id
          ? layerIconById.get(row.geometry.layer_id) || null
          : null,
      }));
      setAllLoadedPosts((prev) => {
        const previous = Array.isArray(prev) ? prev : [];
        return [...optimisticRows, ...previous];
      });

      if (
        (Array.isArray(enabledPinLayerKeys) && enabledPinLayerKeys.length > 0) ||
        enabledAudienceKeys.length > 0
      ) {
        loadPins(enabledPinLayerKeys);
      }
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
      const membershipsRes = await supabase
        .from("pin_layer_memberships")
        .select("pin_id")
        .eq("layer_id", layer.id)
        .limit(200);
      if (membershipsRes.error) throw membershipsRes.error;

      const pinIds = Array.from(
        new Set(
          (membershipsRes.data || [])
            .map((row) => String(row?.pin_id || ""))
            .filter(Boolean),
        ),
      );
      if (pinIds.length === 0) {
        setLayerPosts([]);
        return;
      }

      const pinsRes = await supabase
        .from("pins")
        .select("id,user_id,caption,content,author_name,created_at,layer,geometry")
        .in("id", pinIds)
        .order("created_at", { ascending: false })
        .limit(50);
      if (pinsRes.error) throw pinsRes.error;

      const exactLayerPosts = (pinsRes.data || []).filter(
        (post) => !isCloudOnlyPost(post),
      );
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
    if (!isUuid(pinId)) {
      if (!suppressState && selectedPinIdRef.current === pinId) {
        setPinComments([]);
        setPinCommentsLoading(false);
      }
      return [];
    }

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
    if (!isUuid(pinId)) {
      const emptySummary = { upvotes: 0, downvotes: 0, userVote: 0 };
      if (!suppressState && selectedPinIdRef.current === pinId) {
        setPinVoteSummary(emptySummary);
      }
      return emptySummary;
    }

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
            isUuid(pinId) &&
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
    if (
      multiTouchGestureLockedRef.current &&
      activeMapTouchCountRef.current <= 1 &&
      Date.now() >= regionGestureSuppressUntilRef.current
    ) {
      multiTouchGestureLockedRef.current = false;
      setIsMapMultiTouchActive(false);
    }
  }, []);

  const handleRegionChange = useCallback(() => {
    if (!isDrawingMode) return;
    const hasMultiTouchContext =
      activeMapTouchCountRef.current > 1 || multiTouchGestureLockedRef.current;
    if (!hasMultiTouchContext) return;
    const until = Date.now() + 240;
    regionGestureSuppressUntilRef.current = until;
    suppressDrawUntilRef.current = Math.max(suppressDrawUntilRef.current, until);
    multiTouchGestureLockedRef.current = true;
    setIsMapMultiTouchActive(true);
  }, [isDrawingMode]);

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
    if (!isUuid(selectedPin.id)) {
      Alert.alert(
        "Please wait",
        "This post is still syncing. Voting will be available in a moment.",
      );
      return;
    }

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
    if (!isUuid(pinId)) {
      Alert.alert(
        "Please wait",
        "This post is still syncing. Commenting will be available in a moment.",
      );
      return false;
    }
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
          normalizedUpdates.base_audience = nextLayer;
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
      const pinIdsToDelete = [pinId];

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
        provider={mapProvider}
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
        onRegionChange={handleRegionChange}
        onRegionChangeComplete={handleRegionChangeComplete}
        mapType={mapType}
        customMapStyle={mapProvider && isDark ? MAP_DARK_STYLE : undefined}
        userInterfaceStyle={mapProvider ? undefined : appleMapInterfaceStyle}
        onPress={isPickingPostLocation ? handleMapPress : undefined}
        onLongPress={undefined}
        onPanDrag={
          isDrawingMode &&
          (drawingType === GEOMETRY_TYPES.LINE ||
            drawingType === GEOMETRY_TYPES.PLANE)
            ? handleMapPanDrag
            : undefined
        }
        onTouchStart={(event) => updateMapTouchState(event, "start")}
        onTouchMove={(event) => updateMapTouchState(event, "move")}
        onTouchEnd={(event) => updateMapTouchState(event, "end")}
        onTouchCancel={(event) => updateMapTouchState(event, "cancel")}
        zoomEnabled
        scrollEnabled={!isDrawingMode || isMapMultiTouchActive}
        scrollDuringRotateOrZoomEnabled={true}
        rotateEnabled={false}
        pitchEnabled={false}
        moveOnMarkerPress={false}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {persistedShapes.map((shape) =>
          shape.kind === "line" ? (
            <Polyline
              key={`line-${shape.id}`}
              coordinates={shape.coordinates}
              strokeColor={COLORS.primary}
              strokeWidth={3}
              tappable
              onPress={() => handlePinPress(shape.pin)}
            />
          ) : (
            <Polygon
              key={`plane-${shape.id}`}
              coordinates={shape.coordinates}
              strokeColor={COLORS.primary}
              fillColor="rgba(102, 126, 234, 0.2)"
              strokeWidth={2}
              tappable
              onPress={() => handlePinPress(shape.pin)}
            />
          ),
        )}
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
              coordinates={getPlaneOuterBoundary(drawingCoords)}
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
            {drawingType === GEOMETRY_TYPES.LINE
              ? `Drag with one finger to draw (${drawingCoords.length} points). Use two fingers to move map.`
              : `Drag with one finger to draw the plane outline (${drawingCoords.length} points). Use two fingers to move map.`}
          </Text>
          <View style={styles.drawingActions}>
            <TouchableOpacity
              style={styles.drawingSecondaryBtn}
              onPress={() => {
                setDrawingCoords((prev) => {
                  if (!Array.isArray(prev) || prev.length === 0) return [];
                  if (drawingType === GEOMETRY_TYPES.LINE) {
                    // Ensure any in-flight stroke is closed before undoing.
                    finalizeActiveLineStroke();
                    const starts = [
                      ...lineStrokeStartIndicesRef.current.filter(
                        (idx) =>
                          Number.isInteger(idx) && idx >= 0 && idx <= prev.length,
                      ),
                    ];
                    // Drop trailing no-op markers (empty strokes) first.
                    while (starts.length > 0 && starts[starts.length - 1] >= prev.length) {
                      starts.pop();
                    }
                    if (starts.length > 0) {
                      const lastStart = starts.pop();
                      lineStrokeStartIndicesRef.current = starts;
                      activeLineStrokeStartIndexRef.current = null;
                      return prev.slice(0, lastStart);
                    }
                  } else if (drawingType === GEOMETRY_TYPES.PLANE) {
                    // Ensure any in-flight stroke is closed before undoing.
                    finalizeActivePlaneStroke();
                    const starts = [
                      ...planeStrokeStartIndicesRef.current.filter(
                        (idx) =>
                          Number.isInteger(idx) && idx >= 0 && idx <= prev.length,
                      ),
                    ];
                    // Drop trailing no-op markers (empty strokes) first.
                    while (starts.length > 0 && starts[starts.length - 1] >= prev.length) {
                      starts.pop();
                    }
                    if (starts.length > 0) {
                      const lastStart = starts.pop();
                      planeStrokeStartIndicesRef.current = starts;
                      activePlaneStrokeStartIndexRef.current = null;
                      return prev.slice(0, lastStart);
                    }
                  }
                  return prev.slice(0, -1);
                });
              }}
            >
              <Text style={styles.drawingSecondaryBtnText}>Undo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.drawingSecondaryBtn}
              onPress={() => {
                handleFinishDrawing();
                setDrawingType(null);
                setDrawingCoords([]);
                setPendingPostData(null);
              }}
            >
              <Text style={styles.drawingSecondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.drawingDoneBtn, { marginLeft: 0 }]}
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
          onRemoveLayer={handleRemoveLayer}
          onRefreshLayers={handleRefreshLayersAndPins}
          onPostSubmit={handlePostSubmit}
          userLocation={userLocation}
          onSearch={handleSearch}
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
    drawingActions: {
      flexDirection: "row",
      alignItems: "center",
      marginLeft: 12,
      gap: 8,
    },
    drawingSecondaryBtn: {
      backgroundColor: palette.mutedSurface,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: SIZES.radius,
    },
    drawingSecondaryBtnText: {
      color: palette.text,
      fontSize: 13,
      fontWeight: "700",
    },
    planeCornerPin: {
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: palette.primary,
      borderWidth: 2,
      borderColor: palette.surface,
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
