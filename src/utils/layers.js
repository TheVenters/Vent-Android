// File purpose: Layer normalization helpers that derive display names, identity tokens, ownership, and visibility flags.

import { parseLayerKindMetadata } from "./layerKind";

export const PIN_LAYER_VALUES = ["public", "friends", "private"];
const USER_POSTS_LAYER_NAME_REGEX = /^user-(.+)-posts$/i;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Normalizes free-form layer strings for consistent comparisons.
const normalizeValue = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

// Converts normalized layer strings into title-case labels.
const toTitleCaseWords = (value) =>
  String(value || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

// Normalizes layer identity tokens used for matching user/community layers.
const normalizeIdentityToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

// Gets user posts layer slug for the caller.
export const getUserPostsLayerSlug = (layerOrName) => {
  const rawName =
    typeof layerOrName === "string"
      ? layerOrName
      : String(layerOrName?.name || "");
  const match = rawName.trim().match(USER_POSTS_LAYER_NAME_REGEX);
  return match ? normalizeIdentityToken(match[1]) : "";
};

// Checks whether named user posts layer is true.
export const isNamedUserPostsLayer = (layerOrName) => {
  return Boolean(getUserPostsLayerSlug(layerOrName));
};

// Formats layer display name for display.
export const formatLayerDisplayName = (layer, options = {}) => {
  const fallbackDisplayName = String(layer?.display_name || "").trim();
  const rawName = String(layer?.name || "").trim();
  const match = rawName.match(USER_POSTS_LAYER_NAME_REGEX);
  if (!match) {
    return fallbackDisplayName || rawName || "Layer";
  }

  if (layer?.isOwnUserPostsLayer) {
    return "My Posts";
  }

  const slug = String(match[1] || "").trim();
  const normalizedSlug = slug.toLowerCase();
  const currentUserId = String(options.currentUserId || "").trim().toLowerCase();
  const currentUsername = String(options.currentUsername || "")
    .trim()
    .toLowerCase();
  const currentDisplayName = String(options.currentDisplayName || "").trim();

  const isOwn =
    (currentUserId && normalizedSlug === currentUserId) ||
    (currentUsername && normalizedSlug === currentUsername);

  let personName = slug;
  if (
    isOwn ||
    (UUID_REGEX.test(slug) && currentDisplayName) ||
    (currentUserId && UUID_REGEX.test(slug) && normalizedSlug === currentUserId)
  ) {
    personName = currentDisplayName || currentUsername || "My";
  }

  const normalizedPersonName = toTitleCaseWords(personName);
  return `${normalizedPersonName || "My"} Posts`;
};

// Gets pin layer key from layer for the caller.
export const getPinLayerKeyFromLayer = (layer) => {
  if (!layer) return "public";

  const { baseKind } = parseLayerKindMetadata(layer.kind);
  const fromKind = normalizeValue(baseKind);
  if (PIN_LAYER_VALUES.includes(fromKind)) return fromKind;

  const fromName = normalizeValue(layer.name);
  if (PIN_LAYER_VALUES.includes(fromName)) return fromName;
  if (isNamedUserPostsLayer(layer)) return "friends";

  if (layer.owner_type === "user") return "friends";
  if (layer.owner_type === "community") {
    return "public";
  }
  return "public";
};

// Gets preferred user layer for the caller.
export const getPreferredUserLayer = (layers) => {
  if (!Array.isArray(layers)) return null;

  return (
    layers.find((layer) => layer.owner_type === "user" && layer.isEnabled) ||
    layers.find((layer) => {
      if (!layer?.isEnabled) return false;
      if ((layer?.owner_type || "system") !== "system") return false;
      return normalizeValue(layer?.name) === "friends";
    }) ||
    layers.find(
      (layer) =>
        layer.isEnabled && getPinLayerKeyFromLayer(layer) === "friends",
    ) ||
    null
  );
};

// Resolves next selected layer id from available app or backend data.
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

// Supports the sortLayers workflow in this file.
export const sortLayers = (layers) => {
  if (!Array.isArray(layers)) return [];

  return [...layers].sort((a, b) => {
    const ownerA = ownerOrder[a.owner_type] ?? 9;
    const ownerB = ownerOrder[b.owner_type] ?? 9;
    if (ownerA !== ownerB) return ownerA - ownerB;

    return (a.name || "").localeCompare(b.name || "");
  });
};
