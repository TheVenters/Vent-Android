import {
  getPinLayerKeyFromLayer,
  isNamedUserPostsLayer,
} from "../../utils/layers";
import { hasValidCoordinate } from "./mapVisualEngine";
import {
  fetchFriendListsViaEdgeFunction,
  fetchMyPinsViaEdgeFunction,
  fetchVisiblePinsViaEdgeFunction,
} from "../../services/supabase";
import {
  MY_POSTS_AUDIENCE_ORDER,
  getMyPostsAudienceFilterKey,
  isMyPostsAudienceVirtualLayer,
} from "./layerRuntime";
import { hydrateAvatarUrlsInRows } from "../../utils/avatarUrls";

const LAYER_TRACE_ENABLED = false;
const logLayerTrace = (label, payload = null) => {
  if (!LAYER_TRACE_ENABLED) return;
  if (payload === null) {
    console.log(`[LayerTrace] ${label}`);
    return;
  }
  console.log(`[LayerTrace] ${label}`, payload);
};

const normalizeAudienceValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const USER_POSTS_LAYER_NAME_REGEX = /^user-(.+)-posts$/i;
const normalizeIdentityToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
const extractUserPostsLayerSlug = (layer) => {
  const match = String(layer?.name || "").trim().match(USER_POSTS_LAYER_NAME_REGEX);
  return match ? normalizeIdentityToken(match[1]) : "";
};
const doesFriendScopedLayerMatchPinAuthor = (layer, pin) => {
  const layerSlug = extractUserPostsLayerSlug(layer);
  if (!layerSlug) return false;
  const pinUserId = normalizeIdentityToken(pin?.user_id);
  const pinUsername = normalizeIdentityToken(pin?.author_username);
  return (pinUserId && pinUserId === layerSlug) || (pinUsername && pinUsername === layerSlug);
};

const loadMyPins = async (reader, userId, accessToken = null, refreshToken = null) => {
  if (!userId) return [];
  if (accessToken) {
    const edgeRes = await fetchMyPinsViaEdgeFunction(
      accessToken,
      refreshToken,
      userId,
      5000,
    );
    if (!edgeRes?.error && Array.isArray(edgeRes?.data?.pins)) {
      logLayerTrace("resolvePinsForMap:myPosts:edge", {
        count: edgeRes.data.pins.length,
      });
      return edgeRes.data.pins;
    }
    if (edgeRes?.error) {
      logLayerTrace("resolvePinsForMap:myPosts:edgeError", {
        message: String(edgeRes.error?.message || edgeRes.error || ""),
      });
    }
  }

  const ownPinsRes = await reader
    .from("pins")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (ownPinsRes.error) throw ownPinsRes.error;
  logLayerTrace("resolvePinsForMap:myPosts:direct", {
    count: (ownPinsRes.data || []).length,
  });
  return ownPinsRes.data || [];
};

export const resolvePinsForMap = async ({
  reader,
  layers,
  enabledLayerIds,
  enabledAudienceKeys = [],
  ownUserId,
  accessToken,
  refreshToken,
  resolvedRequestUserId,
}) => {
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));
  const layerOrderIndex = new Map(layers.map((layer, index) => [layer.id, index]));
  const enabledAudienceKeySet = new Set(
    (Array.isArray(enabledAudienceKeys) ? enabledAudienceKeys : [])
      .map((key) => normalizeAudienceValue(key))
      .filter(Boolean),
  );
  const includePublicAudience = enabledAudienceKeySet.has("public");
  const includeFriendsAudience = enabledAudienceKeySet.has("friends");
  const includeMyPostsAudienceByKey = new Map(
    MY_POSTS_AUDIENCE_ORDER.map((audienceKey) => [
      audienceKey,
      enabledAudienceKeySet.has(getMyPostsAudienceFilterKey(audienceKey)),
    ]),
  );
  const includeAnyMyPostsAudience = Array.from(
    includeMyPostsAudienceByKey.values(),
  ).some(Boolean);

  const enabledSystemLayerIdsByAudience = new Map([
    ["public", []],
    ["friends", []],
    ["private", []],
  ]);
  const enabledMyPostsVirtualLayerIdsByAudience = new Map(
    MY_POSTS_AUDIENCE_ORDER.map((audienceKey) => [audienceKey, []]),
  );
  layers.forEach((layer) => {
    if (!layer?.isEnabled) return;
    const canDriveMap =
      layer?.viewerCanManage !== false || Boolean(layer?.isForcedEnabled);
    if (!canDriveMap) return;
    if (isMyPostsAudienceVirtualLayer(layer)) {
      const audienceKey = normalizeAudienceValue(layer?.myPostsAudienceKey);
      if (!enabledMyPostsVirtualLayerIdsByAudience.has(audienceKey)) return;
      const existing = enabledMyPostsVirtualLayerIdsByAudience.get(audienceKey) || [];
      if (!existing.includes(layer.id)) existing.push(layer.id);
      enabledMyPostsVirtualLayerIdsByAudience.set(audienceKey, existing);
      return;
    }
    const ownerType = layer?.owner_type || "system";
    if (ownerType !== "system") return;
    const key = getPinLayerKeyFromLayer(layer);
    if (!enabledSystemLayerIdsByAudience.has(key)) return;
    const existing = enabledSystemLayerIdsByAudience.get(key) || [];
    if (!existing.includes(layer.id)) existing.push(layer.id);
    enabledSystemLayerIdsByAudience.set(key, existing);
  });

  const enabledPublicLayerIds = enabledSystemLayerIdsByAudience.get("public") || [];
  const enabledFriendsLayerIds = enabledSystemLayerIdsByAudience.get("friends") || [];

  logLayerTrace("resolvePinsForMap:start", {
    enabledLayerIds,
    enabledAudienceKeys,
    layers: layers.map((layer) => ({
      id: layer.id,
      name: layer.display_name || layer.name,
      owner_type: layer.owner_type,
      kind: layer.kind,
      isEnabled: Boolean(layer.isEnabled),
    })),
  });

  const enabledOwnUserPostingLayerIds = enabledLayerIds.filter((layerId) => {
    const layerMeta = layerById.get(layerId);
    if (!layerMeta) return false;
    return Boolean(layerMeta?.isOwnUserPostsLayer);
  });
  const enabledFriendScopedLayerIds = enabledLayerIds.filter((layerId) => {
    const layerMeta = layerById.get(layerId);
    if (!layerMeta) return false;
    if (!isNamedUserPostsLayer(layerMeta)) return false;
    return !layerMeta?.isOwnUserPostsLayer;
  });

  logLayerTrace("resolvePinsForMap:enabledBuckets", {
    enabledOwnUserPostingLayerIds,
    enabledFriendScopedLayerIds,
    enabledPublicLayerIds,
    enabledFriendsLayerIds,
    includePublicAudience,
    includeFriendsAudience,
    includeMyPostsAudienceByKey: Object.fromEntries(includeMyPostsAudienceByKey),
  });

  const pinById = new Map();
  const membershipsByPinId = new Map();
  const hasUsableDbAuthContext = Boolean(resolvedRequestUserId);
  let visiblePinsFromEdge = null;
  const visiblePinById = new Map();
  let visiblePinsEdgeError = null;

  const systemLayerIdByKey = new Map();
  layers.forEach((layer) => {
    const ownerType = layer?.owner_type || "system";
    if (ownerType !== "system") return;
    const key = getPinLayerKeyFromLayer(layer);
    if (!key) return;
    if (!systemLayerIdByKey.has(key)) systemLayerIdByKey.set(key, layer.id);
  });
  const publicMembershipLayerIds =
    enabledPublicLayerIds.length > 0
      ? enabledPublicLayerIds
      : [systemLayerIdByKey.get("public")].filter(Boolean);
  const friendsMembershipLayerIds =
    enabledFriendsLayerIds.length > 0
      ? enabledFriendsLayerIds
      : [systemLayerIdByKey.get("friends")].filter(Boolean);

  if (accessToken) {
    const visibleRes = await fetchVisiblePinsViaEdgeFunction(
      accessToken,
      refreshToken,
      ownUserId,
      5000,
    );
    if (!visibleRes?.error && Array.isArray(visibleRes?.data?.pins)) {
      visiblePinsFromEdge = visibleRes.data.pins;
      visiblePinsFromEdge.forEach((pin) => {
        const pinId = String(pin?.id || "");
        if (!pinId) return;
        visiblePinById.set(pinId, pin);
      });
      logLayerTrace("resolvePinsForMap:edgeVisiblePins", {
        count: visiblePinsFromEdge.length,
      });
    } else if (visibleRes?.error) {
      visiblePinsEdgeError = visibleRes.error;
      logLayerTrace("resolvePinsForMap:edgeVisiblePinsError", {
        message: String(visibleRes.error?.message || visibleRes.error || ""),
      });
    }
  }

  if (!hasUsableDbAuthContext && accessToken && visiblePinsEdgeError) {
    throw visiblePinsEdgeError;
  }

  let acceptedFriendIds = [];
  let acceptedFriendIdSet = new Set();
  if (ownUserId && (includeFriendsAudience || enabledFriendScopedLayerIds.length > 0)) {
    try {
      const acceptedFriendsRes = await reader
        .from("friends")
        .select("user_id,friend_id,status")
        .or(`user_id.eq.${ownUserId},friend_id.eq.${ownUserId}`)
        .in("status", ["accepted", "active"]);
      if (acceptedFriendsRes.error) throw acceptedFriendsRes.error;
      acceptedFriendIds = Array.from(
        new Set(
          (acceptedFriendsRes.data || [])
            .map((row) => (row.user_id === ownUserId ? row.friend_id : row.user_id))
            .filter(Boolean)
            .filter((id) => id !== ownUserId),
        ),
      );
    } catch (error) {
      if (!accessToken) throw error;
      const friendListsRes = await fetchFriendListsViaEdgeFunction(
        accessToken,
        refreshToken,
        ownUserId,
      );
      if (friendListsRes?.error) throw friendListsRes.error;
      acceptedFriendIds = Array.from(
        new Set(
          (friendListsRes?.data?.friends || [])
            .map((row) => row?.friend?.id || row?.friend_id || row?.user_id || null)
            .filter(Boolean)
            .filter((id) => id !== ownUserId),
        ),
      );
    }
    acceptedFriendIdSet = new Set(acceptedFriendIds);
  }

  if (hasUsableDbAuthContext && enabledLayerIds.length > 0) {
    const membershipRes = await reader
      .from("pin_layer_memberships")
      .select("pin_id,layer_id,pins(*)")
      .in("layer_id", enabledLayerIds)
      .limit(6000);
    if (membershipRes.error) throw membershipRes.error;
    logLayerTrace("resolvePinsForMap:membershipRows", {
      count: (membershipRes.data || []).length,
      source: "direct-db",
    });

    (membershipRes.data || []).forEach((row) => {
      const pinId = String(row?.pin_id || "");
      const layerId = String(row?.layer_id || "");
      const pin = row?.pins || null;
      if (!pinId || !layerId || !pin) return;
      pinById.set(pinId, pin);
      const existing = membershipsByPinId.get(pinId) || [];
      if (!existing.includes(layerId)) existing.push(layerId);
      membershipsByPinId.set(pinId, existing);
    });
  } else if (Array.isArray(visiblePinsFromEdge)) {
    logLayerTrace("resolvePinsForMap:membershipRows", {
      count: visiblePinsFromEdge.length,
      source: "edge-visible-pins",
    });
    visiblePinsFromEdge.forEach((pin) => {
      const pinId = String(pin?.id || "");
      if (!pinId) return;
      pinById.set(pinId, pin);
      const existing = membershipsByPinId.get(pinId) || [];

      const explicitLayerId = String(pin?.explicit_layer_id || "");
      if (explicitLayerId && enabledLayerIds.includes(explicitLayerId) && !existing.includes(explicitLayerId)) {
        existing.push(explicitLayerId);
      }

      const authorLayerId = String(pin?.author_layer_id || "");
      if (authorLayerId && enabledLayerIds.includes(authorLayerId) && !existing.includes(authorLayerId)) {
        existing.push(authorLayerId);
      }

      const audienceKey = normalizeAudienceValue(pin?.base_audience || pin?.layer);
      const audienceLayerIds =
        enabledSystemLayerIdsByAudience.get(audienceKey) || [];
      audienceLayerIds.forEach((layerId) => {
        if (!existing.includes(layerId)) existing.push(layerId);
      });

      membershipsByPinId.set(pinId, existing);
    });
  }

  let ownPinsCache = null;
  const loadOwnPinsCached = async () => {
    if (ownPinsCache) return ownPinsCache;
    ownPinsCache = await loadMyPins(reader, ownUserId, accessToken, refreshToken);
    return ownPinsCache;
  };

  if (
    ownUserId &&
    enabledOwnUserPostingLayerIds.length > 0 &&
    includeAnyMyPostsAudience
  ) {
    const ownPins = await loadOwnPinsCached();
    logLayerTrace("resolvePinsForMap:myPosts", {
      ownUserId,
      count: ownPins.length,
      ids: ownPins.map((pin) => pin.id),
    });
    ownPins.forEach((pin) => {
      const pinId = String(pin?.id || "");
      if (!pinId) return;
      const pinAudience = normalizeAudienceValue(pin?.base_audience || pin?.layer);
      if (!includeMyPostsAudienceByKey.get(pinAudience)) return;
      pinById.set(pinId, pin);
      const existing = membershipsByPinId.get(pinId) || [];
      enabledOwnUserPostingLayerIds.forEach((layerId) => {
        if (!existing.includes(layerId)) existing.push(layerId);
      });
      membershipsByPinId.set(pinId, existing);
    });
  }

  if (ownUserId && includeAnyMyPostsAudience) {
    const ownPins = await loadOwnPinsCached();
    ownPins.forEach((pin) => {
      const pinId = String(pin?.id || "");
      if (!pinId) return;
      const pinAudience = normalizeAudienceValue(pin?.base_audience || pin?.layer);
      if (!MY_POSTS_AUDIENCE_ORDER.includes(pinAudience)) return;
      if (!includeMyPostsAudienceByKey.get(pinAudience)) return;

      pinById.set(pinId, pin);
      const existing = membershipsByPinId.get(pinId) || [];
      const virtualLayerIds =
        enabledMyPostsVirtualLayerIdsByAudience.get(pinAudience) || [];
      virtualLayerIds.forEach((layerId) => {
        if (!existing.includes(layerId)) existing.push(layerId);
      });
      membershipsByPinId.set(pinId, existing);
    });
  }

  if (includePublicAudience) {
    let publicPins = [];
    if (
      hasUsableDbAuthContext ||
      !accessToken ||
      !Array.isArray(visiblePinsFromEdge)
    ) {
      const visiblePublicPinsRes = await reader
        .from("pins")
        .select("*")
        .eq("layer", "public")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (visiblePublicPinsRes.error) throw visiblePublicPinsRes.error;
      publicPins = visiblePublicPinsRes.data || [];
    } else if (Array.isArray(visiblePinsFromEdge)) {
      publicPins = visiblePinsFromEdge.filter(
        (pin) => normalizeAudienceValue(pin?.base_audience || pin?.layer) === "public",
      );
    }

    logLayerTrace("resolvePinsForMap:publicPins", {
      includePublicAudience,
      fetched: publicPins.length,
    });

    publicPins.forEach((pin) => {
      const pinId = String(pin?.id || "");
      if (!pinId) return;
      pinById.set(pinId, pin);
      const existing = membershipsByPinId.get(pinId) || [];
      publicMembershipLayerIds.forEach((layerId) => {
        if (!existing.includes(layerId)) existing.push(layerId);
      });
      membershipsByPinId.set(pinId, existing);
    });
  }

  if (includeFriendsAudience && ownUserId) {
    if (acceptedFriendIds.length > 0) {
      let visibleFriendPins = [];
      if (
        hasUsableDbAuthContext ||
        !accessToken ||
        !Array.isArray(visiblePinsFromEdge)
      ) {
        const visibleFriendPinsRes = await reader
          .from("pins")
          .select("*")
          .in("user_id", acceptedFriendIds)
          .order("created_at", { ascending: false })
          .limit(3000);
        if (visibleFriendPinsRes.error) throw visibleFriendPinsRes.error;
        visibleFriendPins = visibleFriendPinsRes.data || [];
      } else if (Array.isArray(visiblePinsFromEdge)) {
        const friendIdSet = new Set(acceptedFriendIds);
        visibleFriendPins = visiblePinsFromEdge.filter((pin) => {
          const pinUserId = String(pin?.user_id || "");
          if (!pinUserId || !friendIdSet.has(pinUserId)) return false;
          const audience = normalizeAudienceValue(pin?.base_audience || pin?.layer);
          return audience === "public" || audience === "friends";
        });
      }

      logLayerTrace("resolvePinsForMap:friendPins", {
        acceptedFriendIds,
        fetched: visibleFriendPins.length,
      });

      visibleFriendPins.forEach((pin) => {
        const audience = normalizeAudienceValue(pin?.base_audience || pin?.layer);
        if (!(audience === "public" || audience === "friends")) return;
        const pinId = String(pin?.id || "");
        if (!pinId) return;
        pinById.set(pinId, pin);
        const existing = membershipsByPinId.get(pinId) || [];
        const genericFriendsLayerIds = friendsMembershipLayerIds.filter(
          (layerId) => !isNamedUserPostsLayer(layerById.get(layerId)),
        );
        genericFriendsLayerIds.forEach((layerId) => {
          if (!existing.includes(layerId)) existing.push(layerId);
        });
        enabledFriendScopedLayerIds.forEach((layerId) => {
          const layerMeta = layerById.get(layerId);
          if (!layerMeta) return;
          if (!doesFriendScopedLayerMatchPinAuthor(layerMeta, pin)) return;
          if (!existing.includes(layerId)) existing.push(layerId);
        });
        membershipsByPinId.set(pinId, existing);
      });
    }
  }

  if (visiblePinById.size > 0) {
    pinById.forEach((pin, pinId) => {
      const edgePin = visiblePinById.get(pinId);
      if (!edgePin) return;
      pinById.set(pinId, edgePin);
    });
  }

  const pinsData = Array.from(pinById.values());
  if (pinsData.length === 0) {
    return [];
  }

  const pickTopLayerId = (pin, candidateLayerIds) => {
    const uniqueCandidateIds = Array.from(new Set(candidateLayerIds || []));
    if (uniqueCandidateIds.length === 0) return null;
    const pinOwnerId = String(pin?.user_id || "");
    const pinAudience = normalizeAudienceValue(pin?.base_audience || pin?.layer);
    const isOwnPin = pinOwnerId && ownUserId && pinOwnerId === String(ownUserId);
    const privateMyPostsEnabled = Boolean(
      includeMyPostsAudienceByKey.get("private"),
    );

    const sorted = [...uniqueCandidateIds].sort((a, b) => {
      const rankA = layerOrderIndex.has(a)
        ? layerOrderIndex.get(a)
        : Number.MAX_SAFE_INTEGER;
      const rankB = layerOrderIndex.has(b)
        ? layerOrderIndex.get(b)
        : Number.MAX_SAFE_INTEGER;
      return rankA - rankB;
    });

    const validSorted = sorted.filter((layerId) => {
      const layerMeta = layerById.get(layerId) || null;
      if (!layerMeta) return false;
      const pinKey = getPinLayerKeyFromLayer(layerMeta);
      const layerOwnerType = layerMeta?.owner_type || "system";
      if (layerMeta?.isMyPostsAudienceVirtual) {
        const isOwn = pinOwnerId && ownUserId && pinOwnerId === String(ownUserId);
        if (!isOwn) return false;
        const audienceKey = normalizeAudienceValue(
          layerMeta?.myPostsAudienceKey || pinKey,
        );
        return audienceKey && pinAudience === audienceKey;
      }

      if (layerMeta?.isOwnUserPostsLayer) {
        return pinOwnerId && ownUserId && pinOwnerId === String(ownUserId);
      }

      if (pinKey === "friends") {
        const isOwn = pinOwnerId && ownUserId && pinOwnerId === String(ownUserId);
        const isFriend = pinOwnerId && acceptedFriendIdSet.has(pinOwnerId);
        if (!isOwn && !isFriend) return false;
        if (!(pinAudience === "public" || pinAudience === "friends")) return false;
        if (isNamedUserPostsLayer(layerMeta)) {
          return doesFriendScopedLayerMatchPinAuthor(layerMeta, pin);
        }
      }

      return true;
    });

    const topLayerId = validSorted[0] || null;
    if (!topLayerId) return null;

    // Final safety gate: own private posts must not leak through unless
    // MyPosts private is enabled, or another non-private enabled layer
    // legitimately admits the post.
    if (isOwnPin && pinAudience === "private" && !privateMyPostsEnabled) {
      const topLayer = layerById.get(topLayerId) || null;
      if (!topLayer) return null;
      const topLayerKey = getPinLayerKeyFromLayer(topLayer);
      const topOwnerType = topLayer?.owner_type || "system";
      const topIsOwnScoped =
        Boolean(topLayer?.isOwnUserPostsLayer) ||
        Boolean(topLayer?.isMyPostsAudienceVirtual);
      const topIsSystemPrivate =
        topOwnerType === "system" && topLayerKey === "private";
      if (topIsOwnScoped || topIsSystemPrivate) {
        return null;
      }
    }

    return topLayerId;
  };

  const withResolvedLayer = pinsData
    .map((pin) => {
      const pinId = String(pin?.id || "");
      if (!pinId) return null;
      const candidateLayerIds = membershipsByPinId.get(pinId) || [];
      const topLayerId = pickTopLayerId(pin, candidateLayerIds);
      if (!topLayerId) return null;
      return { pin, topLayerId };
    })
    .filter(Boolean);
  logLayerTrace("resolvePinsForMap:resolvedLayers", {
    count: withResolvedLayer.length,
    rows: withResolvedLayer.slice(0, 100).map(({ pin, topLayerId }) => ({
      pin_id: pin.id,
      pin_user_id: pin.user_id,
      topLayerId,
      topLayerName: layerById.get(topLayerId)?.display_name || layerById.get(topLayerId)?.name || null,
    })),
  });

  const deduped = [];
  const byGroup = new Map();
  withResolvedLayer.forEach(({ pin, topLayerId }) => {
    const groupKey = pin?.geometry?.cross_post_group_id || String(pin?.id || "");
    const existing = byGroup.get(groupKey);
    if (!existing) {
      byGroup.set(groupKey, { pin, topLayerId });
      return;
    }
    const existingRank = layerOrderIndex.has(existing.topLayerId)
      ? layerOrderIndex.get(existing.topLayerId)
      : Number.MAX_SAFE_INTEGER;
    const currentRank = layerOrderIndex.has(topLayerId)
      ? layerOrderIndex.get(topLayerId)
      : Number.MAX_SAFE_INTEGER;
    if (currentRank < existingRank) {
      byGroup.set(groupKey, { pin, topLayerId });
    }
  });
  byGroup.forEach((value) => deduped.push(value));

  const userIds = Array.from(new Set(deduped.map((row) => row.pin?.user_id).filter(Boolean)));
  const profileByUserId = new Map();
  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await reader
      .from("profiles")
      .select("id,username,avatar_url")
      .in("id", userIds);
    if (profileError) throw profileError;
    const hydratedProfiles = await hydrateAvatarUrlsInRows(
      profiles || [],
      "avatar_url",
      accessToken ? { access_token: accessToken } : null,
    );
    hydratedProfiles.forEach((profile) => profileByUserId.set(profile.id, profile));
  }

  const layerIconById = new Map(layers.map((layer) => [layer.id, layer.layer_icon || null]));

  const result = deduped
    .map(({ pin, topLayerId }) => {
      const numericLat = Number(pin?.lat);
      const numericLng = Number(pin?.lng);
      const baseGeometry =
        pin?.geometry && typeof pin.geometry === "object" ? pin.geometry : {};
      return {
        ...pin,
        lat: Number.isFinite(numericLat) ? numericLat : pin?.lat,
        lng: Number.isFinite(numericLng) ? numericLng : pin?.lng,
        geometry: {
          ...baseGeometry,
          layer_id: topLayerId,
        },
        author_avatar_url:
          profileByUserId.get(pin.user_id)?.avatar_url ||
          pin.author_avatar_url ||
          null,
        author_username:
          pin.author_username || profileByUserId.get(pin.user_id)?.username || "",
        // Strict priority: only the resolved top layer controls marker emoji.
        layer_emoji: topLayerId ? layerIconById.get(topLayerId) || null : null,
      };
    })
    .filter(hasValidCoordinate);
  logLayerTrace("resolvePinsForMap:done", { count: result.length });
  return result;
};
