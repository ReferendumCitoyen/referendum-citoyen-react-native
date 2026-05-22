/**
 * Read-only Conditions Générales view, reached from Settings →
 * Conditions générales. Same content as the launch gate but without the
 * accept button — uses the standard Stack header for the back arrow.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useColors } from '@/constants/theme';
import TermsBody from '@/components/TermsBody';

export default function TermsView() {
  const colors = useColors();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <TermsBody />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
