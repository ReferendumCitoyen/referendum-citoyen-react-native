import React from 'react';
import { Tabs } from 'expo-router';

import CustomTabBar from '@/components/CustomTabBar';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' },
      }}>
      <Tabs.Screen
        name="comprendre"
        options={{
          title: 'Comprendre',
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="parametres"
        options={{
          title: 'Paramètres',
          headerShown: false,
        }}
      />
    </Tabs>
  );
}
