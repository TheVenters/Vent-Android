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
} from 'react-native';
import { supabase, getCurrentUser } from '../services/supabase';
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
      loadFriends();
      loadRequests();
      loadSentRequests();
    }
  }, [currentUser]);

  // Separate effect for realtime subscription
  useEffect(() => {
    if (!currentUser?.id) return;

    const userId = currentUser.id;
    console.log('Setting up realtime subscription for user:', userId);

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
          console.log('Friends realtime update:', payload);
          const { new: newRecord, old: oldRecord, eventType } = payload;
          const record = newRecord || oldRecord;

          // Check if this change involves the current user
          if (record?.user_id === userId || record?.friend_id === userId) {
            console.log('Reloading friends data due to', eventType);
            // Small delay to ensure database is updated
            setTimeout(() => {
              loadFriends();
              loadRequests();
              loadSentRequests();
            }, 100);
          }
        }
      )
      .subscribe((status, err) => {
        console.log('Friends subscription status:', status);
        if (err) console.error('Subscription error:', err);
      });

    return () => {
      console.log('Cleaning up realtime subscription');
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id]);

  const initializeUser = async () => {
    const user = await getCurrentUser();
    console.log('FriendsScreen: initializeUser', user?.id);
    setCurrentUser(user);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadFriends(), loadRequests(), loadSentRequests()]);
    setRefreshing(false);
  };

  const loadFriends = async () => {
    if (!currentUser?.id) {
      console.log('loadFriends: No currentUser');
      return;
    }
    console.log('loadFriends: Loading for user', currentUser.id);
    try {
      // Get friendships where I sent the request
      const { data: sentData, error: sentError } = await supabase
        .from('friends')
        .select('id, friend_id, status, created_at')
        .eq('user_id', currentUser.id)
        .eq('status', 'accepted');

      // Get friendships where I received the request
      const { data: receivedData, error: receivedError } = await supabase
        .from('friends')
        .select('id, user_id, status, created_at')
        .eq('friend_id', currentUser.id)
        .eq('status', 'accepted');

      if (sentError) throw sentError;
      if (receivedError) throw receivedError;

      // Get friend IDs from both directions
      const friendIds = [
        ...(sentData || []).map(f => f.friend_id),
        ...(receivedData || []).map(f => f.user_id),
      ];

      if (friendIds.length === 0) {
        setFriends([]);
        return;
      }

      // Fetch profiles for all friends
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .in('id', friendIds);

      if (profilesError) throw profilesError;

      // Combine friendship data with profiles
      const friendsWithProfiles = [
        ...(sentData || []).map(f => ({
          ...f,
          friend: profiles?.find(p => p.id === f.friend_id) || {},
        })),
        ...(receivedData || []).map(f => ({
          ...f,
          friend: profiles?.find(p => p.id === f.user_id) || {},
        })),
      ];

      setFriends(friendsWithProfiles);
    } catch (error) {
      console.error('Error loading friends:', error);
    }
  };

  const loadRequests = async () => {
    if (!currentUser?.id) return;
    try {
      // Get pending requests sent to me
      const { data, error } = await supabase
        .from('friends')
        .select('id, user_id, status, created_at')
        .eq('friend_id', currentUser.id)
        .eq('status', 'pending');

      if (error) throw error;

      if (!data || data.length === 0) {
        setRequests([]);
        return;
      }

      // Get profiles of requesters
      const requesterIds = data.map(r => r.user_id);
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .in('id', requesterIds);

      if (profilesError) throw profilesError;

      const requestsWithProfiles = data.map(r => ({
        ...r,
        requester: profiles?.find(p => p.id === r.user_id) || {},
      }));

      setRequests(requestsWithProfiles);
    } catch (error) {
      console.error('Error loading requests:', error);
    }
  };

  const loadSentRequests = async () => {
    if (!currentUser?.id) return;
    try {
      // Get pending requests I sent
      const { data, error } = await supabase
        .from('friends')
        .select('id, friend_id, status, created_at')
        .eq('user_id', currentUser.id)
        .eq('status', 'pending');

      if (error) throw error;

      if (!data || data.length === 0) {
        setSentRequests([]);
        return;
      }

      // Get profiles of people I sent requests to
      const friendIds = data.map(r => r.friend_id);
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .in('id', friendIds);

      if (profilesError) throw profilesError;

      const sentWithProfiles = data.map(r => ({
        ...r,
        friend: profiles?.find(p => p.id === r.friend_id) || {},
      }));

      setSentRequests(sentWithProfiles);
    } catch (error) {
      console.error('Error loading sent requests:', error);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    if (!currentUser?.id) {
      console.log('handleSearch: No currentUser');
      Alert.alert('Error', 'Please sign in to search for friends');
      return;
    }

    console.log('handleSearch: Searching for', searchQuery);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .ilike('username', `%${searchQuery}%`)
        .neq('id', currentUser.id) // Exclude self
        .limit(10);

      console.log('handleSearch: Results', data, 'Error', error);
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
    console.log('sendFriendRequest:', { from: currentUser?.id, to: friendId });
    try {
      const { data, error } = await supabase.from('friends').insert([
        {
          user_id: currentUser.id,
          friend_id: friendId,
          status: 'pending',
        },
      ]).select();

      console.log('sendFriendRequest result:', { data, error });
      if (error) throw error;
      Alert.alert('Success', 'Friend request sent!');
      setSearchQuery('');
      setSearchResults([]);
      loadSentRequests();
    } catch (error) {
      console.error('Error sending friend request:', error);
      Alert.alert('Error', error.message || 'Failed to send friend request');
    }
  };

  const acceptFriendRequest = async (requestId) => {
    try {
      const { error } = await supabase
        .from('friends')
        .update({ status: 'accepted' })
        .eq('id', requestId);

      if (error) throw error;
      Alert.alert('Success', 'Friend request accepted!');
      loadFriends();
      loadRequests();
    } catch (error) {
      console.error('Error accepting friend request:', error);
      Alert.alert('Error', 'Failed to accept friend request');
    }
  };

  const rejectFriendRequest = async (requestId) => {
    try {
      const { error } = await supabase.from('friends').delete().eq('id', requestId);

      if (error) throw error;
      Alert.alert('Success', 'Friend request rejected');
      loadRequests();
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
              const { error } = await supabase
                .from('friends')
                .delete()
                .eq('id', friendshipId);

              if (error) throw error;
              loadFriends();
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
          {item.friend.display_name || 'User'}
        </Text>
        {item.friend.username && (
          <Text style={styles.friendUsername}>@{item.friend.username}</Text>
        )}
      </View>
      <TouchableOpacity
        style={styles.removeButton}
        onPress={() => removeFriend(item.id)}
      >
        <Text style={styles.removeText}>Remove</Text>
      </TouchableOpacity>
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🤝 Friends</Text>
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
          renderItem={renderFriendItem}
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
    padding: SIZES.xl,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
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
