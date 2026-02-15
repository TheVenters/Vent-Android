import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

type VoteValue = -1 | 1;
type SocialAction =
  | "vote"
  | "vote_summary"
  | "friend_lists"
  | "send_friend_request"
  | "accept_friend_request"
  | "reject_friend_request"
  | "remove_friend"
  | "set_layer_pref"
  | "set_layer_order"
  | "create_pins"
  | "list_pins"
  | "delete_pin";

const asString = (value: unknown) => String(value ?? "").trim();

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);

const parseVote = (value: unknown): VoteValue | null => {
  const numeric = Number(value);
  if (numeric === 1) return 1;
  if (numeric === -1) return -1;
  return null;
};

const resolveActor = async (
  adminClient: ReturnType<typeof createClient>,
  accessToken: string,
  refreshToken: string,
  actorUserId: string,
  options: { allowActorIdFallback?: boolean } = {},
) => {
  const allowActorIdFallback = options.allowActorIdFallback !== false;
  const trimmedAccess = asString(accessToken);
  if (trimmedAccess) {
    const byAccess = await adminClient.auth.getUser(trimmedAccess);
    if (!byAccess.error && byAccess.data.user?.id) {
      return {
        actorId: byAccess.data.user.id,
        usedFallback: false,
      };
    }
  }

  const trimmedRefresh = asString(refreshToken);
  if (trimmedRefresh) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (supabaseUrl && anonKey) {
      const publicClient = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const refreshed = await publicClient.auth.refreshSession({
        refresh_token: trimmedRefresh,
      });
      if (!refreshed.error && refreshed.data.session?.user?.id) {
        return {
          actorId: refreshed.data.session.user.id,
          usedFallback: true,
          refreshedAccessToken: refreshed.data.session.access_token || null,
          refreshedRefreshToken: refreshed.data.session.refresh_token || null,
        };
      }
    }
  }

  if (allowActorIdFallback) {
    const trimmedActor = asString(actorUserId);
    if (isUuid(trimmedActor)) {
      const actorRes = await adminClient.auth.admin.getUserById(trimmedActor);
      if (!actorRes.error && actorRes.data.user?.id) {
        return {
          actorId: actorRes.data.user.id,
          usedFallback: true,
        };
      }
    }
  }

  return {
    actorId: null,
    usedFallback: false,
  };
};

const areUsersAcceptedFriends = async (
  adminClient: ReturnType<typeof createClient>,
  userAId: string,
  userBId: string,
) => {
  if (!userAId || !userBId || userAId === userBId) return false;

  const friendshipRes = await adminClient
    .from("friends")
    .select("id", { count: "exact", head: true })
    .eq("status", "accepted")
    .or(
      `and(user_id.eq.${userAId},friend_id.eq.${userBId}),and(user_id.eq.${userBId},friend_id.eq.${userAId})`,
    );

  if (friendshipRes.error) throw friendshipRes.error;
  return Number(friendshipRes.count || 0) > 0;
};

const isVisibleToActor = async (
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
  pin: { user_id: string; layer: string },
) => {
  if (pin.layer === "public") return true;
  if (pin.user_id === actorId) return true;
  if (pin.layer !== "private" && pin.layer !== "friends") return false;

  return await areUsersAcceptedFriends(adminClient, actorId, pin.user_id);
};

const computeVoteSummary = async (
  adminClient: ReturnType<typeof createClient>,
  pinId: string,
  actorId: string,
) => {
  const votesRes = await adminClient
    .from("pin_votes")
    .select("user_id,vote")
    .eq("pin_id", pinId);
  if (votesRes.error) throw votesRes.error;

  let upvotes = 0;
  let downvotes = 0;
  let user_vote = 0;
  for (const row of votesRes.data || []) {
    if (row.vote === 1) upvotes += 1;
    if (row.vote === -1) downvotes += 1;
    if (row.user_id === actorId) user_vote = row.vote;
  }

  return { upvotes, downvotes, user_vote };
};

const handleVote = async (
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
  payload: Record<string, unknown>,
) => {
  const pinId = asString(payload.pinId);
  const vote = parseVote(payload.vote);
  if (!isUuid(pinId) || vote === null) {
    return jsonResponse(400, { error: "pinId and vote (-1 or 1) are required." });
  }

  const pinRes = await adminClient
    .from("pins")
    .select("id,user_id,layer")
    .eq("id", pinId)
    .maybeSingle();
  if (pinRes.error) {
    return jsonResponse(400, { error: pinRes.error.message });
  }
  if (!pinRes.data) {
    return jsonResponse(404, { error: "Pin not found." });
  }
  if (pinRes.data.user_id === actorId) {
    return jsonResponse(403, { error: "You cannot vote on your own pin." });
  }
  const visible = await isVisibleToActor(adminClient, actorId, pinRes.data);
  if (!visible) {
    return jsonResponse(403, { error: "Pin not accessible for current user." });
  }

  const existingRes = await adminClient
    .from("pin_votes")
    .select("id,vote")
    .eq("pin_id", pinId)
    .eq("user_id", actorId)
    .maybeSingle();
  if (existingRes.error) {
    return jsonResponse(400, { error: existingRes.error.message });
  }

  if (existingRes.data?.vote === vote) {
    const delRes = await adminClient
      .from("pin_votes")
      .delete()
      .eq("id", existingRes.data.id);
    if (delRes.error) {
      return jsonResponse(400, { error: delRes.error.message });
    }
  } else {
    const upsertRes = await adminClient.from("pin_votes").upsert(
      [{ pin_id: pinId, user_id: actorId, vote }],
      { onConflict: "pin_id,user_id" },
    );
    if (upsertRes.error) {
      return jsonResponse(400, { error: upsertRes.error.message });
    }
  }

  const summary = await computeVoteSummary(adminClient, pinId, actorId);
  return jsonResponse(200, { success: true, ...summary });
};

const handleVoteSummary = async (
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
  payload: Record<string, unknown>,
) => {
  const pinId = asString(payload.pinId);
  if (!isUuid(pinId)) {
    return jsonResponse(400, { error: "pinId is required." });
  }

  const pinRes = await adminClient
    .from("pins")
    .select("id,user_id,layer")
    .eq("id", pinId)
    .maybeSingle();
  if (pinRes.error) {
    return jsonResponse(400, { error: pinRes.error.message });
  }
  if (!pinRes.data) {
    return jsonResponse(404, { error: "Pin not found." });
  }

  const visible = await isVisibleToActor(adminClient, actorId, pinRes.data);
  if (!visible) {
    return jsonResponse(403, { error: "Pin not accessible for current user." });
  }

  const summary = await computeVoteSummary(adminClient, pinId, actorId);
  return jsonResponse(200, { success: true, ...summary });
};

const findFriendshipPair = async (
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
  targetUserId: string,
) => {
  const pairRes = await adminClient
    .from("friends")
    .select("id,user_id,friend_id,status")
    .or(
      `and(user_id.eq.${actorId},friend_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_id.eq.${actorId})`,
    );
  if (pairRes.error) throw pairRes.error;
  return pairRes.data || [];
};

const handleSendFriendRequest = async (
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
  payload: Record<string, unknown>,
) => {
  const targetUserId = asString(payload.targetUserId);
  if (!isUuid(targetUserId)) {
    return jsonResponse(400, { error: "targetUserId is required." });
  }
  if (targetUserId === actorId) {
    return jsonResponse(400, { error: "You cannot friend yourself." });
  }

  const targetRes = await adminClient.auth.admin.getUserById(targetUserId);
  if (targetRes.error || !targetRes.data.user) {
    return jsonResponse(404, { error: "Target user not found." });
  }

  const existing = await findFriendshipPair(adminClient, actorId, targetUserId);
  const accepted = existing.find((row) => row.status === "accepted");
  if (accepted) {
    return jsonResponse(409, { error: "You are already friends." });
  }

  const sameDirection = existing.find(
    (row) => row.user_id === actorId && row.friend_id === targetUserId,
  );
  const reverseDirection = existing.find(
    (row) => row.user_id === targetUserId && row.friend_id === actorId,
  );

  if (reverseDirection?.status === "pending") {
    const acceptRes = await adminClient
      .from("friends")
      .update({ status: "accepted" })
      .eq("id", reverseDirection.id);
    if (acceptRes.error) {
      return jsonResponse(400, { error: acceptRes.error.message });
    }
    return jsonResponse(200, { success: true, status: "accepted" });
  }

  if (sameDirection?.status === "pending") {
    return jsonResponse(409, { error: "Friend request already sent." });
  }

  if (sameDirection) {
    const retryRes = await adminClient
      .from("friends")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("id", sameDirection.id);
    if (retryRes.error) {
      return jsonResponse(400, { error: retryRes.error.message });
    }
    return jsonResponse(200, { success: true, status: "pending" });
  }

  const insertRes = await adminClient
    .from("friends")
    .insert([{ user_id: actorId, friend_id: targetUserId, status: "pending" }]);
  if (insertRes.error) {
    return jsonResponse(400, { error: insertRes.error.message });
  }
  return jsonResponse(200, { success: true, status: "pending" });
};

const handleUpdateFriendship = async (
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
  payload: Record<string, unknown>,
  mode: "accept" | "delete",
) => {
  const friendshipId = asString(payload.friendshipId);
  if (!isUuid(friendshipId)) {
    return jsonResponse(400, { error: "friendshipId is required." });
  }

  const rowRes = await adminClient
    .from("friends")
    .select("id,user_id,friend_id,status")
    .eq("id", friendshipId)
    .maybeSingle();
  if (rowRes.error) {
    return jsonResponse(400, { error: rowRes.error.message });
  }
  if (!rowRes.data) {
    return jsonResponse(404, { error: "Friendship not found." });
  }

  if (rowRes.data.user_id !== actorId && rowRes.data.friend_id !== actorId) {
    return jsonResponse(403, { error: "Not allowed for this friendship." });
  }

  if (mode === "accept") {
    const updateRes = await adminClient
      .from("friends")
      .update({ status: "accepted" })
      .eq("id", friendshipId);
    if (updateRes.error) {
      return jsonResponse(400, { error: updateRes.error.message });
    }
    return jsonResponse(200, { success: true, status: "accepted" });
  }

  const deleteRes = await adminClient.from("friends").delete().eq("id", friendshipId);
  if (deleteRes.error) {
    return jsonResponse(400, { error: deleteRes.error.message });
  }
  return jsonResponse(200, { success: true });
};

const handleFriendLists = async (
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
) => {
  const rowsRes = await adminClient
    .from("friends")
    .select("id,user_id,friend_id,status,created_at")
    .or(`user_id.eq.${actorId},friend_id.eq.${actorId}`);

  if (rowsRes.error) {
    return jsonResponse(400, { error: rowsRes.error.message });
  }

  const rows = rowsRes.data || [];
  const acceptedRows = rows.filter((row) => row.status === "accepted");
  const incomingRows = rows.filter(
    (row) => row.status === "pending" && row.friend_id === actorId,
  );
  const outgoingRows = rows.filter(
    (row) => row.status === "pending" && row.user_id === actorId,
  );

  const profileIds = Array.from(
    new Set(
      [
        ...acceptedRows.map((row) =>
          row.user_id === actorId ? row.friend_id : row.user_id
        ),
        ...incomingRows.map((row) => row.user_id),
        ...outgoingRows.map((row) => row.friend_id),
      ].filter(Boolean),
    ),
  );

  let profileMap = new Map<string, Record<string, unknown>>();
  if (profileIds.length > 0) {
    const profilesRes = await adminClient
      .from("profiles")
      .select("id,username,display_name,avatar_url")
      .in("id", profileIds);
    if (profilesRes.error) {
      return jsonResponse(400, { error: profilesRes.error.message });
    }
    profileMap = new Map((profilesRes.data || []).map((profile) => [profile.id, profile]));
  }

  const friends = acceptedRows.map((row) => {
    const friendId = row.user_id === actorId ? row.friend_id : row.user_id;
    return {
      ...row,
      friend: profileMap.get(friendId) || { id: friendId },
    };
  });

  const requests = incomingRows.map((row) => ({
    ...row,
    requester: profileMap.get(row.user_id) || { id: row.user_id },
  }));

  const sentRequests = outgoingRows.map((row) => ({
    ...row,
    friend: profileMap.get(row.friend_id) || { id: row.friend_id },
  }));

  return jsonResponse(200, {
    success: true,
    friends,
    requests,
    sentRequests,
  });
};

const isActorAdmin = async (
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
) => {
  const profileRes = await adminClient
    .from("profiles")
    .select("is_admin")
    .eq("id", actorId)
    .maybeSingle();
  if (profileRes.error) {
    const errCode = asString((profileRes.error as Record<string, unknown>)?.code);
    const errMsg = asString(profileRes.error.message).toLowerCase();
    if (errCode === "42703" || errMsg.includes("is_admin")) {
      return false;
    }
    throw profileRes.error;
  }
  return Boolean(profileRes.data?.is_admin);
};

const resolveGroupedPinIds = async (
  adminClient: ReturnType<typeof createClient>,
  groupId: string,
) => {
  const byExpression = await adminClient
    .from("pins")
    .select("id,user_id")
    .eq("geometry->>cross_post_group_id", groupId);
  if (!byExpression.error) return byExpression.data || [];

  const byContains = await adminClient
    .from("pins")
    .select("id,user_id")
    .contains("geometry", { cross_post_group_id: groupId });
  if (!byContains.error) return byContains.data || [];

  throw byContains.error || byExpression.error;
};

const handleDeletePin = async (
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
  payload: Record<string, unknown>,
) => {
  const pinId = asString(payload.pinId);
  if (!isUuid(pinId)) {
    return jsonResponse(400, { error: "pinId is required." });
  }

  const pinRes = await adminClient
    .from("pins")
    .select("id,user_id,geometry")
    .eq("id", pinId)
    .maybeSingle();
  if (pinRes.error) {
    return jsonResponse(400, { error: pinRes.error.message });
  }
  if (!pinRes.data) {
    return jsonResponse(404, { error: "Pin not found." });
  }

  const ownerId = pinRes.data.user_id;
  const admin = await isActorAdmin(adminClient, actorId);
  if (ownerId !== actorId && !admin) {
    return jsonResponse(403, { error: "You do not have permission to delete this pin." });
  }

  let pinIdsToDelete = [pinId];
  const groupId = asString(
    (pinRes.data.geometry as Record<string, unknown> | null)?.cross_post_group_id,
  );
  if (groupId) {
    const groupedRows = await resolveGroupedPinIds(adminClient, groupId);
    const filteredRows = groupedRows.filter((row) => row.user_id === ownerId);
    if (filteredRows.length > 0) {
      pinIdsToDelete = Array.from(new Set(filteredRows.map((row) => row.id)));
    }
  }

  const deleteRes = await adminClient
    .from("pins")
    .delete()
    .in("id", pinIdsToDelete)
    .select("id");
  if (deleteRes.error) {
    return jsonResponse(400, { error: deleteRes.error.message });
  }

  const deletedPinIds = Array.from(
    new Set((deleteRes.data || []).map((row) => row.id).filter(Boolean)),
  );
  return jsonResponse(200, {
    success: true,
    deletedPinIds,
    deletedCount: deletedPinIds.length,
    requestedCount: pinIdsToDelete.length,
  });
};

const handleCreatePins = async (
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
  payload: Record<string, unknown>,
) => {
  const incomingRows = Array.isArray(payload.rows) ? payload.rows : [];
  if (incomingRows.length === 0) {
    return jsonResponse(400, { error: "rows must contain at least one pin." });
  }
  if (incomingRows.length > 20) {
    return jsonResponse(400, { error: "rows exceeds maximum batch size (20)." });
  }

  const normalizedRows = incomingRows.map((row) => {
    if (!row || typeof row !== "object") return null;
    const typed = row as Record<string, unknown>;
    return {
      ...typed,
      user_id: actorId,
      geometry:
        typed.geometry && typeof typed.geometry === "object"
          ? {
              ...(typed.geometry as Record<string, unknown>),
              author_user_id: actorId,
            }
          : typed.geometry,
    };
  });

  if (normalizedRows.some((row) => row === null)) {
    return jsonResponse(400, { error: "rows contains invalid pin payload." });
  }

  const insertRes = await adminClient
    .from("pins")
    .insert(normalizedRows as Record<string, unknown>[])
    .select("id");
  if (insertRes.error) {
    return jsonResponse(400, { error: insertRes.error.message });
  }

  const insertedPinIds = Array.from(
    new Set((insertRes.data || []).map((row) => row.id).filter(Boolean)),
  );
  return jsonResponse(200, {
    success: true,
    insertedPinIds,
    insertedCount: insertedPinIds.length,
    requestedCount: normalizedRows.length,
  });
};

const handleListPins = async (
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
  payload: Record<string, unknown>,
) => {
  const requestedLayerKeys = Array.isArray(payload.layerKeys)
    ? payload.layerKeys
    : [];
  const layerKeys = Array.from(
    new Set(
      requestedLayerKeys
        .map((value) => asString(value).toLowerCase())
        .filter((value) => ["public", "friends", "private", "events"].includes(value)),
    ),
  );
  if (layerKeys.length === 0) {
    return jsonResponse(400, { error: "layerKeys must include at least one valid layer." });
  }

  const requestedLimit = Number(payload.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(5000, Math.floor(requestedLimit)))
    : 3000;

  const pinsRes = await adminClient
    .from("pins")
    .select("*")
    .in("layer", layerKeys)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (pinsRes.error) {
    return jsonResponse(400, { error: pinsRes.error.message });
  }

  const rows = pinsRes.data || [];
  let friendIdSet = new Set<string>();
  if (layerKeys.includes("friends") || layerKeys.includes("private")) {
    const friendshipRes = await adminClient
      .from("friends")
      .select("user_id,friend_id,status")
      .or(`user_id.eq.${actorId},friend_id.eq.${actorId}`)
      .eq("status", "accepted");
    if (friendshipRes.error) {
      return jsonResponse(400, { error: friendshipRes.error.message });
    }

    friendIdSet = new Set(
      (friendshipRes.data || [])
        .map((row) => (row.user_id === actorId ? row.friend_id : row.user_id))
        .filter(Boolean),
    );
  }

  const pins = rows.filter((pin) => {
    const pinLayer = asString(pin?.layer).toLowerCase();
    if (pinLayer === "public") return true;
    if (pinLayer === "private" || pinLayer === "friends") {
      return pin?.user_id === actorId || friendIdSet.has(pin?.user_id);
    }
    return false;
  });

  return jsonResponse(200, {
    success: true,
    pins,
    count: pins.length,
    requestedCount: rows.length,
  });
};

const handleSetLayerPref = async (
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
  payload: Record<string, unknown>,
) => {
  const layerId = asString(payload.layerId);
  if (!isUuid(layerId)) {
    return jsonResponse(400, { error: "layerId is required." });
  }
  const hidden = Boolean(payload.hidden);

  const upsertRes = await adminClient.from("user_layer_prefs").upsert(
    [{ user_id: actorId, layer_id: layerId, hidden }],
    { onConflict: "user_id,layer_id" },
  );
  if (upsertRes.error) {
    return jsonResponse(400, { error: upsertRes.error.message });
  }

  return jsonResponse(200, {
    success: true,
    layerId,
    hidden,
  });
};

const handleSetLayerOrder = async (
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
  payload: Record<string, unknown>,
) => {
  const rawIds = Array.isArray(payload.layerIds) ? payload.layerIds : [];
  const layerIds = Array.from(
    new Set(rawIds.map((value) => asString(value)).filter((value) => isUuid(value))),
  );
  if (layerIds.length === 0) {
    return jsonResponse(400, { error: "layerIds must include at least one valid UUID." });
  }
  if (layerIds.length > 200) {
    return jsonResponse(400, { error: "layerIds exceeds maximum size (200)." });
  }

  const rows = layerIds.map((layerId, index) => ({
    user_id: actorId,
    layer_id: layerId,
    sort_order: index,
  }));
  const upsertRes = await adminClient
    .from("user_layer_prefs")
    .upsert(rows, { onConflict: "user_id,layer_id" });
  if (upsertRes.error) {
    return jsonResponse(400, { error: upsertRes.error.message });
  }

  return jsonResponse(200, {
    success: true,
    layerIds,
    count: layerIds.length,
  });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  try {
    const payload = (await req.json()) as Record<string, unknown>;
    const action = asString(payload.action) as SocialAction;
    const accessToken = asString(payload.accessToken);
    const refreshToken = asString(payload.refreshToken);
    const actorUserId = asString(payload.actorUserId);

    if (!action || (!accessToken && !refreshToken && !actorUserId)) {
      return jsonResponse(400, {
        error: "action and one of accessToken/refreshToken/actorUserId are required.",
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(500, {
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const actor = await resolveActor(
      adminClient,
      accessToken,
      refreshToken,
      actorUserId,
      {
        allowActorIdFallback:
          action !== "delete_pin" &&
          action !== "create_pins" &&
          action !== "list_pins" &&
          action !== "set_layer_pref" &&
          action !== "set_layer_order",
      },
    );
    const actorId = actor.actorId || null;
    if (!actorId) {
      return jsonResponse(401, { error: "Invalid or expired session token." });
    }

    const withRefreshedTokens = async (response: Response) => {
      if (!actor.refreshedAccessToken || response.status !== 200) {
        return response;
      }
      const json = await response.json();
      return jsonResponse(200, {
        ...json,
        refreshedAccessToken: actor.refreshedAccessToken,
        refreshedRefreshToken: actor.refreshedRefreshToken || null,
        tokenFallbackUsed: actor.usedFallback,
      });
    };

    if (action === "vote") {
      return await withRefreshedTokens(
        await handleVote(adminClient, actorId, payload),
      );
    }
    if (action === "vote_summary") {
      return await withRefreshedTokens(
        await handleVoteSummary(adminClient, actorId, payload),
      );
    }
    if (action === "friend_lists") {
      return await withRefreshedTokens(
        await handleFriendLists(adminClient, actorId),
      );
    }
    if (action === "send_friend_request") {
      return await withRefreshedTokens(
        await handleSendFriendRequest(adminClient, actorId, payload),
      );
    }
    if (action === "accept_friend_request") {
      return await withRefreshedTokens(
        await handleUpdateFriendship(
          adminClient,
          actorId,
          payload,
          "accept",
        ),
      );
    }
    if (action === "reject_friend_request" || action === "remove_friend") {
      return await withRefreshedTokens(
        await handleUpdateFriendship(
          adminClient,
          actorId,
          payload,
          "delete",
        ),
      );
    }
    if (action === "create_pins") {
      return await withRefreshedTokens(
        await handleCreatePins(adminClient, actorId, payload),
      );
    }
    if (action === "list_pins") {
      return await withRefreshedTokens(
        await handleListPins(adminClient, actorId, payload),
      );
    }
    if (action === "set_layer_pref") {
      return await withRefreshedTokens(
        await handleSetLayerPref(adminClient, actorId, payload),
      );
    }
    if (action === "set_layer_order") {
      return await withRefreshedTokens(
        await handleSetLayerOrder(adminClient, actorId, payload),
      );
    }
    if (action === "delete_pin") {
      return await withRefreshedTokens(
        await handleDeletePin(adminClient, actorId, payload),
      );
    }

    return jsonResponse(400, { error: "Unsupported action." });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : "Unexpected error.",
    });
  }
});
