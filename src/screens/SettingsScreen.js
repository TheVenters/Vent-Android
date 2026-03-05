import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAppTheme } from '../context/ThemeContext';
import { getCurrentUser, supabase } from '../services/supabase';

const SettingsScreen = ({ navigation }) => {
  const { themeMode, setThemeMode, palette } = useAppTheme();
  const [isAdmin, setIsAdmin] = useState(false);

  const styles = createStyles(palette);

  useEffect(() => {
    let active = true;

    const loadAdminStatus = async () => {
      try {
        const user = await getCurrentUser();
        if (!user?.id) {
          if (active) setIsAdmin(false);
          return;
        }
        const { data, error } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .maybeSingle();
        if (error) {
          const code = String(error?.code || '');
          const message = String(error?.message || '').toLowerCase();
          const missingAdminColumn = code === '42703' || message.includes('is_admin');
          if (!missingAdminColumn) {
            console.warn('Failed to load admin status:', error);
          }
          if (active) setIsAdmin(false);
          return;
        }
        if (active) setIsAdmin(Boolean(data?.is_admin));
      } catch (error) {
        if (active) setIsAdmin(false);
      }
    };

    loadAdminStatus();
    return () => {
      active = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{'< Account'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.sectionTitle}>Appearance</Text>

        <View style={styles.optionRow}>
          <TouchableOpacity
            style={[styles.optionButton, themeMode === 'system' && styles.optionButtonActive]}
            onPress={() => setThemeMode('system')}
          >
            <Text style={[styles.optionText, themeMode === 'system' && styles.optionTextActive]}>
              Use Device
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.optionButton, themeMode === 'light' && styles.optionButtonActive]}
            onPress={() => setThemeMode('light')}
          >
            <Text style={[styles.optionText, themeMode === 'light' && styles.optionTextActive]}>
              Light Mode
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.optionButton, themeMode === 'dark' && styles.optionButtonActive]}
            onPress={() => setThemeMode('dark')}
          >
            <Text style={[styles.optionText, themeMode === 'dark' && styles.optionTextActive]}>
              Dark Mode
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Support</Text>
        <TouchableOpacity
          style={styles.supportButton}
          onPress={() =>
            navigation.navigate('ReportBug', {
              fromScreen: 'Settings',
            })
          }
        >
          <Text style={styles.supportButtonText}>Report a Bug</Text>
          <Text style={styles.supportButtonHint}>
            Send details and an optional screenshot to help us fix issues faster.
          </Text>
        </TouchableOpacity>

        {isAdmin && (
          <TouchableOpacity
            style={[styles.supportButton, styles.adminButton]}
            onPress={() =>
              navigation.navigate('AdminBugReports')
            }
          >
            <Text style={styles.supportButtonText}>Review Bug Reports</Text>
            <Text style={styles.supportButtonHint}>
              Admin triage view with screenshot previews and report details.
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const createStyles = (palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.background,
    },
    topBar: {
      paddingHorizontal: 20,
      paddingTop: 56,
      paddingBottom: 8,
    },
    backText: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.primary,
    },
    content: {
      paddingHorizontal: 24,
      paddingTop: 12,
    },
    title: {
      fontSize: 28,
      fontWeight: '700',
      color: palette.text,
      marginBottom: 24,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: palette.subtext,
      marginBottom: 10,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    optionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    optionButton: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      paddingVertical: 14,
      alignItems: 'center',
    },
    optionButtonActive: {
      backgroundColor: palette.primary,
      borderColor: palette.primary,
    },
    optionText: {
      fontSize: 14,
      fontWeight: '600',
      color: palette.text,
    },
    optionTextActive: {
      color: palette.onPrimary,
    },
    sectionSpacing: {
      marginTop: 30,
    },
    supportButton: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      paddingVertical: 14,
      paddingHorizontal: 14,
      gap: 4,
    },
    supportButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: palette.text,
    },
    supportButtonHint: {
      fontSize: 13,
      lineHeight: 18,
      color: palette.subtext,
    },
    adminButton: {
      marginTop: 10,
    },
  });

export default SettingsScreen;
