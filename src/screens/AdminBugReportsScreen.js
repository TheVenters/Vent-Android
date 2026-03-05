import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Platform,
  StyleSheet,
  StatusBar as RNStatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../context/ThemeContext';
import {
  getActiveSession,
  listAdminIssueReportsViaEdgeFunction,
} from '../services/supabase';

const PAGE_SIZE = 30;

const formatErrorMessage = (error) => {
  if (!error) return 'Unknown error';
  const message = String(error?.message || '').trim();
  if (message) return message;
  try {
    return JSON.stringify(error);
  } catch (_) {
    return 'Unknown error';
  }
};

const toPrettyDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const AdminBugReportsScreen = ({ navigation }) => {
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const topInset = Math.max(
    insets.top || 0,
    Platform.OS === 'android' ? RNStatusBar.currentHeight || 0 : 0,
  );
  const styles = createStyles(palette, topInset);
  const [reports, setReports] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  const loadReports = useCallback(
    async ({ append = false, asRefresh = false } = {}) => {
      if (append && (!nextBefore || loadingMore)) return;

      if (append) {
        setLoadingMore(true);
      } else if (asRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const session = await getActiveSession();
        const accessToken = session?.access_token || null;
        const refreshToken = session?.refresh_token || null;
        const actorId = session?.user?.id || null;
        if (!accessToken || !actorId) {
          throw new Error('Please sign in as an admin to view bug reports.');
        }

        const result = await listAdminIssueReportsViaEdgeFunction(
          accessToken,
          refreshToken,
          actorId,
          PAGE_SIZE,
          append ? nextBefore : null,
          60 * 60,
        );

        if (result.error) {
          if (result.status === 403) {
            setAccessDenied(true);
            return;
          }
          throw result.error;
        }

        const rows = Array.isArray(result?.data?.reports)
          ? result.data.reports
          : [];
        setAccessDenied(false);
        setReports((prev) => (append ? [...prev, ...rows] : rows));
        setNextBefore(String(result?.data?.nextBefore || '').trim() || null);
      } catch (error) {
        Alert.alert('Could not load reports', formatErrorMessage(error));
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [loadingMore, nextBefore],
  );

  useEffect(() => {
    loadReports({ append: false });
  }, []);

  const handleOpenScreenshot = async (url) => {
    const target = String(url || '').trim();
    if (!target) return;
    try {
      await Linking.openURL(target);
    } catch (error) {
      Alert.alert('Unable to open screenshot', formatErrorMessage(error));
    }
  };

  const renderRow = ({ item }) => {
    const createdAt = toPrettyDate(item?.created_at);
    const description = String(item?.description || '').trim();
    const username = String(item?.reporter_username || '').trim();
    const displayName = String(item?.reporter_display_name || '').trim();
    const userLabel = username
      ? `@${username}`
      : displayName
        ? displayName
        : String(item?.user_id || 'anonymous');
    const screenshotUrl = String(item?.screenshot_signed_url || '').trim();
    const uploadError = String(item?.metadata?.uploadError || '').trim();

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardDate}>{createdAt}</Text>
        </View>
        <Text style={styles.metaLine}>User: {userLabel}</Text>
        {description ? (
          <Text style={styles.descriptionText}>{description}</Text>
        ) : (
          <Text style={styles.descriptionMuted}>No description provided.</Text>
        )}

        {uploadError ? (
          <Text style={styles.uploadError}>Screenshot issue: {uploadError}</Text>
        ) : null}

        {screenshotUrl ? (
          <TouchableOpacity onPress={() => handleOpenScreenshot(screenshotUrl)}>
            <Image source={{ uri: screenshotUrl }} style={styles.screenshotImage} />
            <Text style={styles.screenshotHint}>Tap to open full screenshot</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.screenshotMissing}>No screenshot attached</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{'< Settings'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => loadReports({ append: false })}
          disabled={loading || refreshing}
        >
          <Text style={styles.refreshText}>
            {loading || refreshing ? 'Refreshing...' : 'Refresh'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Bug Reports</Text>

        {accessDenied ? (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              Admin access required. Your profile is not marked as admin.
            </Text>
          </View>
        ) : loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={palette.primary} />
            <Text style={styles.loadingText}>Loading reports...</Text>
          </View>
        ) : (
          <FlatList
            data={reports}
            keyExtractor={(item, index) => String(item?.id || `row-${index}`)}
            renderItem={renderRow}
            onRefresh={() => loadReports({ append: false, asRefresh: true })}
            refreshing={refreshing}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No reports yet.</Text>
            }
            ListFooterComponent={
              nextBefore ? (
                <TouchableOpacity
                  style={[styles.loadMoreButton, loadingMore && styles.disabled]}
                  onPress={() => loadReports({ append: true })}
                  disabled={loadingMore}
                >
                  <Text style={styles.loadMoreText}>
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </Text>
                </TouchableOpacity>
              ) : null
            }
          />
        )}
      </View>
    </View>
  );
};

const createStyles = (palette, topInset = 0) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.background,
    },
    topBar: {
      paddingHorizontal: 20,
      paddingTop: Math.max(topInset + 10, 56),
      paddingBottom: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    backText: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.primary,
    },
    refreshButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    refreshText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: '700',
    },
    content: {
      flex: 1,
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
    title: {
      fontSize: 28,
      fontWeight: '700',
      color: palette.text,
      marginBottom: 12,
      paddingHorizontal: 8,
    },
    listContent: {
      paddingBottom: 36,
    },
    card: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
      gap: 10,
    },
    cardTitle: {
      color: palette.text,
      fontSize: 15,
      fontWeight: '700',
    },
    cardDate: {
      color: palette.subtext,
      fontSize: 12,
      fontWeight: '500',
    },
    metaLine: {
      color: palette.subtext,
      fontSize: 12,
      marginBottom: 2,
    },
    descriptionText: {
      color: palette.text,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 8,
    },
    descriptionMuted: {
      color: palette.subtext,
      fontSize: 13,
      marginTop: 8,
      fontStyle: 'italic',
    },
    uploadError: {
      color: palette.danger,
      fontSize: 12,
      marginTop: 8,
    },
    screenshotImage: {
      width: '100%',
      height: 220,
      borderRadius: 10,
      backgroundColor: palette.mutedSurface,
      marginTop: 10,
    },
    screenshotHint: {
      color: palette.primary,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 6,
    },
    screenshotMissing: {
      color: palette.subtext,
      fontSize: 12,
      marginTop: 10,
      fontStyle: 'italic',
    },
    loadMoreButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      paddingVertical: 10,
      alignItems: 'center',
      marginHorizontal: 4,
      marginTop: 8,
    },
    loadMoreText: {
      color: palette.text,
      fontSize: 13,
      fontWeight: '700',
    },
    disabled: {
      opacity: 0.6,
    },
    emptyText: {
      color: palette.subtext,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 24,
    },
    loadingWrap: {
      marginTop: 26,
      alignItems: 'center',
      gap: 8,
    },
    loadingText: {
      color: palette.subtext,
      fontSize: 13,
    },
    noticeBox: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      padding: 14,
    },
    noticeText: {
      color: palette.text,
      fontSize: 14,
      lineHeight: 20,
    },
  });

export default AdminBugReportsScreen;
