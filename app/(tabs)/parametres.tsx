import React, { useState } from 'react';
import { StyleSheet, ScrollView, View, Text, Switch, TouchableOpacity } from 'react-native';
import { Colors, Typography, Spacing } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';

const CaretRightIcon = ({ color, size = 24 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M9 6L15 12L9 18"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export default function ParametresScreen() {
  const [darkModeEnabled, setDarkModeEnabled] = useState(false);

  return (
    <View style={styles.screenContainer}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
        {/* Header Section */}
        <View style={styles.headerSection}>
          <Text style={styles.headerTitle}>Paramètres</Text>
        </View>

        {/* Settings Container */}
        <View style={styles.settingsContainer}>
          {/* Dark Mode Row */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Dark Mode</Text>
            <Switch
              value={darkModeEnabled}
              onValueChange={setDarkModeEnabled}
              trackColor={{ false: Colors.switchGray, true: Colors.secondary }}
              thumbColor={Colors.white}
              ios_backgroundColor={Colors.switchGray}
            />
          </View>

          {/* Langue Row */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Langue</Text>
            <TouchableOpacity style={styles.settingValueContainer} activeOpacity={0.7}>
              <Text style={styles.settingValue}>Français</Text>
              <CaretRightIcon color={Colors.secondary} size={Spacing.icon.size} />
            </TouchableOpacity>
          </View>

          {/* RPC Row */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>RPC</Text>
            <TouchableOpacity style={styles.settingValueContainer} activeOpacity={0.7}>
              <Text style={styles.settingValue}>Selectioner</Text>
              <CaretRightIcon color={Colors.secondary} size={Spacing.icon.size} />
            </TouchableOpacity>
          </View>

          {/* Smart Contract Row */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Smart Contract</Text>
            <TouchableOpacity style={styles.settingValueContainer} activeOpacity={0.7}>
              <Text style={styles.settingValue}>Selectioner</Text>
              <CaretRightIcon color={Colors.secondary} size={Spacing.icon.size} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Empty spacer for tab bar */}
        <View style={styles.tabBarSpacer} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: Spacing.tabBar.containerHeight,
  },
  headerSection: {
    backgroundColor: Colors.white,
    paddingTop: Spacing.screen.top,
    paddingHorizontal: Spacing.screen.horizontal,
    paddingBottom: Spacing.settingRow.paddingVertical,
  },
  headerTitle: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: Colors.primary,
  },
  settingsContainer: {
    gap: Spacing.settingRow.gap,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.settingRow.paddingVertical,
    paddingHorizontal: Spacing.settingRow.paddingHorizontal,
    backgroundColor: Colors.white,
  },
  settingLabel: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.semibold,
    fontSize: Typography.fontSize.settingRow,
    lineHeight: Typography.lineHeight.settingRow,
    letterSpacing: Typography.letterSpacing.settingRow,
    color: Colors.primary,
    flex: 1,
  },
  settingValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.settingRow.valueGap,
  },
  settingValue: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: Colors.primary,
  },
  tabBarSpacer: {
    height: Spacing.tabBar.containerHeight,
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
  },
});
