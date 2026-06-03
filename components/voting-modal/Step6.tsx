import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Platform, Image, ScrollView, Alert, Linking, AppState } from 'react-native';
import NfcManager from 'react-native-nfc-manager';
import { VideoView } from 'expo-video';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';
import { getRandomValues } from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { useDevMode } from '@/contexts/DevModeContext';
import { loadDevExamplePassportData } from '@/utils/dev-example-passport';

// Dev shortcut: pretend the NFC scan succeeded by handing the parent the
// PassportData built from example-passport.json (gitignored). Loads at
// module scope so a missing fixture returns null once and the gated UI
// hides itself.
const DEV_EXAMPLE_PASSPORT_DATA = loadDevExamplePassportData();

interface Step6Props {
  containerWidth: number;
  player: any;
  mrzData?: {
    documentNumber: string;
    birthDate: string;
    expiryDate: string;
  } | null;
  onAnalyze?: () => void;
  onNFCSuccess?: (data: any) => void;
  onNFCError?: () => void;
  onGoBack?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** True = scan a TD3 passport (scanDocument 'P', Type B + BAC). False
   * = scan a TD1 ID card (scanDocument 'I', Type A + PACE). Driven by
   * the selected proposal's voting contract via voting-flow.tsx. */
  isPassportFlow?: boolean;
}

const Step6: React.FC<Step6Props> = ({ containerWidth, player, mrzData, onAnalyze, onNFCSuccess, onNFCError, onGoBack, onLayout, isPassportFlow = false }) => {
  const { t } = useTranslation();
  const docSfx = isPassportFlow ? 'passport' : 'idCard';
  const { devMode } = useDevMode();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [scanStep, setScanStep] = useState(0);
  const [showRetry, setShowRetry] = useState(false);
  // True when the heuristic below decides the user is holding a passport
  // instead of a French ID card (CNIe). The named state lets the UI render
  // a "please use your ID card" hint instead of a generic NFC error.
  const [passportDetected, setPassportDetected] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [nativeLogs, setNativeLogs] = useState<string[]>([]);

  // Android camera2 teardown (from Step 5) can take 2-3s and shares NFC-controller
  // resources on some SoCs. Track when Step 6 mounted so we can enforce a minimum
  // gap before the NFC scan starts — prevents "Tag was lost" on the first APDU.
  const mountedAtRef = useRef<number>(Date.now());
  useEffect(() => { mountedAtRef.current = Date.now(); }, []);

  // NFC-disabled auto-retry: when the user taps "Open NFC settings" in the
  // dialog we surface below, we arm this ref. The AppState listener fires
  // when the app foregrounds; if NFC is now on, it re-invokes the scan via
  // the ref'd handler (kept fresh each render to avoid stale-closure bugs).
  const retryAfterNfcRef = useRef(false);
  const handleAnalyzePressRef = useRef<() => void>(() => {});

  // Listen to EDocument scan events
  useEffect(() => {
    let listeners: any[] = [];

    const setupEventListeners = async () => {
      try {
        const { EDocumentModuleListener, EDocumentModuleEvents } = await import('@/modules/e-document');

        listeners = [
          EDocumentModuleListener(EDocumentModuleEvents.RequestPresentPassport, () => {
            setScanStatus(t(`voting.step6PresentCard_${docSfx}`));
            setScanStep(1);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.AuthenticatingWithPassport, () => {
            setScanStatus(t('voting.step6Authenticating'));
            setScanStep(2);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ReadingDataGroupProgress, () => {
            setScanStatus(t('voting.step6Reading'));
            setScanStep(3);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ActiveAuthentication, () => {
            setScanStatus(t('voting.step6ActiveAuth'));
            setScanStep(3);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.SuccessfulRead, () => {
            setScanStatus(t('voting.step6ReadSuccess'));
            setScanStep(4);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ScanError, () => {
            setScanStatus(t('voting.step6ReadError'));
          }),
          EDocumentModuleListener(EDocumentModuleEvents.DebugLog, (event: unknown) => {
            const { message } = event as { message: string };
            console.log('[Step6/Native]', message);
            setNativeLogs((prev) => [...prev.slice(-40), message]);
          }),
        ];
      } catch (_error) {
        // Event listeners not available
      }
    };

    setupEventListeners();

    return () => {
      listeners.forEach(listener => {
        try {
          listener.remove();
        } catch (error) {
          // Ignore cleanup errors
        }
      });
    };
  }, []);

  // Keep the ref pointed at the latest closure so the AppState listener below
  // doesn't capture a stale reference (props/state changes between mount and
  // the time the user returns from Settings).
  useEffect(() => {
    handleAnalyzePressRef.current = handleAnalyzePress;
  });

  // Auto-retry the scan when the user enables NFC and returns to the app.
  // Armed only after they tap "Open NFC settings" in the dialog above —
  // background → foreground without going through that path is a no-op.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = AppState.addEventListener('change', async (next) => {
      if (next !== 'active' || !retryAfterNfcRef.current) return;
      const enabled = await NfcManager.isEnabled().catch(() => false);
      if (!enabled) return;
      retryAfterNfcRef.current = false;
      // Small delay so the foreground transition completes before we start
      // touching the NFC controller again.
      setTimeout(() => { handleAnalyzePressRef.current(); }, 200);
    });
    return () => sub.remove();
  }, []);

  const handleAnalyzePress = async () => {
    // Operational only — no PII. mrzData contains documentNumber + DOB
    // which are the BAC key inputs; logging them would leak both to
    // logcat / Metro stdout.
    console.log('[Step6] handleAnalyzePress called, mrzData present:', !!mrzData);
    if (!mrzData) {
      setScanStatus(t('voting.step6MissingMrz'));
      return;
    }

    // Android-only: pre-check that NFC is enabled. The native scan path
    // throws IllegalStateException with a French-only message when it's off,
    // which surfaces as a cryptic Step6 error after the user already went
    // through MRZ + camera. Catching it here lets us guide them to the
    // system NFC toggle and auto-retry when they return.
    if (Platform.OS === 'android') {
      let isOff = false;
      try {
        await NfcManager.start();
        isOff = !(await NfcManager.isEnabled());
      } catch (e) {
        // Couldn't determine state (e.g., no NFC hardware) — let the native
        // module's own error path surface a clearer message downstream.
        console.warn('[Step6] NFC pre-check failed:', e);
      }
      if (isOff) {
        Alert.alert(
          t('voting.step6NfcDisabledTitle'),
          t('voting.step6NfcDisabledMessage'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('voting.step6OpenNfcSettings'),
              onPress: async () => {
                retryAfterNfcRef.current = true;
                try {
                  await Linking.sendIntent('android.settings.NFC_SETTINGS');
                } catch {
                  // Fallback: open the app's own settings page. The user can
                  // still navigate from there.
                  await Linking.openSettings();
                }
              },
            },
          ],
        );
        return;
      }
    }

    // Scan NFC on the same screen for both platforms
    try {
      setIsScanning(true);
      setPassportDetected(false);
      setScanStatus(t('voting.step6Init'));
      setNativeLogs([]);

      console.log('[Step6] Importing e-document module...');
      const eDocModule = await import('@/modules/e-document');
      const { scanDocument } = eDocModule;
      console.log('[Step6] scanDocument imported, type:', typeof scanDocument);

      // Generate random challenge for Active Authentication
      const challenge = getRandomValues(new Uint8Array(32));
      console.log('[Step6] Challenge generated, length:', challenge.length);

      // On Android, ensure at least 5s have elapsed since Step 6 mounted so the
      // camera2 session from Step 5 is fully torn down before NFC starts. On
      // some SoCs the NFC controller and camera DSP share resources; tapping
      // Analyze too quickly results in "Tag was lost" on the first APDU.
      if (Platform.OS === 'android') {
        const MIN_GAP_MS = 5000;
        const elapsed = Date.now() - mountedAtRef.current;
        const wait = Math.max(0, MIN_GAP_MS - elapsed);
        if (wait > 0) {
          setScanStatus(t('voting.step6Init'));
          await new Promise(resolve => setTimeout(resolve, wait));
        }
      }

      setScanStatus(t(`voting.step6Now_${docSfx}`));
      // BAC-key inputs (documentNumber, birthDate, expiryDate) intentionally
      // omitted — logging them would leak the user's doc number + DOB.
      console.log(`[Step6] Starting scanDocument type=${isPassportFlow ? 'P' : 'I'}`);

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('NFC scan timeout')), 30000);
      });

      // 'I' = TD1 ID card → PACE polling on Type A (skipPACE=false), the
      // protocol French CNIes use. 'P' = TD3 passport → Type B + BAC.
      // The doc type is driven by the selected proposal's voting contract
      // upstream (voting-flow.tsx → isPassportFlow prop).
      const scanPromise = scanDocument(isPassportFlow ? 'P' : 'I', {
        documentNumber: mrzData.documentNumber,
        dateOfBirth: mrzData.birthDate,
        dateOfExpiry: mrzData.expiryDate,
      }, challenge);

      // Clear the timeout as soon as the scan settles (success or error) so the
      // two outcomes can never be shown simultaneously.
      const result = await Promise.race([scanPromise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId);
      });
      console.log('[Step6] Scan result received, keys:', Object.keys(result as any));

      // Doc-type post-scan check. The NFC layer's wrong-doc heuristic above
      // catches the case where the chip rejects the wrong protocol (e.g.
      // PACE-IM error → ID card on passport flow). But if the chip *succeeds*
      // and returns a DG1 of the unexpected length — which happens when the
      // user manually entered an ID-card MRZ on a passport-only proposal, or
      // held the wrong document with valid MRZ — that heuristic doesn't fire.
      // Catch it here against the actual DG1 size: TD3 passport = 93 bytes,
      // TD1 ID card = 95 bytes. Without this gate the proof gets built off the
      // wrong DG1, then the relayer's gas estimate reverts ~30 s later with a
      // generic "Execution reverted" — confusing for the user and unrecoverable
      // because the identity is now bound to the wrong on-chain contract.
      // Fail closed unless DG1 is exactly the length expected for this flow.
      // This catches both the wrong-document case (e.g. an ID-card MRZ entered
      // for a passport-only proposal → dg1Len 95 instead of 93) AND a
      // missing/corrupt DG1 (len 0 or any other value). Either way, falling
      // through would build the proof off a bad DG1 and the relayer's gas
      // estimate reverts ~30 s later with a generic "Execution reverted".
      const dg1Len = (result as { dg1Bytes?: Uint8Array }).dg1Bytes?.length ?? 0;
      const expectedDg1Len = isPassportFlow ? 93 : 95;
      if (dg1Len !== expectedDg1Len) {
        const otherDocDg1Len = isPassportFlow ? 95 : 93;
        if (dg1Len === otherDocDg1Len) {
          // Genuine wrong-document swap (passport MRZ on an ID-card flow or vice
          // versa) → show the "wrong document" banner + restart-with-correct-doc.
          console.warn(
            `[Step6] doc-type mismatch: flow=${isPassportFlow ? 'passport' : 'idCard'} but chip dg1Len=${dg1Len}`,
          );
          setPassportDetected(true);
          setScanStatus('');
        } else {
          // Any other DG1 length (0 / missing / corrupt) is NOT a wrong-document
          // case — surface a generic read error and keep the normal retry CTA
          // (don't set passportDetected, which hides the analyze/retry button).
          console.warn(
            `[Step6] unexpected DG1 length: expected=${expectedDg1Len} got=${dg1Len}`,
          );
          setScanStatus(t('voting.step6ReadError'));
        }
        setIsScanning(false);
        setShowRetry(true);
        return;
      }

      setScanStatus(t('voting.step6ReadSuccess'));
      setIsScanning(false);
      setShowRetry(false);

      if (onNFCSuccess) {
        setTimeout(() => { onNFCSuccess(result); }, 500);
      }
    } catch (error: any) {
      console.error('[Step6] NFC scan error:', error);
      const errorDetails = JSON.stringify({ message: error.message, code: error.code, name: error.name, stack: error.stack?.substring(0, 300) });
      console.error('[Step6] Error details:', errorDetails);
      setDebugError(`${error.name || 'Error'}: ${error.message || 'unknown'}\n\nCode: ${error.code || 'none'}\n\nInfo: ${JSON.stringify(error.userInfo || error.nativeError || {})}\n\nStack: ${error.stack?.substring(0, 200) || 'none'}`);

      if (error.message === 'InvalidMRZKey' || error.code === 'InvalidMRZKey') {
        setScanStatus(t('voting.step6InvalidMrz'));
        setIsScanning(false);
        if (onGoBack) { setTimeout(() => { onGoBack(); }, 1500); }
        return;
      }

      // Detect that the user held the *wrong* doc type for this flow.
      // The error-text signals from the native module differ per flow:
      //
      // ID-card flow (expecting CNIe, user held passport):
      //   - "iso14443B" / "Type B": passports are Type B; CNIe scan polls
      //     Type A only.
      //   - "no PACE" / "pace not supported": passports usually only do
      //     BAC, no PACE.
      //   - "passport" / "passeport" in the translated error text.
      //   - "BAC" mentioned during a CNIe-mode scan but not "carte".
      //
      // Passport flow (expecting passport, user held CNIe):
      //   - "step2im" / "pace-im": PACE-IM is unambiguously an ID card
      //     protocol; passports don't speak it.
      //   - "carte d'identité" in the translated error text.
      //   - "6982" / "security status not satisfied" on a skipPACE=true
      //     scan: chip required PACE before BAC — characteristic of CNIe.
      const errLower = (error.message || '').toLowerCase();
      const wrongDocDetected = isPassportFlow
        ? (
            errLower.includes('step2im') ||
            errLower.includes('pace-im') ||
            errLower.includes('im not yet') ||
            errLower.includes("carte d'identit") ||
            errLower.includes('pace non support') ||
            ((errLower.includes('6982') || errLower.includes('security status')) &&
              !errLower.includes('passeport'))
          )
        : (
            errLower.includes('iso14443b') ||
            errLower.includes('type b') ||
            errLower.includes('passport') ||
            errLower.includes('passeport') ||
            errLower.includes('no pace') ||
            errLower.includes('pace not supported') ||
            (errLower.includes('bac') && !errLower.includes("carte"))
          );

      if (wrongDocDetected) {
        setPassportDetected(true);
        setScanStatus('');
        setIsScanning(false);
        setShowRetry(true);
        return;
      }

      setScanStatus(
        t('voting.step6ErrorWithMessage', {
          message: error.message || error.code || t('voting.step6ReadError'),
        })
      );
      setIsScanning(false);
      setShowRetry(true);
    }
  };

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step6Container}>
        <Text style={stepSpecificStyles.step6Title}>{t(`voting.step6Title_${docSfx}`)}</Text>

        <View style={stepSpecificStyles.step6ImageContainer}>
          {Platform.OS === 'android' ? (
            <Image
              // poster-phone-over-passport.png is currently a placeholder
              // copy of poster-phone-over-card.png — replace with passport-
              // themed art before production.
              source={isPassportFlow
                ? require('@/assets/images/poster-phone-over-passport.png')
                : require('@/assets/images/poster-phone-over-card.png')}
              style={stepSpecificStyles.step6Image}
              resizeMode="contain"
            />
          ) : (
            <VideoView
              style={stepSpecificStyles.step6Image}
              player={player}
              contentFit="contain"
              nativeControls={false}
              surfaceType="textureView"
            />
          )}
        </View>

        <Text style={{
          textAlign: 'center',
          marginTop: 12,
          marginBottom: 4,
          marginHorizontal: 16,
          fontSize: 14,
          color: colors.textSecondary || colors.text,
          opacity: 0.7,
        }}>
          {t(`voting.step6Instruction_${docSfx}`)}
        </Text>

        {passportDetected && (
          <View style={{
            backgroundColor: '#FEF3C7',
            borderRadius: 10,
            padding: 14,
            marginHorizontal: 16,
            borderLeftWidth: 4,
            borderLeftColor: '#F59E0B',
          }}>
            <Text style={{
              fontFamily: Typography.fontFamily.semibold,
              fontSize: 14,
              color: '#92400E',
              textAlign: 'center',
              marginBottom: 4,
            }}>
              {t(isPassportFlow ? 'voting.step6IdCardDetected' : 'voting.step6PassportDetected')}
            </Text>
            <Text style={{
              fontFamily: Typography.fontFamily.medium,
              fontSize: 13,
              color: '#92400E',
              textAlign: 'center',
              lineHeight: 18,
            }}>
              {t(isPassportFlow ? 'voting.step6UsePassportInstead' : 'voting.step6UseIdCardInstead')}
            </Text>
            {onGoBack && (
              <TouchableOpacity
                style={{
                  marginTop: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor: '#92400E',
                  alignItems: 'center',
                }}
                activeOpacity={0.8}
                onPress={() => {
                  setPassportDetected(false);
                  setShowRetry(false);
                  setScanStatus('');
                  onGoBack();
                }}
              >
                <Text style={{
                  fontFamily: Typography.fontFamily.semibold,
                  fontSize: 14,
                  color: '#FFFFFF',
                }}>
                  {t('voting.step6RestartWithCorrectDoc')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {scanStatus && (
          <Text style={{
            textAlign: 'center',
            marginVertical: 8,
            fontSize: 14,
            color: scanStatus.includes('❌') ? colors.errorText : scanStatus.includes('✅') ? colors.successText : colors.text
          }}>
            {scanStatus}
          </Text>
        )}

        {isScanning && (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
            {[1, 2, 3, 4].map((step) => (
              <View
                key={step}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: scanStep >= step ? colors.successText : colors.border,
                }}
              />
            ))}
          </View>
        )}

        {devMode && debugError && (
          <View style={{
            backgroundColor: colors.errorBackground,
            borderRadius: 8,
            padding: 10,
            marginHorizontal: 16,
            marginBottom: 8,
          }}>
            <Text selectable style={{
              fontFamily: Typography.fontFamily.mono,
              fontSize: 10,
              color: colors.errorText,
            }}>
              {debugError}
            </Text>
          </View>
        )}

        {devMode && nativeLogs.length > 0 && (
          <View style={{
            backgroundColor: colors.errorBackground,
            borderRadius: 8,
            padding: 10,
            marginHorizontal: 16,
            marginBottom: 8,
            maxHeight: 180,
          }}>
            <ScrollView>
              <Text selectable style={{
                fontFamily: Typography.fontFamily.mono,
                fontSize: 10,
                color: colors.errorText,
              }}>
                {nativeLogs.join('\n')}
              </Text>
            </ScrollView>
          </View>
        )}

        <View style={stepSpecificStyles.step6ButtonContainer}>
          {/* Hide the analyze/retry button when a doc-type mismatch is
              detected — retrying the NFC scan with the same MRZ would just
              hit InvalidMRZKey or re-scan the same wrong chip. The only
              valid action is the "Recommencer avec le bon document" button
              inside the warning banner above, which routes back to MRZ
              entry so the user can input the proper data for the right
              document type. */}
          {!passportDetected && (
            <TouchableOpacity
              style={[stepSpecificStyles.step6Button, isScanning && { opacity: 0.5 }]}
              activeOpacity={0.8}
              onPress={() => { setShowRetry(false); setPassportDetected(false); setDebugError(null); setScanStep(0); setScanStatus(''); handleAnalyzePress(); }}
              disabled={isScanning}
            >
              <Text style={stepSpecificStyles.step6ButtonText}>
                {isScanning ? t('voting.step6Scanning') : showRetry ? t('common.retry') : t('common.analyze')}
              </Text>
            </TouchableOpacity>
          )}
          {devMode && DEV_EXAMPLE_PASSPORT_DATA && !isScanning && (
            <TouchableOpacity
              style={{
                marginTop: 12,
                paddingVertical: 14,
                borderRadius: 8,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: colors.errorText,
              }}
              activeOpacity={0.8}
              onPress={() => onNFCSuccess?.(DEV_EXAMPLE_PASSPORT_DATA)}
            >
              <Text style={{
                fontSize: 14,
                fontWeight: '600',
                color: colors.errorText,
              }}>
                Dev : skip NFC (use example passport) →
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};

export default Step6;
