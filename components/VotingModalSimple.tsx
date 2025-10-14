import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import { Text, StyleSheet } from 'react-native';
import { BottomSheetModal, BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { Colors, Typography, Spacing } from '@/constants/theme';

interface VotingModalSimpleProps {
  isVisible: boolean;
  onClose: () => void;
}

const VotingModalSimple = ({ isVisible, onClose }: VotingModalSimpleProps) => {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['85%'], []);

  useEffect(() => {
    if (isVisible) {
      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [isVisible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
      />
    ),
    []
  );

  const handleDismiss = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      enablePanDownToClose={true}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.bottomSheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      onDismiss={handleDismiss}
    >
      <BottomSheetView style={styles.contentContainer}>
        <Text style={styles.title}>Processus de vote</Text>
        <Text style={styles.placeholder}>
          Testing modal - if you see this, it works!
        </Text>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

const styles = StyleSheet.create({
  bottomSheetBackground: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handleIndicator: {
    backgroundColor: Colors.border,
    width: 40,
    height: 4,
  },
  contentContainer: {
    flex: 1,
    padding: Spacing.voteCard.padding,
    gap: Spacing.voteCard.gap,
  },
  title: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: Colors.primary,
    textAlign: 'center',
  },
  placeholder: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: Colors.primary,
    textAlign: 'center',
    marginTop: 100,
  },
});

export default VotingModalSimple;