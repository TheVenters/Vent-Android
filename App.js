// File purpose: Application entry point that wires theme providers, navigation stacks, route tracking, and the hidden bottom-tab shell.

import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  NavigationContainer,
  DefaultTheme as NavLightTheme,
  DarkTheme as NavDarkTheme,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import MapScreen from './src/screens/MapScreen';
import AccountScreen from './src/screens/AccountScreen';
import FriendsScreen from './src/screens/FriendsScreen';
import ChatScreen from './src/screens/ChatScreen';
import CommunitiesScreen from './src/screens/CommunitiesScreen';
import CommunityChatScreen from './src/screens/CommunityChatScreen';
import { COLORS } from './src/constants/theme';
import SettingsScreen from './src/screens/SettingsScreen';
import ReportBugScreen from './src/screens/ReportBugScreen';
import AdminBugReportsScreen from './src/screens/AdminBugReportsScreen';
import { ThemeProvider, useAppTheme } from './src/context/ThemeContext';
import {
  installGlobalErrorTracking,
  setCurrentTelemetryScreen,
} from './src/services/telemetry';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Defines the nested friends navigation flow, including the friend list, direct chat, and friend profile screens.
function FriendsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="FriendsList" component={FriendsScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="FriendProfile" component={AccountScreen} />
    </Stack.Navigator>
  );
}

// Defines the nested account navigation flow for profile, settings, bug reporting, and admin reports.
function AccountStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AccountHome" component={AccountScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="ReportBug" component={ReportBugScreen} />
      <Stack.Screen name="AdminBugReports" component={AdminBugReportsScreen} />
    </Stack.Navigator>
  );
}

// Defines the nested communities navigation flow from the community list into community chat.
function CommunitiesStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CommunitiesHome" component={CommunitiesScreen} />
      <Stack.Screen name="CommunityChat" component={CommunityChatScreen} />
    </Stack.Navigator>
  );
}

// Walks nested React Navigation state to find the currently visible route name for telemetry.
const getActiveRouteName = (state) => {
  if (!state || !Array.isArray(state.routes) || state.routes.length === 0) {
    return null;
  }
  const index = Number.isFinite(state.index) ? state.index : 0;
  const route = state.routes[index];
  if (!route) return null;
  if (route.state) {
    return getActiveRouteName(route.state) || route.name || null;
  }
  return route.name || null;
};

// Builds the themed navigation container, installs global error tracking, and syncs route changes to telemetry.
function AppNavigator() {
  const { isDark } = useAppTheme();
  const navigationRef = useRef(null);
  const currentRouteRef = useRef(null);

  useEffect(() => {
    const uninstall = installGlobalErrorTracking();
    return () => uninstall?.();
  }, []);

// Supports the syncCurrentRoute workflow in this file.
  const syncCurrentRoute = () => {
    const routeName = getActiveRouteName(navigationRef.current?.getRootState?.());
    if (!routeName || routeName === currentRouteRef.current) return;
    currentRouteRef.current = routeName;
    setCurrentTelemetryScreen(routeName);
  };

  const navTheme = isDark
    ? {
        ...NavDarkTheme,
        colors: {
          ...NavDarkTheme.colors,
          background: '#0f1115',
          card: '#1b1f27',
          border: '#323a47',
          text: '#f2f4f8',
          primary: '#8ea2ff',
        },
      }
    : {
        ...NavLightTheme,
        colors: {
          ...NavLightTheme.colors,
          background: COLORS.white,
        },
      };

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      onReady={syncCurrentRoute}
      onStateChange={syncCurrentRoute}
    >
      <StatusBar
        style={isDark ? 'light' : 'dark'}
        translucent
        backgroundColor="transparent"
      />
      <Tab.Navigator
        screenOptions={{
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.gray,
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      >
        <Tab.Screen name="Map" component={MapScreen} />
        <Tab.Screen name="Communities" component={CommunitiesStack} />
        <Tab.Screen name="Friends" component={FriendsStack} />
        <Tab.Screen name="Account" component={AccountStack} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

// Wraps the application in safe-area, gesture, and theme providers before rendering navigation.
export default function App() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeProvider>
          <AppNavigator />
        </ThemeProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
