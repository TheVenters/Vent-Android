import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Load from environment variables (set in .env file)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing Supabase environment variables. Check your .env file.');
}

const SUPABASE_CLIENT_VERSION = 'v3-auth-fetch';
const NETWORK_RETRY_ATTEMPTS = 3;
const NETWORK_RETRY_BASE_DELAY_MS = 180;
const DEBUG_SUPABASE_NETWORK = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.EXPO_PUBLIC_DEBUG_SUPABASE_NETWORK || '').toLowerCase(),
);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const NON_OK_BODY_LOG_LIMIT = 320;

const getHeaderValue = (headers, key) => {
  if (!headers) return '';
  const target = String(key || '').toLowerCase();

  if (typeof headers.get === 'function') {
    return String(headers.get(key) || '');
  }

  if (Array.isArray(headers)) {
    const match = headers.find(
      (entry) =>
        Array.isArray(entry) &&
        String(entry[0] || '').toLowerCase() === target,
    );
    return String(match?.[1] || '');
  }

  if (typeof headers === 'object') {
    const direct = headers[key];
    if (direct != null) return String(direct);

    const foundKey = Object.keys(headers).find(
      (name) => String(name || '').toLowerCase() === target,
    );
    if (foundKey) return String(headers[foundKey] || '');
  }

  return '';
};

const getRequestMeta = (input, init) => {
  const url = typeof input === 'string' ? input : String(input?.url || '');
  let host = '';
  let path = '';
  try {
    const parsed = new URL(url);
    host = parsed.host || '';
    path = parsed.pathname || '';
  } catch (_) {}

  const method = String(init?.method || 'GET').toUpperCase();
  const authHeader =
    getHeaderValue(init?.headers, 'authorization') ||
    getHeaderValue(init?.headers, 'Authorization');
  const bodyLength =
    typeof init?.body === 'string' ? init.body.length : undefined;

  return {
    method,
    host,
    path,
    platform: Platform.OS,
    hasAuthHeader: Boolean(authHeader),
    authHeaderLength: authHeader ? authHeader.length : 0,
    bodyLength,
  };
};

const isRetryableNetworkError = (error) => {
  const message = String(
    error?.message || error?.details || error || '',
  ).toLowerCase();
  return (
    message.includes('fetch failed') ||
    message.includes('failed to fetch') ||
    message.includes('network request failed') ||
    message.includes('eai_again') ||
    message.includes('timed out') ||
    message.includes('socket hang up')
  );
};

const resilientFetch = async (input, init) => {
  let lastError = null;
  const requestMeta = getRequestMeta(input, init);

  for (let attempt = 1; attempt <= NETWORK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await globalThis.fetch(input, init);
      if (DEBUG_SUPABASE_NETWORK && !response?.ok) {
        let bodySnippet = '';
        try {
          const cloned = response.clone();
          const raw = await cloned.text();
          bodySnippet = String(raw || '').slice(0, NON_OK_BODY_LOG_LIMIT);
        } catch (_) {}
        console.warn('Supabase fetch non-OK response', {
          ...requestMeta,
          attempt,
          status: response?.status,
          statusText: response?.statusText || '',
          bodySnippet,
        });
      }
      if (
        response?.status >= 500 &&
        response?.status <= 599 &&
        attempt < NETWORK_RETRY_ATTEMPTS
      ) {
        await delay(NETWORK_RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      console.warn('Supabase fetch network failure', {
        ...requestMeta,
        attempt,
        message: String(error?.message || error || 'Network request failed'),
      });
      if (!isRetryableNetworkError(error) || attempt >= NETWORK_RETRY_ATTEMPTS) {
        throw error;
      }
      await delay(NETWORK_RETRY_BASE_DELAY_MS * attempt);
    }
  }

  if (isRetryableNetworkError(lastError)) {
    console.warn('Supabase fetch fallback response', {
      ...requestMeta,
      message: String(lastError?.message || 'Network request failed'),
      retries: NETWORK_RETRY_ATTEMPTS,
    });
    return new Response(
      JSON.stringify({
        error: 'Network request failed',
        message: String(lastError?.message || 'Network request failed'),
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'X-Vent-Network-Fallback': '1',
        },
      },
    );
  }

  throw lastError || new Error('Network request failed');
};

const createSupabaseClient = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      fetch: resilientFetch,
    },
    auth: {
      ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

const shouldReuseClient =
  globalThis.__VENT_SUPABASE_CLIENT__ &&
  globalThis.__VENT_SUPABASE_CLIENT_VERSION__ === SUPABASE_CLIENT_VERSION;

if (!shouldReuseClient) {
  try {
    globalThis.__VENT_SUPABASE_APPSTATE_SUB__?.remove?.();
  } catch (_) {}
  globalThis.__VENT_SUPABASE_CLIENT__ = createSupabaseClient();
  globalThis.__VENT_SUPABASE_CLIENT_VERSION__ = SUPABASE_CLIENT_VERSION;
  globalThis.__VENT_SUPABASE_HELPER__ = null;
  globalThis.__VENT_SUPABASE_APPSTATE_SUB__ = null;
  globalThis.__VENT_SUPABASE_REFRESH_ACTIVE__ = null;
  globalThis.__VENT_ACTIVE_SESSION_PROMISE__ = null;
}

export const supabase = globalThis.__VENT_SUPABASE_CLIENT__;

if (Platform.OS !== 'web' && !globalThis.__VENT_SUPABASE_APPSTATE_SUB__) {
  globalThis.__VENT_SUPABASE_REFRESH_ACTIVE__ =
    AppState.currentState === 'active';
  if (globalThis.__VENT_SUPABASE_REFRESH_ACTIVE__) {
    supabase.auth.startAutoRefresh().catch(() => {});
  } else {
    supabase.auth.stopAutoRefresh().catch(() => {});
  }

  globalThis.__VENT_SUPABASE_APPSTATE_SUB__ = AppState.addEventListener(
    'change',
    (state) => {
      const isActive = state === 'active';
      if (globalThis.__VENT_SUPABASE_REFRESH_ACTIVE__ === isActive) return;
      globalThis.__VENT_SUPABASE_REFRESH_ACTIVE__ = isActive;

      if (isActive) {
        supabase.auth.startAutoRefresh().catch(() => {});
      } else {
        supabase.auth.stopAutoRefresh().catch(() => {});
      }
    },
  );
}

// For rare cases where we must guarantee the Authorization header is present
// (e.g. debugging RLS writes), create a short-lived client pinned to a token.
export const supabaseWithAccessToken = (accessToken) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !accessToken) return supabase;
  if (globalThis.__VENT_SUPABASE_HELPER__?.token === accessToken) {
    return globalThis.__VENT_SUPABASE_HELPER__.client;
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      fetch: resilientFetch,
      // Force authenticated PostgREST requests for RLS-gated reads/writes.
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  globalThis.__VENT_SUPABASE_HELPER__ = { token: accessToken, client };
  return client;
};

// Helper functions
export const getCurrentUser = async () => {
  const session = await getActiveSession();
  if (session?.user) return session.user;

  // Fallback for read-only UI identity when strict active-session validation
  // fails transiently.
  try {
    const {
      data: { session: rawSession },
    } = await supabase.auth.getSession();
    return rawSession?.user || null;
  } catch (_) {
    return null;
  }
};

const parseJwtPayload = (token) => {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json =
      typeof globalThis.atob === 'function'
        ? globalThis.atob(padded)
        : typeof globalThis.Buffer?.from === 'function'
          ? globalThis.Buffer.from(padded, 'base64').toString('utf8')
          : null;
    if (!json) return null;
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
};

const isSessionJwtUsable = (session) => {
  const userId = session?.user?.id;
  const token = session?.access_token;
  if (!userId || !token) return false;
  const payload = parseJwtPayload(token);
  if (payload?.sub !== userId) return false;

  const exp = Number(payload?.exp || 0);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tokenSkewBufferSeconds = 30;
  return exp > nowSeconds + tokenSkewBufferSeconds;
};

const isAuthSessionMissingError = (error) => {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    name.includes('authsessionmissingerror') ||
    message.includes('auth session missing')
  );
};

// Resolve a usable session for writes that depend on auth.uid() in RLS/RPC.
// This is intentionally stricter than getSession() and only refreshes on demand.
export const getActiveSession = async () => {
  if (globalThis.__VENT_ACTIVE_SESSION_PROMISE__) {
    return globalThis.__VENT_ACTIVE_SESSION_PROMISE__;
  }

  const resolver = (async () => {
    let currentSession = null;
    let serverValidated = false;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      currentSession = session || null;
      if (isSessionJwtUsable(session)) return session;

      // Server-side check (clock-skew safety net) — but do NOT return the
      // stale JWT early.  Always attempt a refresh first so PostgREST
      // receives a token that is unambiguously valid.
      if (session?.access_token) {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser(session.access_token);
        serverValidated = !error && !!user?.id && user.id === session?.user?.id;
      }
    } catch (error) {
      console.error('Error checking current auth session:', error);
    }

    // No current session means user is signed out; do not attempt refresh.
    if (!currentSession?.refresh_token) {
      return serverValidated ? currentSession : null;
    }

    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.refreshSession();
      if (error) throw error;
      if (isSessionJwtUsable(session)) return session;
    } catch (error) {
      if (isAuthSessionMissingError(error)) {
        return serverValidated ? currentSession : null;
      }
      console.error('Error refreshing auth session:', error);
    }

    // Last resort: if the server validated the old token it may still work
    // for a short window even though isSessionJwtUsable flagged it.
    return serverValidated ? currentSession : null;
  })();

  globalThis.__VENT_ACTIVE_SESSION_PROMISE__ = resolver;

  try {
    return await resolver;
  } finally {
    if (globalThis.__VENT_ACTIVE_SESSION_PROMISE__ === resolver) {
      globalThis.__VENT_ACTIVE_SESSION_PROMISE__ = null;
    }
  }
};

export const signIn = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
};

export const signUp = async (email, password, username, displayName) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username,
        display_name: displayName,
      },
    },
  });
  return { data, error };
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  return { error };
};

export const resetPassword = async (email) => {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email);
  return { data, error };
};

const safeJson = async (response) => {
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
};

const RESET_PASSWORD_FUNCTION_PATH = '/functions/v1/reset-password-with-otp';
const SOCIAL_ACTIONS_FUNCTION_PATH = '/functions/v1/social-actions';

const invokeEdgeFunction = async (path, payload) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      data: null,
      error: new Error('Missing Supabase environment variables.'),
      status: null,
    };
  }

  try {
    const response = await resilientFetch(`${SUPABASE_URL}${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
    });

    const result = await safeJson(response);
    if (!response.ok) {
      const message =
        result?.error ||
        result?.msg ||
        result?.error_description ||
        result?.message ||
        `Edge function failed (${response.status}).`;
      return { data: result, error: new Error(message), status: response.status };
    }
    return { data: result, error: null, status: response.status };
  } catch (error) {
    return { data: null, error, status: null };
  }
};

const resetPasswordViaEdgeFunction = async (email, token, newPassword) => {
  return invokeEdgeFunction(RESET_PASSWORD_FUNCTION_PATH, {
    email,
    token,
    newPassword,
  });
};

export const resetPasswordWithOtp = async (email, token, newPassword) => {
  const edgeResult = await resetPasswordViaEdgeFunction(
    email,
    token,
    newPassword,
  );
  if (!edgeResult.error) return { data: edgeResult.data, error: null };

  if ([401, 403, 404].includes(edgeResult.status || 0)) {
    return {
      data: edgeResult.data,
      error: new Error(
        'Password reset service is unavailable. Ensure edge function `reset-password-with-otp` is deployed with JWT verification disabled.',
      ),
    };
  }

  return { data: edgeResult.data, error: edgeResult.error };
};

const socialAction = async (action, payload, accessToken, refreshToken = null) => {
  if (DEBUG_SUPABASE_NETWORK) {
    console.warn('Supabase socialAction request', {
      action,
      hasAccessToken: Boolean(accessToken),
      accessTokenLength: accessToken ? String(accessToken).length : 0,
      hasRefreshToken: Boolean(refreshToken),
      refreshTokenLength: refreshToken ? String(refreshToken).length : 0,
      actorUserId: String(payload?.actorUserId || ''),
      hasActorUserId: Boolean(payload?.actorUserId),
    });
  }
  const result = await invokeEdgeFunction(SOCIAL_ACTIONS_FUNCTION_PATH, {
    action,
    accessToken,
    refreshToken,
    ...(payload || {}),
  });

  const refreshedAccessToken = result?.data?.refreshedAccessToken;
  const refreshedRefreshToken = result?.data?.refreshedRefreshToken;
  if (!result?.error && refreshedAccessToken && refreshedRefreshToken) {
    try {
      await supabase.auth.setSession({
        access_token: refreshedAccessToken,
        refresh_token: refreshedRefreshToken,
      });
    } catch (error) {
      console.warn('Failed to apply refreshed session from edge function:', error);
    }
  }

  return result;
};

export const votePinViaEdgeFunction = async (
  pinId,
  vote,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'vote',
    { pinId, vote, actorUserId },
    accessToken,
    refreshToken,
  );

export const getPinVoteSummaryViaEdgeFunction = async (
  pinId,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'vote_summary',
    { pinId, actorUserId },
    accessToken,
    refreshToken,
  );

export const addPinCommentViaEdgeFunction = async (
  pinId,
  content,
  accessToken,
  refreshToken = null,
  actorUserId = null,
  parentCommentId = null,
) =>
  socialAction(
    'add_comment',
    { pinId, content, actorUserId, parentCommentId },
    accessToken,
    refreshToken,
  );

export const listPinCommentsViaEdgeFunction = async (
  pinId,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'list_comments',
    { pinId, actorUserId },
    accessToken,
    refreshToken,
  );

export const deletePinCommentViaEdgeFunction = async (
  commentId,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'delete_comment',
    { commentId, actorUserId },
    accessToken,
    refreshToken,
  );

export const listAdminIssueReportsViaEdgeFunction = async (
  accessToken,
  refreshToken = null,
  actorUserId = null,
  limit = 50,
  before = null,
  signedUrlTtlSec = 3600,
) =>
  socialAction(
    'admin_issue_reports',
    { actorUserId, limit, before, signedUrlTtlSec },
    accessToken,
    refreshToken,
  );

export const fetchFriendListsViaEdgeFunction = async (
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'friend_lists',
    { actorUserId },
    accessToken,
    refreshToken,
  );

export const sendFriendRequestViaEdgeFunction = async (
  targetUserId,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'send_friend_request',
    { targetUserId, actorUserId },
    accessToken,
    refreshToken,
  );

export const acceptFriendRequestViaEdgeFunction = async (
  friendshipId,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'accept_friend_request',
    { friendshipId, actorUserId },
    accessToken,
    refreshToken,
  );

export const rejectFriendRequestViaEdgeFunction = async (
  friendshipId,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'reject_friend_request',
    { friendshipId, actorUserId },
    accessToken,
    refreshToken,
  );

export const removeFriendViaEdgeFunction = async (
  friendshipId,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'remove_friend',
    { friendshipId, actorUserId },
    accessToken,
    refreshToken,
  );

export const joinCommunityViaEdgeFunction = async (
  communityId,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'join_community',
    { communityId, actorUserId },
    accessToken,
    refreshToken,
  );

export const createCommunityViaEdgeFunction = async (
  name,
  slug,
  description,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'create_community',
    { name, slug, description, actorUserId },
    accessToken,
    refreshToken,
  );

export const createCommunityLayerViaEdgeFunction = async (
  communityId,
  name,
  kind,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'create_community_layer',
    { communityId, name, kind, actorUserId },
    accessToken,
    refreshToken,
  );

export const setLayerIconViaEdgeFunction = async (
  layerId,
  kind,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'set_layer_icon',
    { layerId, kind, actorUserId },
    accessToken,
    refreshToken,
  );

export const ensureUserPostingLayerViaEdgeFunction = async (
  name,
  legacyName,
  kind,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'ensure_user_posting_layer',
    { name, legacyName, kind, actorUserId },
    accessToken,
    refreshToken,
  );

export const sendDirectMessageViaEdgeFunction = async (
  receiverId,
  content,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'send_direct_message',
    { receiverId, content, actorUserId },
    accessToken,
    refreshToken,
  );

export const sendCommunityMessageViaEdgeFunction = async (
  communityId,
  content,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'send_community_message',
    { communityId, content, actorUserId },
    accessToken,
    refreshToken,
  );

export const leaveCommunityViaEdgeFunction = async (
  communityId,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'leave_community',
    { communityId, actorUserId },
    accessToken,
    refreshToken,
  );

export const fetchMyCommunityMembershipsViaEdgeFunction = async (
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'my_community_memberships',
    { actorUserId },
    accessToken,
    refreshToken,
  );

export const fetchMyLayerPrefsViaEdgeFunction = async (
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'my_layer_prefs',
    { actorUserId },
    accessToken,
    refreshToken,
  );

export const fetchMyPinsViaEdgeFunction = async (
  accessToken,
  refreshToken = null,
  actorUserId = null,
  limit = 3000,
) =>
  socialAction(
    "list_pins",
    {
      layerKeys: ["private"],
      actorUserId,
      limit,
    },
    accessToken,
    refreshToken,
  );

export const fetchVisiblePinsViaEdgeFunction = async (
  accessToken,
  refreshToken = null,
  actorUserId = null,
  limit = 3000,
) =>
  socialAction(
    "list_pins",
    {
      actorUserId,
      limit,
    },
    accessToken,
    refreshToken,
  );

export const fetchDirectMessagesViaEdgeFunction = async (
  friendId,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'list_direct_messages',
    { friendId, actorUserId },
    accessToken,
    refreshToken,
  );

export const markDirectMessagesReadViaEdgeFunction = async (
  friendId,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'mark_direct_messages_read',
    { friendId, actorUserId },
    accessToken,
    refreshToken,
  );

export const fetchCommunityMessagesViaEdgeFunction = async (
  communityId,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'list_community_messages',
    { communityId, actorUserId },
    accessToken,
    refreshToken,
  );

export const createPinsViaEdgeFunction = async (
  rows,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'create_pins',
    { rows, actorUserId },
    accessToken,
    refreshToken,
  );

export const fetchPinsViaEdgeFunction = async (
  layerKeys,
  accessToken,
  refreshToken = null,
  actorUserId = null,
  limit = 3000,
) =>
  socialAction(
    'list_pins',
    { layerKeys, actorUserId, limit },
    accessToken,
    refreshToken,
  );

export const setLayerPreferenceViaEdgeFunction = async (
  layerId,
  hidden,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'set_layer_pref',
    { layerId, hidden, actorUserId },
    accessToken,
    refreshToken,
  );

export const setLayerOrderViaEdgeFunction = async (
  layerIds,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'set_layer_order',
    { layerIds, actorUserId },
    accessToken,
    refreshToken,
  );

export const deletePinViaEdgeFunction = async (
  pinId,
  accessToken,
  refreshToken = null,
  actorUserId = null,
) =>
  socialAction(
    'delete_pin',
    { pinId, actorUserId },
    accessToken,
    refreshToken,
  );
