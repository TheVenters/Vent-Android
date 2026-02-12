import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

export const ThemeProvider = ({ children }) => {
  const [themeMode, setThemeMode] = useState('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'dark' || stored === 'light') {
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

  const setMode = async (mode) => {
    const nextMode = mode === 'dark' ? 'dark' : 'light';
    setThemeMode(nextMode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, nextMode);
    } catch (error) {
      console.error('Failed to save theme mode:', error);
    }
  };

  const value = useMemo(() => {
    const isDark = themeMode === 'dark';
    return {
      ready,
      themeMode,
      isDark,
      palette: isDark ? DARK_PALETTE : LIGHT_PALETTE,
      setThemeMode: setMode,
    };
  }, [ready, themeMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useAppTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used within ThemeProvider');
  }
  return ctx;
};
