import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import { createClient, processLock } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Load from environment variables (set in .env file)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing Supabase environment variables. Check your .env file.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
});

if (Platform.OS !== 'web' && !globalThis.__SUPABASE_APPSTATE_LISTENER__) {
  globalThis.__SUPABASE_APPSTATE_LISTENER__ = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

// For rare cases where we must guarantee the Authorization header is present
// (e.g. debugging RLS writes), create a short-lived client pinned to a token.
export const supabaseWithAccessToken = (accessToken) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !accessToken) return supabase;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
      lock: processLock,
    },
  });
};

// Helper functions
export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
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

const resetPasswordViaEdgeFunction = async (email, token, newPassword) => {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/reset-password-with-otp`,
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
  try {
    const edgeResult = await resetPasswordViaEdgeFunction(email, token, newPassword);
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
  } catch (error) {
    return { data: null, error };
  }
};
