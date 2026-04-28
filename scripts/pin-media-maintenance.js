// File purpose: Maintenance script that audits and optionally cleans pin media fields stored in Supabase.

#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const args = process.argv.slice(2);
const shouldApply = args.includes("--apply");

// Loads local environment variables before maintenance scripts contact Supabase.
const loadEnv = () => {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const envRaw = fs.readFileSync(envPath, "utf8");
  envRaw.split(/\r?\n/).forEach((line) => {
    if (!line || line.trim().startsWith("#")) return;
    const splitIndex = line.indexOf("=");
    if (splitIndex <= 0) return;
    const key = line.slice(0, splitIndex).trim();
    const value = line.slice(splitIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
};

// Converts values into trimmed strings for safer comparisons.
const normalizeString = (value) => String(value || "").trim();
// Normalizes URI-like strings to lowercase for scheme checks.
const normalizeUriLower = (value) => normalizeString(value).toLowerCase();

// Checks whether media data points to Supabase storage instead of a local-only URI.
const isStoragePointer = (value) =>
  normalizeUriLower(value).startsWith("storage://");
// Checks whether a media value is an HTTP or HTTPS URL.
const isHttpUrl = (value) => /^https?:\/\//i.test(normalizeString(value));
// Checks whether a media value is an inline data URL.
const isDataUrl = (value) => normalizeUriLower(value).startsWith("data:");
// Checks whether a media value is a device file URL.
const isFileUrl = (value) => normalizeUriLower(value).startsWith("file://");
// Checks whether a media value is an Android content URI.
const isContentUrl = (value) =>
  normalizeUriLower(value).startsWith("content://");
// Checks whether a media value is an iOS Photos URI.
const isPhUrl = (value) => normalizeUriLower(value).startsWith("ph://");
// Detects media URIs that cannot be rendered after leaving the original device.
const isLocalOnlyUrl = (value) =>
  isFileUrl(value) || isContentUrl(value) || isPhUrl(value);
// Detects media URLs safe to keep in persisted pin records.
const isPersistableMediaUrl = (value) =>
  isStoragePointer(value) || isHttpUrl(value) || isDataUrl(value);

// Removes duplicate strings while preserving their first-seen order.
const dedupeStrings = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeString(value))
        .filter(Boolean),
    ),
  );

// Normalizes media type labels to the supported image/video set.
const normalizeMediaType = (value) => {
  const lowered = normalizeString(value).toLowerCase();
  if (!lowered) return "";
  if (lowered === "video") return "video";
  if (lowered === "photo" || lowered === "image") return "photo";
  return lowered;
};

// Returns a plain object when the input is object-like, otherwise an empty object.
const ensureObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

// Compares string arrays by position and value.
const areStringArraysEqual = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (String(left[i]) !== String(right[i])) return false;
  }
  return true;
};

// Compares JSON-compatible values by their serialized representation.
const areJsonEqual = (left, right) => {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (_) {
    return false;
  }
};

// Builds the database update needed to clean one pin media row.
const buildPatch = (row) => {
  const reasons = [];
  const originalMediaUrl = normalizeString(row?.media_url);
  const originalMediaType = normalizeMediaType(row?.media_type);
  const originalGeometry = ensureObject(row?.geometry);
  const originalGeometryMediaUrls = dedupeStrings(
    Array.isArray(originalGeometry.media_urls) ? originalGeometry.media_urls : [],
  );
  const originalGeometryMediaTypes = Array.isArray(originalGeometry.media_types)
    ? originalGeometry.media_types.map(normalizeMediaType).filter(Boolean)
    : [];

  const validGeometryUrls = originalGeometryMediaUrls.filter(isPersistableMediaUrl);
  const mediaUrlIsPersistable = isPersistableMediaUrl(originalMediaUrl);
  const mergedPersistableUrls = dedupeStrings([
    ...validGeometryUrls,
    mediaUrlIsPersistable ? originalMediaUrl : "",
  ]);

  const nextMediaUrl = mediaUrlIsPersistable
    ? originalMediaUrl
    : mergedPersistableUrls[0] || null;

  const nextGeometry = { ...originalGeometry };
  if (mergedPersistableUrls.length > 0) {
    if (!areStringArraysEqual(originalGeometryMediaUrls, mergedPersistableUrls)) {
      nextGeometry.media_urls = mergedPersistableUrls;
      reasons.push("normalize_geometry_media_urls");
    }

    const fallbackType =
      originalMediaType ||
      normalizeMediaType(originalGeometryMediaTypes[0]) ||
      "photo";
    const nextGeometryMediaTypes = mergedPersistableUrls.map(
      (_, index) => normalizeMediaType(originalGeometryMediaTypes[index]) || fallbackType,
    );
    if (
      !areStringArraysEqual(
        originalGeometryMediaTypes,
        nextGeometryMediaTypes,
      )
    ) {
      nextGeometry.media_types = nextGeometryMediaTypes;
      reasons.push("normalize_geometry_media_types");
    }

    if (Number(nextGeometry.media_count) !== mergedPersistableUrls.length) {
      nextGeometry.media_count = mergedPersistableUrls.length;
      reasons.push("normalize_geometry_media_count");
    }
  } else {
    if (Object.prototype.hasOwnProperty.call(nextGeometry, "media_urls")) {
      delete nextGeometry.media_urls;
      reasons.push("remove_geometry_media_urls");
    }
    if (Object.prototype.hasOwnProperty.call(nextGeometry, "media_types")) {
      delete nextGeometry.media_types;
      reasons.push("remove_geometry_media_types");
    }
    if (Object.prototype.hasOwnProperty.call(nextGeometry, "media_count")) {
      delete nextGeometry.media_count;
      reasons.push("remove_geometry_media_count");
    }
  }

  const updates = {};
  const nextMediaUrlNormalized = normalizeString(nextMediaUrl) || null;
  const originalMediaUrlNormalized = originalMediaUrl || null;
  if (nextMediaUrlNormalized !== originalMediaUrlNormalized) {
    updates.media_url = nextMediaUrlNormalized;
    if (originalMediaUrl && isLocalOnlyUrl(originalMediaUrl)) {
      reasons.push("clear_local_only_media_url");
    } else if (!originalMediaUrl && nextMediaUrlNormalized) {
      reasons.push("backfill_media_url_from_geometry");
    } else if (originalMediaUrl && !nextMediaUrlNormalized) {
      reasons.push("clear_unusable_media_url");
    } else {
      reasons.push("replace_media_url_with_persistable_value");
    }
  }

  if (mergedPersistableUrls.length === 0 && originalMediaType) {
    updates.media_type = null;
    reasons.push("clear_orphan_media_type");
  } else if (mergedPersistableUrls.length > 0 && !originalMediaType) {
    const geometryTypeCandidate =
      normalizeMediaType(nextGeometry.media_types?.[0]) || "photo";
    updates.media_type = geometryTypeCandidate;
    reasons.push("backfill_media_type");
  }

  if (!areJsonEqual(originalGeometry, nextGeometry)) {
    updates.geometry = nextGeometry;
  }

  const changed = Object.keys(updates).length > 0;
  if (!changed) return { changed: false, updates: null, reasons: [] };

  return {
    changed: true,
    updates,
    reasons: dedupeStrings(reasons),
  };
};

// Runs the command-line workflow for this script or edge action dispatcher.
const main = async () => {
  loadEnv();
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.",
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const rows = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("pins")
      .select("id,media_url,media_type,geometry,created_at")
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const reasonCounts = new Map();
  const proposals = [];
  rows.forEach((row) => {
    const patch = buildPatch(row);
    if (!patch.changed) return;
    patch.reasons.forEach((reason) =>
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1),
    );
    proposals.push({
      id: row.id,
      updates: patch.updates,
      reasons: patch.reasons,
    });
  });

  let applied = 0;
  let failed = 0;
  const failures = [];
  if (shouldApply && proposals.length > 0) {
    for (const proposal of proposals) {
      const { error } = await supabase
        .from("pins")
        .update(proposal.updates)
        .eq("id", proposal.id);
      if (error) {
        failed += 1;
        failures.push({
          id: proposal.id,
          message: String(error.message || error),
        });
        continue;
      }
      applied += 1;
    }
  }

  const summary = {
    mode: shouldApply ? "apply" : "audit",
    auditedAt: new Date().toISOString(),
    totalPinsScanned: rows.length,
    proposedUpdates: proposals.length,
    appliedUpdates: shouldApply ? applied : 0,
    failedUpdates: shouldApply ? failed : 0,
    reasonCounts: Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1]),
    sampleProposals: proposals.slice(0, 8).map((proposal) => ({
      id: proposal.id,
      reasons: proposal.reasons,
      updateKeys: Object.keys(proposal.updates || {}),
    })),
    failures: failures.slice(0, 8),
  };

  console.log(JSON.stringify(summary, null, 2));
  if (shouldApply && failed > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: String(error?.message || error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
