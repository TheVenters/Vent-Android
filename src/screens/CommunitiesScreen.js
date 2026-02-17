import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  TextInput,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SIZES } from "../constants/theme";
import { useAppTheme } from "../context/ThemeContext";
import {
  fetchMyCommunityMembershipsViaEdgeFunction,
  fetchMyLayerPrefsViaEdgeFunction,
  getActiveSession,
  supabase,
  supabaseWithAccessToken,
  getCurrentUser,
  getActiveSession,
  setLayerPreferenceViaEdgeFunction,
  supabaseWithAccessToken,
} from "../services/supabase";
import { getPinLayerKeyFromLayer } from "../utils/layers";
import {
  encodeLayerKindWithIcon,
  parseLayerKindMetadata,
} from "../utils/layerKind";

const OWNER_LABELS = {
  system: "System",
  community: "Community",
  user: "User",
};
const isRlsPolicyError = (error) =>
  error?.code === "42501" ||
  String(error?.message || "")
    .toLowerCase()
    .includes("row-level security policy");
const isAcceptedMembershipStatus = (status) =>
  status === "accepted" || status === "active";
const isAdminCommunityRole = (role) => role === "admin" || role === "owner";
const isModeratorCommunityRole = (role) => role === "mod";

const slugify = (value) =>
  (value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const normalizeMembershipStatus = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "active") return "accepted";
  return normalized;
};

const normalizeMembershipRole = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "owner" || normalized === "mod") return "admin";
  return normalized || "member";
};

const normalizeMembershipRow = (row) => {
  if (!row) return row;
  return {
    ...row,
    status: normalizeMembershipStatus(row.status),
    role: normalizeMembershipRole(row.role),
  };
};

const CommunitiesScreen = ({ navigation }) => {
  const { palette, isDark } = useAppTheme();
  const styles = createStyles(palette, isDark);

  const [currentUser, setCurrentUser] = useState(null);
  const [communities, setCommunities] = useState([]);
  const [membershipsByCommunity, setMembershipsByCommunity] = useState({});
  const [layerCountByCommunity, setLayerCountByCommunity] = useState({});
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  const [query, setQuery] = useState("");
  const [selectedCommunityId, setSelectedCommunityId] = useState(null);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detailMembership, setDetailMembership] = useState(null);
  const [communityLayers, setCommunityLayers] = useState([]);
  const [communityPostCount, setCommunityPostCount] = useState(0);
  const [availableLayersToAttach, setAvailableLayersToAttach] = useState([]);
  const [communityOwner, setCommunityOwner] = useState(null);
  const [communityModerators, setCommunityModerators] = useState([]);
  const [communityMembers, setCommunityMembers] = useState([]);
  const [pendingJoinRequests, setPendingJoinRequests] = useState([]);
  const [roleUpdatingUserId, setRoleUpdatingUserId] = useState(null);
  const [membershipActionUserId, setMembershipActionUserId] = useState(null);

  const [showCreateCommunityModal, setShowCreateCommunityModal] =
    useState(false);
  const [communityNameInput, setCommunityNameInput] = useState("");
  const [communityDescriptionInput, setCommunityDescriptionInput] =
    useState("");
  const [communitySlugInput, setCommunitySlugInput] = useState("");

  const [showCreateLayerModal, setShowCreateLayerModal] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");
  const [newLayerKind, setNewLayerKind] = useState("user_overlay");

  const [showAttachLayerModal, setShowAttachLayerModal] = useState(false);
  const [showLayerIconModal, setShowLayerIconModal] = useState(false);
  const [editingLayer, setEditingLayer] = useState(null);
  const [layerIconInput, setLayerIconInput] = useState("");

  const selectedCommunity = communities.find(
    (community) => community.id === selectedCommunityId,
  );

  const filteredCommunities = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return communities;

    return communities.filter((community) => {
      const haystack =
        `${community.name} ${community.description || ""}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [communities, query]);

  const canManageSelectedCommunity =
    isAcceptedMembershipStatus(detailMembership?.status) &&
    (isAdminCommunityRole(detailMembership?.role) ||
      isModeratorCommunityRole(detailMembership?.role));
  const canManageCommunityRoles =
    isAcceptedMembershipStatus(detailMembership?.status) &&
    isAdminCommunityRole(detailMembership?.role);

  const formatMemberName = useCallback((member) => {
    if (!member) return "Unknown";
    if (member.display_name) return member.display_name;
    if (member.username) return `@${member.username}`;
    if (member.user_id) return member.user_id.slice(0, 8);
    return "Unknown";
  }, []);

  const resolveSessionContext = useCallback(async () => {
    let session = await getActiveSession();
    if (!session?.user?.id) {
      try {
        const {
          data: { session: fallbackSession },
        } = await supabase.auth.getSession();
        session = fallbackSession || null;
      } catch (_) {
        session = null;
      }
    }
    const sessionUser = session?.user || null;
    const sessionUserId = sessionUser?.id || null;
    const accessToken = session?.access_token || null;
    return {
      session,
      sessionUser,
      sessionUserId,
      accessToken,
      refreshToken: session?.refresh_token || null,
      client: accessToken ? supabaseWithAccessToken(accessToken) : supabase,
    };
  }, []);

  const loadCommunitySummary = useCallback(
    async (userId) => {
      setLoading(true);

      try {
        const { client, sessionUser, sessionUserId } =
          await resolveSessionContext();
        const effectiveUserId = sessionUserId || userId || null;

        if (sessionUser?.id && currentUser?.id !== sessionUser.id) {
          setCurrentUser(sessionUser);
        }

        const [communitiesRes, communityLayersRes, membershipsRes] =
          await Promise.all([
            client
              .from("communities")
              .select(
                "id,slug,name,description,created_at,owner_user_id,lead_admin_user_id",
              )
              .order("created_at", { ascending: false }),
            client
              .from("community_layers")
              .select("community_id,layer_id,enabled"),
            effectiveUserId
              ? client
                  .from("community_members")
                  .select("community_id,role,status")
                  .eq("user_id", effectiveUserId)
              : Promise.resolve({ data: [], error: null }),
          ]);

        if (communitiesRes.error) throw communitiesRes.error;
        if (communityLayersRes.error) throw communityLayersRes.error;
        if (membershipsRes.error) throw membershipsRes.error;

        const counts = {};
        (communityLayersRes.data || []).forEach((row) => {
          if (!row.enabled) return;
          counts[row.community_id] = (counts[row.community_id] || 0) + 1;
        });

        const membershipMap = {};
        (membershipsRes.data || []).forEach((row) => {
          membershipMap[row.community_id] = row;
        });

        setCommunities(communitiesRes.data || []);
        setLayerCountByCommunity(counts);
        setMembershipsByCommunity(membershipMap);
      } catch (error) {
        console.error("Error loading communities:", error);
        Alert.alert("Error", "Failed to load communities.");
      } finally {
        setLoading(false);
      }
    },
    [currentUser?.id, resolveSessionContext],
  );

  const loadCommunityDetail = useCallback(
    async (communityId, userId) => {
      if (!communityId) return;

      setDetailLoading(true);
      try {
        const { client, sessionUser, sessionUserId } =
          await resolveSessionContext();
        const effectiveUserId = sessionUserId || userId || null;

        if (sessionUser?.id && currentUser?.id !== sessionUser.id) {
          setCurrentUser(sessionUser);
        }

        const [communityRes, membershipRes, communityLayersRes, allLayersRes, membersRes] =
          await Promise.all([
            client
              .from("communities")
              .select("id,owner_user_id,lead_admin_user_id")
              .eq("id", communityId)
              .maybeSingle(),
            effectiveUserId
              ? client
                  .from("community_members")
                  .select("community_id,role,status")
                  .eq("user_id", effectiveUserId)
                  .eq("community_id", communityId)
                  .maybeSingle()
              : Promise.resolve({ data: null, error: null }),
            client
              .from("community_layers")
              .select(
                "community_id,layer_id,enabled,sort_order,layer:layers(id,name,kind,owner_type,owner_id,is_public,enabled,created_at)",
              )
              .eq("community_id", communityId)
              .eq("enabled", true)
              .order("sort_order", { ascending: true }),
            client
              .from("layers")
              .select(
                "id,name,kind,owner_type,owner_id,is_public,enabled,created_at",
              )
              .eq("enabled", true)
              .eq("owner_type", "community"),
            client
              .from("community_members")
              .select("user_id,role,status,created_at")
              .eq("community_id", communityId),
          ]);

        if (communityRes.error) throw communityRes.error;
        if (membershipRes.error) throw membershipRes.error;
        if (communityLayersRes.error) throw communityLayersRes.error;
        if (allLayersRes.error) throw allLayersRes.error;
        if (membersRes.error) throw membersRes.error;

        const allMembers = membersRes.data || [];
        const acceptedMembers = allMembers.filter((member) =>
          isAcceptedMembershipStatus(member.status),
        );
        const pendingMembers = allMembers.filter(
          (member) => member.status === "pending",
        );

        const memberIds = Array.from(
          new Set(allMembers.map((member) => member.user_id).filter(Boolean)),
        );
        let profileMap = new Map();
        if (memberIds.length > 0) {
          const profilesRes = await client
            .from("profiles")
            .select("id,username,display_name")
            .in("id", memberIds);
          if (profilesRes.error) throw profilesRes.error;
          profileMap = new Map(
            (profilesRes.data || []).map((profile) => [profile.id, profile]),
          );
        }

        const roleOrder = { owner: 0, admin: 0, mod: 1, member: 2 };
        const enrichedMembers = acceptedMembers
          .map((member) => {
            const profile = profileMap.get(member.user_id);
            return {
              ...member,
              username: profile?.username || null,
              display_name: profile?.display_name || null,
            };
          })
          .sort((a, b) => {
            const roleDiff = (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99);
            if (roleDiff !== 0) return roleDiff;
            return formatMemberName(a).localeCompare(formatMemberName(b));
          });
        const enrichedPendingMembers = pendingMembers
          .map((member) => {
            const profile = profileMap.get(member.user_id);
            return {
              ...member,
              username: profile?.username || null,
              display_name: profile?.display_name || null,
            };
          })
          .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));

        const explicitOwnerUserId =
          communityRes.data?.lead_admin_user_id ||
          communityRes.data?.owner_user_id ||
          null;
        const owner =
          (explicitOwnerUserId
            ? enrichedMembers.find((member) => member.user_id === explicitOwnerUserId)
            : null) ||
          enrichedMembers.find((member) => isAdminCommunityRole(member.role)) ||
          null;
        const moderators = enrichedMembers.filter(
          (member) =>
            isAdminCommunityRole(member.role) &&
            member.user_id !== owner?.user_id,
        );

        const linkedRows = communityLayersRes.data || [];
        const linkedLayerIds = linkedRows
          .map((row) => row.layer_id)
          .filter(Boolean);
        const layerOwnerCommunityIds = Array.from(
          new Set(linkedRows.map((row) => row.layer?.owner_id).filter(Boolean)),
        );

        let ownerCommunityMap = new Map();
        if (layerOwnerCommunityIds.length > 0) {
          const ownerCommunitiesRes = await client
            .from("communities")
            .select("id,name")
            .in("id", layerOwnerCommunityIds);
          if (ownerCommunitiesRes.error) throw ownerCommunitiesRes.error;
          ownerCommunityMap = new Map(
            (ownerCommunitiesRes.data || []).map((community) => [
              community.id,
              community.name,
            ]),
          );
        }

        let prefsMap = new Map();
        if (effectiveUserId && linkedLayerIds.length > 0) {
          const prefsRes = await client
            .from("user_layer_prefs")
            .select("layer_id,hidden")
            .eq("user_id", effectiveUserId)
            .in("layer_id", linkedLayerIds);

          prefsMap = new Map(
            (prefsRows || []).map((row) => [row.layer_id, row.hidden]),
          );
        }

        const mappedLayers = linkedRows
          .filter((row) => row.layer)
          .map((row) => {
            const layer = row.layer;
            const { baseKind, layerIcon } = parseLayerKindMetadata(layer.kind);
            const hasPref = prefsMap.has(layer.id);
            const inCollection = hasPref ? !prefsMap.get(layer.id) : false;
            const ownerLabel =
              layer.owner_type === "community"
                ? ownerCommunityMap.get(layer.owner_id) || "Community"
                : layer.owner_type === "user"
                  ? "User"
                  : "System";

            return {
              ...layer,
              kind: baseKind || layer.kind,
              raw_kind: layer.kind,
              layer_icon: layerIcon,
              inCollection,
              sortOrder: row.sort_order || 0,
              ownerLabel,
            };
          });

        const pinLayerKeys = Array.from(
          new Set(
            mappedLayers.map((layer) =>
              getPinLayerKeyFromLayer({
                kind: layer.kind,
                name: layer.name,
                owner_type: layer.owner_type,
                is_public: layer.is_public,
              }),
            ),
          ),
        );

        let totalPosts = 0;
        if (pinLayerKeys.length > 0) {
          const communityLayerIdSet = new Set(
            mappedLayers.map((layer) => layer.id),
          );
          const postsRes = await client
            .from("pins")
            .select("id,layer,geometry")
            .in("layer", pinLayerKeys)
            .order("created_at", { ascending: false })
            .limit(300);
          if (postsRes.error) throw postsRes.error;

          totalPosts = (postsRes.data || []).filter((post) =>
            communityLayerIdSet.has(post?.geometry?.layer_id),
          ).length;
        }

        const linkedIdSet = new Set(linkedLayerIds);
        const attachCandidates = (allLayersRes.data || [])
          .filter((layer) => !linkedIdSet.has(layer.id))
          .map((layer) => {
            const { baseKind, layerIcon } = parseLayerKindMetadata(layer.kind);
            return {
              ...layer,
              kind: baseKind || layer.kind,
              raw_kind: layer.kind,
              layer_icon: layerIcon,
            };
          })
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        setCommunityLayers(mappedLayers);
        setCommunityPostCount(totalPosts);
        setAvailableLayersToAttach(attachCandidates);
        setCommunityOwner(owner);
        setCommunityModerators(moderators);
        setCommunityMembers(enrichedMembers);
        setPendingJoinRequests(enrichedPendingMembers);
        setDetailMembership(
          normalizeMembershipRow(membershipRes.data) ||
            membershipsByCommunity[communityId] ||
            null,
        );
      } catch (error) {
        console.error("Error loading community detail:", error);
        Alert.alert("Error", "Failed to load community details.");
      } finally {
        setDetailLoading(false);
      }
    },
    [currentUser?.id, formatMemberName, membershipsByCommunity, resolveSessionContext],
  );

  useEffect(() => {
    const initialize = async () => {
      const user = await getCurrentUser();
      setCurrentUser(user);
      await loadCommunitySummary(user?.id);
    };

    initialize();
  }, [loadCommunitySummary]);

  useFocusEffect(
    useCallback(() => {
      loadCommunitySummary(currentUser?.id);
    }, [currentUser?.id, loadCommunitySummary]),
  );

  useEffect(() => {
    if (!selectedCommunityId) return;
    setDetailMembership(null);
    loadCommunityDetail(selectedCommunityId, currentUser?.id);
  }, [selectedCommunityId, currentUser?.id, loadCommunityDetail]);

  const getJoinStatus = (communityId) => {
    const membership = membershipsByCommunity[communityId];
    if (!membership) return "Join";
    if (isAcceptedMembershipStatus(membership.status)) return "Joined";
    if (membership.status === "pending") return "Pending";
    return "Join";
  };

  const handleJoinCommunity = async (communityId) => {
    try {
      const { client, sessionUserId } = await resolveSessionContext();
      if (!sessionUserId) {
        Alert.alert("Sign In Required", "Please sign in to join communities.");
        navigation.navigate("Account");
        return;
      }

      const existing = membershipsByCommunity[communityId];
      if (isAcceptedMembershipStatus(existing?.status)) return;

      // If a stale pending row exists, replace it with an accepted self-join row.
      const deletePendingRes = await client
        .from("community_members")
        .delete()
        .eq("community_id", communityId)
        .eq("user_id", sessionUserId)
        .eq("status", "pending");
      if (deletePendingRes.error) throw deletePendingRes.error;

      const { error } = await client.from("community_members").upsert(
        {
          user_id: sessionUserId,
          community_id: communityId,
          role: "member",
          status: "accepted",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,community_id", ignoreDuplicates: true },
      );
      if (edgeResult.error) throw edgeResult.error;

      setMembershipsByCommunity((prev) => ({
        ...prev,
        [communityId]: normalizeMembershipRow(
          edgeResult.data?.membership || {
            community_id: communityId,
            role: "member",
            status: "accepted",
          },
        ),
      }));
      if (selectedCommunityId === communityId) {
        setDetailMembership(
          normalizeMembershipRow(
            edgeResult.data?.membership || {
              community_id: communityId,
              role: "member",
              status: "accepted",
            },
          ),
        );
      }

      await loadCommunitySummary(sessionUserId);
      if (selectedCommunityId === communityId) {
        await loadCommunityDetail(communityId, sessionUserId);
      }
    } catch (error) {
      console.error("Error joining community:", error);
      Alert.alert("Error", "Failed to join community.");
    }
  };

  const handleLeaveCommunity = async (communityId) => {
    if (!currentUser?.id) {
      Alert.alert("Sign In Required", "Please sign in to manage communities.");
      navigation.navigate("Account");
      return;
    }

    const existing = membershipsByCommunity[communityId];
    if (!existing) return;

    const isPending = existing.status === "pending";
    Alert.alert(
      isPending ? "Cancel Request" : "Leave Community",
      isPending
        ? "Cancel your join request for this community?"
        : "Are you sure you want to leave this community?",
      [
        { text: "Keep", style: "cancel" },
        {
          text: isPending ? "Cancel Request" : "Leave",
          style: "destructive",
          onPress: async () => {
            try {
              const session = await getActiveSession();
              if (!session?.access_token) {
                Alert.alert("Session Expired", "Please sign in again.");
                navigation.navigate("Account");
                return;
              }
              const edgeResult = await leaveCommunityViaEdgeFunction(
                communityId,
                session.access_token,
                session.refresh_token || null,
                session.user?.id || null,
              );
              if (edgeResult.error) throw edgeResult.error;

              setMembershipsByCommunity((prev) => {
                const next = { ...prev };
                delete next[communityId];
                return next;
              });
              if (selectedCommunityId === communityId) {
                setDetailMembership(null);
              }

              await loadCommunitySummary(currentUser.id);
              if (selectedCommunityId === communityId) {
                await loadCommunityDetail(communityId, currentUser.id);
              }
            } catch (error) {
              console.error("Error leaving community:", error);
              Alert.alert("Error", "Failed to leave community.");
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleToggleLayerCollection = async (layerId, nextEnabled) => {
    const { sessionUserId, accessToken, refreshToken } =
      await resolveSessionContext();
    if (!sessionUserId) {
      Alert.alert(
        "Sign In Required",
        "Your session is missing or expired. Please sign out and sign back in.",
      );
      return;
    }

    const previous = communityLayers;
    const optimistic = communityLayers.map((layer) =>
      layer.id === layerId ? { ...layer, inCollection: nextEnabled } : layer,
    );
    setCommunityLayers(optimistic);

    try {
      const hidden = !nextEnabled;
      const edgeResult = await setLayerPreferenceViaEdgeFunction(
        layerId,
        hidden,
        accessToken,
        refreshToken,
        sessionUserId,
      );
      if (edgeResult.error) {
        throw edgeResult.error;
      }
      await loadCommunityDetail(selectedCommunityId, sessionUserId);
    } catch (error) {
      if (isRlsPolicyError(error)) {
        console.warn("Community layer collection blocked by RLS:", error);
      } else {
        console.error("Error updating user layer prefs:", error);
      }
      setCommunityLayers(previous);
      Alert.alert(
        "Layer Update Blocked",
        isRlsPolicyError(error)
          ? "Database policy blocked this layer update."
          : "Failed to sync your layer collection to Supabase.",
      );
    }
  };

  const handleCreateCommunity = async () => {
    if (!communityNameInput.trim()) {
      Alert.alert("Name Required", "Please enter a community name.");
      return;
    }

    const slug = slugify(communitySlugInput || communityNameInput);
    if (!slug) {
      Alert.alert("Slug Required", "Please enter a valid slug.");
      return;
    }

    try {
      const { client, sessionUserId } = await resolveSessionContext();
      if (!sessionUserId) {
        Alert.alert("Sign In Required", "Please sign in to create communities.");
        return;
      }

      const createRes = await client
        .from("communities")
        .insert({
          slug,
          name: communityNameInput.trim(),
          description: communityDescriptionInput.trim() || null,
          owner_user_id: sessionUserId,
          lead_admin_user_id: sessionUserId,
        })
        .select(
          "id,slug,name,description,created_at,owner_user_id,lead_admin_user_id",
        )
        .single();

      if (createRes.error) throw createRes.error;

      const membershipRes = await client.from("community_members").upsert(
        {
          user_id: sessionUserId,
          community_id: createRes.data.id,
          role: "admin",
          status: "accepted",
          updated_at: new Date().toISOString(),
        },
      );

      if (membershipRes.error) throw membershipRes.error;

      setShowCreateCommunityModal(false);
      setCommunityNameInput("");
      setCommunityDescriptionInput("");
      setCommunitySlugInput("");

      await loadCommunitySummary(sessionUserId);
      setSelectedCommunityId(createRes.data.id);
    } catch (error) {
      console.error("Error creating community:", error);
      Alert.alert("Error", error.message || "Failed to create community.");
    }
  };

  const handleCreateLayerForCommunity = async () => {
    if (!selectedCommunityId) return;

    if (!newLayerName.trim()) {
      Alert.alert("Layer Name Required", "Please enter a layer name.");
      return;
    }

    try {
      const { client, sessionUserId } = await resolveSessionContext();
      if (!sessionUserId) {
        Alert.alert("Sign In Required", "Please sign in to manage communities.");
        return;
      }

      const createLayerRes = await client
        .from("layers")
        .insert({
          name: newLayerName.trim(),
          kind: newLayerKind.trim() || "user_overlay",
          enabled: true,
          owner_type: "community",
          owner_id: selectedCommunityId,
        })
        .select("id")
        .single();

      if (createLayerRes.error) throw createLayerRes.error;

      const nextSort =
        communityLayers.reduce(
          (max, layer) => Math.max(max, layer.sortOrder || 0),
          0,
        ) + 1;

      const attachRes = await client.from("community_layers").upsert(
        {
          community_id: selectedCommunityId,
          layer_id: createLayerRes.data.id,
          enabled: true,
          sort_order: nextSort,
        },
        { onConflict: "community_id,layer_id" },
      );

      if (error) throw error;

      setShowCreateLayerModal(false);
      setNewLayerName("");
      setNewLayerKind("user_overlay");

      await loadCommunitySummary(sessionUserId);
      await loadCommunityDetail(selectedCommunityId, sessionUserId);
    } catch (error) {
      console.error("Error creating layer:", error);
      Alert.alert("Error", error.message || "Failed to create layer.");
    }
  };

  const handleAttachExistingLayer = async (layerId) => {
    if (!selectedCommunityId) return;
    const isAllowed = availableLayersToAttach.some(
      (layer) => layer.id === layerId,
    );
    if (!isAllowed) {
      Alert.alert(
        "Not Allowed",
        "Only community-owned layers can be attached here.",
      );
      return;
    }

    try {
      const { client, sessionUserId } = await resolveSessionContext();
      if (!sessionUserId) {
        Alert.alert("Sign In Required", "Please sign in to manage communities.");
        return;
      }

      const nextSort =
        communityLayers.reduce(
          (max, layer) => Math.max(max, layer.sortOrder || 0),
          0,
        ) + 1;

      const res = await client.from("community_layers").upsert(
        {
          community_id: selectedCommunityId,
          layer_id: layerId,
          enabled: true,
          sort_order: nextSort,
        },
        { onConflict: "community_id,layer_id" },
      );

      if (res.error) throw res.error;

      await loadCommunitySummary(sessionUserId);
      await loadCommunityDetail(selectedCommunityId, sessionUserId);
      setShowAttachLayerModal(false);
    } catch (error) {
      console.error("Error attaching layer:", error);
      Alert.alert("Error", error.message || "Failed to attach layer.");
    }
  };

  const handleDeleteLayer = async (layer) => {
    if (!currentUser?.id || !selectedCommunityId) return;
    if (!canManageSelectedCommunity) {
      Alert.alert(
        "Permission Denied",
        "Only community admins can delete layers.",
      );
      return;
    }
    if (
      !(
        layer.owner_type === "community" &&
        layer.owner_id === selectedCommunityId
      )
    ) {
      Alert.alert(
        "Cannot Delete",
        "You can only delete layers owned by this community.",
      );
      return;
    }

    Alert.alert(
      "Delete Layer",
      `Delete '${layer.name}' and its linked data?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const { client, sessionUserId } = await resolveSessionContext();
              if (!sessionUserId) {
                Alert.alert(
                  "Sign In Required",
                  "Please sign in to manage communities.",
                );
                return;
              }

              const { error: pinsError } = await client
                .from("pins")
                .delete()
                .contains("geometry", { layer_id: layer.id });
              if (pinsError) throw pinsError;

              const { error: overlayError } = await client
                .from("overlay_features")
                .delete()
                .eq("layer_id", layer.id);
              if (overlayError) throw overlayError;

              const { error: prefsError } = await client
                .from("user_layer_prefs")
                .delete()
                .eq("layer_id", layer.id);
              if (prefsError) throw prefsError;

              const { error: linksError } = await client
                .from("community_layers")
                .delete()
                .eq("layer_id", layer.id);
              if (linksError) throw linksError;

              const { error: layerError } = await client
                .from("layers")
                .delete()
                .eq("id", layer.id);
              if (layerError) throw layerError;

              await loadCommunitySummary(sessionUserId);
              await loadCommunityDetail(selectedCommunityId, sessionUserId);
            } catch (error) {
              console.error("Error deleting layer:", error);
              Alert.alert("Error", error.message || "Failed to delete layer.");
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleDeleteCommunity = async () => {
    if (!selectedCommunityId || !canDeleteSelectedCommunity) {
      Alert.alert(
        "Permission Denied",
        "Only the lead admin or a platform admin can delete this community.",
      );
      return;
    }

    Alert.alert(
      "Delete Community",
      `Delete '${selectedCommunity?.name || "this community"}' and all of its layers? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Community",
          style: "destructive",
          onPress: async () => {
            try {
              const { data, error } = await supabase.rpc(
                "delete_community_with_layers",
                {
                  p_community_id: selectedCommunityId,
                },
              );
              if (error) throw error;
              if (!data) {
                throw new Error("Community delete returned no affected rows.");
              }

              await loadCommunitySummary(currentUser?.id);
              setSelectedCommunityId(null);
              setCommunityLayers([]);
              setCommunityPostCount(0);
              setAvailableLayersToAttach([]);
              setCommunityOwner(null);
              setCommunityModerators([]);
              setCommunityMembers([]);
              setDetailMembership(null);
            } catch (error) {
              console.error("Error deleting community:", error);
              Alert.alert(
                "Error",
                error.message || "Failed to delete community.",
              );
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleUpdateMemberRole = async (targetUserId, nextRole) => {
    if (!selectedCommunityId || !currentUser?.id) return;
    if (!canManageCommunityRoles) {
      Alert.alert(
        "Permission Denied",
        "Only community admins can manage moderators.",
      );
      return;
    }
    if (!targetUserId || targetUserId === currentUser.id) return;

    try {
      const { client, sessionUserId } = await resolveSessionContext();
      if (!sessionUserId) {
        Alert.alert("Sign In Required", "Please sign in to manage communities.");
        return;
      }
      setRoleUpdatingUserId(targetUserId);
      const { error } = await client
        .from("community_members")
        .update({ role: nextRole, updated_at: new Date().toISOString() })
        .eq("community_id", selectedCommunityId)
        .eq("user_id", targetUserId)
        .in("status", ["accepted", "active"]);
      if (error) throw error;

      await loadCommunityDetail(selectedCommunityId, sessionUserId);
    } catch (error) {
      console.error("Error updating member role:", error);
      Alert.alert("Error", error.message || "Failed to update member role.");
    } finally {
      setRoleUpdatingUserId(null);
    }
  };

  const handleApproveJoinRequest = async (targetUserId) => {
    if (!selectedCommunityId || !targetUserId) return;
    if (!canManageSelectedCommunity) return;

    try {
      const { client, sessionUserId } = await resolveSessionContext();
      if (!sessionUserId) {
        Alert.alert("Sign In Required", "Please sign in to manage communities.");
        return;
      }
      setMembershipActionUserId(targetUserId);
      const { error } = await client
        .from("community_members")
        .update({
          status: "accepted",
          role: "member",
          updated_at: new Date().toISOString(),
        })
        .eq("community_id", selectedCommunityId)
        .eq("user_id", targetUserId)
        .eq("status", "pending");
      if (error) throw error;
      await loadCommunityDetail(selectedCommunityId, sessionUserId);
    } catch (error) {
      console.error("Error approving join request:", error);
      Alert.alert("Error", error.message || "Failed to approve join request.");
    } finally {
      setMembershipActionUserId(null);
    }
  };

  const handleRejectJoinRequest = async (targetUserId) => {
    if (!selectedCommunityId || !targetUserId) return;
    if (!canManageSelectedCommunity) return;

    try {
      const { client, sessionUserId } = await resolveSessionContext();
      if (!sessionUserId) {
        Alert.alert("Sign In Required", "Please sign in to manage communities.");
        return;
      }
      setMembershipActionUserId(targetUserId);
      const { error } = await client
        .from("community_members")
        .delete()
        .eq("community_id", selectedCommunityId)
        .eq("user_id", targetUserId)
        .eq("status", "pending");
      if (error) throw error;
      await loadCommunityDetail(selectedCommunityId, sessionUserId);
    } catch (error) {
      console.error("Error rejecting join request:", error);
      Alert.alert("Error", error.message || "Failed to reject join request.");
    } finally {
      setMembershipActionUserId(null);
    }
  };

  const openLayerIconEditor = (layer) => {
    setEditingLayer(layer);
    setLayerIconInput(layer?.layer_icon || "");
    setShowLayerIconModal(true);
  };

  const handleSaveLayerIcon = async () => {
    if (!editingLayer?.id) return;

    try {
      const { client, sessionUserId } = await resolveSessionContext();
      if (!sessionUserId) {
        Alert.alert("Sign In Required", "Please sign in to manage communities.");
        return;
      }
      const nextKind = encodeLayerKindWithIcon(
        editingLayer.kind || "user_overlay",
        layerIconInput,
      );
      const { error } = await client
        .from("layers")
        .update({ kind: nextKind })
        .eq("id", editingLayer.id);
      if (error) throw error;

      setShowLayerIconModal(false);
      setEditingLayer(null);
      setLayerIconInput("");
      await loadCommunityDetail(selectedCommunityId, sessionUserId);
    } catch (error) {
      console.error("Error updating layer icon:", error);
      Alert.alert("Error", error.message || "Failed to update layer icon.");
    }
  };

  const renderCreateCommunityModal = () => (
    <Modal
      visible={showCreateCommunityModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowCreateCommunityModal(false)}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowCreateCommunityModal(false)}
        />
        <ScrollView
          style={styles.modalKeyboardScroll}
          contentContainerStyle={styles.modalKeyboardScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Community</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Name"
              placeholderTextColor={palette.subtext}
              value={communityNameInput}
              onChangeText={(value) => {
                setCommunityNameInput(value);
                if (!communitySlugInput) {
                  setCommunitySlugInput(slugify(value));
                }
              }}
            />

            <TextInput
              style={styles.modalInput}
              placeholder="Slug"
              placeholderTextColor={palette.subtext}
              value={communitySlugInput}
              onChangeText={setCommunitySlugInput}
              autoCapitalize="none"
            />

            <TextInput
              style={[styles.modalInput, styles.modalTextArea]}
              placeholder="Description"
              placeholderTextColor={palette.subtext}
              value={communityDescriptionInput}
              onChangeText={setCommunityDescriptionInput}
              multiline
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalSecondaryBtn}
                onPress={() => setCommunitySlugInput(slugify(communityNameInput))}
              >
                <Text style={styles.modalSecondaryBtnText}>Auto Slug</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={handleCreateCommunity}
              >
                <Text style={styles.modalPrimaryBtnText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderCreateLayerModal = () => (
    <Modal
      visible={showCreateLayerModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowCreateLayerModal(false)}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowCreateLayerModal(false)}
        />
        <ScrollView
          style={styles.modalKeyboardScroll}
          contentContainerStyle={styles.modalKeyboardScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Layer</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Layer name"
              placeholderTextColor={palette.subtext}
              value={newLayerName}
              onChangeText={setNewLayerName}
            />

            <TextInput
              style={styles.modalInput}
              placeholder="Kind (e.g. user_overlay)"
              placeholderTextColor={palette.subtext}
              value={newLayerKind}
              onChangeText={setNewLayerKind}
              autoCapitalize="none"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalSecondaryBtn}
                onPress={() => setShowCreateLayerModal(false)}
              >
                <Text style={styles.modalSecondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={handleCreateLayerForCommunity}
              >
                <Text style={styles.modalPrimaryBtnText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderAttachLayerModal = () => (
    <Modal
      visible={showAttachLayerModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowAttachLayerModal(false)}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowAttachLayerModal(false)}
        />

        <View style={[styles.modalCard, styles.modalLargeCard]}>
          <Text style={styles.modalTitle}>Add Existing Layer</Text>

          <ScrollView
            style={styles.modalList}
            showsVerticalScrollIndicator={false}
          >
            {availableLayersToAttach.length === 0 ? (
              <Text style={styles.emptyText}>
                No additional layers available.
              </Text>
            ) : (
              availableLayersToAttach.map((layer) => (
                <View key={layer.id} style={styles.attachLayerRow}>
                  <View style={styles.attachLayerLeft}>
                    <Text style={styles.attachLayerName}>{layer.name}</Text>
                    <Text style={styles.attachLayerMeta}>
                      {OWNER_LABELS[layer.owner_type] || "System"} •{" "}
                      {layer.kind}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.attachLayerBtn}
                    onPress={() => handleAttachExistingLayer(layer.id)}
                  >
                    <Text style={styles.attachLayerBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const renderLayerIconModal = () => (
    <Modal
      visible={showLayerIconModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowLayerIconModal(false)}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowLayerIconModal(false)}
        />
        <ScrollView
          style={styles.modalKeyboardScroll}
          contentContainerStyle={styles.modalKeyboardScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Layer Icon</Text>
            <Text style={styles.modalSubtext}>
              Choose any emoji for this layer pin marker.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="😀"
              placeholderTextColor={palette.subtext}
              value={layerIconInput}
              onChangeText={setLayerIconInput}
              autoCapitalize="none"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalSecondaryBtn}
                onPress={() => setLayerIconInput("")}
              >
                <Text style={styles.modalSecondaryBtnText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={handleSaveLayerIcon}
              >
                <Text style={styles.modalPrimaryBtnText}>Save Icon</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );

  if (selectedCommunity) {
    const joinStatus = getJoinStatus(selectedCommunity.id);
    const canUseCommunityChat =
      isPlatformAdmin || detailMembership?.status === "accepted";

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setSelectedCommunityId(null)}
          >
            <Text style={styles.backButtonText}>{"< Communities"}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Community</Text>
        </View>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.detailCard}>
            <Text style={styles.detailName}>{selectedCommunity.name}</Text>
            <Text style={styles.detailDescription}>
              {selectedCommunity.description || "No description yet."}
            </Text>

            <View style={styles.detailMetaRow}>
              <Text style={styles.detailMetaLabel}>Join Status</Text>
              <Text style={styles.detailMetaValue}>{joinStatus}</Text>
            </View>
            <View style={styles.detailMetaRow}>
              <Text style={styles.detailMetaLabel}>Layers</Text>
              <Text style={styles.detailMetaValue}>
                {layerCountByCommunity[selectedCommunity.id] || 0}
              </Text>
            </View>
            <View style={styles.detailMetaRow}>
              <Text style={styles.detailMetaLabel}>Posts</Text>
              <Text style={styles.detailMetaValue}>{communityPostCount}</Text>
            </View>
            <View style={styles.detailMetaRow}>
              <Text style={styles.detailMetaLabel}>Lead Admin</Text>
              <Text style={styles.detailMetaValue}>
                {communityOwner ? formatMemberName(communityOwner) : "None"}
              </Text>
            </View>
            <View style={styles.detailMetaRow}>
              <Text style={styles.detailMetaLabel}>Additional Admins</Text>
              <Text style={styles.detailMetaValue}>
                {communityModerators.length}
              </Text>
            </View>

            <View style={styles.detailActionsRow}>
              {(joinStatus === "Joined" || joinStatus === "Pending") && (
                <TouchableOpacity
                  style={[styles.primaryInlineBtn, styles.primaryInlineBtnDanger]}
                  onPress={() => handleLeaveCommunity(selectedCommunity.id)}
                >
                  <Text
                    style={[
                      styles.primaryInlineBtnText,
                      styles.primaryInlineBtnDangerText,
                    ]}
                  >
                    {joinStatus === "Pending" ? "Cancel Request" : "Leave Community"}
                  </Text>
                </TouchableOpacity>
              )}
              {joinStatus !== "Joined" && joinStatus !== "Pending" && (
                <TouchableOpacity
                  style={styles.primaryInlineBtn}
                  disabled={joinStatus === "Pending"}
                  onPress={() => handleJoinCommunity(selectedCommunity.id)}
                >
                  <Text style={styles.primaryInlineBtnText}>
                    {joinStatus === "Pending" ? "Request Pending" : "Join Community"}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.secondaryInlineBtn}
                onPress={() =>
                  navigation.navigate("Map", {
                    communityMap: {
                      id: selectedCommunity.id,
                      name: selectedCommunity.name,
                    },
                  })
                }
              >
                <Text style={styles.secondaryInlineBtnText}>
                  View Their Map
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.sectionHeading}>Leadership</Text>
          <View style={styles.leadershipCard}>
            <Text style={styles.leadershipLabel}>Lead Admin</Text>
            <Text style={styles.leadershipValue}>
              {communityOwner ? formatMemberName(communityOwner) : "No admin assigned"}
            </Text>
            <Text style={[styles.leadershipLabel, styles.leadershipLabelSpaced]}>
              Additional Admins
            </Text>
            {communityModerators.length === 0 ? (
              <Text style={styles.leadershipEmpty}>No additional admins yet.</Text>
            ) : (
              communityModerators.map((moderator) => (
                <Text key={moderator.user_id} style={styles.leadershipValue}>
                  {formatMemberName(moderator)}
                </Text>
              ))
            )}
          </View>

          <Text style={styles.sectionHeading}>Community Chat</Text>
          {!canUseCommunityChat ? (
            <Text style={styles.emptyText}>
              Join this community to chat with members.
            </Text>
          ) : (
            <View style={styles.chatLaunchCard}>
              <TouchableOpacity
                style={styles.chatLaunchBtn}
                onPress={() =>
                  navigation.navigate("CommunityChat", {
                    communityId: selectedCommunity.id,
                    communityName: selectedCommunity.name,
                  })
                }
              >
                <Text style={styles.chatLaunchBtnText}>Open Chat</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.sectionHeading}>Community Layers</Text>

          {detailLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={palette.primary} />
            </View>
          ) : communityLayers.length === 0 ? (
            <Text style={styles.emptyText}>
              No layers in this community yet.
            </Text>
          ) : (
            communityLayers.map((layer) => (
              <View key={layer.id} style={styles.layerCard}>
                <View style={styles.layerCardLeft}>
                  <Text style={styles.layerCardName}>{layer.name}</Text>
                  <Text style={styles.layerCardMeta}>
                    {OWNER_LABELS[layer.owner_type] || "System"} • {layer.kind}
                  </Text>
                  <Text style={styles.layerOwnerMeta}>
                    Owner: {layer.ownerLabel || "Unknown"}
                  </Text>
                  <Text style={styles.layerOwnerMeta}>
                    Icon: {layer.layer_icon || "default"}
                  </Text>
                </View>

                <View style={styles.layerActionsRow}>
                  <TouchableOpacity
                    style={[
                      styles.collectionActionBtn,
                      layer.inCollection && styles.collectionActionBtnRemove,
                    ]}
                    onPress={() =>
                      handleToggleLayerCollection(layer.id, !layer.inCollection)
                    }
                  >
                    <Text
                      style={[
                        styles.collectionActionBtnText,
                        layer.inCollection &&
                          styles.collectionActionBtnTextRemove,
                      ]}
                    >
                      {layer.inCollection
                        ? "Remove From My Layers"
                        : "Add To My Layers"}
                    </Text>
                  </TouchableOpacity>

                  {canManageSelectedCommunity &&
                  layer.owner_type === "community" &&
                  layer.owner_id === selectedCommunityId ? (
                    <View style={styles.layerOwnerActions}>
                      <TouchableOpacity
                        style={styles.editIconBtn}
                        onPress={() => openLayerIconEditor(layer)}
                      >
                        <Text style={styles.editIconBtnText}>Edit Icon</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.deleteLayerBtn}
                        onPress={() => handleDeleteLayer(layer)}
                      >
                        <Text style={styles.deleteLayerBtnText}>
                          Delete Layer
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              </View>
            ))
          )}

          {canManageSelectedCommunity && (
            <>
              <Text style={styles.sectionHeading}>Manage Community</Text>
              <View style={styles.manageActionsRow}>
                <TouchableOpacity
                  style={styles.manageActionBtn}
                  onPress={() => setShowCreateLayerModal(true)}
                >
                  <Text style={styles.manageActionBtnText}>Create Layer</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.manageActionBtn}
                  onPress={() => setShowAttachLayerModal(true)}
                >
                  <Text style={styles.manageActionBtnText}>
                    Add Existing Layer
                  </Text>
                </TouchableOpacity>
              </View>
              {canDeleteSelectedCommunity && (
                <TouchableOpacity
                  style={styles.deleteCommunityBtn}
                  onPress={handleDeleteCommunity}
                >
                  <Text style={styles.deleteCommunityBtnText}>
                    Delete Community
                  </Text>
                </TouchableOpacity>
              )}

              {canManageCommunityRoles && (
                <>
                  <Text style={styles.sectionHeading}>Join Requests</Text>
                  {pendingJoinRequests.length === 0 ? (
                    <Text style={styles.leadershipEmpty}>
                      No pending join requests.
                    </Text>
                  ) : (
                    pendingJoinRequests.map((member) => (
                      <View key={member.user_id} style={styles.memberRow}>
                        <View style={styles.memberRowLeft}>
                          <Text style={styles.memberName}>
                            {formatMemberName(member)}
                          </Text>
                          <Text style={styles.memberRole}>Pending</Text>
                        </View>
                        <View style={styles.memberRowRight}>
                          <TouchableOpacity
                            style={styles.memberActionBtn}
                            disabled={membershipActionUserId === member.user_id}
                            onPress={() =>
                              handleApproveJoinRequest(member.user_id)
                            }
                          >
                            <Text style={styles.memberActionBtnText}>
                              {membershipActionUserId === member.user_id
                                ? "Saving..."
                                : "Approve"}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.memberActionBtn}
                            disabled={membershipActionUserId === member.user_id}
                            onPress={() =>
                              handleRejectJoinRequest(member.user_id)
                            }
                          >
                            <Text style={styles.memberActionBtnText}>Reject</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))
                  )}

                  <Text style={styles.sectionHeading}>Manage Moderators</Text>
                  {communityMembers
                    .filter((member) =>
                      isPlatformAdmin
                        ? member.user_id !== currentUser?.id
                        : member.user_id !== communityOwner?.user_id,
                    )
                    .map((member) => (
                      <View key={member.user_id} style={styles.memberRow}>
                        <View style={styles.memberRowLeft}>
                          <Text style={styles.memberName}>
                            {formatMemberName(member)}
                          </Text>
                          <Text style={styles.memberRole}>
                            {member.role === "mod" || member.role === "admin"
                              ? "Moderator"
                              : "Member"}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.memberActionBtn}
                          disabled={roleUpdatingUserId === member.user_id}
                          onPress={() =>
                            handleUpdateMemberRole(
                              member.user_id,
                              member.role === "mod" || member.role === "admin"
                                ? "member"
                                : "admin",
                            )
                          }
                        >
                          <Text style={styles.memberActionBtnText}>
                            {roleUpdatingUserId === member.user_id
                              ? "Saving..."
                              : member.role === "mod" ||
                                  member.role === "admin"
                                ? "Remove Mod"
                                : "Make Mod"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                </>
              )}
            </>
          )}
        </ScrollView>

        {renderCreateLayerModal()}
        {renderAttachLayerModal()}
        {renderLayerIconModal()}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.navigate("Map")}
        >
          <Text style={styles.backButtonText}>{"< Map"}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Communities</Text>
        <TouchableOpacity
          style={styles.createCommunityBtn}
          onPress={() => setShowCreateCommunityModal(true)}
        >
          <Text style={styles.createCommunityBtnText}>Create</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search communities"
          placeholderTextColor={palette.subtext}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={palette.primary} />
          </View>
        ) : filteredCommunities.length === 0 ? (
          <Text style={styles.emptyText}>No communities found.</Text>
        ) : (
          filteredCommunities.map((community) => {
            const joinStatus = getJoinStatus(community.id);
            const isJoined = joinStatus === "Joined";
            const isPending = joinStatus === "Pending";
            const canLeave = isJoined || isPending;
            const actionLabel = isJoined
              ? "Leave"
              : isPending
                ? "Cancel"
                : "Join";

            return (
              <Pressable
                key={community.id}
                style={styles.card}
                onPress={() => setSelectedCommunityId(community.id)}
              >
                <View style={styles.cardTopRow}>
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.cardName}>{community.name}</Text>
                    <Text style={styles.cardDescription}>
                      {community.description || "No description"}
                    </Text>
                  </View>

                  <Pressable
                    style={[
                      styles.joinBtn,
                      isJoined && styles.joinBtnLeave,
                      isPending && styles.joinBtnPending,
                    ]}
                    onPress={(event) => {
                      if (event?.stopPropagation) event.stopPropagation();
                      if (canLeave) {
                        handleLeaveCommunity(community.id);
                        return;
                      }
                      handleJoinCommunity(community.id);
                    }}
                  >
                    <Text
                      style={[
                        styles.joinBtnText,
                        isJoined && styles.joinBtnTextLeave,
                        isPending && styles.joinBtnTextPending,
                      ]}
                    >
                      {actionLabel}
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.cardBottomRow}>
                  <Text style={styles.layerCountText}>
                    {layerCountByCommunity[community.id] || 0} layers
                  </Text>
                  <Text style={styles.openText}>Open</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {renderCreateCommunityModal()}
    </View>
  );
};

const createStyles = (palette, isDark) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.background,
    },
    header: {
      paddingTop: Platform.OS === "ios" ? 50 : 20,
      paddingHorizontal: SIZES.xl,
      paddingBottom: SIZES.lg,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
      flexDirection: "row",
      alignItems: "center",
      gap: SIZES.md,
    },
    backButton: {
      paddingVertical: SIZES.sm,
      paddingRight: SIZES.sm,
    },
    backButtonText: {
      fontSize: SIZES.md,
      fontWeight: "700",
      color: palette.primary,
    },
    title: {
      fontSize: SIZES.xxl,
      fontWeight: "800",
      color: palette.text,
      flex: 1,
    },
    createCommunityBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: SIZES.radius,
      backgroundColor: palette.primary,
    },
    createCommunityBtnText: {
      color: palette.onPrimary,
      fontWeight: "700",
      fontSize: 12,
    },
    searchWrap: {
      paddingHorizontal: SIZES.xl,
      paddingTop: 14,
    },
    searchInput: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: palette.text,
      backgroundColor: isDark ? "#202632" : "#ffffff",
    },
    list: {
      flex: 1,
      marginTop: 10,
    },
    listContent: {
      paddingHorizontal: SIZES.xl,
      paddingBottom: 24,
    },
    loadingWrap: {
      marginTop: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyText: {
      color: palette.subtext,
      fontSize: 14,
      textAlign: "center",
      marginTop: 16,
      lineHeight: 20,
    },
    card: {
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: isDark ? "#202632" : "#f9fbff",
      borderRadius: SIZES.radiusLg,
      padding: 12,
      marginBottom: 10,
    },
    cardTopRow: {
      flexDirection: "row",
      gap: 10,
    },
    cardTitleWrap: {
      flex: 1,
    },
    cardName: {
      fontSize: 16,
      fontWeight: "800",
      color: palette.text,
      marginBottom: 4,
    },
    cardDescription: {
      fontSize: 13,
      color: palette.subtext,
      lineHeight: 18,
    },
    joinBtn: {
      alignSelf: "flex-start",
      backgroundColor: palette.primary,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    joinBtnJoined: {
      backgroundColor: "rgba(16, 185, 129, 0.18)",
    },
    joinBtnLeave: {
      backgroundColor: "rgba(220, 38, 38, 0.12)",
      borderWidth: 1,
      borderColor: "rgba(220, 38, 38, 0.35)",
    },
    joinBtnPending: {
      backgroundColor: "rgba(245, 158, 11, 0.2)",
    },
    joinBtnText: {
      color: palette.onPrimary,
      fontSize: 12,
      fontWeight: "800",
    },
    joinBtnTextJoined: {
      color: "#047857",
    },
    joinBtnTextLeave: {
      color: "#ef4444",
    },
    joinBtnTextPending: {
      color: "#92400e",
    },
    cardBottomRow: {
      marginTop: 12,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: palette.border,
    },
    layerCountText: {
      fontSize: 13,
      fontWeight: "600",
      color: palette.subtext,
    },
    openText: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.primary,
    },
    detailCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radiusLg,
      padding: 14,
      backgroundColor: isDark ? "#202632" : "#f9fbff",
      marginBottom: 12,
    },
    detailName: {
      fontSize: 22,
      fontWeight: "800",
      color: palette.text,
      marginBottom: 8,
    },
    detailDescription: {
      fontSize: 14,
      color: palette.subtext,
      marginBottom: 12,
      lineHeight: 20,
    },
    detailMetaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    detailMetaLabel: {
      fontSize: 13,
      color: palette.subtext,
      fontWeight: "600",
    },
    detailMetaValue: {
      fontSize: 13,
      color: palette.text,
      fontWeight: "700",
    },
    primaryInlineBtn: {
      backgroundColor: palette.primary,
      borderRadius: SIZES.radius,
      paddingVertical: 10,
      paddingHorizontal: 14,
      alignItems: "center",
      flex: 1,
    },
    primaryInlineBtnDanger: {
      backgroundColor: "rgba(220, 38, 38, 0.12)",
      borderWidth: 1,
      borderColor: "rgba(220, 38, 38, 0.35)",
    },
    primaryInlineBtnText: {
      color: palette.onPrimary,
      fontWeight: "700",
      fontSize: 13,
    },
    primaryInlineBtnDangerText: {
      color: "#ef4444",
    },
    detailActionsRow: {
      flexDirection: "row",
      gap: 8,
      marginTop: 10,
    },
    secondaryInlineBtn: {
      backgroundColor: palette.mutedSurface,
      borderRadius: SIZES.radius,
      paddingVertical: 10,
      paddingHorizontal: 14,
      alignItems: "center",
      borderWidth: 1,
      borderColor: palette.border,
      flex: 1,
    },
    secondaryInlineBtnText: {
      color: palette.text,
      fontWeight: "700",
      fontSize: 13,
    },
    sectionHeading: {
      fontSize: 16,
      fontWeight: "800",
      color: palette.text,
      marginTop: 8,
      marginBottom: 8,
    },
    layerCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      padding: 10,
      marginBottom: 8,
      backgroundColor: isDark ? "#202632" : "#f9fbff",
      gap: 8,
    },
    layerCardLeft: {
      width: "100%",
    },
    layerActionsRow: {
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flexWrap: "wrap",
    },
    layerCardName: {
      fontSize: 14,
      fontWeight: "700",
      color: palette.text,
      marginBottom: 2,
    },
    layerCardMeta: {
      fontSize: 12,
      color: palette.subtext,
      fontWeight: "600",
    },
    layerOwnerMeta: {
      fontSize: 12,
      color: palette.subtext,
      fontWeight: "600",
      marginTop: 3,
    },
    layerOwnerActions: {
      flexDirection: "row",
      gap: 6,
      flexWrap: "wrap",
    },
    editIconBtn: {
      alignSelf: "flex-start",
      borderRadius: SIZES.radius,
      backgroundColor: palette.mutedSurface,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    editIconBtnText: {
      color: palette.text,
      fontSize: 11,
      fontWeight: "800",
    },
    collectionActionBtn: {
      borderRadius: SIZES.radius,
      backgroundColor: palette.primary,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    collectionActionBtnRemove: {
      backgroundColor: palette.mutedSurface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    collectionActionBtnText: {
      color: palette.onPrimary,
      fontSize: 11,
      fontWeight: "800",
    },
    collectionActionBtnTextRemove: {
      color: palette.text,
    },
    deleteLayerBtn: {
      borderRadius: SIZES.radius,
      backgroundColor: "rgba(220, 38, 38, 0.14)",
      borderWidth: 1,
      borderColor: "rgba(220, 38, 38, 0.35)",
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    deleteLayerBtnText: {
      color: "#ef4444",
      fontSize: 11,
      fontWeight: "800",
    },
    manageActionsRow: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 8,
    },
    manageActionBtn: {
      flex: 1,
      backgroundColor: palette.mutedSurface,
      borderRadius: SIZES.radius,
      paddingVertical: 10,
      alignItems: "center",
      borderWidth: 1,
      borderColor: palette.border,
    },
    manageActionBtnText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "700",
    },
    deleteCommunityBtn: {
      borderRadius: SIZES.radius,
      backgroundColor: "rgba(220, 38, 38, 0.12)",
      borderWidth: 1,
      borderColor: "rgba(220, 38, 38, 0.35)",
      paddingVertical: 10,
      alignItems: "center",
      marginBottom: 10,
    },
    deleteCommunityBtnText: {
      color: "#ef4444",
      fontSize: 12,
      fontWeight: "800",
    },
    leadershipCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      padding: 10,
      marginBottom: 8,
      backgroundColor: isDark ? "#202632" : "#f9fbff",
    },
    leadershipLabel: {
      fontSize: 12,
      fontWeight: "800",
      color: palette.subtext,
      marginBottom: 4,
    },
    leadershipLabelSpaced: {
      marginTop: 8,
    },
    leadershipValue: {
      fontSize: 14,
      fontWeight: "700",
      color: palette.text,
      marginBottom: 2,
    },
    leadershipEmpty: {
      fontSize: 13,
      color: palette.subtext,
      fontWeight: "600",
    },
    chatLaunchCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      padding: 10,
      marginBottom: 10,
      backgroundColor: isDark ? "#202632" : "#f9fbff",
    },
    chatLaunchBtn: {
      borderRadius: SIZES.radius,
      backgroundColor: palette.primary,
      paddingVertical: 10,
      alignItems: "center",
    },
    chatLaunchBtnText: {
      color: palette.onPrimary,
      fontSize: 13,
      fontWeight: "800",
    },
    memberRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      padding: 10,
      marginBottom: 8,
      backgroundColor: isDark ? "#202632" : "#f9fbff",
      gap: 8,
    },
    memberRowLeft: {
      flex: 1,
    },
    memberRowRight: {
      flexDirection: "row",
      gap: 8,
    },
    memberName: {
      color: palette.text,
      fontSize: 14,
      fontWeight: "700",
      marginBottom: 2,
    },
    memberRole: {
      color: palette.subtext,
      fontSize: 12,
      fontWeight: "600",
    },
    memberActionBtn: {
      backgroundColor: palette.primary,
      borderRadius: SIZES.radius,
      paddingHorizontal: 10,
      paddingVertical: 8,
      minWidth: 92,
      alignItems: "center",
    },
    memberActionBtnText: {
      color: palette.onPrimary,
      fontSize: 12,
      fontWeight: "700",
    },
    memberLeadBtn: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      paddingHorizontal: 10,
      paddingVertical: 7,
      backgroundColor: palette.mutedSurface,
      minWidth: 92,
      alignItems: "center",
    },
    memberLeadBtnText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "700",
    },
    modalOverlay: {
      flex: 1,
      justifyContent: "flex-end",
    },
    modalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.45)",
    },
    modalKeyboardScroll: {
      flex: 1,
    },
    modalKeyboardScrollContent: {
      flexGrow: 1,
      justifyContent: "flex-end",
    },
    modalCard: {
      backgroundColor: palette.surface,
      borderTopLeftRadius: SIZES.radiusXl,
      borderTopRightRadius: SIZES.radiusXl,
      padding: 16,
      borderTopWidth: 1,
      borderTopColor: palette.border,
      maxHeight: "80%",
    },
    modalLargeCard: {
      maxHeight: "86%",
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "800",
      color: palette.text,
      marginBottom: 10,
    },
    modalSubtext: {
      fontSize: 13,
      color: palette.subtext,
      marginBottom: 10,
    },
    modalInput: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: palette.text,
      backgroundColor: isDark ? "#202632" : "#ffffff",
      marginBottom: 8,
    },
    modalTextArea: {
      minHeight: 90,
      textAlignVertical: "top",
    },
    modalActions: {
      flexDirection: "row",
      gap: 8,
      marginTop: 6,
    },
    modalSecondaryBtn: {
      flex: 1,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      paddingVertical: 10,
      alignItems: "center",
      backgroundColor: palette.mutedSurface,
    },
    modalSecondaryBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.text,
    },
    modalPrimaryBtn: {
      flex: 1,
      borderRadius: SIZES.radius,
      paddingVertical: 10,
      alignItems: "center",
      backgroundColor: palette.primary,
    },
    modalPrimaryBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.onPrimary,
    },
    modalList: {
      marginTop: 4,
    },
    attachLayerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      padding: 10,
      marginBottom: 8,
      gap: 10,
      backgroundColor: isDark ? "#202632" : "#f9fbff",
    },
    attachLayerLeft: {
      flex: 1,
    },
    attachLayerName: {
      color: palette.text,
      fontSize: 14,
      fontWeight: "700",
      marginBottom: 2,
    },
    attachLayerMeta: {
      color: palette.subtext,
      fontSize: 12,
      fontWeight: "600",
    },
    attachLayerBtn: {
      backgroundColor: palette.primary,
      borderRadius: SIZES.radius,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    attachLayerBtnText: {
      color: palette.onPrimary,
      fontSize: 12,
      fontWeight: "700",
    },
  });

export default CommunitiesScreen;
