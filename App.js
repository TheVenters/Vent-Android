import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';

import MapScreen from './src/screens/MapScreen';
import AccountScreen from './src/screens/AccountScreen';
import FriendsScreen from './src/screens/FriendsScreen';
import { COLORS } from './src/constants/theme';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Tab.Navigator
        screenOptions={{
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.gray,
          headerShown: false,
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
          name="Friends"
          component={FriendsScreen}
          options={{
            tabBarIcon: ({ color }) => <Text style={{ fontSize: 24 }}>🤝</Text>,
          }}
        />
        <Tab.Screen
          name="Account"
          component={AccountScreen}
          options={{
            tabBarIcon: ({ color }) => <Text style={{ fontSize: 24 }}>👤</Text>,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
