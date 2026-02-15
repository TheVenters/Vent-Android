import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getActiveSession, supabase, supabaseWithAccessToken } from './supabase';

const ISSUE_TABLE = 'client_issue_reports';
const SCREENSHOT_BUCKET = 'bug-report-screenshots';
const MAX_TEXT_LENGTH = 4000;
const MAX_STACK_LENGTH = 12000;
const DUPLICATE_WINDOW_MS = 30000;

let currentScreenName = null;
let globalTrackingInstalled = false;
let lastErrorSignatures = new Map();

const truncate = (value, maxLength = MAX_TEXT_LENGTH) =>
  String(value || '').slice(0, maxLength);

const cleanObject = (input) => {
  if (!input || typeof input !== 'object') return {};
  const output = {};
  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string') {
      output[key] = truncate(value, 800);
      return;
    }
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'object'
    ) {
      output[key] = value;
    }
  });
  return output;
};

const nowIso = () => new Date().toISOString();

const readAppVersion = () =>
  truncate(
    Constants?.expoConfig?.version ||
      Constants?.manifest?.version ||
      Constants?.manifest2?.extra?.expoClient?.version ||
      'unknown',
    64,
  );

const readAppBuild = () =>
  truncate(
    Constants?.nativeBuildVersion ||
      Constants?.expoConfig?.ios?.buildNumber ||
      Constants?.expoConfig?.android?.versionCode ||
      '',
    64,
  );

const readDeviceInfo = () => {
  const details = {
    platform: Platform.OS,
    platformVersion: Platform.Version,
    appOwnership: Constants?.appOwnership || null,
    executionEnvironment: Constants?.executionEnvironment || null,
    isDevice: Boolean(Constants?.isDevice),
  };
  return truncate(JSON.stringify(details), 512);
};

const normalizeError = (error) => {
  if (!error) {
    return {
      name: 'UnknownError',
      message: 'Unknown error',
      stack: '',
    };
  }
  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: truncate(error),
      stack: '',
    };
  }
  const maybe = error;
  return {
    name: truncate(maybe?.name || 'Error', 120),
    message: truncate(maybe?.message || 'Unexpected error'),
    stack: truncate(maybe?.stack || '', MAX_STACK_LENGTH),
  };
};

const buildSignature = (category, severity, title, message, stack) =>
  `${category}|${severity}|${title}|${message}|${stack.slice(0, 300)}`;

const shouldDropDuplicate = (signature) => {
  const now = Date.now();
  const previous = lastErrorSignatures.get(signature) || 0;
  if (now - previous < DUPLICATE_WINDOW_MS) return true;
  lastErrorSignatures.set(signature, now);

  if (lastErrorSignatures.size > 300) {
    const cutoff = now - DUPLICATE_WINDOW_MS * 2;
    lastErrorSignatures.forEach((timestamp, key) => {
      if (timestamp < cutoff) lastErrorSignatures.delete(key);
    });
  }
  return false;
};

const insertIssueReport = async (row, session = null) => {
  const client = session?.access_token
    ? supabaseWithAccessToken(session.access_token)
    : supabase;

  const { data, error } = await client
    .from(ISSUE_TABLE)
    .insert([row])
    .select('id')
    .maybeSingle();

  if (error) throw error;
  return data || null;
};

const resolveImageExtension = (uri, contentType = '') => {
  const lowerType = String(contentType || '').toLowerCase();
  if (lowerType.includes('heic') || lowerType.includes('heif')) return 'heic';
  if (lowerType.includes('png')) return 'png';
  if (lowerType.includes('webp')) return 'webp';
  const match = String(uri || '')
    .toLowerCase()
    .match(/\.(heic|heif|png|jpg|jpeg|webp)($|\?)/);
  if (match?.[1] === 'heic' || match?.[1] === 'heif') return 'heic';
  if (match?.[1] === 'png') return 'png';
  if (match?.[1] === 'webp') return 'webp';
  return 'jpg';
};

const resolveImageMimeType = (fileExt, explicitMimeType = '') => {
  const lower = String(explicitMimeType || '').toLowerCase();
  if (lower.startsWith('image/')) return lower;
  if (fileExt === 'png') return 'image/png';
  if (fileExt === 'webp') return 'image/webp';
  if (fileExt === 'heic') return 'image/heic';
  return 'image/jpeg';
};

const decodeBase64ToArrayBuffer = (base64Value) => {
  const normalized = String(base64Value || '').replace(/\s+/g, '');
  if (!normalized) return null;

  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  }

  if (typeof globalThis.Buffer?.from === 'function') {
    const bytes = globalThis.Buffer.from(normalized, 'base64');
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  throw new Error('Base64 decoding is unavailable on this device.');
};

const normalizeScreenshotInput = (input) => {
  if (!input) return null;
  if (typeof input === 'string') {
    return {
      uri: input,
      mimeType: '',
      base64: '',
      fileName: '',
      fileSize: null,
    };
  }
  if (typeof input !== 'object') return null;

  return {
    uri: String(input?.uri || ''),
    mimeType: String(input?.mimeType || ''),
    base64: String(input?.base64 || ''),
    fileName: String(input?.fileName || ''),
    fileSize:
      typeof input?.fileSize === 'number' && Number.isFinite(input.fileSize)
        ? input.fileSize
        : null,
  };
};

const uploadScreenshot = async (session, userId, screenshotInput) => {
  if (!session?.access_token || !userId || !screenshotInput) return null;

  const screenshot = normalizeScreenshotInput(screenshotInput);
  if (!screenshot) return null;

  const sourceUri = screenshot.uri || screenshot.fileName || '';
  const fileExt = resolveImageExtension(sourceUri, screenshot.mimeType);
  const contentType = resolveImageMimeType(fileExt, screenshot.mimeType);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${fileExt}`;
  const path = `${userId}/${fileName}`;

  let payload = null;
  if (screenshot.base64) {
    payload = decodeBase64ToArrayBuffer(screenshot.base64);
  } else {
    const response = await fetch(screenshot.uri);
    if (!response?.ok) {
      throw new Error(
        `Failed to read screenshot (${response?.status || 'unknown'}).`,
      );
    }
    payload = await response.arrayBuffer();
  }

  if (!payload || Number(payload.byteLength || 0) <= 0) {
    throw new Error('Screenshot payload was empty.');
  }

  const storageClient = supabaseWithAccessToken(session.access_token);
  const uploadRes = await storageClient.storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, payload, {
      contentType,
      upsert: false,
    });
  if (uploadRes.error) throw uploadRes.error;

  return path;
};

export const setCurrentTelemetryScreen = (screenName) => {
  currentScreenName = screenName ? truncate(screenName, 120) : null;
};

export const getCurrentTelemetryScreen = () => currentScreenName;

export const captureClientIssue = async ({
  category = 'js_error',
  severity = 'error',
  title = '',
  description = '',
  error = null,
  metadata = {},
  currentScreen = null,
  screenshot = null,
  screenshotUri = null,
  dropDuplicates = true,
} = {}) => {
  const normalized = normalizeError(error);
  const safeCategory =
    category === 'bug_report' || category === 'unhandled_rejection'
      ? category
      : 'js_error';
  const safeSeverity =
    severity === 'info' || severity === 'warning' || severity === 'fatal'
      ? severity
      : 'error';
  const safeTitle = truncate(title || normalized.name || 'Client issue', 160);
  const safeDescription = truncate(description || normalized.message);
  const safeStack = truncate(normalized.stack, MAX_STACK_LENGTH);
  const signature = buildSignature(
    safeCategory,
    safeSeverity,
    safeTitle,
    safeDescription,
    safeStack,
  );

  if (dropDuplicates && shouldDropDuplicate(signature)) {
    return {
      data: null,
      error: null,
      duplicate: true,
      screenshotPath: null,
      uploadError: null,
    };
  }

  let session = null;
  try {
    session = await getActiveSession();
  } catch (_) {
    session = null;
  }
  const userId = session?.user?.id || null;

  let screenshotPath = null;
  let uploadError = null;
  const screenshotInput = screenshot || screenshotUri || null;
  if (screenshotInput) {
    if (!session?.access_token || !userId) {
      uploadError =
        'Screenshot upload skipped: sign in is required for screenshot uploads.';
    } else {
      try {
        screenshotPath = await uploadScreenshot(session, userId, screenshotInput);
      } catch (err) {
        uploadError = truncate(err?.message || String(err || 'Screenshot upload failed'));
      }
    }
  }

  const row = {
    user_id: userId,
    category: safeCategory,
    severity: safeSeverity,
    title: safeTitle,
    description: safeDescription,
    current_screen: truncate(currentScreen || currentScreenName || '', 120),
    app_version: readAppVersion(),
    app_build: readAppBuild(),
    platform: truncate(Platform.OS, 32),
    device_info: readDeviceInfo(),
    screenshot_path: screenshotPath,
    stack: safeStack || null,
    metadata: cleanObject({
      ...metadata,
      capturedAt: nowIso(),
      uploadError,
    }),
  };

  try {
    const data = await insertIssueReport(row, session);
    return {
      data,
      error: null,
      duplicate: false,
      screenshotPath,
      uploadError,
    };
  } catch (insertError) {
    return {
      data: null,
      error: insertError,
      duplicate: false,
      screenshotPath,
      uploadError,
    };
  }
};

export const submitBugReport = async ({
  description,
  screenshot = null,
  screenshotUri = null,
  currentScreen = null,
  metadata = {},
} = {}) => {
  return captureClientIssue({
    category: 'bug_report',
    severity: 'error',
    title: 'Manual bug report',
    description: truncate(description || ''),
    metadata,
    currentScreen,
    screenshot,
    screenshotUri,
    dropDuplicates: false,
  });
};

export const installGlobalErrorTracking = () => {
  if (globalTrackingInstalled) {
    return () => {};
  }
  globalTrackingInstalled = true;

  const previousGlobalHandler = globalThis.ErrorUtils?.getGlobalHandler?.() || null;
  if (globalThis.ErrorUtils?.setGlobalHandler) {
    globalThis.ErrorUtils.setGlobalHandler((error, isFatal) => {
      captureClientIssue({
        category: 'js_error',
        severity: isFatal ? 'fatal' : 'error',
        error,
        metadata: { isFatal: Boolean(isFatal) },
      }).catch(() => {});

      if (typeof previousGlobalHandler === 'function') {
        previousGlobalHandler(error, isFatal);
      }
    });
  }

  const previousUnhandledRejection = globalThis.onunhandledrejection || null;
  globalThis.onunhandledrejection = (event) => {
    const reason = event?.reason;
    captureClientIssue({
      category: 'unhandled_rejection',
      severity: 'error',
      error:
        reason instanceof Error
          ? reason
          : new Error(truncate(String(reason || 'Unhandled promise rejection'))),
      metadata: cleanObject({
        promise: String(event?.promise || ''),
      }),
    }).catch(() => {});

    if (typeof previousUnhandledRejection === 'function') {
      previousUnhandledRejection(event);
    }
  };

  return () => {
    if (globalThis.ErrorUtils?.setGlobalHandler && previousGlobalHandler) {
      globalThis.ErrorUtils.setGlobalHandler(previousGlobalHandler);
    }
    globalThis.onunhandledrejection = previousUnhandledRejection;
    globalTrackingInstalled = false;
  };
};
