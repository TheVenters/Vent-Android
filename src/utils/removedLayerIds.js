// File purpose: AsyncStorage helpers for persisting layer IDs hidden by a specific user.

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_PREFIX = "removed_layer_ids_v1";

// Builds the AsyncStorage key used to save hidden layers per user.
const storageKeyForUser = (userId) =>
  `${STORAGE_PREFIX}:${String(userId || "anon")}`;

// Normalizes persisted hidden layer IDs into a unique string list.
const normalizeIds = (value) => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  );
};

// Reads removed layer ids from the current environment or input.
export const readRemovedLayerIds = async (userId) => {
  if (!userId) return new Set();
  try {
    const raw = await AsyncStorage.getItem(storageKeyForUser(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(normalizeIds(parsed));
  } catch (_) {
    return new Set();
  }
};

// Supports the writeRemovedLayerIds workflow in this file.
export const writeRemovedLayerIds = async (userId, idsSet) => {
  if (!userId) return;
  const normalized = normalizeIds(Array.from(idsSet || []));
  await AsyncStorage.setItem(
    storageKeyForUser(userId),
    JSON.stringify(normalized),
  );
};

// Supports the setLayerRemovedState workflow in this file.
export const setLayerRemovedState = async (userId, layerId, removed) => {
  if (!userId || !layerId) return;
  const current = await readRemovedLayerIds(userId);
  const normalizedLayerId = String(layerId);
  if (removed) {
    current.add(normalizedLayerId);
  } else {
    current.delete(normalizedLayerId);
  }
  await writeRemovedLayerIds(userId, current);
};
