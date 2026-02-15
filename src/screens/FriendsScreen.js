import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  RefreshControl,
  Platform,
} from 'react-native';
import {
  acceptFriendRequestViaEdgeFunction,
  fetchFriendListsViaEdgeFunction,
  getActiveSession,
  getCurrentUser,
  rejectFriendRequestViaEdgeFunction,
  removeFriendViaEdgeFunction,
  sendFriendRequestViaEdgeFunction,
  supabase,
} from '../services/supabase';
import { COLORS, SIZES } from '../constants/theme';

const FriendsScreen = ({ navigation }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [activeTab, setActiveTab] = useState('friends');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    initializeUser();
  }, []);

  // Separate effect for loading data
  useEffect(() => {
    if (currentUser) {
      loadFriendCollections();
    }
  }, [currentUser]);

  // Separate effect for realtime subscription
  useEffect(() => {
    if (!currentUser?.id) return;

    const userId = currentUser.id;

    const channel = supabase
      .channel(`friends-realtime-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friends',
        },
        (payload) => {
          const { new: newRecord, old: oldRecord } = payload;
          const record = newRecord || oldRecord;

          // Check if this change involves the current user
          if (record?.user_id === userId || record?.friend_id === userId) {
            // Small delay to ensure database is updated
            setTimeout(() => {
              loadFriendCollections();
            }, 100);
          }
        }
      )
      .subscribe((_status, err) => {
        if (err) console.error('Subscription error:', err);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id]);

  const initializeUser = async () => {
    const user = await getCurrentUser();
    setCurrentUser(user);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFriendCollections();
    setRefreshing(false);
  };

  const loadFriendCollections = async () => {
    if (!currentUser?.id) {
      setFriends([]);
      setRequests([]);
      setSentRequests([]);
      return;
    }

    try {
      const session = await getActiveSession();
      const result = await fetchFriendListsViaEdgeFunction(
        session?.access_token || null,
        session?.refresh_token || null,
        session?.user?.id || currentUser.id,
      );
      if (result.error) {
        throw result.error;
      }
      setFriends(Array.isArray(result.data?.friends) ? result.data.friends : []);
      setRequests(Array.isArray(result.data?.requests) ? result.data.requests : []);
      setSentRequests(
        Array.isArray(result.data?.sentRequests) ? result.data.sentRequests : [],
      );
    } catch (error) {
      console.error('Error loading friend collections:', error);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    if (!currentUser?.id) {
      Alert.alert('Error', 'Please sign in to search for friends');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .ilike('username', `%${searchQuery}%`)
        .neq('id', currentUser.id) // Exclude self
        .limit(10);

      if (error) throw error;

      // Filter out existing friends and pending requests
      const existingIds = new Set([
        ...friends.map(f => f.friend?.id),
        ...sentRequests.map(r => r.friend?.id),
        ...requests.map(r => r.requester?.id),
      ].filter(Boolean));

      const filtered = (data || []).filter(user => !existingIds.has(user.id));
      setSearchResults(filtered);
    } catch (error) {
      console.error('Search error:', error);
      Alert.alert('Error', 'Failed to search for users');
    }
  };

  const sendFriendRequest = async (friendId) => {
    try {
      const session = await getActiveSession();
      const actorUserId = session?.user?.id || null;
      const accessToken = session?.access_token || null;
      if (!actorUserId || !accessToken) {
        Alert.alert('Sign In Required', 'Please sign in again to send friend requests.');
        return;
      }

      const { data, error } = await sendFriendRequestViaEdgeFunction(
        friendId,
        accessToken,
        session?.refresh_token || null,
        actorUserId,
      );

      if (error) throw error;

      const status = String(data?.status || 'pending');
      const requestedProfile = searchResults.find((user) => user.id === friendId) || null;

      if (status === 'accepted') {
        Alert.alert('Success', 'Friend request accepted. You are now friends.');
        setSearchQuery('');
        setSearchResults((prev) => prev.filter((user) => user.id !== friendId));
        await loadFriendCollections();
        return;
      }

      if (requestedProfile) {
        setSentRequests((prev) => {
          const exists = prev.some((entry) => entry?.friend?.id === friendId);
          if (exists) return prev;
          return [
            {
              id: `tmp-${Date.now()}`,
              friend_id: friendId,
              status: 'pending',
              created_at: new Date().toISOString(),
              friend: requestedProfile,
            },
            ...prev,
          ];
        });
      }

      Alert.alert('Success', 'Friend request sent!');
      setSearchQuery('');
      setSearchResults((prev) => prev.filter((user) => user.id !== friendId));
      await loadFriendCollections();
    } catch (error) {
      console.error('Error sending friend request:', error);
      Alert.alert(
        'Error',
        error?.message || 'Failed to send friend request',
      );
    }
  };

  const acceptFriendRequest = async (requestId) => {
    try {
      const session = await getActiveSession();
      const accessToken = session?.access_token || null;
      if (!accessToken) {
        Alert.alert('Sign In Required', 'Please sign in again to accept requests.');
        return;
      }

      const { error } = await acceptFriendRequestViaEdgeFunction(
        requestId,
        accessToken,
        session?.refresh_token || null,
        session?.user?.id || null,
      );

      if (error) throw error;
      Alert.alert('Success', 'Friend request accepted!');
      await loadFriendCollections();
    } catch (error) {
      console.error('Error accepting friend request:', error);
      Alert.alert('Error', 'Failed to accept friend request');
    }
  };

  const rejectFriendRequest = async (requestId) => {
    try {
      const session = await getActiveSession();
      const accessToken = session?.access_token || null;
      if (!accessToken) {
        Alert.alert('Sign In Required', 'Please sign in again to manage requests.');
        return;
      }

      const { error } = await rejectFriendRequestViaEdgeFunction(
        requestId,
        accessToken,
        session?.refresh_token || null,
        session?.user?.id || null,
      );

      if (error) throw error;
      Alert.alert('Success', 'Friend request cancelled');
      await loadFriendCollections();
    } catch (error) {
      console.error('Error rejecting friend request:', error);
      Alert.alert('Error', 'Failed to reject friend request');
    }
  };

  const removeFriend = async (friendshipId) => {
    Alert.alert(
      'Remove Friend',
      'Are you sure you want to remove this friend?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const session = await getActiveSession();
              const accessToken = session?.access_token || null;
              if (!accessToken) {
                Alert.alert('Sign In Required', 'Please sign in again to remove friends.');
                return;
              }

              const { error } = await removeFriendViaEdgeFunction(
                friendshipId,
                accessToken,
                session?.refresh_token || null,
                session?.user?.id || null,
              );

              if (error) throw error;
              await loadFriendCollections();
            } catch (error) {
              console.error('Error removing friend:', error);
              Alert.alert('Error', 'Failed to remove friend');
            }
          },
        },
      ]
    );
  };

  if (!currentUser) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🔒</Text>
          <Text style={styles.emptyTitle}>Sign in to connect</Text>
          <Text style={styles.emptyText}>
            You need to be signed in to add friends
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => navigation.navigate('Account')}
          >
            <Text style={styles.buttonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const renderFriendItem = ({ item }) => (
    <View style={styles.friendItem}>
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>
          {item.friend?.display_name || 'User'}
        </Text>
        {item.friend?.username && (
          <Text style={styles.friendUsername}>@{item.friend.username}</Text>
        )}
      </View>
      <View style={styles.friendActions}>
        <TouchableOpacity
          style={styles.messageButton}
          onPress={() => navigation.navigate('Chat', { friend: item.friend })}
        >
          <Text style={styles.messageIcon}>💬</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.removeButton}
          onPress={() => removeFriend(item.id)}
        >
          <Text style={styles.removeText}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderRequestItem = ({ item }) => (
    <View style={styles.friendItem}>
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>
          {item.requester.display_name || 'User'}
        </Text>
        {item.requester.username && (
          <Text style={styles.friendUsername}>@{item.requester.username}</Text>
        )}
      </View>
      <View style={styles.requestActions}>
        <TouchableOpacity
          style={styles.acceptButton}
          onPress={() => acceptFriendRequest(item.id)}
        >
          <Text style={styles.acceptText}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.rejectButton}
          onPress={() => rejectFriendRequest(item.id)}
        >
          <Text style={styles.rejectText}>Reject</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSearchItem = ({ item }) => (
    <View style={styles.friendItem}>
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>{item.display_name || 'User'}</Text>
        {item.username && (
          <Text style={styles.friendUsername}>@{item.username}</Text>
        )}
      </View>
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => sendFriendRequest(item.id)}
      >
        <Text style={styles.addText}>Add</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSentItem = ({ item }) => (
    <View style={styles.friendItem}>
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>
          {item.friend?.display_name || 'User'}
        </Text>
        {item.friend?.username && (
          <Text style={styles.friendUsername}>@{item.friend.username}</Text>
        )}
        <Text style={styles.pendingLabel}>Pending</Text>
      </View>
      <TouchableOpacity
        style={styles.rejectButton}
        onPress={() => rejectFriendRequest(item.id)}
      >
        <Text style={styles.rejectText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.navigate('Map')}
        >
          <Text style={styles.backButtonText}>{'< Map'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Friends</Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by username..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
          <Text style={styles.searchIcon}>🔍</Text>
        </TouchableOpacity>
      </View>

      {searchResults.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Search Results</Text>
          <FlatList
            data={searchResults}
            renderItem={renderSearchItem}
            keyExtractor={(item) => item.id}
          />
        </View>
      )}

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'friends' && styles.tabActive]}
          onPress={() => setActiveTab('friends')}
        >
          <Text style={styles.tabText}>Friends</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'requests' && styles.tabActive]}
          onPress={() => setActiveTab('requests')}
        >
          <Text style={styles.tabText}>Requests</Text>
          {requests.length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{requests.length}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'sent' && styles.tabActive]}
          onPress={() => setActiveTab('sent')}
        >
          <Text style={styles.tabText}>Sent</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'friends' && (
        <FlatList
          data={friends}
          renderItem={renderFriendItem}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>👫</Text>
              <Text style={styles.emptyText}>No friends yet</Text>
              <Text style={styles.emptyHint}>Pull down to refresh</Text>
            </View>
          }
        />
      )}

      {activeTab === 'requests' && (
        <FlatList
          data={requests}
          renderItem={renderRequestItem}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📬</Text>
              <Text style={styles.emptyText}>No pending requests</Text>
              <Text style={styles.emptyHint}>Pull down to refresh</Text>
            </View>
          }
        />
      )}

      {activeTab === 'sent' && (
        <FlatList
          data={sentRequests}
          renderItem={renderSentItem}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📤</Text>
              <Text style={styles.emptyText}>No sent requests</Text>
              <Text style={styles.emptyHint}>Pull down to refresh</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingHorizontal: SIZES.xl,
    paddingBottom: SIZES.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SIZES.md,
  },
  backButton: {
    paddingVertical: SIZES.sm,
    paddingRight: SIZES.sm,
  },
  backButtonText: {
    fontSize: SIZES.md,
    fontWeight: '600',
    color: COLORS.primary,
  },
  title: {
    fontSize: SIZES.xxl,
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    padding: SIZES.lg,
    gap: SIZES.sm,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radiusLg,
    padding: SIZES.md,
    fontSize: SIZES.md,
  },
  searchButton: {
    width: 48,
    height: 48,
    borderRadius: SIZES.radiusLg,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchIcon: {
    fontSize: 20,
  },
  section: {
    padding: SIZES.lg,
  },
  sectionTitle: {
    fontSize: SIZES.sm,
    fontWeight: '600',
    color: COLORS.gray,
    marginBottom: SIZES.md,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tab: {
    flex: 1,
    paddingVertical: SIZES.lg,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SIZES.sm,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.primary,
  },
  tabText: {
    fontSize: SIZES.md,
    fontWeight: '600',
  },
  badge: {
    backgroundColor: COLORS.danger,
    borderRadius: SIZES.radiusFull,
    paddingHorizontal: SIZES.sm,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeText: {
    color: COLORS.white,
    fontSize: SIZES.xs,
    fontWeight: '600',
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SIZES.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  friendInfo: {
    flex: 1,
  },
  friendName: {
    fontSize: SIZES.md,
    fontWeight: '600',
    color: COLORS.dark,
  },
  friendUsername: {
    fontSize: SIZES.sm,
    color: COLORS.primary,
    marginTop: SIZES.xs,
  },
  pendingLabel: {
    marginTop: SIZES.xs,
    fontSize: SIZES.xs,
    color: COLORS.gray,
    fontWeight: '600',
  },
  requestActions: {
    flexDirection: 'row',
    gap: SIZES.sm,
  },
  acceptButton: {
    paddingHorizontal: SIZES.lg,
    paddingVertical: SIZES.sm,
    backgroundColor: COLORS.success,
    borderRadius: SIZES.radiusLg,
  },
  acceptText: {
    color: COLORS.white,
    fontSize: SIZES.sm,
    fontWeight: '600',
  },
  rejectButton: {
    paddingHorizontal: SIZES.lg,
    paddingVertical: SIZES.sm,
    backgroundColor: COLORS.danger,
    borderRadius: SIZES.radiusLg,
  },
  rejectText: {
    color: COLORS.white,
    fontSize: SIZES.sm,
    fontWeight: '600',
  },
  friendActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SIZES.sm,
  },
  messageButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageIcon: {
    fontSize: 18,
  },
  removeButton: {
    paddingHorizontal: SIZES.lg,
    paddingVertical: SIZES.sm,
    backgroundColor: COLORS.light,
    borderRadius: SIZES.radiusLg,
  },
  removeText: {
    color: COLORS.danger,
    fontSize: SIZES.sm,
    fontWeight: '600',
  },
  addButton: {
    paddingHorizontal: SIZES.lg,
    paddingVertical: SIZES.sm,
    backgroundColor: COLORS.primary,
    borderRadius: SIZES.radiusLg,
  },
  addText: {
    color: COLORS.white,
    fontSize: SIZES.sm,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: SIZES.xxl * 2,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SIZES.lg,
  },
  emptyTitle: {
    fontSize: SIZES.lg,
    fontWeight: '600',
    color: COLORS.dark,
    marginBottom: SIZES.sm,
  },
  emptyText: {
    fontSize: SIZES.md,
    color: COLORS.gray,
    textAlign: 'center',
    marginBottom: SIZES.sm,
  },
  emptyHint: {
    fontSize: SIZES.sm,
    color: COLORS.gray,
    textAlign: 'center',
    opacity: 0.6,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: SIZES.radiusLg,
    paddingHorizontal: SIZES.xxl,
    paddingVertical: SIZES.lg,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: SIZES.md,
    fontWeight: '600',
  },
});

export default FriendsScreen;
