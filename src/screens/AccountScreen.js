import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Image,
  Modal,
  StatusBar as RNStatusBar,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import {
  supabase,
  fetchVisiblePinsViaEdgeFunction,
  getActiveSession,
  getCurrentUser,
  hydratePinsWithSignedMediaUrls,
  signIn,
  signUp,
  signOut,
  resetPassword,
  resetPasswordWithOtp,
} from "../services/supabase";
import { SIZES } from "../constants/theme";
import { useAppTheme } from "../context/ThemeContext";
import { getBrandAssetsForTheme } from "../constants/brandAssets";
import {
  getProfileAvatarUrl,
  hydrateAvatarUrlsInRows,
} from "../utils/avatarUrls";

const MAX_SAFE_AUTH_TOKEN_LENGTH = 12000;

const AccountScreen = ({ navigation, route }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [resetStep, setResetStep] = useState(null);
  const [resetEmail, setResetEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [myPosts, setMyPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState("");
  const [joinedLayers, setJoinedLayers] = useState([]);
  const [joinedLayersLoading, setJoinedLayersLoading] = useState(false);
  const [joinedLayersError, setJoinedLayersError] = useState("");
  const [viewedProfile, setViewedProfile] = useState(null);
  const [selectedPost, setSelectedPost] = useState(null);
  const cleanedAvatarMetadataRef = useRef(new Set());
  const oversizedTokenAlertShownRef = useRef(false);
  const { palette, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const topInset = Math.max(
    insets.top || 0,
    Platform.OS === "android" ? RNStatusBar.currentHeight || 0 : 0,
  );
  const brandAssets = getBrandAssetsForTheme(isDark);
  const styles = createStyles(palette, topInset);
  const profileUserId = String(route?.params?.profileUserId || "");
  const isFriendProfileRoute = Boolean(route?.params?.fromFriends);
  const isViewingOtherProfile = Boolean(
    profileUserId &&
      currentUser?.id &&
      profileUserId !== currentUser.id,
  );

  useEffect(() => {
    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      if (session?.user) {
        loadUser();
      } else {
        setCurrentUser(null);
        setViewedProfile(null);
        setAvatarUrl(null);
        setMyPosts([]);
        setPostsError("");
        setPostsLoading(false);
        setJoinedLayers([]);
        setJoinedLayersError("");
        setJoinedLayersLoading(false);
        setResetStep(null);
        setResetEmail("");
        setOtpCode("");
        setNewPassword("");
        setConfirmPassword("");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUser?.id) return;
    const targetUserId = profileUserId || currentUser.id;
    loadProfile(targetUserId);
    loadMyPosts(targetUserId);
    if (targetUserId === currentUser.id) {
      loadJoinedLayers(currentUser.id);
    } else {
      setJoinedLayers([]);
      setJoinedLayersError("");
      setJoinedLayersLoading(false);
    }
  }, [currentUser?.id, profileUserId]);

  const isInlineAvatarDataUrl = (value) =>
    /^data:image\//i.test(String(value || "").trim());

  const scrubAvatarFromAuthMetadata = async (user) => {
    const userId = String(user?.id || "");
    const avatarValue = String(user?.user_metadata?.avatar_url || "").trim();
    if (!userId || !isInlineAvatarDataUrl(avatarValue)) return user;
    if (cleanedAvatarMetadataRef.current.has(userId)) return user;

    cleanedAvatarMetadataRef.current.add(userId);
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: {
          avatar_url: null,
        },
      });
      if (error) throw error;
      return data?.user || user;
    } catch (error) {
      console.warn("Failed to scrub avatar from auth metadata:", error);
      return user;
    }
  };

  const isOversizedSession = (session) =>
    String(session?.access_token || "").length > MAX_SAFE_AUTH_TOKEN_LENGTH;

  const handleOversizedSession = async (session) => {
    if (!isOversizedSession(session)) return false;
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (_) {}
    setCurrentUser(null);
    setAvatarUrl(null);
    setViewedProfile(null);
    if (!oversizedTokenAlertShownRef.current) {
      oversizedTokenAlertShownRef.current = true;
      Alert.alert(
        "Profile Metadata Too Large",
        "This account still has a profile image stored inside auth metadata, which makes the login token too large for mobile requests. We need to remove `avatar_url` from this user's auth metadata in Supabase before this account can sign in normally again.",
      );
    }
    return true;
  };

  const loadUser = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (await handleOversizedSession(session)) {
        return;
      }
    } catch (_) {}

    const rawUser = await getCurrentUser();
    const user = await scrubAvatarFromAuthMetadata(rawUser);
    setCurrentUser(user);
    if (user?.id) {
      const resolvedAvatarUrl = await getProfileAvatarUrl(user.id);
      setAvatarUrl(resolvedAvatarUrl);
    } else {
      setAvatarUrl(null);
    }
  };

  const loadProfile = async (userId) => {
    if (!userId) {
      setViewedProfile(null);
      setAvatarUrl(null);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,username,display_name,avatar_url")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;

      const isOwnProfile = Boolean(currentUser?.id && userId === currentUser.id);
      const fallbackUsername = isOwnProfile
        ? currentUser?.user_metadata?.username || null
        : null;
      const fallbackDisplayName = isOwnProfile
        ? currentUser?.user_metadata?.display_name ||
          currentUser?.user_metadata?.username ||
          currentUser?.email ||
          "User"
        : "User";
      const fallbackAvatar = isOwnProfile
        ? await getProfileAvatarUrl(currentUser?.id)
        : null;

      const normalizedProfile = {
        id: userId,
        username: data?.username || fallbackUsername,
        display_name: data?.display_name || fallbackDisplayName,
        avatar_url: data?.avatar_url || fallbackAvatar,
      };
      const [hydratedProfile] = await hydrateAvatarUrlsInRows([normalizedProfile]);

      setViewedProfile(hydratedProfile || normalizedProfile);
      if (isOwnProfile) {
        setAvatarUrl(hydratedProfile?.avatar_url || normalizedProfile.avatar_url || null);
      }
    } catch (error) {
      const message = String(error?.message || "").toLowerCase();
      const isNetworkError =
        message.includes("network request failed") ||
        message.includes("fetch failed");
      if (!isNetworkError) {
        console.error("Error loading profile:", error);
      }
      const isOwnProfile = Boolean(currentUser?.id && userId === currentUser.id);
      const fallbackAvatar = isOwnProfile
        ? await getProfileAvatarUrl(currentUser?.id)
        : null;
      setViewedProfile({
        id: userId,
        username: isOwnProfile
          ? currentUser?.user_metadata?.username || null
          : null,
        display_name: isOwnProfile
          ? currentUser?.user_metadata?.display_name ||
            currentUser?.user_metadata?.username ||
            currentUser?.email ||
            "User"
          : "User",
        avatar_url: fallbackAvatar,
      });
      if (isOwnProfile) setAvatarUrl(fallbackAvatar);
    }
  };

  const loadMyPosts = async (userId) => {
    if (!userId) {
      setMyPosts([]);
      setPostsError("");
      return;
    }

    setPostsLoading(true);
    setPostsError("");
    try {
      let basePosts = [];
      let loadedViaEdge = false;

      const session = await getActiveSession();
      const accessToken = session?.access_token || null;
      const refreshToken = session?.refresh_token || null;
      const actorUserId = session?.user?.id || currentUser?.id || null;
      if (accessToken && actorUserId) {
        const edgeRes = await fetchVisiblePinsViaEdgeFunction(
          accessToken,
          refreshToken,
          actorUserId,
          5000,
        );
        if (!edgeRes.error && Array.isArray(edgeRes?.data?.pins)) {
          basePosts = edgeRes.data.pins
            .filter((post) => String(post?.user_id || "") === String(userId))
            .slice(0, 200);
          loadedViaEdge = true;
        } else if (edgeRes.error) {
          console.warn("Account posts edge fetch failed, using direct query fallback.");
        }
      }

      if (!loadedViaEdge) {
        const queryPins = (selectClause) =>
          supabase
            .from("pins")
            .select(selectClause)
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(200);

        let res = await queryPins(
          "id,type,content,caption,layer,base_audience,created_at,lat,lng,media_url,media_type,geometry",
        );
        const missingBaseAudienceColumn =
          String(res?.error?.code || "") === "42703" ||
          String(res?.error?.message || "")
            .toLowerCase()
            .includes("base_audience");

        if (missingBaseAudienceColumn) {
          res = await queryPins(
            "id,type,content,caption,layer,created_at,lat,lng,media_url,media_type,geometry",
          );
        }

        if (res.error) throw res.error;
        basePosts = Array.isArray(res.data) ? res.data : [];
      }

      basePosts = await hydratePinsWithSignedMediaUrls(
        basePosts,
        accessToken ? { access_token: accessToken } : session,
      );

      const pinIds = basePosts
        .map((post) => String(post?.id || ""))
        .filter(Boolean);

      let layerLabelsByPinId = new Map();
      if (pinIds.length > 0) {
        const membershipsRes = await supabase
          .from("pin_layer_memberships")
          .select("pin_id,layer_id")
          .in("pin_id", pinIds);

        if (!membershipsRes.error) {
          const layerIds = Array.from(
            new Set(
              (membershipsRes.data || [])
                .map((row) => String(row?.layer_id || ""))
                .filter(Boolean),
            ),
          );
          let layerNameById = new Map();
          if (layerIds.length > 0) {
            const layersRes = await supabase
              .from("layers")
              .select("id,name")
              .in("id", layerIds);
            if (!layersRes.error) {
              layerNameById = new Map(
                (layersRes.data || []).map((layer) => [
                  String(layer?.id || ""),
                  String(layer?.name || ""),
                ]),
              );
            }
          }

          const next = new Map();
          (membershipsRes.data || []).forEach((row) => {
            const pinId = String(row?.pin_id || "");
            const layerId = String(row?.layer_id || "");
            if (!pinId || !layerId) return;
            const layerName = layerNameById.get(layerId);
            if (!layerName) return;
            const existing = next.get(pinId) || [];
            if (!existing.includes(layerName)) existing.push(layerName);
            next.set(pinId, existing);
          });
          layerLabelsByPinId = next;
        }
      }

      const enrichedPosts = basePosts.map((post) => ({
        ...post,
        layer_labels: layerLabelsByPinId.get(String(post?.id || "")) || [],
      }));
      setMyPosts(enrichedPosts);
    } catch (error) {
      console.error("Error loading account posts:", error);
      setMyPosts([]);
      setPostsError("Failed to load your posts.");
    } finally {
      setPostsLoading(false);
    }
  };

  const loadJoinedLayers = async (userId) => {
    if (!userId) {
      setJoinedLayers([]);
      setJoinedLayersError("");
      setJoinedLayersLoading(false);
      return;
    }

    setJoinedLayersLoading(true);
    setJoinedLayersError("");
    try {
      const membershipsRes = await supabase
        .from("community_members")
        .select("community_id,status")
        .eq("user_id", userId);
      if (membershipsRes.error) throw membershipsRes.error;

      const activeCommunityIds = Array.from(
        new Set(
          (membershipsRes.data || [])
            .filter((row) => {
              const status = String(row?.status || "").trim().toLowerCase();
              return status === "accepted" || status === "active";
            })
            .map((row) => String(row?.community_id || ""))
            .filter(Boolean),
        ),
      );
      if (activeCommunityIds.length === 0) {
        setJoinedLayers([]);
        return;
      }

      const linksRes = await supabase
        .from("community_layers")
        .select("community_id,layer_id,enabled,sort_order")
        .in("community_id", activeCommunityIds)
        .eq("enabled", true);
      if (linksRes.error) throw linksRes.error;

      const links = linksRes.data || [];
      if (links.length === 0) {
        setJoinedLayers([]);
        return;
      }

      const layerIds = Array.from(
        new Set(
          links
            .map((row) => String(row?.layer_id || ""))
            .filter(Boolean),
        ),
      );
      const communityIds = Array.from(
        new Set(
          links
            .map((row) => String(row?.community_id || ""))
            .filter(Boolean),
        ),
      );

      const [layersRes, communitiesRes] = await Promise.all([
        layerIds.length > 0
          ? supabase.from("layers").select("id,name,kind,owner_type").in("id", layerIds)
          : Promise.resolve({ data: [], error: null }),
        communityIds.length > 0
          ? supabase.from("communities").select("id,name,slug").in("id", communityIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (layersRes.error) throw layersRes.error;
      if (communitiesRes.error) throw communitiesRes.error;

      const layerById = new Map(
        (layersRes.data || []).map((layer) => [String(layer?.id || ""), layer]),
      );
      const communityById = new Map(
        (communitiesRes.data || []).map((community) => [
          String(community?.id || ""),
          community,
        ]),
      );

      const joinedByKey = new Map();
      links.forEach((link) => {
        const layerId = String(link?.layer_id || "");
        const communityId = String(link?.community_id || "");
        if (!layerId || !communityId) return;

        const layer = layerById.get(layerId);
        const community = communityById.get(communityId);
        const key = `${communityId}:${layerId}`;
        joinedByKey.set(key, {
          id: key,
          layerId,
          communityId,
          layerName: String(layer?.name || "Unnamed layer"),
          layerKind: String(layer?.kind || ""),
          ownerType: String(layer?.owner_type || ""),
          communityName: String(community?.name || "Community"),
          communitySlug: String(community?.slug || ""),
          sortOrder: Number.isFinite(Number(link?.sort_order))
            ? Number(link.sort_order)
            : Number.MAX_SAFE_INTEGER,
        });
      });

      const normalized = Array.from(joinedByKey.values()).sort((a, b) => {
        const communityCmp = a.communityName.localeCompare(b.communityName);
        if (communityCmp !== 0) return communityCmp;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.layerName.localeCompare(b.layerName);
      });
      setJoinedLayers(normalized);
    } catch (error) {
      console.error("Error loading joined layers:", error);
      setJoinedLayers([]);

      const lowerMessage = String(error?.message || "").toLowerCase();
      const isSchemaMissing =
        String(error?.code || "") === "42P01" ||
        lowerMessage.includes("does not exist");
      setJoinedLayersError(
        isSchemaMissing
          ? "Joined layers are unavailable on this database."
          : "Failed to load joined layers.",
      );
    } finally {
      setJoinedLayersLoading(false);
    }
  };

  const formatPostDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
  };

  const getPostPreview = (post) => {
    const content = String(post?.content || "").trim();
    if (content) return content;

    const caption = String(post?.caption || "").trim();
    if (caption) return caption;

    const type = String(post?.type || "").toLowerCase();
    if (type === "photo" || type === "video" || type === "media") {
      return `[${type} post]`;
    }
    return "[empty post]";
  };

  const getAudienceLabel = (value) => {
    const audience = String(value || "public").trim().toLowerCase();
    if (audience === "friends") return "Friends";
    if (audience === "private") return "Private";
    return "Public";
  };

  const getAudienceIcon = (value) => {
    const audience = String(value || "public").trim().toLowerCase();
    if (audience === "friends") return "👥";
    if (audience === "private") return "🔒";
    return "🌎";
  };

  const getPostLayerLabels = (post) => {
    const explicitLabels = Array.isArray(post?.layer_labels)
      ? post.layer_labels
          .map((label) => String(label || "").trim())
          .filter(Boolean)
      : [];
    if (explicitLabels.length > 0) return explicitLabels;
    return [getAudienceLabel(post?.base_audience || post?.layer || "public")];
  };

  const isRenderableRemoteMediaUrl = (value) => {
    const uri = String(value || "").trim();
    if (!uri) return false;
    const lowered = uri.toLowerCase();
    if (lowered.startsWith("storage://")) return false;
    if (lowered.startsWith("file://")) return false;
    if (lowered.startsWith("content://")) return false;
    if (lowered.startsWith("ph://")) return false;
    return true;
  };

  const getPostMediaUrls = (post) => {
    const geometryList = Array.isArray(post?.geometry?.media_urls)
      ? post.geometry.media_urls
      : [];
    const mediaList = Array.isArray(post?.media_urls) ? post.media_urls : [];
    const normalizedList = [...geometryList, ...mediaList]
      .map((value) => String(value || "").trim())
      .filter(isRenderableRemoteMediaUrl);
    if (normalizedList.length > 0) {
      return Array.from(new Set(normalizedList));
    }
    const primary = String(post?.media_url || "").trim();
    return isRenderableRemoteMediaUrl(primary) ? [primary] : [];
  };

  const openPostDetail = (post) => {
    if (!post) return;
    setSelectedPost(post);
  };

  const closePostDetail = () => {
    setSelectedPost(null);
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Error", "Please enter email and password");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await signIn(email, password);
      if (error) throw error;
      if (await handleOversizedSession(data?.session || null)) {
        return;
      }

      Alert.alert("Success", "Signed in successfully!");
      clearForm();
    } catch (error) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Error", "Please enter email and password");
      return;
    }
    if (!username.trim()) {
      Alert.alert("Error", "Please enter a username");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await signUp(
        email,
        password,
        username.toLowerCase().trim(),
        displayName.trim() || username.trim(),
      );

      if (error) throw error;

      if (data?.user) {
        Alert.alert("Success", "Account created! You are now signed in.");
        clearForm();
      } else {
        Alert.alert(
          "Success",
          "Account created! Please check your email to verify your account.",
          [{ text: "OK", onPress: () => setIsSignUp(false) }],
        );
        clearForm();
      }
    } catch (error) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  const clearForm = () => {
    setEmail("");
    setPassword("");
    setUsername("");
    setDisplayName("");
    setResetStep(null);
    setResetEmail("");
    setOtpCode("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    clearForm();
  };

  const handleForgotPassword = () => {
    setResetStep("email");
    setResetEmail(email.trim());
  };

  const cancelReset = () => {
    setResetStep(null);
    setResetEmail("");
    setOtpCode("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleSendResetCode = async () => {
    const trimmedEmail = resetEmail.trim();
    if (!trimmedEmail) {
      Alert.alert("Error", "Please enter your email address");
      return;
    }

    setLoading(true);
    try {
      const { error } = await resetPassword(trimmedEmail);
      if (error) throw error;

      Alert.alert(
        "Code Sent",
        "If an account exists with that email, you will receive a reset code. Please check your inbox.",
      );
      setResetStep("otp");
    } catch (error) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    const trimmedOtp = otpCode.trim();
    if (!trimmedOtp || trimmedOtp.length < 6) {
      Alert.alert("Error", "Please enter the code from your email");
      return;
    }
    if (!newPassword.trim()) {
      Alert.alert("Error", "Please enter a new password");
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Error", "Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const resetResult = await resetPasswordWithOtp(
        resetEmail.trim(),
        trimmedOtp,
        newPassword,
      );
      if (resetResult.error) throw resetResult.error;

      Alert.alert("Success", "Your password has been reset successfully!", [
        {
          text: "OK",
          onPress: () => {
            setResetStep(null);
            setResetEmail("");
            setOtpCode("");
            setNewPassword("");
            setConfirmPassword("");
          },
        },
      ]);
    } catch (error) {
      Alert.alert(
        "Error",
        error?.message ||
          "Failed to reset password. Please request a new code and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      const { error } = await signOut();
      if (error) throw error;

      Alert.alert("Success", "Signed out successfully!");
    } catch (error) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePickAvatar = async () => {
    if (!currentUser?.id) return;

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission Needed", "Please allow photo library access.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert("Error", "Unable to process selected image.");
        return;
      }

      const nextAvatarUrl = `data:image/jpeg;base64,${asset.base64}`;
      setLoading(true);

      const existingProfileRes = await supabase
        .from("profiles")
        .select("username")
        .eq("id", currentUser.id)
        .maybeSingle();
      if (existingProfileRes.error) throw existingProfileRes.error;

      const fallbackUsername = `user-${currentUser.id.slice(0, 8)}`;
      const usernameValue =
        existingProfileRes.data?.username ||
        currentUser.user_metadata?.username ||
        fallbackUsername;

      const upsertRes = await supabase.from("profiles").upsert(
        {
          id: currentUser.id,
          username: usernameValue,
          display_name:
            currentUser.user_metadata?.display_name ||
            currentUser.user_metadata?.username ||
            usernameValue,
          avatar_url: nextAvatarUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (upsertRes.error) throw upsertRes.error;

      const { error: updateMetaError } = await supabase.auth.updateUser({
        data: {
          avatar_url: null,
        },
      });
      if (updateMetaError) throw updateMetaError;

      setAvatarUrl(nextAvatarUrl);
      await loadUser();
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to update profile image.");
    } finally {
      setLoading(false);
    }
  };

  const renderTopBar = () => (
    <View style={styles.topBar}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          if (isFriendProfileRoute) {
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            const parent = navigation.getParent?.();
            if (parent?.navigate) {
              parent.navigate("Friends");
              return;
            }
            navigation.navigate("Friends");
            return;
          }
          navigation.navigate("Map");
        }}
      >
        <Text style={styles.backButtonText}>
          {isFriendProfileRoute ? "< Friends" : "< Map"}
        </Text>
      </TouchableOpacity>
      {!isFriendProfileRoute ? (
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => navigation.navigate("Settings")}
        >
          <Text style={styles.settingsButtonText}>Settings</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.topBarSpacer} />
      )}
    </View>
  );

  const renderBrandHeader = () => (
    <View style={styles.logo}>
      <Image source={brandAssets.logo} style={styles.logoImage} resizeMode="contain" />
      <Text style={styles.tagline}>Share your world</Text>
    </View>
  );

  if (currentUser) {
    const profileTargetUserId =
      isViewingOtherProfile && profileUserId ? profileUserId : currentUser.id;
    const profileName = isViewingOtherProfile
      ? viewedProfile?.display_name ||
        viewedProfile?.username ||
        "User"
      : currentUser.user_metadata?.display_name || "User";
    const profileUsername = isViewingOtherProfile
      ? viewedProfile?.username || null
      : currentUser.user_metadata?.username || null;
    const profileEmail = isViewingOtherProfile ? null : currentUser.email || null;
    const profileAvatarUrl = isViewingOtherProfile
      ? viewedProfile?.avatar_url || null
      : avatarUrl;

    return (
      <View style={styles.container}>
        {renderTopBar()}
        <ScrollView contentContainerStyle={styles.profileScrollContent}>
          <View style={styles.profileContainer}>
            {renderBrandHeader()}

            <TouchableOpacity
              style={styles.avatarWrap}
              onPress={isViewingOtherProfile ? undefined : handlePickAvatar}
              disabled={loading || isViewingOtherProfile}
            >
              {profileAvatarUrl ? (
                <Image source={{ uri: profileAvatarUrl }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarInitial}>
                  {String(
                    profileUsername ||
                      profileName ||
                      profileEmail ||
                      "U",
                  )
                    .trim()
                    .charAt(0)
                    .toUpperCase()}
                </Text>
              )}
            </TouchableOpacity>
            {!isViewingOtherProfile && (
              <TouchableOpacity
                style={styles.avatarButton}
                onPress={handlePickAvatar}
                disabled={loading}
              >
                <Text style={styles.avatarButtonText}>
                  {loading ? "Saving..." : "Change Profile Image"}
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.profileInfo}>
              <Text style={styles.displayName}>{profileName}</Text>
              {profileUsername && (
                <Text style={styles.username}>@{profileUsername}</Text>
              )}
              {profileEmail ? <Text style={styles.email}>{profileEmail}</Text> : null}
            </View>

            {!isViewingOtherProfile && (
              <TouchableOpacity
                style={[styles.button, styles.signOutButton]}
                onPress={handleSignOut}
                disabled={loading}
              >
                <Text style={styles.buttonText}>
                  {loading ? "Signing out..." : "Sign Out"}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {!isViewingOtherProfile && (
            <>
              <TouchableOpacity
                style={styles.joinedLayersHeaderRow}
                onPress={() => loadJoinedLayers(profileTargetUserId)}
                disabled={joinedLayersLoading}
              >
                <View>
                  <Text style={styles.joinedLayersHeader}>Joined Layers</Text>
                  <Text style={styles.joinedLayersSubheader}>
                    {joinedLayers.length}{" "}
                    {joinedLayers.length === 1 ? "layer" : "layers"}
                  </Text>
                </View>
                <View style={styles.postsRefreshButton}>
                  <Text style={styles.postsRefreshText}>
                    {joinedLayersLoading ? "Refreshing..." : "Refresh"}
                  </Text>
                </View>
              </TouchableOpacity>

              <View style={styles.joinedLayersSection}>
                {joinedLayersLoading ? (
                  <Text style={styles.joinedLayersStateText}>
                    Loading joined layers...
                  </Text>
                ) : joinedLayersError ? (
                  <Text style={styles.joinedLayersStateText}>
                    {joinedLayersError}
                  </Text>
                ) : joinedLayers.length === 0 ? (
                  <Text style={styles.joinedLayersStateText}>
                    You have not joined any community layers yet.
                  </Text>
                ) : (
                  joinedLayers.map((layer) => (
                    <View key={layer.id} style={styles.joinedLayerCard}>
                      <Text style={styles.joinedLayerName} numberOfLines={1}>
                        {layer.layerName}
                      </Text>
                      <Text style={styles.joinedLayerMeta} numberOfLines={1}>
                        {layer.communityName}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </>
          )}

          <TouchableOpacity
            style={styles.postsHeaderRow}
            onPress={() => loadMyPosts(profileTargetUserId)}
            disabled={postsLoading}
          >
            <View>
              <Text style={styles.postsHeader}>
                {isViewingOtherProfile ? "Posts" : "My Posts"}
              </Text>
              <Text style={styles.postsSubheader}>
                {myPosts.length} {myPosts.length === 1 ? "post" : "posts"}
              </Text>
            </View>
            <View style={styles.postsRefreshButton}>
              <Text style={styles.postsRefreshText}>
                {postsLoading ? "Refreshing..." : "Refresh"}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.postsSection}>
            {postsLoading ? (
              <Text style={styles.postsStateText}>Loading your posts...</Text>
            ) : postsError ? (
              <Text style={styles.postsStateText}>{postsError}</Text>
            ) : myPosts.length === 0 ? (
              <Text style={styles.postsStateText}>You have not posted yet.</Text>
            ) : (
              myPosts.map((post, index) => {
                const audienceRaw = String(
                  post?.base_audience || post?.layer || "public",
                )
                  .trim()
                  .toLowerCase();
                const audienceLabel = getAudienceLabel(audienceRaw);
                const audienceIcon = getAudienceIcon(audienceRaw);
                const postType = String(post?.type || "text").toUpperCase();
                const layerLabels = getPostLayerLabels(post);
                const mediaUrls = getPostMediaUrls(post);
                return (
                  <TouchableOpacity
                    key={String(post?.id || `post-${index}`)}
                    style={styles.postCard}
                    activeOpacity={0.85}
                    onPress={() => openPostDetail(post)}
                  >
                    <View style={styles.postTopRow}>
                      <View style={styles.postAudienceBadge}>
                        <Text style={styles.postAudienceText}>
                          {audienceIcon} {audienceLabel}
                        </Text>
                      </View>
                      <Text style={styles.postDateText} numberOfLines={1}>
                        {formatPostDate(post?.created_at)}
                      </Text>
                    </View>
                    <Text style={styles.postPreview} numberOfLines={4}>
                      {getPostPreview(post)}
                    </Text>
                    {mediaUrls.length > 0 ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.postMediaStrip}
                      >
                        {mediaUrls.slice(0, 4).map((mediaUrl, mediaIndex) => (
                          <Image
                            key={`${post?.id || index}-${mediaIndex}`}
                            source={{ uri: mediaUrl }}
                            style={styles.postMediaThumb}
                            resizeMode="cover"
                          />
                        ))}
                        {mediaUrls.length > 4 ? (
                          <View style={styles.postMediaOverflowBadge}>
                            <Text style={styles.postMediaOverflowText}>
                              +{mediaUrls.length - 4}
                            </Text>
                          </View>
                        ) : null}
                      </ScrollView>
                    ) : null}
                    <View style={styles.postLayersWrap}>
                      {layerLabels.map((label) => (
                        <View key={`${post?.id}-${label}`} style={styles.postLayerChip}>
                          <Text style={styles.postLayerChipText}>{label}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={styles.postBottomRow}>
                      <Text style={styles.postTypeText}>{postType}</Text>
                      <Text style={styles.postTapHint}>Tap to open</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </ScrollView>
        <Modal
          visible={Boolean(selectedPost)}
          transparent
          animationType="slide"
          onRequestClose={closePostDetail}
        >
          <View style={styles.postModalOverlay}>
            <TouchableOpacity
              style={styles.postModalBackdrop}
              activeOpacity={1}
              onPress={closePostDetail}
            />
            <View style={styles.postModalCard}>
              <View style={styles.postModalHeader}>
                <Text style={styles.postModalTitle}>Post</Text>
                <TouchableOpacity
                  style={styles.postModalCloseBtn}
                  onPress={closePostDetail}
                >
                  <Text style={styles.postModalCloseText}>Close</Text>
                </TouchableOpacity>
              </View>

              {selectedPost ? (
                <ScrollView style={styles.postModalContent}>
                  {getPostMediaUrls(selectedPost).length > 0 &&
                  String(selectedPost.media_type || "").toLowerCase() !==
                    "video" ? (
                    <>
                      <Image
                        source={{ uri: getPostMediaUrls(selectedPost)[0] }}
                        style={styles.postModalImage}
                        resizeMode="cover"
                      />
                      {getPostMediaUrls(selectedPost).length > 1 ? (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.postModalImageStrip}
                        >
                          {getPostMediaUrls(selectedPost).map((mediaUrl, index) => (
                            <Image
                              key={`${selectedPost.id || "post"}-${index}`}
                              source={{ uri: mediaUrl }}
                              style={styles.postModalImageThumb}
                              resizeMode="cover"
                            />
                          ))}
                        </ScrollView>
                      ) : null}
                    </>
                  ) : null}
                  {String(selectedPost.media_url || "").trim() &&
                  String(selectedPost.media_type || "").toLowerCase() ===
                    "video" ? (
                    <View style={styles.postModalVideoPlaceholder}>
                      <Text style={styles.postModalVideoText}>
                        Video post
                      </Text>
                    </View>
                  ) : null}

                  <Text style={styles.postModalCaption}>
                    {String(selectedPost.caption || "").trim() || "Untitled"}
                  </Text>
                  {String(selectedPost.content || "").trim() ? (
                    <Text style={styles.postModalBody}>
                      {String(selectedPost.content || "").trim()}
                    </Text>
                  ) : null}

                  <View style={styles.postModalMetaBlock}>
                    <Text style={styles.postModalMetaText}>
                      Audience:{" "}
                      {getAudienceLabel(
                        selectedPost.base_audience || selectedPost.layer,
                      )}
                    </Text>
                    <Text style={styles.postModalMetaText}>
                      Posted: {formatPostDate(selectedPost.created_at)}
                    </Text>
                    <Text style={styles.postModalMetaText}>
                      Layers:{" "}
                      {getPostLayerLabels(selectedPost).join(", ")}
                    </Text>
                  </View>
                </ScrollView>
              ) : null}
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      {renderTopBar()}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {renderBrandHeader()}

        {resetStep === "email" ? (
          <View style={styles.form}>
            <Text style={styles.resetTitle}>Reset Password</Text>
            <Text style={styles.resetSubtitle}>
              Enter your email address and we'll send you a code to reset your
              password.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={palette.subtext}
              value={resetEmail}
              onChangeText={setResetEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              autoFocus
            />
            <TouchableOpacity
              style={styles.button}
              onPress={handleSendResetCode}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? "Sending..." : "Send Reset Code"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={cancelReset}
            >
              <Text style={styles.cancelButtonText}>Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        ) : resetStep === "otp" ? (
          <View style={styles.form}>
            <Text style={styles.resetTitle}>Reset Password</Text>
            <Text style={styles.resetSubtitle}>
              We sent a code to {resetEmail}. Enter it below along with your
              new password.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Reset code"
              placeholderTextColor={palette.subtext}
              value={otpCode}
              onChangeText={setOtpCode}
              keyboardType="number-pad"
              maxLength={8}
              autoFocus
            />
            <TextInput
              style={styles.input}
              placeholder="New password"
              placeholderTextColor={palette.subtext}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm new password"
              placeholderTextColor={palette.subtext}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
            />
            <TouchableOpacity
              style={styles.button}
              onPress={handleResetPassword}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? "Resetting..." : "Reset Password"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.resendButton}
              onPress={handleSendResetCode}
              disabled={loading}
            >
              <Text style={styles.cancelButtonText}>Resend Code</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={cancelReset}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.form}>
              {isSignUp && (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="Username"
                    placeholderTextColor={palette.subtext}
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoComplete="username"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Display Name (optional)"
                    placeholderTextColor={palette.subtext}
                    value={displayName}
                    onChangeText={setDisplayName}
                    autoCapitalize="words"
                  />
                </>
              )}
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={palette.subtext}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={palette.subtext}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete={isSignUp ? "new-password" : "password"}
              />

              <TouchableOpacity
                style={styles.button}
                onPress={isSignUp ? handleSignUp : handleSignIn}
                disabled={loading}
              >
                <Text style={styles.buttonText}>
                  {loading
                    ? isSignUp
                      ? "Creating account..."
                      : "Signing in..."
                    : isSignUp
                      ? "Create Account"
                      : "Sign In"}
                </Text>
              </TouchableOpacity>
            </View>

            {!isSignUp && (
              <TouchableOpacity
                style={styles.forgotPasswordButton}
                onPress={handleForgotPassword}
                activeOpacity={0.85}
              >
                <Text style={styles.forgotPasswordText}>
                  Forgot Password?
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or continue with</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.socialButtons}>
              <TouchableOpacity style={styles.socialButton}>
                <Text style={styles.socialIcon}>🌐</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.socialButton}>
                <Text style={styles.socialIcon}>🍎</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.socialButton}>
                <Text style={styles.socialIcon}>📱</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerText}>
                {isSignUp
                  ? "Already have an account? "
                  : "Don't have an account? "}
              </Text>
              <TouchableOpacity
                style={styles.footerLinkButton}
                onPress={toggleMode}
                activeOpacity={0.85}
              >
                <Text style={styles.footerLink}>
                  {isSignUp ? "Sign In" : "Sign Up"}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const createStyles = (palette, topInset = 0) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.background,
    },
    scrollContent: {
      flexGrow: 1,
      padding: SIZES.xxl,
      justifyContent: "center",
    },
    profileContainer: {
      paddingTop: SIZES.xl,
      alignItems: "center",
      padding: SIZES.xxl,
      paddingBottom: SIZES.lg,
    },
    profileScrollContent: {
      paddingBottom: SIZES.xxl,
    },
    logo: {
      alignItems: "center",
      marginBottom: SIZES.xxl * 2,
    },
    logoImage: {
      width: 120,
      height: 120,
      marginBottom: SIZES.sm,
    },
    tagline: {
      fontSize: SIZES.md,
      color: palette.subtext,
    },
    form: {
      marginBottom: SIZES.xxl,
    },
    input: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radiusLg,
      padding: SIZES.lg,
      fontSize: SIZES.md,
      marginBottom: SIZES.lg,
      color: palette.text,
      backgroundColor: palette.surface,
    },
    button: {
      backgroundColor: palette.primary,
      borderRadius: SIZES.radiusLg,
      padding: SIZES.lg,
      alignItems: "center",
    },
    signOutButton: {
      backgroundColor: palette.danger,
      marginTop: SIZES.xxl,
    },
    buttonText: {
      color: palette.onPrimary,
      fontSize: SIZES.md,
      fontWeight: "600",
    },
    resetTitle: {
      fontSize: SIZES.xxl,
      fontWeight: "700",
      color: palette.text,
      marginBottom: SIZES.sm,
    },
    resetSubtitle: {
      fontSize: SIZES.sm,
      color: palette.subtext,
      marginBottom: SIZES.xxl,
      lineHeight: SIZES.xl,
    },
    forgotPasswordButton: {
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
      minWidth: 220,
      borderRadius: SIZES.radiusLg,
      borderWidth: 1,
      borderColor: palette.primary,
      backgroundColor: palette.mutedSurface,
      paddingVertical: SIZES.md,
      paddingHorizontal: SIZES.xl,
      marginTop: SIZES.md,
      marginBottom: SIZES.sm,
    },
    forgotPasswordText: {
      color: palette.primary,
      fontSize: SIZES.md,
      fontWeight: "600",
    },
    cancelButton: {
      alignItems: "center",
      marginTop: SIZES.lg,
      padding: SIZES.sm,
    },
    cancelButtonText: {
      color: palette.subtext,
      fontSize: SIZES.sm,
      fontWeight: "600",
    },
    resendButton: {
      alignItems: "center",
      marginTop: SIZES.lg,
      padding: SIZES.sm,
    },
    divider: {
      flexDirection: "row",
      alignItems: "center",
      marginVertical: SIZES.xxl,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: palette.border,
    },
    dividerText: {
      marginHorizontal: SIZES.md,
      color: palette.subtext,
      fontSize: SIZES.sm,
    },
    socialButtons: {
      flexDirection: "row",
      justifyContent: "center",
      gap: SIZES.lg,
      marginBottom: SIZES.xxl,
    },
    socialButton: {
      width: 56,
      height: 56,
      borderRadius: SIZES.radiusFull,
      backgroundColor: palette.mutedSurface,
      justifyContent: "center",
      alignItems: "center",
    },
    socialIcon: {
      fontSize: 24,
    },
    footer: {
      alignItems: "center",
      justifyContent: "center",
      gap: SIZES.sm,
    },
    footerText: {
      color: palette.subtext,
      fontSize: SIZES.sm,
    },
    footerLinkButton: {
      minWidth: 180,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: SIZES.radiusLg,
      borderWidth: 1,
      borderColor: palette.primary,
      backgroundColor: palette.mutedSurface,
      paddingVertical: SIZES.md,
      paddingHorizontal: SIZES.xl,
    },
    footerLink: {
      color: palette.primary,
      fontSize: SIZES.md,
      fontWeight: "600",
    },
    profileInfo: {
      alignItems: "center",
      marginBottom: SIZES.xxl,
    },
    avatarWrap: {
      width: 92,
      height: 92,
      borderRadius: 46,
      backgroundColor: palette.mutedSurface,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: SIZES.md,
      overflow: "hidden",
    },
    avatarImage: {
      width: "100%",
      height: "100%",
    },
    avatarInitial: {
      fontSize: 34,
      fontWeight: "800",
      color: palette.primary,
    },
    avatarButton: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: SIZES.radius,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      marginBottom: SIZES.lg,
    },
    avatarButtonText: {
      color: palette.text,
      fontSize: 13,
      fontWeight: "700",
    },
    displayName: {
      fontSize: SIZES.xxl,
      fontWeight: "700",
      color: palette.text,
      marginBottom: SIZES.xs,
    },
    username: {
      fontSize: SIZES.md,
      color: palette.primary,
      marginBottom: SIZES.sm,
    },
    email: {
      fontSize: SIZES.sm,
      color: palette.subtext,
    },
    topBar: {
      paddingTop:
        Platform.OS === "ios"
          ? Math.max(topInset + SIZES.sm, 50)
          : Math.max(topInset + SIZES.sm, 44),
      paddingHorizontal: SIZES.lg,
      paddingBottom: SIZES.sm,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    backButton: {
      paddingVertical: SIZES.sm,
      paddingRight: SIZES.lg,
    },
    backButtonText: {
      fontSize: SIZES.md,
      fontWeight: "600",
      color: palette.primary,
    },
    settingsButton: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: SIZES.radius,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    settingsButtonText: {
      fontSize: 13,
      fontWeight: "600",
      color: palette.text,
    },
    topBarSpacer: {
      width: 70,
      height: 1,
    },
    joinedLayersHeaderRow: {
      marginHorizontal: SIZES.xxl,
      marginTop: SIZES.sm,
      marginBottom: SIZES.sm,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    joinedLayersHeader: {
      fontSize: SIZES.lg,
      fontWeight: "700",
      color: palette.text,
    },
    joinedLayersSubheader: {
      marginTop: 2,
      color: palette.subtext,
      fontSize: 12,
      fontWeight: "500",
    },
    joinedLayersSection: {
      marginHorizontal: SIZES.xxl,
      marginBottom: SIZES.lg,
      gap: SIZES.xs,
    },
    joinedLayersStateText: {
      color: palette.subtext,
      fontSize: SIZES.sm,
    },
    joinedLayerCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      backgroundColor: palette.surface,
      paddingVertical: SIZES.sm,
      paddingHorizontal: SIZES.md,
      gap: 2,
    },
    joinedLayerName: {
      color: palette.text,
      fontSize: 13,
      fontWeight: "700",
    },
    joinedLayerMeta: {
      color: palette.subtext,
      fontSize: 12,
      fontWeight: "500",
    },
    postsHeaderRow: {
      marginHorizontal: SIZES.xxl,
      marginTop: SIZES.sm,
      marginBottom: SIZES.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    postsHeader: {
      fontSize: SIZES.lg,
      fontWeight: "700",
      color: palette.text,
    },
    postsSubheader: {
      marginTop: 2,
      color: palette.subtext,
      fontSize: 12,
      fontWeight: "500",
    },
    postsRefreshButton: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: SIZES.radius,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    postsRefreshText: {
      fontSize: 12,
      fontWeight: "600",
      color: palette.primary,
    },
    postsSection: {
      marginHorizontal: SIZES.xxl,
      marginBottom: SIZES.xl,
      gap: SIZES.sm,
    },
    postsStateText: {
      color: palette.subtext,
      fontSize: SIZES.sm,
    },
    postCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radiusLg,
      backgroundColor: palette.surface,
      padding: SIZES.md + 2,
      gap: SIZES.xs,
    },
    postTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 2,
      gap: SIZES.sm,
    },
    postAudienceBadge: {
      paddingVertical: 5,
      paddingHorizontal: 9,
      borderRadius: SIZES.radius,
      backgroundColor: palette.mutedSurface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    postAudienceText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "600",
    },
    postDateText: {
      color: palette.subtext,
      fontSize: 12,
      flexShrink: 1,
      textAlign: "right",
    },
    postPreview: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "600",
      lineHeight: 22,
    },
    postMediaStrip: {
      flexDirection: "row",
      gap: SIZES.xs,
      paddingTop: SIZES.xs,
      paddingBottom: 2,
    },
    postMediaThumb: {
      width: 84,
      height: 84,
      borderRadius: SIZES.radius,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.mutedSurface,
    },
    postMediaOverflowBadge: {
      width: 84,
      height: 84,
      borderRadius: SIZES.radius,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.mutedSurface,
      alignItems: "center",
      justifyContent: "center",
    },
    postMediaOverflowText: {
      color: palette.text,
      fontSize: 18,
      fontWeight: "700",
    },
    postBottomRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 4,
    },
    postLayersWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginTop: SIZES.xs,
      marginBottom: 2,
      gap: SIZES.xs,
    },
    postLayerChip: {
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: SIZES.radius,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.mutedSurface,
    },
    postLayerChipText: {
      fontSize: 11,
      color: palette.text,
      fontWeight: "600",
    },
    postTypeText: {
      color: palette.subtext,
      fontSize: 12,
      letterSpacing: 0.8,
      fontWeight: "600",
    },
    postTapHint: {
      color: palette.primary,
      fontSize: 11,
      fontWeight: "600",
    },
    postModalOverlay: {
      flex: 1,
      justifyContent: "flex-end",
    },
    postModalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.45)",
    },
    postModalCard: {
      maxHeight: "84%",
      backgroundColor: palette.surface,
      borderTopLeftRadius: SIZES.radiusXl,
      borderTopRightRadius: SIZES.radiusXl,
      borderTopWidth: 1,
      borderTopColor: palette.border,
      overflow: "hidden",
    },
    postModalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: SIZES.lg,
      paddingVertical: SIZES.md,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    postModalTitle: {
      color: palette.text,
      fontSize: SIZES.lg,
      fontWeight: "700",
    },
    postModalCloseBtn: {
      paddingHorizontal: SIZES.md,
      paddingVertical: SIZES.sm,
      borderRadius: SIZES.radius,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.mutedSurface,
    },
    postModalCloseText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "600",
    },
    postModalContent: {
      paddingHorizontal: SIZES.lg,
      paddingVertical: SIZES.md,
    },
    postModalImage: {
      width: "100%",
      height: 240,
      borderRadius: SIZES.radiusLg,
      marginBottom: SIZES.md,
      backgroundColor: palette.mutedSurface,
    },
    postModalImageStrip: {
      gap: SIZES.sm,
      paddingBottom: SIZES.md,
    },
    postModalImageThumb: {
      width: 78,
      height: 78,
      borderRadius: SIZES.radius,
      backgroundColor: palette.mutedSurface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    postModalVideoPlaceholder: {
      width: "100%",
      height: 180,
      borderRadius: SIZES.radiusLg,
      marginBottom: SIZES.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.mutedSurface,
      alignItems: "center",
      justifyContent: "center",
    },
    postModalVideoText: {
      color: palette.subtext,
      fontSize: SIZES.md,
      fontWeight: "600",
    },
    postModalCaption: {
      color: palette.text,
      fontSize: SIZES.lg,
      fontWeight: "700",
      marginBottom: SIZES.sm,
    },
    postModalBody: {
      color: palette.text,
      fontSize: SIZES.md,
      lineHeight: 22,
      marginBottom: SIZES.lg,
    },
    postModalMetaBlock: {
      borderTopWidth: 1,
      borderTopColor: palette.border,
      paddingTop: SIZES.md,
      gap: SIZES.xs,
      paddingBottom: SIZES.xl,
    },
    postModalMetaText: {
      color: palette.subtext,
      fontSize: 13,
    },
  });

export default AccountScreen;
