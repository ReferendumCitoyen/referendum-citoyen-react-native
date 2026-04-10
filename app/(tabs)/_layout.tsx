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
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.accueil'),
          }}
        />
        <Tabs.Screen
          name="verifier"
          options={{
            title: t('tabs.verifier'),
          }}
        />
      </Tabs>
    </VideoProvider>
  );
}
