// File purpose: Avatar URL helper that signs Supabase storage paths and leaves already-renderable URLs alone.

import {
  getActiveSession,
  isStorageMediaPointer,
  parseStorageMediaPointer,
  supabase,
  supabaseWithAccessToken,
} from "../services/supabase";

const AVATAR_SIGNED_URL_TTL_SEC = 60 * 60 * 24;

// Checks whether an avatar value can be rendered without signing.
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

// Chooses the Supabase storage client, optionally scoped to a supplied session.
const getStorageClient = async (sessionOverride = null) => {
  const accessToken =
    sessionOverride?.access_token ||
    (await getActiveSession())?.access_token ||
    null;
  return accessToken ? supabaseWithAccessToken(accessToken) : supabase;
};

// Creates signed avatar URLs for Supabase storage paths.
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

// Supports the hydrateAvatarUrl workflow in this file.
export const hydrateAvatarUrl = async (value, sessionOverride = null) => {
  const [row] = await hydrateAvatarUrlsInRows(
    [{ avatar_url: value }],
    "avatar_url",
    sessionOverride,
  );
  return row?.avatar_url || null;
};

// Gets profile avatar url for the caller.
export const getProfileAvatarUrl = async (userId, sessionOverride = null) => {
  const resolvedUserId = String(userId || "").trim();
  if (!resolvedUserId) return null;

  try {
    const accessToken =
      sessionOverride?.access_token ||
      (await getActiveSession())?.access_token ||
      null;
    const client = accessToken ? supabaseWithAccessToken(accessToken) : supabase;

    const { data, error } = await client
      .from("profiles")
      .select("avatar_url")
      .eq("id", resolvedUserId)
      .maybeSingle();

    if (error) throw error;
    return hydrateAvatarUrl(data?.avatar_url || null, sessionOverride);
  } catch (_) {
    return null;
  }
};
