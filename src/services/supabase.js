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

const SUPABASE_CLIENT_VERSION = 'v2-no-lock';

const createSupabaseClient = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user || null;
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

const resetPasswordViaEdgeFunction = async (email, token, newPassword) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      data: null,
      error: new Error('Missing Supabase environment variables.'),
      status: null,
    };
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}${RESET_PASSWORD_FUNCTION_PATH}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, token, newPassword }),
      },
    );

    const payload = await safeJson(response);
    if (!response.ok) {
      const message =
        payload?.error ||
        payload?.msg ||
        payload?.error_description ||
        payload?.message ||
        `Edge password reset failed (${response.status}).`;
      return { data: payload, error: new Error(message), status: response.status };
    }

    return { data: payload, error: null, status: response.status };
  } catch (error) {
    return { data: null, error, status: null };
  }
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
