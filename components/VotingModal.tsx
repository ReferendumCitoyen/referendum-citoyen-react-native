import React, { useCallback, useMemo, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text, StyleSheet } from 'react-native';
import { BottomSheetModal, BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { Colors, Typography, Spacing } from '@/constants/theme';

export interface VotingModalRef {
  present: () => void;
  dismiss: () => void;
}

const VotingModal = forwardRef<VotingModalRef>((props, ref) => {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['85%'], []);

  useImperativeHandle(ref, () => ({
    present: () => {
      console.log('Present called, bottomSheetRef:', bottomSheetRef.current);
      bottomSheetRef.current?.present();
    },
    dismiss: () => {
      console.log('Dismiss called');
      bottomSheetRef.current?.dismiss();
    },
  }));

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

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      enablePanDownToClose={true}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.bottomSheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.contentContainer}>
        <Text style={styles.title}>Processus de vote</Text>
        <Text style={styles.placeholder}>
          Placeholder content - carousel and steps will go here
        </Text>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

VotingModal.displayName = 'VotingModal';

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

export default VotingModal;
