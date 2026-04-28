// File purpose: Direct-message conversation screen for one-on-one friend chats.

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  fetchDirectMessagesViaEdgeFunction,
  supabase,
  getCurrentUser,
  getActiveSession,
  markDirectMessagesReadViaEdgeFunction,
  sendDirectMessageViaEdgeFunction,
} from '../services/supabase';
import { COLORS, SIZES } from '../constants/theme';

// Renders a direct-message thread and sends new messages.
const ChatScreen = ({ route, navigation }) => {
  const { friend } = route.params;
  const [currentUser, setCurrentUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef(null);

  useEffect(() => {
    initializeUser();
  }, []);

  useEffect(() => {
    if (currentUser && friend) {
      loadMessages();
      markMessagesAsRead();
      const cleanup = subscribeToMessages();
      return cleanup;
    }
  }, [currentUser, friend]);

// Supports the initializeUser workflow in this file.
  const initializeUser = async () => {
    const user = await getCurrentUser();
    setCurrentUser(user);
  };

// Loads messages from storage or the backend.
  const loadMessages = async () => {
    try {
      const session = await getActiveSession();
      if (!session?.access_token) return;
      const edgeResult = await fetchDirectMessagesViaEdgeFunction(
        friend.id,
        session.access_token,
        session.refresh_token || null,
        session.user?.id || null,
      );
      if (edgeResult.error) throw edgeResult.error;
      setMessages(Array.isArray(edgeResult.data?.messages) ? edgeResult.data.messages : []);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

// Supports the markMessagesAsRead workflow in this file.
  const markMessagesAsRead = async () => {
    try {
      const session = await getActiveSession();
      if (!session?.access_token) return;
      await markDirectMessagesReadViaEdgeFunction(
        friend.id,
        session.access_token,
        session.refresh_token || null,
        session.user?.id || null,
      );
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  };

// Supports the subscribeToMessages workflow in this file.
  const subscribeToMessages = () => {
    const channel = supabase
      .channel(`chat-${currentUser.id}-${friend.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const msg = payload.new;
          // Only add if it's part of this conversation
          if (
            (msg.sender_id === currentUser.id && msg.receiver_id === friend.id) ||
            (msg.sender_id === friend.id && msg.receiver_id === currentUser.id)
          ) {
            setMessages((prev) => {
              // Prevent duplicates
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
            // Mark as read if we received it
            if (msg.sender_id === friend.id) {
              markMessagesAsRead();
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

// Supports the sendMessage workflow in this file.
  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    const messageText = newMessage.trim();
    setNewMessage('');
    setLoading(true);

    try {
      const session = await getActiveSession();
      if (!session?.access_token) {
        throw new Error('Session expired — please sign in again.');
      }
      const edgeResult = await sendDirectMessageViaEdgeFunction(
        friend.id,
        messageText,
        session.access_token,
        session.refresh_token || null,
        session.user?.id || null,
      );
      if (edgeResult.error) throw edgeResult.error;
      await loadMessages();
    } catch (error) {
      console.error('Error sending message:', error);
      setNewMessage(messageText); // Restore message on error
    } finally {
      setLoading(false);
    }
  };

// Formats time for display.
  const formatTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

// Supports the renderMessage workflow in this file.
  const renderMessage = ({ item, index }) => {
    const isMe = item.sender_id === currentUser?.id;
    const showDate = index === 0 ||
      new Date(item.created_at).toDateString() !==
      new Date(messages[index - 1]?.created_at).toDateString();

    return (
      <View>
        {showDate && (
          <View style={styles.dateHeader}>
            <Text style={styles.dateText}>
              {new Date(item.created_at).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </Text>
          </View>
        )}
        <View style={[styles.messageRow, isMe && styles.messageRowMe]}>
          <View style={[styles.messageBubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
            <Text style={[styles.messageText, isMe && styles.messageTextMe]}>
              {item.content}
            </Text>
            <Text style={[styles.messageTime, isMe && styles.messageTimeMe]}>
              {formatTime(item.created_at)}
              {isMe && (
                <Text style={styles.readStatus}>
                  {item.read ? ' ✓✓' : ' ✓'}
                </Text>
              )}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{friend.display_name || 'User'}</Text>
          {friend.username && (
            <Text style={styles.headerUsername}>@{friend.username}</Text>
          )}
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        onLayout={() => flatListRef.current?.scrollToEnd()}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>💬</Text>
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptyHint}>Say hello to {friend.display_name || 'your friend'}!</Text>
          </View>
        }
      />

      {/* Input */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            value={newMessage}
            onChangeText={setNewMessage}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity
            style={[styles.sendButton, !newMessage.trim() && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!newMessage.trim() || loading}
          >
            <Text style={styles.sendText}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SIZES.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backText: {
    fontSize: 28,
    color: COLORS.primary,
  },
  headerInfo: {
    flex: 1,
    marginLeft: SIZES.sm,
  },
  headerName: {
    fontSize: SIZES.lg,
    fontWeight: '700',
    color: COLORS.dark,
  },
  headerUsername: {
    fontSize: SIZES.sm,
    color: COLORS.primary,
  },
  messagesList: {
    padding: SIZES.lg,
    flexGrow: 1,
  },
  dateHeader: {
    alignItems: 'center',
    marginVertical: SIZES.lg,
  },
  dateText: {
    fontSize: SIZES.xs,
    color: COLORS.gray,
    backgroundColor: COLORS.light,
    paddingHorizontal: SIZES.md,
    paddingVertical: SIZES.xs,
    borderRadius: SIZES.radiusFull,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: SIZES.sm,
  },
  messageRowMe: {
    justifyContent: 'flex-end',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: SIZES.md,
    borderRadius: SIZES.radiusLg,
  },
  bubbleMe: {
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: SIZES.xs,
  },
  bubbleThem: {
    backgroundColor: COLORS.light,
    borderBottomLeftRadius: SIZES.xs,
  },
  messageText: {
    fontSize: SIZES.md,
    color: COLORS.dark,
    lineHeight: 22,
  },
  messageTextMe: {
    color: COLORS.white,
  },
  messageTime: {
    fontSize: SIZES.xs,
    color: COLORS.gray,
    marginTop: SIZES.xs,
    textAlign: 'right',
  },
  messageTimeMe: {
    color: 'rgba(255,255,255,0.7)',
  },
  readStatus: {
    fontSize: SIZES.xs,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SIZES.xxl * 3,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SIZES.lg,
  },
  emptyText: {
    fontSize: SIZES.md,
    color: COLORS.gray,
    marginBottom: SIZES.sm,
  },
  emptyHint: {
    fontSize: SIZES.sm,
    color: COLORS.gray,
    opacity: 0.7,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: SIZES.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radiusLg,
    padding: SIZES.md,
    paddingTop: SIZES.md,
    fontSize: SIZES.md,
    maxHeight: 100,
    marginRight: SIZES.sm,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.gray,
    opacity: 0.5,
  },
  sendText: {
    fontSize: 24,
    color: COLORS.white,
    fontWeight: '700',
  },
});

export default ChatScreen;
