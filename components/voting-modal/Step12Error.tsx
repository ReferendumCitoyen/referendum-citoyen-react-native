import React from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, ScrollView } from 'react-native';
import LottieView from 'lottie-react-native';
import { createStepSpecificStyles, slideBoxStyle, slideFooterStyle, slideScrollContent, useScrollOverflow } from './styles';
import { Spacing } from '@/constants/theme';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import { ErrorReportButton } from '@/components/ErrorReportButton';
import { isServiceUnavailableError } from '@/utils/relayer-errors';

interface Step12ErrorProps {
  containerWidth: number;
  onGoHome?: () => void;
  /** Re-run step 11 only. Undefined when the failure is final for this
   *  document (already voted, proposal closed): the vote-error table decides
   *  (utils/vote-error-table.ts). */
  onRetry?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  errorReason?: string | null;
  isPassportFlow?: boolean;
  error?: unknown;
  /** From the vote-error table (utils/vote-error-table.ts): false hides the
   *  report button for an expected refusal (minor, already voted, other key,
   *  closed question), true shows it even for a transport-looking error the
   *  generic filter would hide. Undefined keeps the generic behaviour. */
  reportable?: boolean;
  /** Measured slide area (voting-flow): bounds the slide so it scrolls. */
  slideAreaHeight?: number;
}

// The slide is bounded by the measured slide area and everything, buttons
// last, sits in one ScrollView (QA 2.0.2, item 1): on a 320 x 568 iPhone the
// error text of 25 codes out of 32 pushed "Retour à l'écran d'accueil", the
// only way out on Android, below the screen with nothing to scroll.
const Step12Error: React.FC<Step12ErrorProps> = ({ containerWidth, onGoHome, onRetry, onLayout, errorReason, error, isPassportFlow = false, reportable, slideAreaHeight }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  // Once the error text is long enough (or the text is scaled up) the slide
  // no longer centres: it stacks from the top, so the title stays reachable.
  const scroll = useScrollOverflow();
  return (
    <View style={[{ width: containerWidth }, slideBoxStyle(slideAreaHeight)]} onLayout={onLayout}>
      <ScrollView
        style={{ flex: 1, width: '100%' }}
        contentContainerStyle={slideScrollContent(stepSpecificStyles.step12ErrorContainer, {
          overflowing: scroll.overflowing,
        })}
        onLayout={scroll.onLayout}
        onContentSizeChange={scroll.onContentSizeChange}
        bounces={false}
      >
        <View style={stepSpecificStyles.step12ErrorContent}>
          <Text style={stepSpecificStyles.step12ErrorTitle}>
            {t('voting.step12ErrorTitle')}
          </Text>

          <Text style={stepSpecificStyles.step12ErrorDescription}>
            {errorReason || t('voting.step12ErrorDescription')}
          </Text>

          <LottieView
            source={require('@/assets/animations/error.json')}
            // Once the text overflows the slide (long reason, or text size
            // 1.3 on a small phone) the picture is what the reader can
            // spare: it shrinks so the message needs less scrolling.
            style={[
              stepSpecificStyles.step12ErrorAnimation,
              scroll.overflowing ? { width: 88, height: 88 } : null,
            ]}
            autoPlay
            loop={false}
          />

        </View>

      </ScrollView>

      {/* The actions sit in a fixed footer, outside the scroll (2026-09-24):
          on an iPhone SE at text size 1.3 both buttons were below the fold,
          reachable only by scrolling, on an error screen. The text above
          scrolls; the way out never moves. */}
      <View style={[slideFooterStyle(colors, Spacing.modal.step12ErrorPadding), { gap: 12 }]}>
        {/* The report button too (2026-09-25): on a 360 x 640 screen at text
            size 1.3 it was below the fold of the scrolling body, and a report
            is what the team needs most from a failed vote. */}
        {error != null && reportable !== false && (
          <ErrorReportButton
            error={error}
            // Same reasoning as Step 7: a vote-relayer / RPC outage surfaces
            // through the transport strings isExpectedError suppresses, and a
            // vote failure is exactly what we need reported — force the button
            // for a service failure so it is never silently eaten. The error
            // table's verdict, when there is one, wins.
            forceShow={reportable === true || isServiceUnavailableError(error)}
            // docType matters here: TD1 and TD3 take entirely different vote
            // paths (see Step11's routing comment), so a vote failure is
            // ambiguous without it.
            context={{ step: 12, reason: errorReason ?? null, docType: isPassportFlow ? 'passport' : 'idCard' }}
          />
        )}
        {/* A failed vote does not cost the registration: the identity is on
            chain and the document is read. Re-running step 11 regenerates the
            proof against the current registration root, which is exactly what
            makes the second attempt succeed when the first lost the race to a
            registration mined mid-proof. Sending the user back to the start to
            scan the card again was asking for five minutes they did not owe. */}
        {onRetry && (
          <TouchableOpacity
            style={stepSpecificStyles.step12ErrorButton}
            activeOpacity={0.8}
            onPress={onRetry}
          >
            <Text style={stepSpecificStyles.step12ErrorButtonText}>{t('voting.step12ErrorRetry')}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[
            stepSpecificStyles.step12ErrorButton,
            // With a retry above it, "back to home" becomes the quieter of the
            // two — same box, no fill — so the primary action is unambiguous.
            onRetry ? { backgroundColor: 'transparent' } : null,
          ]}
          activeOpacity={0.8}
          onPress={onGoHome || (() => console.log('Go home'))}
        >
          <Text
            style={[
              stepSpecificStyles.step12ErrorButtonText,
              onRetry ? { color: colors.secondary } : null,
            ]}
          >
            {t('common.backToHome')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step12Error;
