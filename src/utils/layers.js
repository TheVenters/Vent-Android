import { parseLayerKindMetadata } from "./layerKind";

export const PIN_LAYER_VALUES = ["public", "friends", "private"];

const normalizeValue = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const getPinLayerKeyFromLayer = (layer) => {
  if (!layer) return "public";

  const { baseKind } = parseLayerKindMetadata(layer.kind);
  const fromKind = normalizeValue(baseKind);
  if (PIN_LAYER_VALUES.includes(fromKind)) return fromKind;

  const fromName = normalizeValue(layer.name);
  if (PIN_LAYER_VALUES.includes(fromName)) return fromName;

  if (layer.owner_type === "user") return "friends";
  if (layer.owner_type === "community") {
    return "public";
  }
  return "public";
};

export const getPreferredUserLayer = (layers) => {
  if (!Array.isArray(layers)) return null;

  return (
    layers.find((layer) => layer.owner_type === "user" && layer.isEnabled) ||
    layers.find(
      (layer) =>
        layer.isEnabled && getPinLayerKeyFromLayer(layer) === "friends",
    ) ||
    null
  );
};

export const resolveNextSelectedLayerId = (layers, currentSelectedId) => {
  if (!Array.isArray(layers) || layers.length === 0) return null;

  const enabledLayers = layers.filter((layer) => layer.isEnabled);

  const currentEnabled = enabledLayers.find(
    (layer) => layer.id === currentSelectedId,
  );
  if (currentEnabled) return currentEnabled.id;

  const preferred = getPreferredUserLayer(enabledLayers);
  if (preferred) return preferred.id;

  if (enabledLayers[0]) return enabledLayers[0].id;
  return layers[0]?.id || null;
};

const ownerOrder = {
  user: 0,
  community: 1,
  system: 2,
};

export const sortLayers = (layers) => {
  if (!Array.isArray(layers)) return [];

  return [...layers].sort((a, b) => {
    const ownerA = ownerOrder[a.owner_type] ?? 9;
    const ownerB = ownerOrder[b.owner_type] ?? 9;
    if (ownerA !== ownerB) return ownerA - ownerB;

    return (a.name || "").localeCompare(b.name || "");
  });
};
