/**
 * The voting flow's chrome, around ONE step, for the QA gallery.
 *
 * A copy of app/voting-flow.tsx's render (outer container with the bottom
 * safe-area inset, topSection measured for slideAreaHeight, the Android
 * top-inset spacer and title, the overflow-hidden slidingWrapper, the steps
 * 1-3 bottom nav, the iOS native header with "Fermer"). The carousel itself is
 * left out: the step is the only slide, at offset 0, which is what the voter
 * sees once the slide animation has settled.
 *
 * Kept in step with voting-flow.tsx by hand. If the flow's chrome changes, this
 * must change with it, or the gallery measures a layout the app no longer has.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Dimensions } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Svg, Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/constants/theme';
import { createModalStyles } from '@/components/voting-modal/styles';

export interface FlowDims {
  containerWidth: number;
  slideAreaHeight: number | undefined;
  /** The slide area as steps 4+ see it (voting-flow's stepSlideHeight): on
   *  Android without the status-bar spacer. */
  stepSlideHeight: number | undefined;
}

interface Props {
  /** The flow's step number (1 to 13); decides the title, the nav and step 4's
   *  flex. 0 = the document chooser, which has the title and no nav. */
  step: number;
  onClose: () => void;
  onNext?: () => void;
  children: (dims: FlowDims) => React.ReactNode;
}

export function FlowFrame({ step, onClose, onNext, children }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const modalStyles = createModalStyles(colors);
  const [containerWidth, setContainerWidth] = useState(Dimensions.get('window').width);
  const [slideAreaHeight, setSlideAreaHeight] = useState<number | undefined>(undefined);

  const closeButton = (
    <TouchableOpacity
      onPress={onClose}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={t('common.close')}
    >
      <Text allowFontScaling={false} style={{ fontSize: 17, color: colors.secondary }}>
        {t('common.close')}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.cardBackground, paddingBottom: insets.bottom }]}>
      {Platform.OS === 'ios' && (
        <Stack.Screen
          options={{
            title: step < 4 ? t('voting.title') : '',
            headerRight: () => closeButton,
          }}
        />
      )}
      <View
        style={[styles.topSection, { backgroundColor: colors.cardBackground }]}
        onLayout={(e) => setSlideAreaHeight(e.nativeEvent.layout.height)}
      >
        {Platform.OS !== 'ios' && <View style={{ height: insets.top, backgroundColor: colors.cardBackground }} />}
        {Platform.OS !== 'ios' && step < 4 && (
          <View style={modalStyles.titleSection}>
            <Text style={modalStyles.title}>{t('voting.title')}</Text>
          </View>
        )}
        <View
          style={[
            modalStyles.slidingWrapper,
            step < 4 && { backgroundColor: Platform.OS === 'ios' ? colors.cardBackground : colors.background },
            step === 4 && { flex: 1 },
          ]}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
          <View style={[modalStyles.slidingContainer, step === 4 && { flex: 1 }]}>
            {children({
              containerWidth,
              slideAreaHeight,
              stepSlideHeight:
                slideAreaHeight === undefined
                  ? undefined
                  : Platform.OS === 'ios'
                    ? slideAreaHeight
                    : Math.max(0, slideAreaHeight - insets.top),
            })}
          </View>
        </View>
      </View>
      <View
        style={
          step < 4 ? { backgroundColor: Platform.OS === 'ios' ? colors.cardBackground : colors.background } : undefined
        }
      >
        {step > 0 && step < 4 && (
          <View style={styles.navigationSection}>
            <View style={styles.progressSection}>
              <View style={[styles.progressBar, { backgroundColor: colors.secondary }]} />
              <View style={[styles.progressBar, { backgroundColor: colors.secondary, opacity: step >= 2 ? 1 : 0.25 }]} />
            </View>
            {/* Same element as the flow's arrow, with its accessibility
                label (QA 2.0.2, item 5). */}
            <TouchableOpacity
              style={[styles.arrowButton, { backgroundColor: colors.secondary }]}
              onPress={onNext}
              activeOpacity={0.7}
              testID="qa-flow-next"
              accessibilityRole="button"
              accessibilityLabel={t('common.next')}
            >
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path d="M9 18l6-6-6-6" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topSection: { flex: 1 },
  progressSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: Platform.select({ ios: 16 }),
  },
  progressBar: { flex: 1, height: 4, borderRadius: 2 },
  navigationSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 39,
  },
  arrowButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
