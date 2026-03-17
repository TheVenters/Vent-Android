import { getPinLayerKeyFromLayer } from "../../utils/layers";

export const MY_POSTS_AUDIENCE_ORDER = ["private", "public", "friends"];
export const MY_POSTS_AUDIENCE_VIRTUAL_LAYER_IDS = {
  private: "virtual-my-posts-private",
  public: "virtual-my-posts-public",
  friends: "virtual-my-posts-friends",
};
const MY_POSTS_AUDIENCE_KEY_PREFIX = "my-posts-";

export const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );

export const getMyPostsAudienceFilterKey = (audienceKey) => {
  const normalized = String(audienceKey || "")
    .trim()
    .toLowerCase();
  if (!MY_POSTS_AUDIENCE_ORDER.includes(normalized)) return "";
  return `${MY_POSTS_AUDIENCE_KEY_PREFIX}${normalized}`;
};

export const isMyPostsAudienceVirtualLayer = (layer) => {
  const audienceKey = String(layer?.myPostsAudienceKey || "")
    .trim()
    .toLowerCase();
  if (!layer?.isMyPostsAudienceVirtual) return false;
  if (!MY_POSTS_AUDIENCE_ORDER.includes(audienceKey)) return false;
  const expectedId = MY_POSTS_AUDIENCE_VIRTUAL_LAYER_IDS[audienceKey];
  return String(layer?.id || "") === expectedId;
};

export const toNormalizedLayerIdKey = (layerIds) =>
  Array.from(
    new Set((Array.isArray(layerIds) ? layerIds : []).map((id) => String(id))),
  )
    .filter(Boolean)
    .join("|");

export const isUserPostingLayer = (layer) => {
  const ownerType = layer?.owner_type || "system";
  return ownerType === "user";
};

export const buildFallbackLayers = (userId) => {
  const asEnabled = Boolean(userId);
  const baseLayers = [
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
  ];

  if (!userId) {
    return baseLayers;
  }

  return [
    ...baseLayers,
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

export const ensureCoreSystemLayers = (inputLayers, userId) => {
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

export const getEnabledLayerIdsForMap = (layerRows) => {
  const enabledLayerIds = (Array.isArray(layerRows) ? layerRows : [])
    .filter((layer) => {
      if (!layer?.isEnabled) return false;
      const canDriveMap =
        layer?.viewerCanManage !== false || Boolean(layer?.isForcedEnabled);
      if (!canDriveMap) return false;
      if (layer?.isOwnUserPostsLayer) return false;
      const ownerType = layer?.owner_type || "system";
      const pinKey = getPinLayerKeyFromLayer(layer);
      // Private audience visibility is controlled by the virtual
      // MyPosts private layer (my-posts-private), not by hidden
      // system private UUID layers.
      if (ownerType === "system" && pinKey === "private") return false;
      return isUuid(String(layer?.id || ""));
    })
    .map((layer) => layer.id);

  return Array.from(new Set(enabledLayerIds));
};

export const getEnabledAudienceKeysForMap = (layerRows) => {
  const enabledAudienceKeys = new Set();

  (Array.isArray(layerRows) ? layerRows : []).forEach((layer) => {
    if (!layer?.isEnabled) return;
    const canDriveMap =
      layer?.viewerCanManage !== false || Boolean(layer?.isForcedEnabled);
    if (!canDriveMap) return;
    if (isMyPostsAudienceVirtualLayer(layer)) {
      const virtualKey = getMyPostsAudienceFilterKey(layer.myPostsAudienceKey);
      if (virtualKey) enabledAudienceKeys.add(virtualKey);
      return;
    }

    const ownerType = layer?.owner_type || "system";
    if (ownerType !== "system") return;

    const key = getPinLayerKeyFromLayer(layer);
    if (!["public", "friends"].includes(key)) return;
    enabledAudienceKeys.add(key);
  });

  return Array.from(enabledAudienceKeys);
};

const getEnabledRenderableLayers = (layerRows) =>
  (Array.isArray(layerRows) ? layerRows : []).filter((layer) => {
    if (!layer?.isEnabled) return false;
    return layer?.viewerCanManage !== false || Boolean(layer?.isForcedEnabled);
  });

export const shouldKeepPinsWhenNoUuidLayers = (layerRows) => {
  const enabledRenderable = getEnabledRenderableLayers(layerRows);
  if (enabledRenderable.length === 0) return false;
  return enabledRenderable.every((layer) => {
    const id = String(layer?.id || "");
    if (isUuid(id)) return false;
    if ((layer?.owner_type || "system") !== "system") return false;
    return id.startsWith("fallback-");
  });
};
