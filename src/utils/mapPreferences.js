import AsyncStorage from "@react-native-async-storage/async-storage";

export const MAP_CLOUDS_ENABLED_STORAGE_KEY = "map_clouds_enabled_v1";
export const DEFAULT_MAP_CLOUDS_ENABLED = true;

export const getMapCloudsEnabled = async () => {
  try {
    const rawValue = await AsyncStorage.getItem(MAP_CLOUDS_ENABLED_STORAGE_KEY);
    if (rawValue == null) return DEFAULT_MAP_CLOUDS_ENABLED;
    return rawValue !== "false";
  } catch (_) {
    return DEFAULT_MAP_CLOUDS_ENABLED;
  }
};

export const setMapCloudsEnabled = async (enabled) => {
  await AsyncStorage.setItem(
    MAP_CLOUDS_ENABLED_STORAGE_KEY,
    enabled ? "true" : "false",
  );
};
