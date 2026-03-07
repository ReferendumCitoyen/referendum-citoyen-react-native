import React from 'react';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import CustomTabBar from '@/components/CustomTabBar';
import { VideoProvider } from '@/contexts/VideoContext';

export default function TabLayout() {
  const { t } = useTranslation();

  return (
    <VideoProvider>
      <Tabs
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}>
        <Tabs.Screen
          name="comprendre"
          options={{
            title: t('tabs.comprendre'),
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.accueil'),
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="parametres"
          options={{
            title: t('tabs.parametres'),
            headerShown: false,
          }}
        />
      </Tabs>
    </VideoProvider>
  );
}
