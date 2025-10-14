import React from 'react';
import { Tabs } from 'expo-router';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import AccueilIcon from '@/components/icons/AccueilIcon';
import ComprendreIcon from '@/components/icons/ComprendreIcon';
import ParametresIcon from '@/components/icons/ParametresIcon';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        // Disable the static render of the header on web
        // to prevent a hydration error in React Navigation v6.
        headerShown: useClientOnlyValue(false, true),
      }}>
      <Tabs.Screen
        name="comprendre"
        options={{
          title: 'Comprendre',
          tabBarIcon: ({ color }) => <ComprendreIcon color={color} size={28} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color }) => <AccueilIcon color={color} size={28} />,
        }}
      />
      <Tabs.Screen
        name="parametres"
        options={{
          title: 'Paramètres',
          tabBarIcon: ({ color }) => <ParametresIcon color={color} size={28} />,
        }}
      />
    </Tabs>
  );
}
