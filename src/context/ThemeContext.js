// File purpose: Theme context that persists light/dark mode and exposes theme helpers to the app.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import { COLORS } from '../constants/theme';

const THEME_STORAGE_KEY = 'vent_theme_mode';

const LIGHT_PALETTE = {
  background: COLORS.white,
  surface: COLORS.white,
  mutedSurface: COLORS.light,
  text: COLORS.dark,
  subtext: COLORS.gray,
  border: COLORS.border,
  primary: COLORS.primary,
  danger: COLORS.danger,
  onPrimary: COLORS.white,
};

const DARK_PALETTE = {
  background: '#0f1115',
  surface: '#1b1f27',
  mutedSurface: '#252b36',
  text: '#f2f4f8',
  subtext: '#aab2bf',
  border: '#323a47',
  primary: '#8ea2ff',
  danger: '#ff6f6f',
  onPrimary: '#ffffff',
};

const ThemeContext = createContext(null);

// Supports the ThemeProvider workflow in this file.
export const ThemeProvider = ({ children }) => {
  const deviceScheme = useColorScheme();
  const [themeMode, setThemeMode] = useState('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
// Loads theme from storage or the backend.
    const loadTheme = async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'dark' || stored === 'light' || stored === 'system') {
          setThemeMode(stored);
        }
      } catch (error) {
        console.error('Failed to load theme mode:', error);
      } finally {
        setReady(true);
      }
    };

    loadTheme();
  }, []);

// Supports the setMode workflow in this file.
  const setMode = async (mode) => {
    const nextMode =
      mode === 'dark' || mode === 'light' || mode === 'system' ? mode : 'system';
    setThemeMode(nextMode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, nextMode);
    } catch (error) {
      console.error('Failed to save theme mode:', error);
    }
  };

  const value = useMemo(() => {
    const resolvedTheme = themeMode === 'system' ? deviceScheme || 'light' : themeMode;
    const isDark = resolvedTheme === 'dark';
    return {
      ready,
      themeMode,
      resolvedTheme,
      isDark,
      palette: isDark ? DARK_PALETTE : LIGHT_PALETTE,
      setThemeMode: setMode,
    };
  }, [ready, themeMode, deviceScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// React hook helper that manages app theme.
export const useAppTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used within ThemeProvider');
  }
  return ctx;
};
