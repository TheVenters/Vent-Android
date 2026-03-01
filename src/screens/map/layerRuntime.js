import { getPinLayerKeyFromLayer } from "../../utils/layers";

export const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );

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

    const ownerType = layer?.owner_type || "system";
    if (ownerType !== "system") return;

    const key = getPinLayerKeyFromLayer(layer);
    if (!["public", "friends", "private"].includes(key)) return;
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
  return enabledRenderable.every((layer) => !isUuid(String(layer?.id || "")));
};
