import React, { useState, useEffect, useRef } from 'react';
import { View, Text, LayoutChangeEvent, Platform, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { VideoView } from 'expo-video';
import { createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';
import { withRetry, formatRpcError, type Network } from '@/constants/rarime-config';
import type { Rarime, RarimePassport, FreedomTool } from '@rarimo/rarime-rn-sdk';
import { useTranslation } from 'react-i18next';
import {
  registerIdentityViaNoir,
  generateHeavyNoirProof,
  type HeavyNoirProof,
} from '@/utils/register-via-noir';
import { EPassport } from '@/utils/e-document/e-document';

interface NFCPersonDetails {
  firstName?: string;
  lastName?: string;
  // Note: modules/e-document/index.ts renames Android's native
  // `dateOfBirth` / `dateOfExpiry` to `birthDate` / `expiryDate` in the
  // normalized PassportData payload, so we read the renamed names here.
  // Reading dateOfBirth instead would always be undefined → 'N/A'.
  birthDate?: string;
  expiryDate?: string;
  nationality?: string;
  documentNumber?: string;
}

// MRZ date is YYMMDD. ICAO 9303 century rule: YY >= 50 → 19xx, else 20xx.
// Returns French JJ/MM/AAAA, or 'N/A' for missing/malformed input.
function formatMrzDateFr(yymmdd?: string | null): string {
  if (!yymmdd || yymmdd.length !== 6 || !/^\d{6}$/.test(yymmdd)) return 'N/A';
  const yy = yymmdd.slice(0, 2);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const century = parseInt(yy, 10) >= 50 ? '19' : '20';
  return `${dd}/${mm}/${century}${yy}`;
}

interface NFCData {
  personDetails?: NFCPersonDetails;
  dg1Bytes?: Uint8Array | string;
  sodBytes?: Uint8Array | string;
  dg15Bytes?: Uint8Array | string;
  aaSignature?: Uint8Array | string;
}

interface Step7Props {
  containerWidth: number;
  player: any;
  isActive?: boolean;
  nfcData?: NFCData | null;
  onSuccess?: () => void;
  /** Called when Step 7 hits a verification error. `fatal=true` means
   * the user cannot recover by retrying — typically a [VOTE_INELIGIBLE]
   * condition like "passport already registered with another key". The
   * parent should NOT auto-advance to the vote screen in that case;
   * leave the user on Step 7 so they can read the actual message
   * (rendered via `errorMessage` in this component). */
  onError?: (message?: string, fatal?: boolean, error?: unknown) => void;
  onFatalError?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  rarime?: Rarime;
  passport?: RarimePassport;
  freedomTool?: FreedomTool;
  /** Selected network from the global NetworkContext. Routes the registration
   * flow: 'mainnet' uses registerViaNoir + heavy circuit + registration-relayer
   * (the proven path from the user's own rarime-app tx at block 2330);
   * 'testnet' falls back to the SDK's light register path (Q-testnet, still
   * broken for TD3 but kept around as a smoke test for the rest of the flow). */
  network?: Network;
}

const Step7: React.FC<Step7Props> = ({
  containerWidth,
  player,
  isActive,
  nfcData,
  onSuccess,
  onError,
  onFatalError,
  onLayout,
  rarime,
  passport,
  freedomTool,
  network = 'testnet',
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [statusText, setStatusText] = useState(t('voting.step7Verifying'));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasCalledCallback = useRef(false);
  const isVerifying = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (isActive && !hasStarted) {
      setHasStarted(true);
      hasCalledCallback.current = false;
      isVerifying.current = false;
      setStatusText(t('voting.step7Verifying'));
      setErrorMessage(null);
    } else if (!isActive && hasStarted) {
      // Do NOT reset hasCalledCallback / isVerifying here. Both effects
      // share `hasStarted` in their deps, so when isActive flips true→false
      // immediately after onSuccess, this effect runs first and clears the
      // refs synchronously, but `setHasStarted(false)` is async. In the same
      // commit, the verification effect then runs with state hasStarted=true
      // and refs both false — and re-fires the whole register-identity flow.
      // The on-chain signature has already been consumed, so the duplicate
      // call fails with "signature used" and bumps the user back to vote
      // selection. Refs get re-cleared on a fresh activation below.
      setHasStarted(false);
    }
  }, [isActive, hasStarted]);

  // Fallback: if rarime/passport genuinely never arrive (init threw), don't
  // wait forever — surface a real error after a generous timeout.
  useEffect(() => {
    if (!hasStarted || hasCalledCallback.current) return;
    if (rarime && passport) return;
    const timer = setTimeout(() => {
      if (hasCalledCallback.current) return;
      if (rarime && passport) return;
      hasCalledCallback.current = true;
      setErrorMessage(t('voting.step7MissingData'));
      onError?.();
    }, 15000);
    return () => clearTimeout(timer);
  }, [hasStarted, rarime, passport, onError, t]);

  useEffect(() => {
    if (!hasStarted || hasCalledCallback.current || isVerifying.current) return;

    // rarime + passport are populated asynchronously in voting-flow's init
    // effect (SDK import + Rarime native warmup). On the first pass they're
    // still undefined — wait rather than bailing. The effect re-runs when
    // they become defined. A separate timeout below surfaces a real error
    // if init genuinely fails.
    if (!rarime || !passport) return;

    isVerifying.current = true;
    (async () => {
      try {
        // Step 1: Check document registration status
        const mrzInfo = passport.getMRZData();
        // No docNo / birthDate — both are PII (and the doc-num is also half of the BAC key).
        console.log(`[Step7] MRZ loaded — nationality: ${mrzInfo.issuingCountry}`);
        console.log(`[Step7] DG1 length: ${passport.dataGroup1.length} (95=TD1 ID card, 93=TD3 passport)`);
        console.log(`[Step7] SOD length: ${passport.sod.length} bytes; DG15 present: ${passport.dataGroup15 ? `yes (${passport.dataGroup15.length}B)` : 'no'}`);
        try {
          const sodHashOid = passport.extractDGHashAlgo();
          const sodSigOid = passport.getSignatureAlgorithm();
          console.log(`[Step7] SOD DG hash OID: ${sodHashOid}, signature OID: ${sodSigOid}`);
        } catch (e: any) {
          console.error('[Step7] SOD algo extraction failed:', e?.message ?? e);
        }
        setStatusText(t('voting.step7CheckingStatus'));
        const status = await withRetry(
          () => rarime.getDocumentStatus(passport),
          { label: 'getDocumentStatus' }
        );
        console.log('[Step7] Document status:', status);

        // Phase A.1 bail-out probe: for TD3 passports, log the resolved
        // registerIdentity_<suite> name before the lite-register attempt
        // (which currently fails server-side because no TD3 lite verifier
        // is deployed). The logged name is what we'd download from
        // https://storage.googleapis.com/.../passport-zk-circuits-noir/v0.1.x/<name>.json
        // and pass to the heavy-register flow once Phase A.2-A.4 lands.
        // If this throws or the name is not in iOS/Android RariMe's published
        // variant table, Option A is dead for this passport.
        if (passport.dataGroup1.length === 93) {
          try {
            const { name, suite } = (passport as any).extractCircuitSuite();
            console.log(`[Step7][PhaseA.1] TD3 suite resolved: ${name}`);
            console.log(`[Step7][PhaseA.1] suite details: sigId=${suite.signatureType.staticId} hash=${suite.passportHashType} doc=${suite.documentType} ec=${suite.ecChunkNumber} ecPos=${suite.ecDigestPosition} dg1Pos=${suite.dg1DigestPositionShift} aa=${suite.aaType ? 'present' : 'NA'}`);
          } catch (probeErr: any) {
            console.error(`[Step7][PhaseA.1] suite resolver failed: ${probeErr?.message || probeErr}`);
          }
        }

        // ----------------------------------------------------------------
        // Step 2: register identity. Routing matrix is by *document type*,
        // not just network — confirmed with the Rarimo team 2026-05-21:
        // ID cards (TD1) always go through `/registerid` on the light
        // registrator on BOTH testnet and mainnet, because Rarimo never
        // built a heavy TD1 register circuit (their `passport-zk-circuits-
        // noir` repo only has `register_identity` for TD3 and
        // `register_identity_light_td1`). The heavy path is passport-only.
        //
        //   TD3 (dg1=93) + mainnet → heavy Noir circuit
        //                            (`registerIdentity_<suite>`). Proves
        //                            the slave-cert chain in-zk, we ABI-
        //                            encode `Registration2.registerViaNoir`
        //                            and POST calldata to the registration
        //                            relayer. Independently verified at
        //                            Mainnet block 2330 (2144-byte proof
        //                            shape, P_NO_AA + Z_NOIR_PASSPORT_*
        //                            keccaks match). See utils/register-
        //                            via-noir.ts.
        //
        //   everything else        → SDK's `rarime.registerIdentity()`
        //                            light flow → /registerid (TD1) or
        //                            /register (TD3 testnet). Base URL is
        //                            network-specific so the same call
        //                            covers both networks.
        //
        // Either path is a no-op when the passport is already
        // RegisteredWithThisPk — the SDK's getDocumentStatus comparison is
        // against the on-chain `activeIdentity` for the current BJJ key.
        // ----------------------------------------------------------------
        const { DocumentStatus } = await import('@rarimo/rarime-rn-sdk');

        // Hard stop: passport is on-chain but bound to a DIFFERENT BJJ key.
        // Re-binding would need a revocation proof signed by the original
        // private key (which we don't have on this device). The relayer
        // returns HTTP 500 if we try to register-via-noir over it — so
        // bail out early with a clear French message instead of burning
        // 40 s on a proof gen that will fail.
        //
        // Common cause: this passport was previously scanned in
        // inid-passport-debug, the rarime-app, or here BEFORE the
        // per-passport-key DB landed (when one legacy key covered all
        // passports). Step11's error handler recognizes the
        // [VOTE_INELIGIBLE] prefix and surfaces this message verbatim.
        if (status === DocumentStatus.RegisteredWithOtherPk) {
          throw new Error(
            '[VOTE_INELIGIBLE] ' +
              t('voting.errors.passportAlreadyBoundOtherKey', {
                defaultValue:
                  "Ce passeport est déjà enregistré sur Mainnet avec une autre clé privée. Pour voter avec ce passeport, restaurez la clé d'origine via Paramètres → Gestion des clés → Restaurer une clé.",
              }),
          );
        }

        const needsRegistration = status === DocumentStatus.NotRegistered;

        if (needsRegistration) {
          console.log(`[Step7] registering identity (status=${status}, network=${network})`);
          setStatusText(t('voting.step7Registering'));

          if (!nfcData?.dg1Bytes || !nfcData?.sodBytes) {
            throw new Error('Step7: nfcData missing dg1/sod bytes');
          }

          const isTd3 = passport.dataGroup1.length === 93;
          if (network === 'mainnet' && isTd3) {
            // ----- HEAVY NOIR PATH (TD3 mainnet only) -----------------
            // Confirmed 2026-05-18 (probe logs): light-registrator is
            // broken for TD3 on both networks (HTTP 400 identical), so
            // the heavy circuit is the only viable path on Mainnet.
            // The rarime-app's own successful tx at block 2330 used
            // this exact flow.
            //
            // Pipeline (all in utils/register-via-noir.ts):
            //   1. generateHeavyNoirProof — SMT lookup on Mainnet's
            //      CertificatesSMT (0xA8b350d6…) + Noir prove() against
            //      the bundled registerIdentity_1_256_3_5_576_248_NA
            //      bytecode (3 MB asset, registered at boot). ~20 s on
            //      the Volla Phone X23.
            //   2. registerIdentityViaNoir — ABI-encode registerViaNoir
            //      against Registration2 (0x11BB4B14AA…) + POST to the
            //      registration-relayer at api.app.rarime.com.
            //
            // The relayer submits the tx and returns the hash; we log
            // it for the user to verify on scan.rarimo.com.
            //
            // The skIdentity (BJJ private key) comes from SecureStore
            // via getOrCreatePrivateKey() — same source the SDK uses for
            // its light path, so the on-chain `identityKey` is bound to
            // the user's stable identity across registration + voting.
            const { getOrCreatePrivateKey } = await import('@/utils/identity');
            const skIdentityHex = '0x' + (await getOrCreatePrivateKey());

            // Build an EPassport from the NFC scan bytes — needed by the
            // input builder because RarimePassport doesn't expose the
            // ASN.1-parsed slave certificate (e-document does).
            const eDoc = new EPassport({
              docCode: 'P',
              personDetails: nfcData?.personDetails ?? ({} as any),
              dg1Bytes: new Uint8Array(nfcData!.dg1Bytes as Uint8Array),
              sodBytes: new Uint8Array(nfcData!.sodBytes as Uint8Array),
              dg15Bytes: nfcData?.dg15Bytes
                ? new Uint8Array(nfcData.dg15Bytes as Uint8Array)
                : undefined,
              aaSignature: nfcData?.aaSignature
                ? new Uint8Array(nfcData.aaSignature as Uint8Array)
                : undefined,
            });

            // Generate the heavy register proof. If the slave-cert SMT
            // lookup inside fails (existence=false) it means the CSCA
            // isn't on chain yet — catch that specific error, bootstrap
            // the CSCA via `Registration2.registerCertificate(...)`,
            // wait for the tx to confirm, then re-try the proof gen.
            // This is what `inid-passport-debug` does in
            // `passport-debug/index.tsx::register` (`registerCertificate
            // -> registerByDocument`) — same relayer endpoint, same
            // master tree, same dispatcher hashes. See
            // utils/csca-bootstrap.ts for the full pipeline.
            let heavyProof;
            try {
              heavyProof = await generateHeavyNoirProof(eDoc, skIdentityHex);
            } catch (e: any) {
              const msg = e?.message ?? '';
              // Match by `[CSCA_MISSING]` sentinel, not the French body —
              // the body is localised so a substring match would break in en.
              const isMissingCsca = msg.startsWith('[CSCA_MISSING]');
              if (!isMissingCsca) throw e;

              console.log('[Step7][mainnet] CSCA missing — bootstrapping via registerCertificate');
              setStatusText(t('voting.step7Registering'));
              const { registerCscaForSlave } = await import('@/utils/csca-bootstrap');
              const { txHash: cscaTxHash, dispatcherName } =
                await registerCscaForSlave(eDoc.sod.slaveCertificate);
              console.log(`[Step7][mainnet] CSCA registration tx: ${cscaTxHash} (${dispatcherName})`);

              // Wait for the slave-cert SMT to reflect the new CSCA.
              // We don't track the tx state directly (the relayer didn't
              // return a JSON-RPC tx, just a hash). Poll the SMT until
              // existence is true OR we hit a sane timeout. ~12 attempts
              // × 2.5 s ≈ 30 s — generous given L2 block times.
              const { JsonRpcProvider, Contract } = await import('ethers');
              const provider = new JsonRpcProvider(
                'https://l2.rarimo.com',
              );
              const { slaveCertSmtLeafKey } = await import('@/utils/heavy-noir-inputs');
              const leafKey = slaveCertSmtLeafKey(eDoc);
              const smtAbi = ['function getProof(bytes32) view returns (tuple(bytes32 root, bytes32[] siblings, bool existence, bytes32 key, bytes32 value, bool auxExistence, bytes32 auxKey, bytes32 auxValue))'];
              const smtAddr = '0xA8b350d699632569D5351B20ffC1b31202AcEDD8';
              const smt = new Contract(smtAddr, smtAbi, provider);
              let landed = false;
              for (let i = 0; i < 12; i++) {
                await new Promise((r) => setTimeout(r, 2500));
                try {
                  const probe = await smt.getProof(leafKey);
                  // We're really waiting for the CSCA → CertificatesSMT
                  // root to update; existence here flips when the slave
                  // can be inserted under the new CSCA. If the bootstrap
                  // tx hasn't landed yet, the master tree root is still
                  // stale and the proof step below will re-fail.
                  if (probe.existence === false) {
                    // Still false → bootstrap tx not yet mined. The
                    // `siblings.length` can also change (root rotated)
                    // before existence flips, so we don't break early on
                    // that. Just keep polling.
                  }
                  if (probe.existence === true) { landed = true; break; }
                } catch (probeErr: any) {
                  console.log('[Step7][mainnet] SMT probe err:', probeErr?.message ?? probeErr);
                }
              }
              if (!landed) {
                console.warn('[Step7][mainnet] bootstrap tx not visible after 30 s — proceeding anyway');
              }

              // Retry proof generation. If the tx landed, the slave-cert
              // SMT lookup inside generateHeavyNoirProof now succeeds (we
              // can register the slave under the freshly-added CSCA).
              heavyProof = await generateHeavyNoirProof(eDoc, skIdentityHex);
            }

            const { txHash } = await registerIdentityViaNoir({
              network: 'mainnet',
              noirProof: heavyProof,
              circuitName: 'registerIdentity_1_256_3_5_576_248_NA',
              // No Active Authentication on French passports — pass
              // empty bytes so buildRegisterViaNoirCalldata picks the
              // P_NO_AA dispatcher (keccak("P_NO_AA")) and emits empty
              // signature/publicKey fields in the Passport struct.
              aaPubKeyPem: new Uint8Array(),
              aaSignature: new Uint8Array(),
              ecSizeInBits: eDoc.sod.encapsulatedContent.length * 8,
            });
            console.log(`[Step7][mainnet] registerViaNoir tx submitted: ${txHash}`);
          } else {
            // ----- LIGHT REGISTRATOR PATH -----------------------------
            // Covers everything except TD3 mainnet: TD1 testnet, TD1
            // mainnet, TD3 testnet. The SDK posts to /registerid (TD1) or
            // /register (TD3) on Rarimo's incognito-light-registrator;
            // the service generates the heavy proof server-side and
            // submits on-chain. Base URL is set by the Rarime instance's
            // network config, so the same call routes correctly per
            // network.
            //
            // Note: TD3 testnet on this endpoint has historically returned
            // HTTP 400 (see td3-spike-blocker memory) — kept here for
            // completeness but if you're testing TD3, use mainnet.
            const label = `registerIdentity (light, ${isTd3 ? 'TD3' : 'TD1'}, ${network})`;
            await withRetry(
              () => rarime.registerIdentity(passport),
              { label },
            );
            console.log(`[Step7][${network}] light register submitted (${isTd3 ? 'TD3' : 'TD1'})`);
          }
        }

        hasCalledCallback.current = true;
        console.log('[Step7] Verification complete — calling onSuccess');
        setStatusText(t('voting.step7Verified'));
        onSuccess?.();
      } catch (err: any) {
        console.error('[Step7] Verification error:', err);
        hasCalledCallback.current = true;
        const msg: string = err?.message ?? '';
        // [VOTE_INELIGIBLE] errors carry a French user-facing message that
        // we want to surface verbatim — formatRpcError would replace it
        // with a generic "an error occurred" string.
        const isFatal = msg.startsWith('[VOTE_INELIGIBLE]');
        const text = isFatal
          ? msg.replace('[VOTE_INELIGIBLE]', '').trim()
          : formatRpcError(err);
        setErrorMessage(text);
        onError?.(text, isFatal, err);
      }
    })();
  }, [hasStarted, rarime, passport, freedomTool, onSuccess, onError]);

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step7Container}>
        <Text style={stepSpecificStyles.step7Title}>{t('voting.step7Title')}</Text>

        {Platform.OS === 'android' ? (
          <Image
            source={require('@/assets/images/poster-verify.png')}
            style={stepSpecificStyles.step7Image}
            resizeMode="contain"
          />
        ) : (
          <VideoView
            style={stepSpecificStyles.step7Image}
            player={player}
            contentFit="contain"
            nativeControls={false}
            surfaceType="textureView"
          />
        )}

        <View style={{ flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {!errorMessage && hasStarted && (
            <ActivityIndicator size="small" color={colors.text} />
          )}
          <Text style={stepSpecificStyles.step7Description}>
            {errorMessage || statusText}
          </Text>
        </View>

        {nfcData?.personDetails && (
          <View style={{ marginTop: 16, padding: 16, backgroundColor: colors.white, borderRadius: 8 }}>
            <Text style={{
              fontFamily: Typography.fontFamily.semibold,
              fontSize: Typography.fontSize.body,
              color: colors.text,
              marginBottom: 8,
            }}>
              {`${nfcData.personDetails.firstName || ''} ${nfcData.personDetails.lastName || ''}`.trim() || t('voting.step7NameUnavailable')}
            </Text>
            <Text style={{
              fontFamily: Typography.fontFamily.medium,
              fontSize: Typography.fontSize.small,
              color: colors.text,
              opacity: 0.7,
            }}>
              {t('voting.step7BornOn', {
                date: formatMrzDateFr(nfcData.personDetails.birthDate),
              })}
            </Text>
            <Text style={{
              fontFamily: Typography.fontFamily.medium,
              fontSize: Typography.fontSize.small,
              color: colors.text,
              opacity: 0.7,
            }}>
              {t('voting.step7Nationality', { value: nfcData.personDetails.nationality || 'N/A' })}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

export default Step7;
