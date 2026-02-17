import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SIZES } from "../constants/theme";
import { useAppTheme } from "../context/ThemeContext";
import {
  fetchCommunityMessagesViaEdgeFunction,
  fetchMyCommunityMembershipsViaEdgeFunction,
  getCurrentUser,
  getActiveSession,
  sendCommunityMessageViaEdgeFunction,
  supabase,
} from "../services/supabase";

const isRlsPolicyError = (error) =>
  error?.code === "42501" ||
  String(error?.message || "")
    .toLowerCase()
    .includes("row-level security policy");

const normalizeMembershipStatus = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "active") return "accepted";
  return normalized;
};

const CommunityChatScreen = ({ route, navigation }) => {
  const { palette, isDark } = useAppTheme();
  const styles = createStyles(palette, isDark);
  const flatListRef = useRef(null);

  const communityId = String(route?.params?.communityId || "");
  const communityName = String(route?.params?.communityName || "Community");

  const [currentUser, setCurrentUser] = useState(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [membershipStatus, setMembershipStatus] = useState(null);
  const [membershipLoading, setMembershipLoading] = useState(true);

  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [sending, setSending] = useState(false);

  const canUseChat = useMemo(
    () =>
      Boolean(currentUser?.id) &&
      (isPlatformAdmin || membershipStatus === "accepted"),
    [currentUser?.id, isPlatformAdmin, membershipStatus],
  );

  const formatChatTimestamp = useCallback((value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    return isToday
      ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
  }, []);

  const loadMembershipGate = useCallback(
    async (userId) => {
      if (!userId || !communityId) {
        setIsPlatformAdmin(false);
        setMembershipStatus(null);
        setMembershipLoading(false);
        return;
      }

      setMembershipLoading(true);
      try {
        const session = await getActiveSession();
        const [profileRes, membershipsResult] = await Promise.all([
          supabase
            .from("profiles")
            .select("is_admin")
            .eq("id", userId)
            .maybeSingle(),
          session?.access_token
            ? fetchMyCommunityMembershipsViaEdgeFunction(
                session.access_token,
                session.refresh_token || null,
                session.user?.id || userId,
              )
            : Promise.resolve({ data: { memberships: [] }, error: null }),
        ]);

        if (profileRes.error) throw profileRes.error;
        if (membershipsResult.error) throw membershipsResult.error;

        const membershipRow = (membershipsResult.data?.memberships || []).find(
          (row) => row.community_id === communityId,
        );
        setIsPlatformAdmin(Boolean(profileRes.data?.is_admin));
        setMembershipStatus(normalizeMembershipStatus(membershipRow?.status));
      } catch (error) {
        console.error("Error loading community chat permissions:", error);
        setIsPlatformAdmin(false);
        setMembershipStatus(null);
      } finally {
        setMembershipLoading(false);
      }
    },
    [communityId],
  );

  const loadMessages = useCallback(async () => {
    if (!communityId) return;

    setMessagesLoading(true);
    try {
      const session = await getActiveSession();
      if (!session?.access_token) {
        setMessages([]);
        return;
      }
      const edgeResult = await fetchCommunityMessagesViaEdgeFunction(
        communityId,
        session.access_token,
        session.refresh_token || null,
        session.user?.id || null,
      );
      if (edgeResult.error) throw edgeResult.error;
      setMessages(Array.isArray(edgeResult.data?.messages) ? edgeResult.data.messages : []);
    } catch (error) {
      if (!isRlsPolicyError(error)) {
        console.error("Error loading community chat messages:", error);
      }
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    const initialize = async () => {
      const user = await getCurrentUser();
      setCurrentUser(user);
      await loadMembershipGate(user?.id || null);
    };

    initialize();
  }, [loadMembershipGate]);

  useEffect(() => {
    if (!canUseChat || !communityId) {
      setMessages([]);
      return undefined;
    }

    loadMessages();
    const channel = supabase
      .channel(`community-chat-${communityId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "community_messages",
          filter: `community_id=eq.${communityId}`,
        },
        () => {
          loadMessages();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [canUseChat, communityId, loadMessages]);

  const handleSend = async () => {
    if (!canUseChat || !communityId || !currentUser?.id) return;
    const content = String(composerValue || "").trim();
    if (!content) return;

    setSending(true);
    try {
      const session = await getActiveSession();
      if (!session?.access_token) {
        Alert.alert("Session Expired", "Please sign in again to send messages.");
        return;
      }
      const edgeResult = await sendCommunityMessageViaEdgeFunction(
        communityId,
        content,
        session.access_token,
        session.refresh_token || null,
        session.user?.id || null,
      );
      if (edgeResult.error) throw edgeResult.error;
      setComposerValue("");
    } catch (error) {
      console.error("Error sending community chat message:", error);
      if (isRlsPolicyError(error)) {
        Alert.alert(
          "Permission Denied",
          "You can only chat in communities where you are an accepted member.",
        );
      } else {
        Alert.alert("Error", error?.message || "Failed to send message.");
      }
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }) => {
    const isMine = item.sender_id === currentUser?.id;
    return (
      <View style={[styles.messageRow, isMine && styles.messageRowMine]}>
        <View style={[styles.messageBubble, isMine && styles.messageBubbleMine]}>
          <Text style={[styles.senderText, isMine && styles.senderTextMine]}>
            {item.sender_display_name}
          </Text>
          <Text style={[styles.messageText, isMine && styles.messageTextMine]}>
            {item.content}
          </Text>
          <Text style={[styles.timeText, isMine && styles.timeTextMine]}>
            {formatChatTimestamp(item.created_at)}
          </Text>
        </View>
      </View>
    );
  };

  if (!communityId) {
    return (
      <View style={styles.centerWrap}>
        <Text style={styles.emptyText}>Community chat is unavailable.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>{"< Back"}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{communityName} Chat</Text>
      </View>

      {membershipLoading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : !canUseChat ? (
        <View style={styles.centerWrap}>
          <Text style={styles.emptyText}>
            Join this community first to use chat.
          </Text>
        </View>
      ) : (
        <>
          {messagesLoading ? (
            <View style={styles.centerWrap}>
              <ActivityIndicator color={palette.primary} />
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.messagesList}
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No messages yet.</Text>
              }
            />
          )}

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
          >
            <View style={styles.composerRow}>
              <TextInput
                style={styles.composerInput}
                placeholder="Message community..."
                placeholderTextColor={palette.subtext}
                value={composerValue}
                onChangeText={setComposerValue}
                editable={!sending}
                maxLength={800}
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  (!composerValue.trim() || sending) && styles.sendButtonDisabled,
                ]}
                disabled={!composerValue.trim() || sending}
                onPress={handleSend}
              >
                <Text style={styles.sendButtonText}>{sending ? "..." : "Send"}</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </>
      )}
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
      flex: 1,
      fontSize: SIZES.xl,
      fontWeight: "800",
      color: palette.text,
    },
    centerWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: SIZES.xl,
    },
    emptyText: {
      color: palette.subtext,
      fontSize: 14,
      textAlign: "center",
      lineHeight: 20,
    },
    messagesList: {
      paddingHorizontal: SIZES.xl,
      paddingTop: SIZES.md,
      paddingBottom: SIZES.md,
      gap: 8,
      flexGrow: 1,
    },
    messageRow: {
      flexDirection: "row",
      justifyContent: "flex-start",
      marginBottom: 8,
    },
    messageRowMine: {
      justifyContent: "flex-end",
    },
    messageBubble: {
      maxWidth: "84%",
      backgroundColor: palette.mutedSurface,
      borderRadius: SIZES.radius,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    messageBubbleMine: {
      backgroundColor: palette.primary,
      borderColor: palette.primary,
    },
    senderText: {
      color: palette.subtext,
      fontSize: 11,
      fontWeight: "800",
      marginBottom: 4,
    },
    senderTextMine: {
      color: "rgba(255,255,255,0.8)",
    },
    messageText: {
      color: palette.text,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
    },
    messageTextMine: {
      color: palette.onPrimary,
    },
    timeText: {
      color: palette.subtext,
      fontSize: 10,
      fontWeight: "600",
      marginTop: 6,
      textAlign: "right",
    },
    timeTextMine: {
      color: "rgba(255,255,255,0.8)",
    },
    composerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: SIZES.xl,
      paddingTop: 8,
      paddingBottom: Platform.OS === "ios" ? 22 : 14,
      borderTopWidth: 1,
      borderTopColor: palette.border,
      backgroundColor: palette.background,
    },
    composerInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      paddingHorizontal: 12,
      paddingVertical: 9,
      color: palette.text,
      backgroundColor: isDark ? "#1a202c" : "#ffffff",
      fontSize: 13,
    },
    sendButton: {
      borderRadius: SIZES.radius,
      backgroundColor: palette.primary,
      paddingHorizontal: 12,
      paddingVertical: 9,
      minWidth: 62,
      alignItems: "center",
    },
    sendButtonDisabled: {
      opacity: 0.45,
    },
    sendButtonText: {
      color: palette.onPrimary,
      fontSize: 12,
      fontWeight: "800",
    },
  });

export default CommunityChatScreen;
