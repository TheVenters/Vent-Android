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
  supabase,
  getCurrentUser,
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
const layerOrderStorageKey = (userId) => `layer_order:${userId || "guest"}`;
const CLOUD_DISTANCE_THRESHOLD_METERS = 250;
const CLOUD_MIN_POST_COUNT = 2;
const CLOUD_RADIUS_PADDING_METERS = 40;
const CLOUD_MIN_RADIUS_METERS = 120;
const CLOUD_MAX_RADIUS_METERS = 1000;
const NORMAL_CLUSTER_MIN_COUNT = 4;
const NORMAL_CLUSTER_ZOOM_DELTA_THRESHOLD = 0.02;

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

const isCloudOnlyPost = (pin) => pin?.geometry?.visibility_mode === "cloud_only";
const isRlsPolicyError = (error) =>
  error?.code === "42501" ||
  String(error?.message || "")
    .toLowerCase()
    .includes("row-level security policy");

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

const buildCloudsFromPosts = (posts) => {
  const candidates = (posts || []).filter(
    (post) =>
      typeof post?.lat === "number" &&
      Number.isFinite(post.lat) &&
      typeof post?.lng === "number" &&
      Number.isFinite(post.lng),
  );
  if (candidates.length < CLOUD_MIN_POST_COUNT) return [];

  const visited = new Set();
  const clouds = [];

  for (let i = 0; i < candidates.length; i += 1) {
    if (visited.has(i)) continue;
    const queue = [i];
    const groupIndexes = [i];
    visited.add(i);

    while (queue.length > 0) {
      const sourceIndex = queue.shift();
      const source = candidates[sourceIndex];
      const sourceCoord = { latitude: source.lat, longitude: source.lng };

      for (let j = 0; j < candidates.length; j += 1) {
        if (visited.has(j)) continue;
        const target = candidates[j];
        const targetCoord = { latitude: target.lat, longitude: target.lng };
        if (
          haversineMeters(sourceCoord, targetCoord) <=
          CLOUD_DISTANCE_THRESHOLD_METERS
        ) {
          visited.add(j);
          groupIndexes.push(j);
          queue.push(j);
        }
      }
    }

    if (groupIndexes.length < CLOUD_MIN_POST_COUNT) continue;

    const groupPosts = groupIndexes.map((index) => candidates[index]);
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
      Math.max(
        CLOUD_MIN_RADIUS_METERS,
        farthest + CLOUD_RADIUS_PADDING_METERS,
      ),
    );

    clouds.push({
      id: `cloud-${groupPosts.map((post) => post.id).join("-")}`,
      center,
      radiusMeters: computedRadius,
      count: groupPosts.length,
      privacyCount: groupPosts.filter(isCloudOnlyPost).length,
      posts: groupPosts,
    });
  }

  return clouds;
};

const computeMapVisuals = (posts, latitudeDelta) => {
  const normalizedPosts = Array.isArray(posts) ? posts : [];
  const clusters = buildCloudsFromPosts(normalizedPosts);
  const zoomedOut =
    Number(latitudeDelta || DEFAULT_REGION.latitudeDelta) >=
    NORMAL_CLUSTER_ZOOM_DELTA_THRESHOLD;

  const visibleClouds = [];
  const clusteredPinnedIds = new Set();

  clusters.forEach((cloud) => {
    const pinnedCount = cloud.count - cloud.privacyCount;
    const hasPrivacyPosts = cloud.privacyCount > 0;
    const shouldShowCloudForPinned =
      pinnedCount >= NORMAL_CLUSTER_MIN_COUNT || zoomedOut;
    const shouldShowCloud = hasPrivacyPosts || shouldShowCloudForPinned;

    if (!shouldShowCloud) return;
    visibleClouds.push(cloud);

    cloud.posts.forEach((post) => {
      if (!isCloudOnlyPost(post)) {
        clusteredPinnedIds.add(post.id);
      }
    });
  });

  const visiblePins = normalizedPosts.filter(
    (post) => !isCloudOnlyPost(post) && !clusteredPinnedIds.has(post.id),
  );

  return { visiblePins, visibleClouds };
};

const toTitle = (value) => {
  const str = String(value || "").trim();
  if (!str) return "Unknown";
  return str.charAt(0).toUpperCase() + str.slice(1);
};

const MapScreen = ({ navigation, route }) => {
  const { isDark, palette } = useAppTheme();
  const styles = createStyles(palette);

  const [region, setRegion] = useState(DEFAULT_REGION);
  const [pins, setPins] = useState([]);
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
  const [clouds, setClouds] = useState([]);
  const [allLoadedPosts, setAllLoadedPosts] = useState([]);
  const [cloudPostsModalVisible, setCloudPostsModalVisible] = useState(false);
  const [selectedCloud, setSelectedCloud] = useState(null);

  const mapRef = useRef(null);
  const isAdmin = Boolean(currentUser?.user_metadata?.is_admin);

  const resolveCurrentUserId = useCallback(async () => {
    // For RLS-gated writes, we must ensure there is an active session so auth.uid()
    // is set on the PostgREST request. A stale cached user object is not enough.
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        if (currentUser?.id !== session.user.id) {
          setCurrentUser(session.user);
        }
        return session.user.id;
      }
    } catch (error) {
      console.error("Error resolving current session:", error);
    }

    // Try to refresh tokens/session if the local session is missing/stale.
    try {
      const {
        data: { session: refreshed },
        error,
      } = await supabase.auth.refreshSession();
      if (error) throw error;
      if (refreshed?.user?.id) {
        setCurrentUser(refreshed.user);
        return refreshed.user.id;
      }
    } catch (error) {
      console.error("Error refreshing session:", error);
    }

    // Fallback: may return user even when session isn't usable for PostgREST.
    try {
      const user = await getCurrentUser();
      if (user?.id) {
        setCurrentUser(user);
        return user.id;
      }
    } catch (error) {
      console.error("Error resolving current user:", error);
    }
    return null;
  }, [currentUser?.id]);

  const persistLayerOrder = useCallback(async (nextLayers, userId) => {
    if (!userId || !Array.isArray(nextLayers)) return;
    try {
      const ids = nextLayers.map((layer) => layer.id);
      await AsyncStorage.setItem(
        layerOrderStorageKey(userId),
        JSON.stringify(ids),
      );
    } catch (error) {
      console.error("Error saving layer order:", error);
    }
  }, []);

  const applySavedLayerOrder = useCallback(async (nextLayers, userId) => {
    if (!userId || !Array.isArray(nextLayers) || nextLayers.length === 0) {
      return nextLayers;
    }
    try {
      const raw = await AsyncStorage.getItem(layerOrderStorageKey(userId));
      if (!raw) return nextLayers;
      const ids = JSON.parse(raw);
      if (!Array.isArray(ids) || ids.length === 0) return nextLayers;

      const rank = new Map(ids.map((id, index) => [id, index]));
      return [...nextLayers].sort((a, b) => {
        const rankA = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
        const rankB = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        return 0;
      });
    } catch (error) {
      console.error("Error applying saved layer order:", error);
      return nextLayers;
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
      setLayersLoading(true);

      try {
        const [allLayersRes, membershipsRes, prefsRes] = await Promise.all([
          supabase
            .from("layers")
            .select(
              "id,name,kind,owner_type,owner_id,is_public,enabled,created_at",
            ),
          userId
            ? supabase
                .from("community_members")
                .select("community_id,role,status")
                .eq("user_id", userId)
            : Promise.resolve({ data: [], error: null }),
          userId
            ? supabase
                .from("user_layer_prefs")
                .select("layer_id,hidden")
                .eq("user_id", userId)
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (allLayersRes.error) throw allLayersRes.error;
        if (membershipsRes.error) throw membershipsRes.error;
        if (prefsRes.error) throw prefsRes.error;

        const activeMemberships = (membershipsRes.data || []).filter(
          (row) => row.status === "active",
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
        const allLayerRows = allLayersRes.data || [];

        const layerIdSet = new Set([
          ...allLayerRows
            .filter((row) => {
              const ownerType = row.owner_type || "system";
              return ownerType === "system" || ownerType === "user";
            })
            .map((row) => row.id),
          ...allLayerRows
            .filter((row) => {
              const pinKey = getPinLayerKeyFromLayer({
                kind: row.kind,
                name: row.name,
                owner_type: row.owner_type || "system",
              });
              return ["public", "friends", "private"].includes(pinKey);
            })
            .map((row) => row.id),
          ...communityLayerLinks.map((row) => row.layer_id),
          ...prefLayerIds,
        ]);

        if (layerIdSet.size === 0) {
          setLayers([]);
          setSelectedLayerId(null);
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

        const prefMap = new Map(
          (prefsRes.data || []).map((row) => [row.layer_id, row.hidden]),
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
          const hasPref = prefMap.has(layer.id);
          const isDbEnabled = layer.enabled !== false;
          const isEnabled = forcedCommunityLayerIds.has(layer.id)
            ? true
            : hasPref
              ? !prefMap.get(layer.id)
              : isDbEnabled && (ownerType === "system" || ownerType === "user");

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
            ownerCommunityName: ownerCommunity?.name || null,
            sourceCommunityIds: layerCommunitiesMap.get(layer.id) || [],
          };
        });

        const ownUserLayersOnly = mappedLayers.filter((layer) => {
          if (!(layer.owner_type === "user" && layer.kind === "user_posts")) {
            return true;
          }

          if (!userId) return false;
          if (userPostingLayerId && layer.id === userPostingLayerId)
            return true;

          const lowerName = String(layer.name || "").toLowerCase();
          return lowerName.includes(String(userId).toLowerCase());
        });

        const sortedLayers = sortLayers(ownUserLayersOnly);
        const nextLayers = await applySavedLayerOrder(sortedLayers, userId);
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
        console.error("Error loading layers:", error);
        Alert.alert("Error", "Failed to load layers from Supabase.");
      } finally {
        setLayersLoading(false);
      }
    },
    [applySavedLayerOrder, userPostingLayerId],
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
    const incomingCommunityMap = route?.params?.communityMap;
    if (incomingCommunityMap?.id) {
      setCommunityMapContext(incomingCommunityMap);
    }
  }, [route?.params?.communityMap]);

  useEffect(() => {
    fetchAccessibleLayers(currentUser?.id, communityMapContext?.id);
  }, [currentUser?.id, communityMapContext?.id, fetchAccessibleLayers]);

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
        console.error("Error loading friend ids:", error);
        setFriendUserIds([]);
      }
    };

    loadFriendIds();
  }, [currentUser?.id]);

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
        if (renameError) throw renameError;
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
      console.error("Error ensuring user posting layer:", error);
      return null;
    }
  }, [currentUser?.id, userPostingLayerId]);

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
      setPins([]);
      setClouds([]);
      setAllLoadedPosts([]);
      return undefined;
    }

    loadPins(enabledPinLayerKeys);
    const unsubscribe = subscribeToPins(enabledPinLayerKeys);
    return unsubscribe;
  }, [enabledPinLayerKeys, mapMode, layers]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const { visiblePins, visibleClouds } = computeMapVisuals(
        allLoadedPosts,
        region?.latitudeDelta,
      );
      setPins(visiblePins);
      setClouds(visibleClouds);
    });
    return () => cancelAnimationFrame(frame);
  }, [allLoadedPosts, region]);

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
      setPins([]);
      setClouds([]);
      setAllLoadedPosts([]);
      return;
    }

    try {
      const friendsLayerEnabled = layers.some(
        (layer) =>
          layer.isEnabled && getPinLayerKeyFromLayer(layer) === "friends",
      );
      const queryLayerKeys = friendsLayerEnabled
        ? Array.from(new Set([...pinLayerKeys, "private", "public", "friends"]))
        : pinLayerKeys;
      const { data, error } = await supabase
        .from("pins")
        .select("*")
        .in("layer", queryLayerKeys)
        .order("created_at", { ascending: false });

      if (error) throw error;
      const enabledLayerIds = new Set(
        layers.filter((layer) => layer.isEnabled).map((layer) => layer.id),
      );
      const filtered = (data || []).filter((pin) => {
        const friendScopeUserIds = new Set([
          ...(currentUser?.id ? [currentUser.id] : []),
          ...friendUserIds,
        ]);
        if (friendsLayerEnabled && friendScopeUserIds.has(pin.user_id)) {
          return true;
        }
        if (mapMode === "explore" && pin?.layer === "public") {
          return true;
        }
        const selectedLayerId = pin?.geometry?.layer_id;
        if (selectedLayerId) {
          return enabledLayerIds.has(selectedLayerId);
        }
        if (mapMode === "user" && pin?.layer === "public") {
          return false;
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
      const withLayerIcon = deduped.map((pin) => ({
        ...pin,
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
      }));
      setAllLoadedPosts(withLayerIcon);
    } catch (error) {
      console.error("Error loading pins:", error);
      setPins([]);
      setClouds([]);
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
        const { data, error } = await supabase
          .from("pins")
          .select("id,layer,geometry")
          .contains("geometry", { cross_post_group_id: groupId });
        if (error) throw error;
        if (Array.isArray(data) && data.length > 0) {
          relatedRows = data;
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
      console.error("Error loading pin associations:", error);
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
    const optimisticLayers = layers.map((layer) =>
      layer.id === layerId ? { ...layer, isEnabled: nextEnabled } : layer,
    );

    const nextSelected = options.selectAfterToggle
      ? layerId
      : resolveNextSelectedLayerId(optimisticLayers, selectedLayerId);

    setLayers(optimisticLayers);
    setSelectedLayerId(nextSelected);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const authed = supabaseWithAccessToken(session?.access_token || null);

      const { error } = await authed.from("user_layer_prefs").upsert(
        {
          user_id: userId,
          layer_id: layerId,
          hidden: !nextEnabled,
        },
        { onConflict: "user_id,layer_id" },
      );

      if (error) throw error;
      await persistLayerOrder(optimisticLayers, userId);
    } catch (error) {
      if (isRlsPolicyError(error)) {
        console.warn("Layer preference blocked by RLS policy:", error);
      } else {
        console.error("Error updating layer preference:", error);
      }
      setLayers(previousLayers);
      setSelectedLayerId(
        resolveNextSelectedLayerId(previousLayers, selectedLayerId),
      );
      Alert.alert(
        "Layer Update Blocked",
        isRlsPolicyError(error)
          ? "Database policy blocked this layer update. Apply the user_layer_prefs RLS policy migration to allow your account to save layer toggles."
          : "Failed to update layer preference.",
      );
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
      setLayers(next);
      await persistLayerOrder(next, userId);
    },
    [layers, persistLayerOrder, resolveCurrentUserId],
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
      const postableLayerIdSet = new Set(
        layers
          .filter((layer) => getPinLayerKeyFromLayer(layer) !== "friends")
          .map((layer) => layer.id),
      );
      const extraLayerIds = requestedLayerIds.filter(
        (layerId) =>
          postableLayerIdSet.has(layerId) && layerId !== authorLayerId,
      );
      const targetLayerIds = [...new Set([authorLayerId, ...extraLayerIds])];

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
        const postPinLayerKey = getPinLayerKeyFromLayer(targetLayer || null);

        let geometry;
        if (postVisibilityMode === "cloud_only") {
          geometry = {
            type: "Point",
            coordinates: [storedLng, storedLat],
            layer_id: targetLayerId,
            author_layer_id: authorLayerId,
            author_user_id: currentUser.id,
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
            author_user_id: currentUser.id,
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
            author_user_id: currentUser.id,
            cross_post_group_id: crossPostGroupId,
            visibility_mode: "pinned",
          };
        } else {
          geometry = {
            type: "Point",
            coordinates: [storedLng, storedLat],
            layer_id: targetLayerId,
            author_layer_id: authorLayerId,
            author_user_id: currentUser.id,
            cross_post_group_id: crossPostGroupId,
            visibility_mode: "pinned",
          };
        }

        return {
          user_id: currentUser.id,
          type: postData.mediaUrl ? "media" : "text",
          content: postData.content,
          caption: postData.title,
          media_url: postData.mediaUrl || null,
          media_type: postData.mediaType,
          lat: storedLat,
          lng: storedLng,
          layer: postPinLayerKey,
          author_name: currentUser.user_metadata?.display_name || "Anonymous",
          author_username: currentUser.user_metadata?.username || "",
          posted_from_current_location: postData.locationMode === "current",
          geometry,
        };
      });

      const { error } = await supabase.from("pins").insert(insertRows);
      if (error) throw error;

      setDrawingCoords([]);
      setDrawingType(null);
      setPendingPostData(null);
      setIsPickingPostLocation(false);
      Alert.alert("Success", "Post created!");
    } catch (error) {
      console.error("Error creating post:", error);
      Alert.alert("Error", "Failed to create post. Please try again.");
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
        .select("id,caption,content,author_name,created_at,layer,geometry")
        .eq("layer", pinLayerKey)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      const exactLayerPosts = (data || []).filter((post) => {
        if (isCloudOnlyPost(post)) return false;
        if (post?.geometry?.layer_id) {
          return post.geometry.layer_id === layer.id;
        }
        return layer.owner_type === "system";
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

  const loadPinVotes = async (pinId) => {
    try {
      const { data, error } = await supabase
        .from("pin_votes")
        .select("user_id, vote")
        .eq("pin_id", pinId);

      if (error) throw error;

      const summary = { upvotes: 0, downvotes: 0, userVote: 0 };
      (data || []).forEach((voteRow) => {
        if (voteRow.vote === 1) summary.upvotes += 1;
        if (voteRow.vote === -1) summary.downvotes += 1;
        if (voteRow.user_id === currentUser?.id) {
          summary.userVote = voteRow.vote;
        }
      });

      setPinVoteSummary(summary);
    } catch (error) {
      console.error("Error loading pin votes:", error);
      setPinVoteSummary({ upvotes: 0, downvotes: 0, userVote: 0 });
    }
  };

  const handlePinPress = (pin) => {
    setSelectedPin(pin);
    loadPinVotes(pin.id);
    loadPinAssociations(pin);
    setShowDetailModal(true);
  };

  const handleCloudPress = (cloud) => {
    setSelectedCloud(cloud);
    setCloudPostsModalVisible(true);
  };

  const handleRegionChangeComplete = useCallback(
    (nextRegion) => {
      setRegion(nextRegion);
      const { visiblePins, visibleClouds } = computeMapVisuals(
        allLoadedPosts,
        nextRegion?.latitudeDelta,
      );
      setPins(visiblePins);
      setClouds(visibleClouds);
    },
    [allLoadedPosts],
  );

  const handleVotePin = async (vote) => {
    if (!selectedPin || !currentUser) {
      Alert.alert("Sign In Required", "Please sign in to vote on pins");
      return;
    }

    if (selectedPin.user_id === currentUser.id) return;

    try {
      setIsSubmittingVote(true);

      if (pinVoteSummary.userVote === vote) {
        const { error } = await supabase
          .from("pin_votes")
          .delete()
          .eq("pin_id", selectedPin.id)
          .eq("user_id", currentUser.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("pin_votes").upsert(
          {
            pin_id: selectedPin.id,
            user_id: currentUser.id,
            vote,
          },
          { onConflict: "pin_id,user_id" },
        );
        if (error) throw error;
      }

      await loadPinVotes(selectedPin.id);
    } catch (error) {
      console.error("Error voting on pin:", error);
      Alert.alert("Error", "Failed to submit vote. Please try again.");
    } finally {
      setIsSubmittingVote(false);
    }
  };

  const handleUpdatePin = async (pinId, updates) => {
    try {
      const { error } = await supabase
        .from("pins")
        .update(updates)
        .eq("id", pinId);

      if (error) throw error;

      setAllLoadedPosts((prev) =>
        prev.map((pin) => (pin.id === pinId ? { ...pin, ...updates } : pin)),
      );
      setSelectedPin((prev) => (prev ? { ...prev, ...updates } : null));
      Alert.alert("Success", "Pin updated!");
    } catch (error) {
      console.error("Error updating pin:", error);
      Alert.alert("Error", "Failed to update pin");
    }
  };

  const handleDeletePin = async (pinId) => {
    try {
      const { error } = await supabase.from("pins").delete().eq("id", pinId);

      if (error) throw error;

      setAllLoadedPosts((prev) => prev.filter((pin) => pin.id !== pinId));
      setShowDetailModal(false);
      setSelectedPin(null);
      Alert.alert("Success", "Pin deleted!");
    } catch (error) {
      console.error("Error deleting pin:", error);
      Alert.alert("Error", "Failed to delete pin");
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={region}
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
            <Marker coordinate={cloud.center} onPress={() => handleCloudPress(cloud)}>
              <View style={styles.cloudCountBadge}>
                <Text style={styles.cloudCountText}>{cloud.count}</Text>
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
                  return (
                    <View key={post.id} style={styles.postRow}>
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
                      {post.content ? (
                        <Text style={styles.postContent} numberOfLines={4}>
                          {post.content}
                        </Text>
                      ) : null}
                      <Text style={styles.postMeta}>
                        {new Date(post.created_at).toLocaleString()}
                      </Text>
                    </View>
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
        pinVoteSummary={pinVoteSummary}
        isSubmittingVote={isSubmittingVote}
        associatedLayers={selectedPinLayers}
        onVote={handleVotePin}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedPin(null);
          setSelectedPinLayers([]);
          setPinVoteSummary({ upvotes: 0, downvotes: 0, userVote: 0 });
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
