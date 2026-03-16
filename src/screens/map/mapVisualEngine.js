const CLOUD_MIN_POST_COUNT = 2;
const CLOUD_RADIUS_PADDING_METERS = 40;
const CLOUD_MIN_RADIUS_METERS = 120;
const CLOUD_MAX_RADIUS_METERS = 1000;
// Reduced sensitivity so nearby pins stay separate longer before becoming clouds.
const CLUSTER_DISTANCE_PX = 44;
const CLUSTER_MERGE_DISTANCE_PX = 50;
const CLUSTER_VIEWPORT_PADDING_PX = 160;

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

export const hasValidCoordinate = (post) =>
  typeof post?.lat === "number" &&
  Number.isFinite(post.lat) &&
  typeof post?.lng === "number" &&
  Number.isFinite(post.lng);

const normalizeLongitude = (longitude) => {
  if (!Number.isFinite(longitude)) return longitude;
  let next = longitude;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  return next;
};

const isLongitudeWithinBounds = (longitude, minLng, maxLng) => {
  if (minLng <= maxLng) {
    return longitude >= minLng && longitude <= maxLng;
  }
  return longitude >= minLng || longitude <= maxLng;
};

export const isCoordinateWithinRegionBounds = (
  coordinate,
  mapRegion,
  paddingRatio = 0,
) => {
  if (
    !Number.isFinite(coordinate?.latitude) ||
    !Number.isFinite(coordinate?.longitude)
  ) {
    return false;
  }

  const centerLat = Number(mapRegion?.latitude);
  const centerLng = Number(mapRegion?.longitude);
  const latitudeDelta = Number(mapRegion?.latitudeDelta);
  const longitudeDelta = Number(mapRegion?.longitudeDelta);

  if (
    !Number.isFinite(centerLat) ||
    !Number.isFinite(centerLng) ||
    !Number.isFinite(latitudeDelta) ||
    !Number.isFinite(longitudeDelta) ||
    latitudeDelta <= 0 ||
    longitudeDelta <= 0
  ) {
    return true;
  }

  const latPadding = latitudeDelta * paddingRatio;
  const lngPadding = longitudeDelta * paddingRatio;

  const minLat = centerLat - latitudeDelta / 2 - latPadding;
  const maxLat = centerLat + latitudeDelta / 2 + latPadding;
  if (coordinate.latitude < minLat || coordinate.latitude > maxLat) {
    return false;
  }

  if (longitudeDelta + lngPadding * 2 >= 360) {
    return true;
  }

  const longitude = normalizeLongitude(coordinate.longitude);
  const minLng = normalizeLongitude(centerLng - longitudeDelta / 2 - lngPadding);
  const maxLng = normalizeLongitude(centerLng + longitudeDelta / 2 + lngPadding);
  return isLongitudeWithinBounds(longitude, minLng, maxLng);
};

const toScreenPoint = (coordinate, mapRegion, mapSize) => {
  const width = Number(mapSize?.width || 0);
  const height = Number(mapSize?.height || 0);
  const latitudeDelta = Number(mapRegion?.latitudeDelta || 0);
  const longitudeDelta = Number(mapRegion?.longitudeDelta || 0);
  const centerLat = Number(mapRegion?.latitude || 0);
  const centerLng = Number(mapRegion?.longitude || 0);

  if (
    width <= 0 ||
    height <= 0 ||
    latitudeDelta <= 0 ||
    longitudeDelta <= 0 ||
    !Number.isFinite(centerLat) ||
    !Number.isFinite(centerLng)
  ) {
    return null;
  }

  const minLat = centerLat - latitudeDelta / 2;
  const maxLat = centerLat + latitudeDelta / 2;
  const minLng = centerLng - longitudeDelta / 2;

  return {
    x: ((coordinate.longitude - minLng) / longitudeDelta) * width,
    y: ((maxLat - coordinate.latitude) / latitudeDelta) * height,
  };
};

const isScreenPointWithinClusterViewport = (
  screenPoint,
  mapSize,
  paddingPx = CLUSTER_VIEWPORT_PADDING_PX,
) => {
  if (!screenPoint) return false;
  const width = Number(mapSize?.width || 0);
  const height = Number(mapSize?.height || 0);
  if (width <= 0 || height <= 0) return false;

  return (
    screenPoint.x >= -paddingPx &&
    screenPoint.x <= width + paddingPx &&
    screenPoint.y >= -paddingPx &&
    screenPoint.y <= height + paddingPx
  );
};

export const isCloudOnlyPost = (pin) =>
  pin?.geometry?.visibility_mode === "cloud_only";

const buildCloudFromPosts = (groupPosts) => {
  if (!Array.isArray(groupPosts) || groupPosts.length === 0) {
    return null;
  }

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
    Math.max(CLOUD_MIN_RADIUS_METERS, farthest + CLOUD_RADIUS_PADDING_METERS),
  );

  const sortedPostIds = groupPosts
    .map((post) => String(post?.id || ""))
    .filter(Boolean)
    .sort();

  return {
    id: `cloud-${sortedPostIds.join("-")}`,
    center,
    radiusMeters: computedRadius,
    count: groupPosts.length,
    privacyCount: groupPosts.filter(isCloudOnlyPost).length,
    posts: groupPosts,
  };
};

const buildCloudsFromPosts = (posts, mapRegion, mapSize) => {
  const candidates = (posts || []).filter(hasValidCoordinate);
  if (candidates.length < CLOUD_MIN_POST_COUNT) return [];

  const clusterDistancePx = CLUSTER_DISTANCE_PX;
  const clusterDistancePxSq = clusterDistancePx * clusterDistancePx;
  const cellSize = clusterDistancePx;
  const toCell = (value) => Math.floor(value / cellSize);
  const cellKey = (x, y) => `${x}:${y}`;

  const points = candidates
    .map((post) => {
      const coord = { latitude: post.lat, longitude: post.lng };
      const screenPoint = toScreenPoint(coord, mapRegion, mapSize);
      if (
        !screenPoint ||
        !isScreenPointWithinClusterViewport(screenPoint, mapSize)
      ) {
        return null;
      }
      return {
        post,
        screenX: screenPoint.x,
        screenY: screenPoint.y,
        cellX: toCell(screenPoint.x),
        cellY: toCell(screenPoint.y),
      };
    })
    .filter(Boolean);

  if (points.length < CLOUD_MIN_POST_COUNT) return [];

  const grid = new Map();
  points.forEach((point, index) => {
    const key = cellKey(point.cellX, point.cellY);
    const bucket = grid.get(key) || [];
    bucket.push(index);
    grid.set(key, bucket);
  });

  const visited = new Array(points.length).fill(false);
  const clouds = [];

  for (let i = 0; i < points.length; i += 1) {
    if (visited[i]) continue;
    const queue = [i];
    const groupIndexes = [];
    visited[i] = true;

    while (queue.length > 0) {
      const sourceIndex = queue.shift();
      const source = points[sourceIndex];
      groupIndexes.push(sourceIndex);

      for (let x = source.cellX - 1; x <= source.cellX + 1; x += 1) {
        for (let y = source.cellY - 1; y <= source.cellY + 1; y += 1) {
          const neighborIndexes = grid.get(cellKey(x, y)) || [];
          for (let k = 0; k < neighborIndexes.length; k += 1) {
            const targetIndex = neighborIndexes[k];
            if (visited[targetIndex]) continue;
            const target = points[targetIndex];
            const deltaX = source.screenX - target.screenX;
            const deltaY = source.screenY - target.screenY;
            const distanceSq = deltaX * deltaX + deltaY * deltaY;
            if (distanceSq <= clusterDistancePxSq) {
              visited[targetIndex] = true;
              queue.push(targetIndex);
            }
          }
        }
      }
    }

    if (groupIndexes.length < CLOUD_MIN_POST_COUNT) continue;

    const groupPosts = groupIndexes.map((index) => points[index].post);
    const cloud = buildCloudFromPosts(groupPosts);
    if (cloud) {
      clouds.push(cloud);
    }
  }

  return clouds;
};

const mergeNearbyClouds = (clouds, mapRegion, mapSize) => {
  if (!Array.isArray(clouds) || clouds.length < 2) return clouds || [];

  const mergeDistanceSq = CLUSTER_MERGE_DISTANCE_PX * CLUSTER_MERGE_DISTANCE_PX;
  const visited = new Array(clouds.length).fill(false);
  const merged = [];

  const cloudNodes = clouds.map((cloud) => ({
    cloud,
    screenPoint: toScreenPoint(cloud.center, mapRegion, mapSize),
  }));

  for (let i = 0; i < cloudNodes.length; i += 1) {
    if (visited[i]) continue;
    visited[i] = true;
    const queue = [i];
    const groupIndexes = [];

    while (queue.length > 0) {
      const sourceIndex = queue.shift();
      groupIndexes.push(sourceIndex);
      const source = cloudNodes[sourceIndex];
      if (!source?.screenPoint) continue;

      for (let j = 0; j < cloudNodes.length; j += 1) {
        if (visited[j]) continue;
        const target = cloudNodes[j];
        if (!target?.screenPoint) continue;

        const deltaX = source.screenPoint.x - target.screenPoint.x;
        const deltaY = source.screenPoint.y - target.screenPoint.y;
        const distanceSq = deltaX * deltaX + deltaY * deltaY;
        if (distanceSq <= mergeDistanceSq) {
          visited[j] = true;
          queue.push(j);
        }
      }
    }

    if (groupIndexes.length === 1) {
      merged.push(cloudNodes[groupIndexes[0]].cloud);
      continue;
    }

    const mergedPosts = [];
    groupIndexes.forEach((index) => {
      mergedPosts.push(...(cloudNodes[index].cloud?.posts || []));
    });
    const mergedCloud = buildCloudFromPosts(mergedPosts);
    if (mergedCloud) {
      merged.push(mergedCloud);
    }
  }

  return merged;
};

export const computeMapVisuals = (
  posts,
  mapRegion,
  mapSize,
  focusedPinId = null,
  options = {},
) => {
  const normalizedPosts = (Array.isArray(posts) ? posts : []).filter(
    hasValidCoordinate,
  );
  const cloudsEnabled = options?.cloudsEnabled !== false;

  if (!cloudsEnabled) {
    return { visiblePins: normalizedPosts, visibleClouds: [] };
  }

  const baseClusters = buildCloudsFromPosts(
    normalizedPosts,
    mapRegion,
    mapSize,
  );
  const clusters = mergeNearbyClouds(baseClusters, mapRegion, mapSize);

  const visibleClouds = [];
  const clusteredPinnedIds = new Set();
  const clusteredPostIds = new Set();

  clusters.forEach((cloud) => {
    const pinnedCount = cloud.count - cloud.privacyCount;
    const hasPrivacyPosts = cloud.privacyCount > 0;
    const shouldShowCloud = hasPrivacyPosts || pinnedCount >= CLOUD_MIN_POST_COUNT;
    if (!shouldShowCloud) return;

    const cloudScreenPoint = toScreenPoint(cloud.center, mapRegion, mapSize);
    const isCloudVisible = isScreenPointWithinClusterViewport(
      cloudScreenPoint,
      mapSize,
      CLUSTER_VIEWPORT_PADDING_PX,
    );
    if (!isCloudVisible) return;

    (cloud.posts || []).forEach((post) => {
      if (post?.id) clusteredPostIds.add(post.id);
    });
    if (pinnedCount >= CLOUD_MIN_POST_COUNT) {
      (cloud.posts || []).forEach((post) => {
        if (post?.id && !isCloudOnlyPost(post)) {
          clusteredPinnedIds.add(post.id);
        }
      });
    }
    const badgeCount = pinnedCount > 0 ? pinnedCount : cloud.count;
    visibleClouds.push({ ...cloud, badgeCount });
  });

  normalizedPosts
    .filter((post) => isCloudOnlyPost(post) && !clusteredPostIds.has(post.id))
    .forEach((post) => {
      const cloudCenter = { latitude: post.lat, longitude: post.lng };
      const cloudScreenPoint = toScreenPoint(cloudCenter, mapRegion, mapSize);
      if (
        !isScreenPointWithinClusterViewport(
          cloudScreenPoint,
          mapSize,
          CLUSTER_VIEWPORT_PADDING_PX,
        )
      ) {
        return;
      }
      visibleClouds.push({
        id: `cloud-single-${post.id}`,
        center: cloudCenter,
        radiusMeters: CLOUD_MIN_RADIUS_METERS,
        count: 1,
        privacyCount: 1,
        posts: [post],
        badgeCount: 1,
      });
    });

  const focusedPinIdText = String(focusedPinId || "");
  const visiblePins = normalizedPosts.filter((post) => {
    if (isCloudOnlyPost(post)) return false;
    const postIdText = String(post?.id || "");
    const isFocusedPin = focusedPinIdText && postIdText === focusedPinIdText;
    return isFocusedPin || !clusteredPinnedIds.has(post.id);
  });

  return { visiblePins, visibleClouds };
};

export const haveSameEntitySignatures = (left, right, getSignature) => {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i += 1) {
    if (getSignature(left[i]) !== getSignature(right[i])) {
      return false;
    }
  }
  return true;
};

export const getPinVisualSignature = (pin) =>
  [
    String(pin?.id || ""),
    String(pin?.lat ?? ""),
    String(pin?.lng ?? ""),
    String(pin?.layer_emoji || ""),
    String(pin?.geometry?.layer_id || ""),
    String(pin?.posted_from_current_location ? "1" : "0"),
  ].join("|");

export const getCloudVisualSignature = (cloud) =>
  [
    String(cloud?.id || ""),
    String(cloud?.badgeCount ?? ""),
    String(cloud?.count ?? ""),
    String(cloud?.privacyCount ?? ""),
    String(cloud?.radiusMeters ?? ""),
    String(cloud?.center?.latitude ?? ""),
    String(cloud?.center?.longitude ?? ""),
  ].join("|");
