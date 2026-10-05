import React from 'react';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import CustomTabBar from '@/components/CustomTabBar';
import { VideoProvider } from '@/contexts/VideoContext';

// Land on Comprendre rather than the Votes list. Expo Router otherwise picks
// the `index` route for a directory, so this has to be stated explicitly.
//
// Note this only takes effect once someone is past the CGU gate: that gate is
// on the whole app (app/_layout.tsx), not on a tab, so until the terms are
// accepted there is no tab navigator at all.
export const unstable_settings = {
  initialRouteName: 'comprendre',
};

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
        <Tabs.Screen
          name="contribuer"
          options={{
            title: t('tabs.contribuer'),
          }}
        />
      </Tabs>
    </VideoProvider>
  );
}
