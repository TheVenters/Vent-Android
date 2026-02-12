import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAppTheme } from '../context/ThemeContext';

const SettingsScreen = ({ navigation }) => {
  const { themeMode, setThemeMode, palette } = useAppTheme();

  const styles = createStyles(palette);

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
  });

export default SettingsScreen;
