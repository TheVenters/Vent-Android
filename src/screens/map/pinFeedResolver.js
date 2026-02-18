import { getPinLayerKeyFromLayer } from "../../utils/layers";
import { hasValidCoordinate } from "./mapVisualEngine";
import { isUserPostingLayer } from "./layerRuntime";
import {
  fetchMyPinsViaEdgeFunction,
  fetchVisiblePinsViaEdgeFunction,
} from "../../services/supabase";

const LAYER_TRACE_ENABLED = false;
const logLayerTrace = (label, payload = null) => {
  if (!LAYER_TRACE_ENABLED) return;
  if (payload === null) {
    console.log(`[LayerTrace] ${label}`);
    return;
  }
  console.log(`[LayerTrace] ${label}`, payload);
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
  ownUserId,
  currentUser,
  accessToken,
  refreshToken,
  resolvedRequestUserId,
}) => {
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));
  const layerOrderIndex = new Map(layers.map((layer, index) => [layer.id, index]));
  logLayerTrace("resolvePinsForMap:start", {
    enabledLayerIds,
    layers: layers.map((layer) => ({
      id: layer.id,
      name: layer.display_name || layer.name,
      owner_type: layer.owner_type,
      kind: layer.kind,
      isEnabled: Boolean(layer.isEnabled),
    })),
  });

  const enabledUserPostingLayerIds = enabledLayerIds.filter((layerId) =>
    isUserPostingLayer(layerById.get(layerId)),
  );

  const enabledFriendsLayerIds = enabledLayerIds.filter((layerId) => {
    const layerMeta = layerById.get(layerId) || null;
    return (
      (layerMeta?.owner_type || "system") === "system" &&
      getPinLayerKeyFromLayer(layerMeta) === "friends"
    );
  });
  logLayerTrace("resolvePinsForMap:enabledBuckets", {
    enabledUserPostingLayerIds,
    enabledFriendsLayerIds,
  });

  const pinById = new Map();
  const membershipsByPinId = new Map();
  const hasUsableDbAuthContext = Boolean(resolvedRequestUserId);

  const systemLayerIdByKey = new Map();
  layers.forEach((layer) => {
    const ownerType = layer?.owner_type || "system";
    if (ownerType !== "system") return;
    const key = getPinLayerKeyFromLayer(layer);
    if (!key) return;
    if (!systemLayerIdByKey.has(key)) systemLayerIdByKey.set(key, layer.id);
  });

  if (hasUsableDbAuthContext) {
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
  } else if (accessToken) {
    const visibleRes = await fetchVisiblePinsViaEdgeFunction(
      accessToken,
      refreshToken,
      ownUserId,
      5000,
    );
    if (visibleRes?.error) {
      throw visibleRes.error;
    }
    const visiblePins = Array.isArray(visibleRes?.data?.pins)
      ? visibleRes.data.pins
      : [];
    logLayerTrace("resolvePinsForMap:membershipRows", {
      count: visiblePins.length,
      source: "edge-visible-pins",
    });
    visiblePins.forEach((pin) => {
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

      const audienceKey = String(pin?.base_audience || pin?.layer || "").toLowerCase();
      const baseSystemLayerId = systemLayerIdByKey.get(audienceKey) || null;
      if (baseSystemLayerId && enabledLayerIds.includes(baseSystemLayerId) && !existing.includes(baseSystemLayerId)) {
        existing.push(baseSystemLayerId);
      }

      membershipsByPinId.set(pinId, existing);
    });
  }

  if (ownUserId && enabledUserPostingLayerIds.length > 0) {
    const ownPins = await loadMyPins(reader, ownUserId, accessToken, refreshToken);
    logLayerTrace("resolvePinsForMap:myPosts", {
      ownUserId,
      count: ownPins.length,
      ids: ownPins.map((pin) => pin.id),
    });
    ownPins.forEach((pin) => {
      const pinId = String(pin?.id || "");
      if (!pinId) return;
      pinById.set(pinId, pin);
      const existing = membershipsByPinId.get(pinId) || [];
      enabledUserPostingLayerIds.forEach((layerId) => {
        if (!existing.includes(layerId)) existing.push(layerId);
      });
      membershipsByPinId.set(pinId, existing);
    });
  }

  if (enabledFriendsLayerIds.length > 0 && ownUserId) {
    const acceptedFriendsRes = await reader
      .from("friends")
      .select("user_id,friend_id,status")
      .or(`user_id.eq.${ownUserId},friend_id.eq.${ownUserId}`)
      .in("status", ["accepted", "active"]);
    if (acceptedFriendsRes.error) throw acceptedFriendsRes.error;

    const acceptedFriendIds = Array.from(
      new Set(
        (acceptedFriendsRes.data || [])
          .map((row) => (row.user_id === ownUserId ? row.friend_id : row.user_id))
          .filter(Boolean)
          .filter((id) => id !== ownUserId),
      ),
    );

    if (acceptedFriendIds.length > 0) {
      const visibleFriendPinsRes = await reader
        .from("pins")
        .select("*")
        .in("user_id", acceptedFriendIds)
        .order("created_at", { ascending: false })
        .limit(3000);
      if (visibleFriendPinsRes.error) throw visibleFriendPinsRes.error;
      logLayerTrace("resolvePinsForMap:friendPins", {
        acceptedFriendIds,
        fetched: (visibleFriendPinsRes.data || []).length,
      });

      (visibleFriendPinsRes.data || []).forEach((pin) => {
        const audience = String(pin?.base_audience || pin?.layer || "").toLowerCase();
        if (!(audience === "public" || audience === "friends")) return;
        const pinId = String(pin?.id || "");
        if (!pinId) return;
        pinById.set(pinId, pin);
        const existing = membershipsByPinId.get(pinId) || [];
        enabledFriendsLayerIds.forEach((layerId) => {
          if (!existing.includes(layerId)) existing.push(layerId);
        });
        membershipsByPinId.set(pinId, existing);
      });
    }
  }

  const pinsData = Array.from(pinById.values());
  if (pinsData.length === 0) {
    return [];
  }

  const pickTopLayerId = (pin, candidateLayerIds) => {
    const uniqueCandidateIds = Array.from(new Set(candidateLayerIds || []));
    if (uniqueCandidateIds.length === 0) return null;

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
      const pinOwnerId = String(pin?.user_id || "");
      if (!isUserPostingLayer(layerMeta)) return true;
      return pinOwnerId && ownUserId && pinOwnerId === String(ownUserId);
    });

    return validSorted[0] || null;
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
    (profiles || []).forEach((profile) => profileByUserId.set(profile.id, profile));
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
          (pin.user_id === currentUser?.id
            ? currentUser?.user_metadata?.avatar_url || null
            : null),
        author_username:
          pin.author_username || profileByUserId.get(pin.user_id)?.username || "",
        layer_emoji:
          (topLayerId ? layerIconById.get(topLayerId) || null : null) ||
          (pin?.explicit_layer_id
            ? layerIconById.get(String(pin.explicit_layer_id)) || null
            : null),
      };
    })
    .filter(hasValidCoordinate);
  logLayerTrace("resolvePinsForMap:done", { count: result.length });
  return result;
};
