import React, { useState, useEffect, useRef } from 'react';
import { View, Text, LayoutChangeEvent, Platform, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { VideoView } from 'expo-video';
import { createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';
import {
  withRetry,
  formatRpcError,
  RARIME_MAINNET_CONFIG,
  MAINNET_CERT_POSEIDON_SMT_ADDRESS,
  type Network,
} from '@/constants/rarime-config';
import type { Rarime, RarimePassport, FreedomTool } from '@rarimo/rarime-rn-sdk';
import { useTranslation } from 'react-i18next';
import {
  registerIdentityViaNoir,
  generateHeavyNoirProof,
  type HeavyNoirProof,
} from '@/utils/register-via-noir';
import { EPassport } from '@/utils/e-document/e-document';
import { expandMrzBirthYear } from '@/utils/mrzDate';
import { isServiceUnavailableError } from '@/utils/relayer-errors';
import { isStorageFullError } from '@/utils/storage-errors';

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

// Display helper for the MRZ *birth date* (the only field this is used for —
// `nfcData.personDetails.birthDate` at line ~484). Uses the ICAO sliding-
// window rule via `expandMrzBirthYear` so YY=44 today resolves to 1944 (the
// 80yo voter case) instead of 2044 (the old fixed `>=50` cutoff was wrong
// for any pre-1950 birth and produced "Né(e) le: 31/12/2044").
// Returns French JJ/MM/AAAA, or 'N/A' for missing/malformed input.
function formatMrzDateFr(yymmdd?: string | null): string {
  if (!yymmdd || yymmdd.length !== 6 || !/^\d{6}$/.test(yymmdd)) return 'N/A';
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  return `${dd}/${mm}/${expandMrzBirthYear(yy)}`;
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
  // Mirror of `isActive` readable from inside the long-running async
  // verification flow below. The mainnet SMT poll can run up to 60 s; if the
  // user cancels or navigates away mid-poll we must stop touching state /
  // callbacks on an inactive step. A ref so the running closure sees the
  // latest value without re-subscribing.
  const isActiveRef = useRef(isActive);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

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
    // 30 s defensive watchdog. Previously 15 s, which was tight enough
    // that the CSCA pre-warm's synchronous Merkle build (20-25 s on slow
    // Android devices) would starve the Rarime SDK init effect and fire
    // this timer falsely — see error reports 2026-06-02T08:10 / 11:52.
    // The Merkle build is now async + yielding (utils/icao-master-tree.ts
    // ::buildIcaoMasterTreeAsync) so the JS thread stays responsive
    // during CSCA pre-warm; this timer should never fire under normal
    // operation. Keep it as a guard against future regressions or
    // genuine init failures (network drop while loading bundled circuit,
    // SecureStore failure, etc.) without making the wait absurd.
    const timer = setTimeout(() => {
      if (hasCalledCallback.current) return;
      if (rarime && passport) return;
      hasCalledCallback.current = true;
      const msg = t('voting.step7MissingData');
      // Previously this path was completely silent (no console output) AND
      // non-blocking — handleVerificationError would auto-advance to Step 8
      // after 1.5 s, walking the user toward a vote that cannot succeed
      // (no rarime/passport refs). Log it and mark it blocking so the user
      // stays on Step 7 with the explanatory message.
      console.warn(
        `[Step7] missing-data timeout (30s) — refs never arrived (rarime=${!!rarime}, passport=${!!passport})`,
      );
      setErrorMessage(msg);
      onError?.(msg, true);
    }, 30000);
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

            // Diagnostic probe BEFORE the Noir prover runs: the SDK's
            // noir.aar swallows System.loadLibrary("noir_java") failures
            // into System.err (logcat only), so when the lib can't load,
            // reports only show the generic "No implementation found for
            // …setup_srs". This probe surfaces the REAL dlopen error into
            // the JS log ring buffer → the error report names its own root
            // cause (see WitnesscalculatorModule.kt::probeNoirLibrary).
            // Free when the library is healthy (loadLibrary is idempotent).
            if (Platform.OS === 'android') {
              try {
                const { default: Witnesscalculator } = await import(
                  '@modules/witnesscalculator/src/WitnesscalculatorModule'
                );
                const probe: unknown = (Witnesscalculator as any).probeNoirLibrary?.();
                if (typeof probe === 'string' && probe !== 'ok') {
                  console.error(`[noir-probe] System.loadLibrary("noir_java") FAILED: ${probe}`);
                } else if (probe === 'ok') {
                  console.log('[noir-probe] noir_java loads OK');
                }
              } catch (probeErr: any) {
                // Older binary without the probe function — not an error.
                console.log('[noir-probe] probe unavailable:', probeErr?.message ?? probeErr);
              }
            }

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
                RARIME_MAINNET_CONFIG.apiConfiguration.jsonRpcEvmUrl,
              );
              const { slaveCertSmtLeafKey } = await import('@/utils/heavy-noir-inputs');
              const leafKey = slaveCertSmtLeafKey(eDoc);
              const smtAbi = ['function getProof(bytes32) view returns (tuple(bytes32 root, bytes32[] siblings, bool existence, bytes32 key, bytes32 value, bool auxExistence, bytes32 auxKey, bytes32 auxValue))'];
              const smt = new Contract(MAINNET_CERT_POSEIDON_SMT_ADDRESS, smtAbi, provider);
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

          // Wait for the registration tx to be mined + indexed in the
          // RegistrationSMT before declaring success. The relayer ACKs the
          // moment the tx is broadcast, NOT when it lands on-chain. Rarimo
          // L2 blocks every ~5 s and SMT indexing trails by a block or two.
          // Without this poll, `mainnet-vote-flow.readOnChainContext`'s
          // pre-flight `regSmt.getProof(proofIndex)` races the chain and
          // throws "not yet registered" ~10–15 s into the vote step — a
          // confusing dead-end for what was actually a successful
          // registration. Mirrors the CSCA-bootstrap poll above.
          if (network === 'mainnet') {
            console.log('[Step7][mainnet] waiting for registration to land in SMT…');
            setStatusText(t('voting.step7Confirming'));
            const POLL_INTERVAL_MS = 2_000;
            const POLL_TIMEOUT_MS = 60_000;
            const tConfirmStart = Date.now();
            let confirmed = false;
            while (Date.now() - tConfirmStart < POLL_TIMEOUT_MS) {
              // Abort if Step 7 deactivated (user cancelled / navigated away)
              // so we don't keep polling and fire callbacks on an inactive step.
              if (!isActiveRef.current) {
                console.log('[Step7][mainnet] step deactivated mid-poll — aborting confirmation');
                return;
              }
              try {
                const smtProof = await rarime.getSMTProof(passport);
                if (smtProof.existence) {
                  confirmed = true;
                  console.log(`[Step7][mainnet] SMT confirmed in ${Date.now() - tConfirmStart}ms`);
                  break;
                }
              } catch (e: any) {
                console.log('[Step7][mainnet] SMT poll err:', e?.message ?? e);
              }
              await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            }
            if (!confirmed) {
              throw new Error(
                `[Step7] Registration confirmation timed out after ${Math.round((Date.now() - tConfirmStart) / 1000)}s. ` +
                  'Please retry the vote in a moment.',
              );
            }
          }
        }

        if (!isActiveRef.current) {
          console.log('[Step7] step inactive at completion — skipping onSuccess');
          return;
        }
        hasCalledCallback.current = true;
        console.log('[Step7] Verification complete — calling onSuccess');
        setStatusText(t('voting.step7Verified'));
        onSuccess?.();
      } catch (err: any) {
        console.error('[Step7] Verification error:', err);
        hasCalledCallback.current = true;
        if (!isActiveRef.current) {
          console.log('[Step7] step inactive at error — skipping onError');
          return;
        }
        const msg: string = err?.message ?? '';
        // [VOTE_INELIGIBLE] errors carry a French user-facing message that
        // we want to surface verbatim — formatRpcError would replace it
        // with a generic "an error occurred" string.
        const isIneligible = msg.startsWith('[VOTE_INELIGIBLE]');
        // Disk-full / OOM (e.g. ENOSPC downloading the ~300 MB trusted setup,
        // 2026-06-11 reports) — a DEVICE problem: "try later" would be wrong
        // advice, and retrying without freeing space cannot succeed. Checked
        // before the service-down branch so it wins.
        const isDeviceFull = !isIneligible && isStorageFullError(err);
        // 5xx / network / confirmation-timeout → transient SERVER-side failure
        // (e.g. the registration relayer returning HTTP 500). Show an honest
        // "service temporarily unavailable, try again later" message instead of
        // formatRpcError's generic text — and crucially treat it as blocking so
        // the user isn't auto-advanced into a vote that fails with the
        // misleading existence=false / "restore your key".
        const isServiceDown = !isIneligible && !isDeviceFull && isServiceUnavailableError(err);
        let text: string;
        if (isIneligible) {
          text = msg.replace('[VOTE_INELIGIBLE]', '').trim();
        } else if (isDeviceFull) {
          text = t('voting.errors.deviceStorageFull', {
            defaultValue:
              "Espace de stockage insuffisant sur votre appareil. Le vote nécessite le téléchargement d'environ 1 Go de données cryptographiques. Libérez de l'espace puis réessayez.",
          });
        } else if (isServiceDown) {
          text = t('voting.errors.registrationServiceUnavailable', {
            defaultValue:
              "Le service d'enregistrement est temporairement indisponible. Réessayez plus tard.",
          });
        } else {
          text = formatRpcError(err);
        }
        // Block the flow for permanent (ineligible), device (storage-full) and
        // transient (service-down) failures alike. voting-flow's
        // handleVerificationError keeps the user on Step 7 with this message
        // when the 2nd arg is true, instead of setTimeout(handleNext) which
        // would walk into the vote.
        const blocking = isIneligible || isDeviceFull || isServiceDown;
        setErrorMessage(text);
        onError?.(text, blocking, err);
      }
    })();
  }, [hasStarted, rarime, passport, freedomTool, onSuccess, onError]);

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step7Container}>
        <Text style={stepSpecificStyles.step7Title}>{t('voting.step7Title')}</Text>

        {/* Hide the 225×225 poster while an error message is rendered.
            slidingWrapper has `overflow: 'hidden'`, so a long VOTE_INELIGIBLE
            message (the ECDSA-dispatcher / curve-unsupported / compressed-key
            strings run 250–300 chars) was overflowing the bottom of the slide
            and getting clipped. Collapsing the image gives the error text the
            vertical budget it needs to fully render. */}
        {!errorMessage && (
          Platform.OS === 'android' ? (
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
          )
        )}

        {/* Spinner + description as direct children of step7Container.
            A previous attempt wrapped them in an inner column-flex View with
            no explicit width — that View collapsed to its widest child's
            natural width, so step7Description's `width: '100%'` resolved to
            the unwrapped natural width of the (long) errorMessage Text and
            overflowed the screen. step7Container already provides
            `width: '100%'` + `alignItems: 'center'` + `gap`, so the wrapper
            was redundant. */}
        {!errorMessage && hasStarted && (
          <ActivityIndicator size="small" color={colors.text} />
        )}
        <Text style={stepSpecificStyles.step7Description}>
          {errorMessage || statusText}
        </Text>

        {/* Personal-details card hides when an error is showing — it's only
            useful as positive feedback during the verification flow, not as
            extra noise above an error explanation. */}
        {!errorMessage && nfcData?.personDetails && (
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
