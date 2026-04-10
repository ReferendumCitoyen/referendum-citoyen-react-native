import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ComprendreIcon from './icons/ComprendreIcon';
import AccueilIcon from './icons/AccueilIcon';
import VerifierIcon from './icons/VerifierIcon';
import { useColors, Typography, Spacing, Shadows } from '@/constants/theme';

const iconMap: { [key: string]: React.ComponentType<{ color: string; size?: number }> } = {
  comprendre: ComprendreIcon,
  index: AccueilIcon,
  verifier: VerifierIcon,
};

const labelKeyMap: { [key: string]: string } = {
  comprendre: 'tabs.comprendre',
  index: 'tabs.accueil',
  verifier: 'tabs.verifier',
};

export default function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[
          styles.gradient,
          {
            paddingTop: Platform.OS === 'ios' ? Spacing.tabBar.bottomPaddingIOS : Spacing.tabBar.bottomPaddingAndroid,
            paddingBottom: (Platform.OS === 'ios' ? Spacing.tabBar.bottomPaddingIOS : Spacing.tabBar.bottomPaddingAndroid) + insets.bottom
          }
        ]}
      >
        <View style={styles.tabBarContainer}>
          {state.routes.map((route, index) => {
            const isFocused = state.index === index;
            const Icon = iconMap[route.name];
            const labelKey = labelKeyMap[route.name];
            const label = t(labelKey);

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                onPress={onPress}
                style={[styles.tabItem, isFocused && styles.tabItemActive]}
              >
                <View style={styles.tabContent}>
                  {Icon && (
                    <Icon
                      color={isFocused ? colors.buttonText : colors.icon}
                      size={Spacing.icon.size}
                    />
                  )}
                  <Text
                    style={[
                      styles.tabLabel,
                      isFocused && styles.tabLabelActive,
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </LinearGradient>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: Spacing.tabBar.containerHeight,
  },
  gradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.tabBar.horizontalPadding,
  },
  tabBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: Spacing.tabBar.borderRadius,
    height: Spacing.tabBar.height,
    paddingHorizontal: Spacing.tabBar.innerPadding,
    paddingVertical: Spacing.tabBar.innerPadding,
    ...Shadows.tabBar,
    width: '100%',
    maxWidth: Spacing.tabBar.maxWidth,
  },
  tabItem: {
    flex: 1,
    height: Spacing.tabBar.itemHeight,
    borderRadius: Spacing.tabBar.itemBorderRadius,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  tabItemActive: {
    backgroundColor: colors.primary,
  },
  tabContent: {
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.icon.labelGap,
  },
  tabLabel: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Platform.OS === 'android' ? 13 : Typography.fontSize.tabLabel,
    lineHeight: Typography.lineHeight.tabLabel,
    letterSpacing: Typography.letterSpacing.tabLabel,
    color: colors.icon,
    textAlign: 'center',
    ...(Platform.OS === 'android' && { includeFontPadding: false }),
  },
  tabLabelActive: {
    color: colors.buttonText,
  },
});
