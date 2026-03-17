import {
  getActiveSession,
  isStorageMediaPointer,
  parseStorageMediaPointer,
  supabase,
  supabaseWithAccessToken,
} from "../services/supabase";

const AVATAR_SIGNED_URL_TTL_SEC = 60 * 60 * 24;

const isDirectRenderableAvatarUrl = (value) => {
  const uri = String(value || "").trim().toLowerCase();
  if (!uri) return false;
  return (
    uri.startsWith("http://") ||
    uri.startsWith("https://") ||
    uri.startsWith("data:image/") ||
    uri.startsWith("file://") ||
    uri.startsWith("content://") ||
    uri.startsWith("blob:") ||
    uri.startsWith("ph://")
  );
};

const getStorageClient = async (sessionOverride = null) => {
  const accessToken =
    sessionOverride?.access_token ||
    (await getActiveSession())?.access_token ||
    null;
  return accessToken ? supabaseWithAccessToken(accessToken) : supabase;
};

const resolveSignedAvatarUrlMap = async (values, sessionOverride = null) => {
  const pointers = Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter((value) => isStorageMediaPointer(value)),
    ),
  );
  if (pointers.length === 0) return new Map();

  const storageClient = await getStorageClient(sessionOverride);
  const signedUrlByPointer = new Map();

  await Promise.all(
    pointers.map(async (pointer) => {
      const parsed = parseStorageMediaPointer(pointer);
      if (!parsed?.bucket || !parsed?.path) return;

      const signedRes = await storageClient.storage
        .from(parsed.bucket)
        .createSignedUrl(parsed.path, AVATAR_SIGNED_URL_TTL_SEC);
      if (!signedRes.error && signedRes.data?.signedUrl) {
        signedUrlByPointer.set(pointer, signedRes.data.signedUrl);
      }
    }),
  );

  return signedUrlByPointer;
};

export const hydrateAvatarUrlsInRows = async (
  rows,
  fieldName = "avatar_url",
  sessionOverride = null,
) => {
  const source = Array.isArray(rows) ? rows : [];
  if (source.length === 0) return [];

  const signedUrlByPointer = await resolveSignedAvatarUrlMap(
    source.map((row) => row?.[fieldName]),
    sessionOverride,
  );

  return source.map((row) => {
    const rawValue = String(row?.[fieldName] || "").trim();
    let nextValue = null;

    if (isDirectRenderableAvatarUrl(rawValue)) {
      nextValue = rawValue;
    } else if (isStorageMediaPointer(rawValue)) {
      nextValue = signedUrlByPointer.get(rawValue) || null;
    } else if (rawValue) {
      nextValue = rawValue;
    }

    return {
      ...row,
      [fieldName]: nextValue,
    };
  });
};

export const hydrateAvatarUrl = async (value, sessionOverride = null) => {
  const [row] = await hydrateAvatarUrlsInRows(
    [{ avatar_url: value }],
    "avatar_url",
    sessionOverride,
  );
  return row?.avatar_url || null;
};
