import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_PREFIX = "removed_layer_ids_v1";

const storageKeyForUser = (userId) =>
  `${STORAGE_PREFIX}:${String(userId || "anon")}`;

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

export const writeRemovedLayerIds = async (userId, idsSet) => {
  if (!userId) return;
  const normalized = normalizeIds(Array.from(idsSet || []));
  await AsyncStorage.setItem(
    storageKeyForUser(userId),
    JSON.stringify(normalized),
  );
};

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
