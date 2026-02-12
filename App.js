import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme as NavLightTheme, DarkTheme as NavDarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Text } from 'react-native';

import MapScreen from './src/screens/MapScreen';
import AccountScreen from './src/screens/AccountScreen';
import FriendsScreen from './src/screens/FriendsScreen';
import ChatScreen from './src/screens/ChatScreen';
import CommunitiesScreen from './src/screens/CommunitiesScreen';
import { COLORS } from './src/constants/theme';
import SettingsScreen from './src/screens/SettingsScreen';
import { ThemeProvider, useAppTheme } from './src/context/ThemeContext';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Stack navigator for Friends tab (includes Chat)
function FriendsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="FriendsList" component={FriendsScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
    </Stack.Navigator>
  );
}

function AccountStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AccountHome" component={AccountScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}

function AppNavigator() {
  const { isDark } = useAppTheme();
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
    <NavigationContainer theme={navTheme}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Tab.Navigator
        screenOptions={{
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.gray,
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      >
        <Tab.Screen
          name="Map"
          component={MapScreen}
          options={{
            tabBarIcon: ({ color }) => <Text style={{ fontSize: 24 }}>🗺️</Text>,
          }}
        />
        <Tab.Screen
          name="Communities"
          component={CommunitiesScreen}
        />
        <Tab.Screen
          name="Friends"
          component={FriendsStack}
          options={{
            tabBarIcon: ({ color }) => <Text style={{ fontSize: 24 }}>🤝</Text>,
          }}
        />
        <Tab.Screen
          name="Account"
          component={AccountStack}
          options={{
            tabBarIcon: ({ color }) => <Text style={{ fontSize: 24 }}>👤</Text>,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppNavigator />
    </ThemeProvider>
  );
}
