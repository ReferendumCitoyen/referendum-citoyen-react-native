import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, LayoutChangeEvent, Platform, Image, TouchableOpacity, ActivityIndicator, AppState, ScrollView } from 'react-native';
import { VideoView } from 'expo-video';
import { createStepSpecificStyles, slideBoxStyle, slideFooterStyle, slideScrollContent } from './styles';
import { Spacing, useColors, Typography } from '@/constants/theme';
import {
  withRetry,
  formatRpcError,
  type Network,
} from '@/constants/rarime-config';
import type { Rarime, RarimePassport, FreedomTool } from '@rarimo/rarime-rn-sdk';
import { useTranslation } from 'react-i18next';
import { ErrorReportButton } from '@/components/ErrorReportButton';
import {
  registerIdentityViaNoir,
  generateHeavyNoirProofWithCscaBootstrap,
  type HeavyNoirProof,
} from '@/utils/register-via-noir';
import { heavyCircuitNameForDg1 } from '@/utils/heavy-circuits';
import { TD1_HEAVY_REGISTER } from '@/constants/td1-heavy-register';
import { isBetaBuild } from '@/constants/app-flavour';
import { EPassport } from '@/utils/e-document/e-document';
import { expandMrzBirthYear } from '@/utils/mrzDate';
import { isServiceUnavailableError } from '@/utils/relayer-errors';
import { step7ErrorMessage } from '@/utils/step7-error-message';
import {
  REGISTERED_WITH_OTHER_KEY,
  REGISTRATION_OUTCOME_UNKNOWN,
  isOtherKeyRefusal,
  isOutcomeUnknown,
  isRegistrationPending,
  isStatusReadTimeout,
  STATUS_READ_ATTEMPT_TIMEOUT_MS,
  STATUS_READ_TIMEOUT,
} from '@/utils/registration-sentinels';
import { isTransientRpcError, runRegistration } from '@/utils/registration-submission';
import {
  armPendingSlot,
  clearPendingSlot,
  markRegistrationSent,
  pendingSlotAgeMs,
  writePendingSlot,
} from '@/utils/registration-pending-slot';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { isMockBackend, mockDelay } from '@/constants/mock-backend';
import { parseDg11 } from '@/utils/e-document/dg11';
import { loggableTxHash } from '@/utils/logger';
import { assertProverCanRun } from '@/utils/device-support';
import { createAttemptGeneration } from '@/utils/attempt-generation';
import { useMissingDataWatchdog } from '@/hooks/useMissingDataWatchdog';
import type { AttemptKey } from '@/utils/attempt-key';

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
  dg11Bytes?: Uint8Array | string;
  aaSignature?: Uint8Array | string;
}

interface Step7Props {
  containerWidth: number;
  player: any;
  isActive?: boolean;
  nfcData?: NFCData | null;
  /**
   * Verification finished. `didRegister` is true when THIS run bonded the
   * document on-chain for the first time, which is the moment its key becomes
   * the only thing that can ever vote with it again — Step 12 uses it to ask
   * for a backup exactly once, rather than after every vote.
   */
  onSuccess?: (didRegister?: boolean) => void;
  /** Called when Step 7 hits a verification error. This component has already
   * rendered `message` (and the report button) by then; the parent's only job
   * is to leave the user here to read it — nothing that fails on Step 7 is
   * something the vote could survive. */
  onError?: (message?: string, error?: unknown) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  rarime?: Rarime;
  passport?: RarimePassport;
  freedomTool?: FreedomTool;
  /** Selected network from the global NetworkContext. Routes the registration
   * flow: 'mainnet' uses registerViaNoir + heavy circuit + registration-relayer
   * (the path proven by a rarime-app registration on Mainnet);
   * 'testnet' falls back to the SDK's light register path (Q-testnet, still
   * broken for TD3 but kept around as a smoke test for the rest of the flow). */
  network?: Network;
  /** Names the document the user is voting with in the copy (the rescan
   * prompt), so a passport voter isn't told to rescan their card. */
  isPassportFlow?: boolean;
  /** True when this document shares its key with the other document type on
   * this phone (Level 1, utils/identity.ts). Lets a StateKeeper "identity
   * already registered" refusal name the document that IS registered. */
  keyLinkedToOtherDocument?: boolean;
  /** The proposal being voted on. Only used to answer "has this key already
   * voted here" before a proof is built — see runOneDocumentPerPersonChecks.
   * Without it both of those checks are skipped. */
  proposalId?: string;
  /** The key resolved for this document in this attempt, the one `rarime`
   * was built with (utils/attempt-key.ts). Captured as a value when the
   * verification starts; the global key slot is never read here. */
  attemptKey?: AttemptKey;
  /** Set when the document's key could not be resolved. The step stops on
   * this message: there is no fallback to another key. */
  initError?: string | null;
  /** Step 7 rebuilt the SDK instance for this document after the one approved
   * status re-read (item 14 b) and the chain confirmed it: the parent swaps
   * it in so the vote uses the same instance and key. */
  onSdkRebuilt?: (rarime: Rarime, attemptKey: AttemptKey) => void;
  /** "Relancer le vote": a clean restart of the flow, offered on the expected
   * other-key refusal instead of a report button. */
  onRestart?: () => void;
  /** Measured slide area (voting-flow): bounds the slide so it scrolls. */
  slideAreaHeight?: number;
  /** Overrides the 30 s missing-data watchdog. Only the QA gallery passes it:
   *  the state it publishes as "Vérification en cours..." must still be that
   *  state when the run reaches it (QA iPhone 2.0.2, item 3). */
  missingDataTimeoutMs?: number;
}

const Step7: React.FC<Step7Props> = ({
  containerWidth,
  player,
  isActive,
  nfcData,
  onSuccess,
  onError,
  onLayout,
  rarime,
  passport,
  freedomTool,
  network = 'testnet',
  isPassportFlow = false,
  keyLinkedToOtherDocument = false,
  proposalId,
  attemptKey,
  initError,
  onSdkRebuilt,
  onRestart,
  slideAreaHeight,
  missingDataTimeoutMs,
}) => {
  const { t } = useTranslation();
  const docSfx = isPassportFlow ? 'passport' : 'idCard';
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [statusText, setStatusText] = useState(t('voting.step7Verifying'));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Kept alongside the message because the report needs the stack and any
  // relayer body, which the user-facing French string has already discarded.
  const [errorObject, setErrorObject] = useState<unknown>(null);
  // DG11 (additional personal details) is plaintext on the chip — parsed
  // locally, purely for display back to the user who just scanned their own
  // document. Never logged, never sent anywhere.
  const dg11Fields = useMemo(() => {
    if (!nfcData?.dg11Bytes) return null;
    try {
      return parseDg11(new Uint8Array(nfcData.dg11Bytes as Uint8Array));
    } catch {
      return null;
    }
  }, [nfcData?.dg11Bytes]);
  const hasCalledCallback = useRef(false);
  const isVerifying = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);
  // One generation per verification run, local to Step 7: bumped on every
  // activation, deactivation and unmount. A run compares its own generation
  // before touching the screen (setState, onSuccess, onError, the CSCA
  // release), so a run whose screen is gone, or which a newer run replaced,
  // keeps submitting and confirming its registration (dossier 2.0.2, item
  // 3 b) but never drives the UI of a later attempt. It used to stop polling
  // when the step went inactive, and a run left alive on an unmounted
  // instance still called its callbacks (field report of 20/09).
  // The shared R1 mechanism (utils/attempt-generation.ts), one instance per
  // Step 7 mount, owned by this step alone.
  const runGenRef = useRef(createAttemptGeneration());
  useEffect(() => () => { runGenRef.current.next(); }, []);

  useEffect(() => {
    if (isActive && !hasStarted) {
      runGenRef.current.next();
      setHasStarted(true);
      hasCalledCallback.current = false;
      isVerifying.current = false;
      setStatusText(t('voting.step7Verifying'));
      setErrorMessage(null);
      setErrorObject(null);
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
      runGenRef.current.next();
      setHasStarted(false);
    }
  }, [isActive, hasStarted]);

  // Fallback: if rarime/passport genuinely never arrive (init threw), don't
  // wait forever — surface a real error after a generous timeout.
  // 30 s defensive watchdog, blocking-aware (hooks/useMissingDataWatchdog.ts):
  // it re-reads the refs on expiry instead of trusting its closure, and a
  // timer that fires late because the JS thread was frozen (the CSCA PEM parse
  // did that for 32 to 50 s on low-end Android, dossier 2.0.2 item 5) gets a
  // short grace instead of declaring the data missing. A genuine init failure
  // (bundled circuit, SecureStore, key resolution) still surfaces at 30 s.
  const latestRefs = useRef({ rarime, passport, attemptKey });
  latestRefs.current = { rarime, passport, attemptKey };
  useMissingDataWatchdog({
    timeoutMs: missingDataTimeoutMs,
    armed: hasStarted && !hasCalledCallback.current && !initError,
    ready: !!(rarime && passport && attemptKey),
    onExpire: () => {
      if (hasCalledCallback.current) return;
      const { rarime: r, passport: p, attemptKey: k } = latestRefs.current;
      if (r && p && k) return;
      hasCalledCallback.current = true;
      const msg = t(`voting.step7MissingData_${docSfx}`);
      // Previously this path was completely silent (no console output). Log
      // it so a report can say what init was doing for those 30 s.
      console.warn(
        `[Step7] missing-data timeout (30s) — refs never arrived (rarime=${!!r}, passport=${!!p})`,
      );
      setErrorMessage(msg);
      // Synthesised: nothing threw here, the refs simply never arrived. The
      // report still wants an object so the button renders and the log buffer
      // (which holds the real story) gets attached.
      const timeoutErr = new Error(
        `[Step7] missing-data timeout after 30s (rarime=${!!r}, passport=${!!p})`,
      );
      setErrorObject(timeoutErr);
      onError?.(msg, timeoutErr);
    },
  });

  // The document's key could not be resolved (voting-flow, 14 f): stop here
  // with that message. Nothing is proved or read with any other key.
  useEffect(() => {
    if (!hasStarted || hasCalledCallback.current || !initError) return;
    hasCalledCallback.current = true;
    const err = new Error('[Step7] key resolution failed for this document');
    setErrorMessage(initError);
    setErrorObject(err);
    onError?.(initError, err);
  }, [hasStarted, initError, onError]);

  /**
   * "One vote per person", enforced on this phone before a proof is built.
   *
   * Two refusals, in the order they help:
   *
   *   1. This document's own key has already voted on this question. Step 11
   *      has always checked this, but only after the user had scanned,
   *      registered and picked an answer. The same three eth_calls answer it
   *      here instead (project decision, 2026-09-09).
   *   2. The other document belonging to the same person is already in use.
   *      See utils/second-document-guard.ts — this is the hole between Level 1
   *      (which links only at row creation) and StateKeeper (which only
   *      refuses documents that share a key), and a tester fell into it on
   *      2026-09-09 with a card written on build 16.
   *
   * Best-effort throughout. The refusal is raised AFTER the try block so that
   * nothing thrown by the reads themselves can be mistaken for one: an RPC
   * that is merely down must cost a second, not a vote.
   */
  const runOneDocumentPerPersonChecks = useCallback(async (ownPrivateKey: string) => {
    // Mainnet only. The proposal registry and the per-proposal nullifier trees
    // read here are Mainnet contracts; the testnet path votes through the SDK,
    // which runs its own already-voted check.
    if (network !== 'mainnet' || !proposalId) return;

    let ineligible: string | null = null;
    try {
      const [
        { docTypeFromDg1, getAllEntries },
        { computePersonKey },
        { UNIVERSAL_PERSON_KEY },
        { findSecondDocumentConflict },
        { hasKeyVoted, mainnetProvider, readProposalVoteIndex },
      ] = await Promise.all([
        import('@/utils/passport-key-db'),
        import('@/utils/universal-person-key'),
        import('@/constants/universal-person-key'),
        import('@/utils/second-document-guard'),
        import('@/utils/vote-nullifier'),
      ]);

      // `ownPrivateKey` is the key captured for this attempt (R2), not a
      // re-read of the global slot: a later scan of another document rewrites
      // that slot, and these checks would then answer for the wrong document.
      const provider = mainnetProvider();
      const index = await readProposalVoteIndex(provider, proposalId);

      if (await hasKeyVoted({ provider, index, bjjPrivateKeyHex: ownPrivateKey })) {
        console.log('[Step7][one-document] this document has already voted on this proposal');
        ineligible = t('voting.errors.alreadyVotedThisQuestion');
      } else if (UNIVERSAL_PERSON_KEY) {
        const dg1 = nfcData?.dg1Bytes ? new Uint8Array(nfcData.dg1Bytes as Uint8Array) : undefined;
        const dg11 = nfcData?.dg11Bytes
          ? new Uint8Array(nfcData.dg11Bytes as Uint8Array)
          : undefined;
        const conflict = await findSecondDocumentConflict({
          entries: await getAllEntries(),
          personKey: computePersonKey(dg11) ?? undefined,
          docType: dg1 ? docTypeFromDg1(dg1) : undefined,
          ownPrivateKey,
          hasVoted: (sk) => hasKeyVoted({ provider, index, bjjPrivateKeyHex: sk }),
        });
        if (conflict) {
          console.log(
            `[Step7][one-document] refused: the ${conflict.otherDocType} of the same person is already ${conflict.reason}`,
          );
          const verb =
            conflict.reason === 'voted' ? 'Voted' : conflict.reason === 'legacy' ? 'Legacy' : 'Registered';
          ineligible = t(`voting.errors.otherDocument${verb}_${conflict.otherDocType}`);
        }
      }
    } catch (e: any) {
      console.warn('[Step7][one-document] check skipped:', e?.message ?? String(e));
      return;
    }

    if (ineligible) throw new Error(`[VOTE_INELIGIBLE] ${ineligible}`);
  }, [network, proposalId, nfcData, t]);

  /**
   * Record on this document's row that the chain has it bound, so the guard
   * above can refuse its sibling later without asking the chain — including on
   * a question neither document has voted on yet, which is the one case the
   * nullifier check cannot see. Fire-and-forget: it changes nothing for this
   * vote, and a row that misses it simply falls back to the nullifier check.
   */
  const recordOnChainBinding = useCallback(async (r: Rarime, p: RarimePassport) => {
    try {
      if (!nfcData?.dg1Bytes || !nfcData?.sodBytes) return;
      const { computePassportHash, lookupKeyForPassport, markRegistered, setOnChainIdentity } =
        await import('@/utils/passport-key-db');
      const passportHash = computePassportHash({
        dg1: new Uint8Array(nfcData.dg1Bytes as Uint8Array),
        sod: new Uint8Array(nfcData.sodBytes as Uint8Array),
      });
      const row = await lookupKeyForPassport(passportHash);
      if (!row || row.registeredAt) return;
      // Reached only on RegisteredWithThisPk, so the identity the chain names
      // IS this row's own key — which is what makes it usable as evidence.
      await markRegistered(passportHash);
      // Also worth keeping: it lets Settings check a pasted replacement key
      // offline, which otherwise needs the chip present.
      const activeIdentity = (await r.getPassportInfo(p))?.[0]?.activeIdentity;
      if (activeIdentity) await setOnChainIdentity(passportHash, activeIdentity);
    } catch (e: any) {
      console.warn('[Step7][one-document] could not record the binding:', e?.message ?? String(e));
    }
  }, [nfcData]);

  useEffect(() => {
    if (!hasStarted || hasCalledCallback.current || isVerifying.current) return;

    // rarime + passport are populated asynchronously in voting-flow's init
    // effect (SDK import + Rarime native warmup). On the first pass they're
    // still undefined — wait rather than bailing. The effect re-runs when
    // they become defined. A separate timeout below surfaces a real error
    // if init genuinely fails.
    if (!rarime || !passport || !attemptKey || initError) return;

    // R2: {document, network, key, SDK instance} for this attempt, captured as
    // values now. Every read and proof below uses these and nothing else; in
    // particular the key is never re-read from the global slot, which a scan
    // of another document may rewrite while this run is still proving.
    const captured = {
      rarime,
      passport,
      network,
      privateKey: attemptKey.privateKey,
      passportHash: attemptKey.passportHash,
    };

    // This run's generation. `alive()` is false once the screen that started
    // the run is gone or a newer run started; only UI work checks it, the
    // registration itself carries on.
    const generation = runGenRef.current.current();
    const alive = () => runGenRef.current.isCurrent(generation);
    const say = (text: string) => {
      if (alive()) setStatusText(text);
    };

    isVerifying.current = true;
    (async () => {
      if (isMockBackend()) {
        // Beta build: skip the relayer / on-chain registration entirely and
        // simulate the same status-text sequence the real flow shows, so
        // the scan → verify UX still feels real. See constants/mock-backend.ts.
        say(t('voting.step7CheckingStatus'));
        await mockDelay(600);
        say(t('voting.step7Registering'));
        await mockDelay(900);
        say(t('voting.step7Confirming'));
        await mockDelay(600);
        if (!alive()) {
          console.log('[Step7][mock] step inactive at completion — skipping onSuccess');
          return;
        }
        hasCalledCallback.current = true;
        say(t('voting.step7Verified'));
        console.log('[Step7][mock] simulated registration success — no relayer/on-chain calls made');
        // `true` so the backup notice is reachable in a stubbed build. The
        // on-chain bonding is simulated, but the per-document key is not — it
        // is created from the scan regardless of this flag (voting-flow's
        // getOrCreateKeyForPassport), so it is just as real and just as worth
        // backing up here as on the live pipeline.
        onSuccess?.(true);
        return;
      }
      let mastersGeneration: number | null = null;
      try {
        // The key must belong to the document on screen. A mismatch means the
        // key and the scan come from different attempts: stop before any
        // read or proof uses it.
        if (nfcData?.dg1Bytes && nfcData?.sodBytes) {
          const { computePassportHash } = await import('@/utils/passport-key-db');
          const scanned = computePassportHash({
            dg1: new Uint8Array(nfcData.dg1Bytes as Uint8Array),
            sod: new Uint8Array(nfcData.sodBytes as Uint8Array),
          });
          if (scanned !== captured.passportHash) {
            throw new Error(
              '[VOTE_INELIGIBLE] ' +
                t('voting.errors.keyResolutionFailed', {
                  defaultValue:
                    "La clé de ce document n'a pas pu être lue sur ce téléphone. Fermez puis relancez le vote. Si le message revient, écrivez-nous.",
                }),
            );
          }
        }
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
        say(t('voting.step7CheckingStatus'));
        const { DocumentStatus } = await import('@rarimo/rarime-rn-sdk');
        // Each attempt bounded (AV1, plan D2): a read that never answers used
        // to hold this screen for ever. Nothing is sent before this read.
        let status = await withRetry(
          () => captured.rarime.getDocumentStatus(passport),
          {
            label: 'getDocumentStatus',
            attemptTimeoutMs: STATUS_READ_ATTEMPT_TIMEOUT_MS,
            timeoutMessage: `${STATUS_READ_TIMEOUT} getDocumentStatus did not answer within ${STATUS_READ_ATTEMPT_TIMEOUT_MS / 1000} s`,
          }
        );
        console.log('[Step7] Document status:', status);

        // Dossier 2.0.2, item 14 (b). Before showing "another key", rebuild
        // the SDK instance with the key this phone holds FOR THIS DOCUMENT and
        // read the status once more (the same request, repeated once; no new
        // request, no write). A card bound to this phone was refused this way
        // when the first read ran on an instance built with another key
        // (field report of 19/09: OTHER_PK, then THIS_PK two minutes later,
        // same card, same phone).
        if (status === DocumentStatus.RegisteredWithOtherPk) {
          try {
            const [{ lookupKeyForPassport }, { Rarime: RarimeClass }, { getRarimeConfig }] =
              await Promise.all([
                import('@/utils/passport-key-db'),
                import('@rarimo/rarime-rn-sdk'),
                import('@/constants/rarime-config'),
              ]);
            const documentKey =
              (await lookupKeyForPassport(captured.passportHash))?.privateKey ?? captured.privateKey;
            const rebuilt = new RarimeClass({
              ...getRarimeConfig(captured.network),
              userConfiguration: { userPrivateKey: documentKey },
            });
            const reread = await withRetry(() => rebuilt.getDocumentStatus(passport), {
              label: 'getDocumentStatus (document key)',
              maxRetries: 0,
              attemptTimeoutMs: STATUS_READ_ATTEMPT_TIMEOUT_MS,
            });
            console.log('[Step7] Document status:', reread);
            if (reread === DocumentStatus.RegisteredWithThisPk) {
              status = reread;
              // From here on this attempt proves and votes with the instance
              // and key the chain just confirmed.
              captured.rarime = rebuilt;
              if (documentKey !== captured.privateKey) {
                captured.privateKey = documentKey;
              }
              onSdkRebuilt?.(rebuilt, {
                ...attemptKey,
                privateKey: documentKey,
              });
            }
          } catch {
            // The re-read is a second chance, not a new failure mode: on any
            // error the first answer stands.
          }
        }

        // Two refusals that have to land before any proof is generated, and
        // one screen before the user is asked to pick an answer. Both are
        // read-only, both are best-effort, and neither may block a legitimate
        // vote: every failure inside runOneDocumentPerPersonChecks is logged
        // and swallowed, because a flaky RPC must not cost someone their vote.
        // See utils/second-document-guard.ts for why the second one insists on
        // evidence rather than the mere existence of another row.
        await runOneDocumentPerPersonChecks(captured.privateKey);

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
        // Step 2: register identity. Routing matrix is by *document type*
        // AND network:
        //
        //   mainnet + a document we route through a heavy circuit
        //                            → heavy Noir circuit. Proves the
        //                            slave-cert chain in-zk, we ABI-encode
        //                            `Registration2.registerViaNoir` and
        //                            POST calldata to the registration
        //                            relayer. See utils/register-via-noir.ts.
        //                            Which circuit is chosen by DG1 length —
        //                            HEAVY_CIRCUIT_NAMES in
        //                            utils/heavy-circuits.ts.
        //
        //     · TD3 (dg1=93) → registerIdentity_1_256_3_5_576_248_NA.
        //       Independently verified at Mainnet block 2330 (2144-byte
        //       proof shape, P_NO_AA + Z_NOIR_PASSPORT_* keccaks match).
        //
        //     · TD1 (dg1=95) → registerIdentity_1_256_1_6_960_248_NA,
        //       gated on TD1_HEAVY_REGISTER (constants/td1-heavy-register.ts).
        //       Rarimo deployed the matching Aztec verifier and registered it
        //       against this circuit's zkType, so the on-chain leg is real:
        //       Registration2.passportVerifiers(keccak(
        //       "Z_NOIR_PASSPORT_1_256_1_6_960_248_NA")) returns
        //       0xeDA16d0aA50D8a66C306525D0d6e95fA485d0658 (verified live
        //       2026-08-31 at block 0x108fe), and that contract's bytecode
        //       embeds the Verification Key Hash of the .sol in circuits/,
        //       i.e. it is the verifier for the circuit we actually bundle.
        //       the circuit author (Rarimo) called it "final" the same day. The
        //       SAME read returned the zero address ON 2026-08-24 — that is
        //       when the zero address was last observed, NOT when it changed;
        //       the deployment happened at some point between then and
        //       2026-08-31. That older read is why comments elsewhere in this
        //       repo describe the TD1 submit as reverting by design — history,
        //       not current behaviour. See constants/td1-heavy-register.ts and
        //       circuits/README.md.
        //
        //   everything else        → SDK's `rarime.registerIdentity()`
        //                            light flow → /registerid (TD1) or
        //                            /register (TD3 testnet). Base URL is
        //                            network-specific so the same call
        //                            covers both networks.
        //
        //     · TD1 on TESTNET, always — there is no registerViaNoir
        //       deployment on Q-testnet to submit to, so the heavy path
        //       refuses that network outright (utils/register-via-noir.ts
        //       ::submitToRegistrationRelayer).
        //
        //     · TD1 on mainnet whenever TD1_HEAVY_REGISTER is off. Rarimo's
        //       light registrator handles ID cards on both networks
        //       (confirmed with them 2026-05-21) and carried every CNIe
        //       registration up to the verifier deployment, so this stays a
        //       working fallback rather than dead code.
        //
        //     · Plus any DG1 length we ship no heavy circuit for.
        //
        // Two notes that used to live here, kept because the reasoning still
        // matters. First: "the heavy path is passport-only, Rarimo never built
        // a heavy TD1 register circuit" was true of Rarimo's PUBLISHED
        // circuits; the TD1 one was compiled and supplied to us directly by
        // the circuit author. Second: a CNIe used to take the light path by
        // default, so cards registered before this route went live are bonded
        // by the light registrator. Nothing needs re-registering — both
        // registrars write the same (passportHash, identityKey) pair into
        // StateKeeper, so the getDocumentStatus check above reports those
        // cards RegisteredWithThisPk and skips registration entirely.
        //
        // Either path is a no-op when the document is already
        // RegisteredWithThisPk — the SDK's getDocumentStatus comparison is
        // against the on-chain `activeIdentity` for the current BJJ key.
        // ----------------------------------------------------------------

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
          // Before bailing, answer the one question this message doesn't:
          // is the right key still on this phone? "Restore your key" is good
          // advice only when there is nothing to restore FROM — if a key we
          // already hold matches the chain, the user needs no backup and we
          // have a sync bug to chase. Emits counts and a boolean, never a key
          // (see utils/key-diagnosis.ts). Best-effort: a failure here must not
          // replace a precise message with an RPC error.
          try {
            const [
              { RarimeUtils },
              { getAllEntries },
              { diagnoseKeyMismatch, formatKeyDiagnosis },
              SecureStore,
              { PRIVATE_KEY_STORAGE_KEY },
            ] = await Promise.all([
              import('@rarimo/rarime-rn-sdk'),
              import('@/utils/passport-key-db'),
              import('@/utils/key-diagnosis'),
              import('expo-secure-store'),
              import('@/constants/rarime-config'),
            ]);
            const info = await captured.rarime.getPassportInfo(passport);
            const activeIdentity = info?.[0]?.activeIdentity;
            if (activeIdentity) {
              // The legacy single-key slot is checked alongside the DB: it can
              // hold the only copy of a key for a document registered before
              // the per-document DB existed and not rescanned since.
              const legacy = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY).catch(
                () => null,
              );
              const diagnosis = diagnoseKeyMismatch(
                activeIdentity,
                await getAllEntries(),
                (sk) => RarimeUtils.getProfileKey(sk),
                legacy,
              );
              console.warn(`[Step7][key-mismatch] ${docSfx}: ${formatKeyDiagnosis(diagnosis)}`);

              // Record it against this document. This is the only place the
              // on-chain identity and the document's DB row are both in hand:
              // the DB stores a SHA-256 of (DG1 ‖ SOD), which cannot reproduce
              // the on-chain passport key, so without persisting it here the
              // Settings screen can never check a pasted replacement offline —
              // and pasting an unverified key overwrites the current one for
              // good.
              const { computePassportHash, setOnChainIdentity } = await import(
                '@/utils/passport-key-db'
              );
              await setOnChainIdentity(
                computePassportHash({
                  dg1: new Uint8Array(nfcData!.dg1Bytes as Uint8Array),
                  sod: new Uint8Array(nfcData!.sodBytes as Uint8Array),
                }),
                activeIdentity,
              );
            } else {
              console.warn('[Step7][key-mismatch] no activeIdentity returned — cannot diagnose');
            }
          } catch (diagErr: any) {
            console.warn(
              '[Step7][key-mismatch] diagnosis failed:',
              diagErr?.message ?? String(diagErr),
            );
          }
          // Its own sentinel (R6): an expected refusal, shown without the
          // report button and with "Relancer le vote" (item 14 e). The text
          // comes from step7ErrorMessage, suffixed per document.
          throw new Error(`${REGISTERED_WITH_OTHER_KEY} document status after one re-read`);
        }

        const needsRegistration = status === DocumentStatus.NotRegistered;

        // Already bound, and the chain just said so. Write that onto the row
        // so the one-document guard can refuse this document's sibling later
        // without a proposal to check it against. Nothing waits on it.
        if (!needsRegistration) void recordOnChainBinding(captured.rarime, passport);

        if (needsRegistration) {
          console.log(`[Step7] registering identity (status=${status}, network=${network})`);
          say(t('voting.step7Registering'));
          // Warm the CSCA cache now, and only now: registration is the one
          // thing that can need it. Joins a build already in progress rather
          // than starting a second one; the generation is what lets this run
          // release exactly the build it warmed, and nothing newer.
          if (network === 'mainnet') {
            try {
              const { warmMastersCache } = await import('@/utils/csca-bootstrap');
              mastersGeneration = warmMastersCache();
            } catch {}
          }

          if (!nfcData?.dg1Bytes || !nfcData?.sodBytes) {
            throw new Error('Step7: nfcData missing dg1/sod bytes');
          }

          const isTd3 = passport.dataGroup1.length === 93;
          // Which heavy circuit we physically ship for this document, if any.
          // A static map over the two files in assets/circuits/ — NOT
          // `extractCircuitSuite()`, the CDN-derived resolver probed above.
          // Pinning the bundled circuits is exactly what the circuit author
          // asked for.
          const bundledCircuitName = heavyCircuitNameForDg1(passport.dataGroup1);
          // ...and whether we're actually allowed to route this document
          // through it. TD3 always is. TD1 is gated on TD1_HEAVY_REGISTER,
          // which is the kill switch back to the light registrator now that
          // the TD1 zkType has a live verifier on Mainnet (verified
          // 2026-08-31, full provenance in constants/td1-heavy-register.ts).
          // It is no longer gating off a guaranteed on-chain revert — that was
          // true only while passportVerifiers(<TD1 zkType>) was the zero
          // address, which it WAS when last read on 2026-08-24 and was NOT on
          // 2026-08-31. The changeover date inside that window is unknown, so
          // do not read 2026-08-24 as when it flipped. Anything else has no
          // bundled circuit at all, so the flag can't force it heavy.
          //
          // ONE value from here on: `heavyCircuitName` drives both the branch
          // test below and the circuitName handed to registerIdentityViaNoir,
          // so the bytecode we prove against and the string the on-chain
          // zkType is derived from cannot disagree. `undefined` = light
          // registrator.
          const heavyCircuitName =
            isTd3 || TD1_HEAVY_REGISTER ? bundledCircuitName : undefined;
          // The branch point itself, logged: "why did this go light instead of
          // heavy" is otherwise only inferable from which logs *didn't*
          // appear. The gated-off case is named explicitly — a bare "none"
          // would read as "no circuit exists for this document", which for a
          // CNIe is the wrong diagnosis. The flag's value is interpolated, not
          // written out as a literal: this line used to hardcode
          // "TD1_HEAVY_REGISTER=false" and would have printed a lie the moment
          // the flag was flipped.
          console.log(
            `[Step7] heavy circuit for dg1=${passport.dataGroup1.length}B: ` +
            `${heavyCircuitName ??
              (bundledCircuitName
                ? `${bundledCircuitName} bundled but gated off ` +
                  `(TD1_HEAVY_REGISTER=${TD1_HEAVY_REGISTER}) → light registrator`
                : 'none bundled → light registrator')}; network=${network}`,
          );
          const useHeavyPath = captured.network === 'mainnet' && !!heavyCircuitName;
          // ----- LIGHT REGISTRATOR PATH (guard checked before anything is
          // proved or sent; the call itself is in `submit` below) ---------
          // Covers everything the heavy path doesn't: both document
          // types on testnet, a CNIe on mainnet whenever
          // TD1_HEAVY_REGISTER is off, plus any DG1 length we have no
          // bundled heavy circuit for. The SDK posts to /registerid (TD1)
          // or /register (TD3) on Rarimo's incognito-light-registrator;
          // the service generates the heavy proof server-side and
          // submits on-chain. Base URL is set by the Rarime instance's
          // network config, so the same call routes correctly per
          // network.
          //
          // Still the route every CNIe registered through before
          // 2026-08-31, so this is not dead code even when the flag is on:
          // it is what the flag falls back to, and testnet has no
          // registerViaNoir deployment to fall back FROM.
          //
          // Note: TD3 testnet on this endpoint has historically returned
          // HTTP 400 (see td3-spike-blocker memory) — kept here for
          // completeness but if you're testing TD3, use mainnet.
          //
          // Not on the store app. The light registrator is a hosted
          // service that receives the document to prove it server-side,
          // and the launch rule is that nothing leaving the store app is
          // personal data (call of 2026-09-15). A CNIe on Mainnet never
          // reaches here while TD1_HEAVY_REGISTER is on; this is the
          // guard for the day something does.
          if (!useHeavyPath) {
            if (!isBetaBuild()) {
              throw new Error(
                `[Step7] no bundled circuit for this document (dg1=${passport.dataGroup1.length}B, ${network}); ` +
                  'the light registrator is not used by the store app',
              );
            }
          }

          // ----- HEAVY NOIR PATH (mainnet; TD3 always, TD1 gated) ---
          // TD3: confirmed 2026-05-18 (probe logs) that the light
          // registrator is broken for a passport on both networks
          // (HTTP 400, identical either side), so the heavy circuit is
          // the only viable path on Mainnet. The rarime-app's own
          // successful tx at block 2330 used this exact flow.
          //
          // TD1: a different rationale, so do not read the TD3 sentence
          // above as one. The light registrator WORKS for a CNIe
          // (/registerid — confirmed with the Rarimo team 2026-05-21)
          // and carried every CNIe registration up to 2026-08-31; this
          // branch displaces it rather than rescuing it. What changed is
          // that the on-chain leg now exists — Rarimo deployed the Aztec
          // verifier for registerIdentity_1_256_1_6_960_248_NA and
          // registered it against that circuit's zkType, verified live
          // 2026-08-31. So a CNIe here follows the same protocol-native
          // route as a passport (proof verified on-chain by Registration2,
          // relayer as a plain tx submitter) instead of depending on a
          // hosted service we don't control. TD1_HEAVY_REGISTER remains as
          // the switch back if that ever turns out to be the wrong trade.
          //
          // NOTE this cross-product is newer than either half: TD3 runs
          // heavy-register + Circom query, and TD1 previously ran
          // light-register + Noir TD1 query. TD1 heavy-register + Noir TD1
          // query is what this branch now produces. The confirmation poll
          // below is the check that matters — it only succeeds if the
          // circuit's passportHash/identityKey conventions match the SDK's.
          //
          // Pipeline (all in utils/register-via-noir.ts):
          //   1. generateHeavyNoirProof — SMT lookup on Mainnet's
          //      CertificatesSMT (0xA8b350d6…) + Noir prove() against
          //      the bundled `heavyCircuitName` bytecode (~3 MB asset
          //      per document type, both registered at boot in
          //      app/voting-flow.tsx). ~20 s on the Volla Phone X23.
          //   2. registerIdentityViaNoir — ABI-encode registerViaNoir
          //      against Registration2 (0x11BB4B14AA…) + POST to the
          //      registration-relayer at api.app.rarime.com.
          //
          // The relayer submits the tx and returns the hash; we log
          // it for the user to verify on scan.rarimo.com.
          //
          let heavyProof: HeavyNoirProof | null = null;
          let ecSizeInBits = 0;
          // This run's own pending-marker owner, set by `arm` below and read
          // by every write AND by the relayer POST. It belongs to the run, not
          // to the module: a second document scanned while this proof runs must
          // not end up owning this run's marker (wave 2a, constat 1).
          let pendingOwner: string | undefined;
          const prove = async () => {
            if (!useHeavyPath || !heavyCircuitName) return;
            // The skIdentity (BJJ private key) is the key captured for this
            // attempt: the very one the SDK instance above was built with, so
            // the on-chain `identityKey` matches the status read and the vote.
            // It used to be re-read here from the global slot, which a scan
            // of another document during this proof would have rewritten
            // (dossier 2.0.2, R2 / 14 g).
            const skIdentityHex = '0x' + captured.privateKey;

            // Build an EPassport from the NFC scan bytes — needed by the
            // input builder because RarimePassport doesn't expose the
            // ASN.1-parsed slave certificate (e-document does).
            //
            // docCode was hardcoded 'P' back when only passports reached this
            // branch. Nothing in the heavy chain reads it (checked:
            // buildHeavyRegisterInputs, slaveCertSmtLeafKey, the `sod` getter
            // and csca-bootstrap all ignore EPassport.docType), so a CNIe
            // self-reporting as PASSPORT was harmless — but misleading. Set it
            // honestly: e-document.ts:87-97 maps a code containing 'I' to
            // DocType.ID and one containing 'P' to DocType.PASSPORT.
            const eDoc = new EPassport({
              docCode: isTd3 ? 'P' : 'I',
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
            //
            // Item 4 (2.0.2): an explicit negative answer stops here, before
            // any proof or registration request, with the unsupported-phone
            // message: the proof cannot run on this phone. No probe (iOS,
            // older binary) continues exactly as before. Only the status word
            // is logged: the loader's text carries a per-install path.
            await assertProverCanRun(t('voting.errors.unsupportedPhone'));

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
            // The bootstrap-and-retry itself lives in register-via-noir.ts so
            // the french-id-test dev screen runs the identical path; all this
            // branch adds is the user-facing status text.
            ecSizeInBits = eDoc.sod.encapsulatedContent.length * 8;
            heavyProof = await generateHeavyNoirProofWithCscaBootstrap(
              eDoc,
              skIdentityHex,
              heavyCircuitName,
              () => say(t('voting.step7Registering')),
            );
          };

          const submit = async (): Promise<{ txHash?: string }> => {
            if (useHeavyPath) {
              if (!heavyCircuitName || !heavyProof) {
                throw new Error('[Step7] no registration proof to send');
              }
              const { txHash } = await registerIdentityViaNoir({
                network: 'mainnet',
                noirProof: heavyProof,
                // The marker this POST writes belongs to THIS run, not to
                // whatever document was scanned meanwhile (wave 2a, constat 1).
                pendingOwner,
                // SAME value that selected the bytecode above. This string is
                // the sole input to the on-chain zkType
                // (keccak("Z_NOIR_PASSPORT_" + suffix)), and a mismatch would
                // be silent — a perfectly valid proof declared as the wrong
                // circuit. Hence one variable, used twice.
                circuitName: heavyCircuitName,
                // No Active Authentication on either French document (both
                // circuits compile against `dg15: [u8; 0]`) — pass empty bytes
                // so buildRegisterViaNoirCalldata picks the P_NO_AA dispatcher
                // (keccak("P_NO_AA")) and emits empty signature/publicKey
                // fields in the Passport struct.
                aaPubKeyPem: new Uint8Array(),
                aaSignature: new Uint8Array(),
                // Computed from the actual eContent, so it is already right for
                // both shapes (297 B for TD3, 313 B for TD1).
                ecSizeInBits,
              });
              console.log(`[Step7][mainnet] registerViaNoir submitted ${loggableTxHash(txHash)}`);
              return { txHash };
            }
            // Light path: one call, never wrapped in a retry. withRetry here
            // re-POSTed after a network error, when the first request may have
            // reached the registrator (R3).
            try {
              await captured.rarime.registerIdentity(passport);
            } catch (e) {
              if (isServiceUnavailableError(e) && !/\b[45]\d\d\b/.test(String((e as any)?.message ?? ''))) {
                throw new Error(`${REGISTRATION_OUTCOME_UNKNOWN} light registrator answer lost`);
              }
              throw e;
            }
            console.log(`[Step7][${captured.network}] light register submitted (${isTd3 ? 'TD3' : 'TD1'})`);
            return {};
          };

          // The submission as a state machine (utils/registration-submission.ts,
          // dossier 2.0.2 R3 / item 3): the in-flight marker is taken before
          // the proof, a second run for this document adopts the first run's
          // outcome, a lost answer is never re-sent, and the foreground wait
          // runs up to 300 s with its own keep-awake. It keeps running after
          // this screen goes away; only the UI hooks are dropped (say / alive).
          //
          // Mainnet waits for the registration to land in the RegistrationSMT
          // before declaring success: the relayer ACKs when it broadcasts, not
          // when the tx lands, and the vote's pre-flight SMT read would
          // otherwise race the chain.
          await runRegistration({
            network: captured.network,
            passportHash: captured.passportHash,
            privateKey: captured.privateKey,
            prove,
            submit,
            confirmOnChain: captured.network === 'mainnet',
            readStatus: async () => {
              const s = await captured.rarime.getDocumentStatus(passport);
              console.log('[Step7] Document status:', s);
              return s === DocumentStatus.RegisteredWithThisPk
                ? 'this-key'
                : s === DocumentStatus.NotRegistered
                  ? 'not-registered'
                  : 'other';
            },
            pollOnce: async () => {
              try {
                const smtProof = await captured.rarime.getSMTProof(passport);
                return smtProof.existence ? 'found' : 'absent';
              } catch (e: any) {
                // A gateway 5xx (HTML body) is "unknown", retried with backoff,
                // and never logged or shown.
                if (isTransientRpcError(e)) return 'transient';
                console.log('[Step7][mainnet] SMT poll err:', String(e?.message ?? e).slice(0, 160));
                return 'absent';
              }
            },
            onResume: (cb) => {
              const sub = AppState.addEventListener('change', (s) => {
                if (s === 'active') cb();
              });
              return () => sub.remove();
            },
            keepAwake: { activate: activateKeepAwakeAsync, deactivate: deactivateKeepAwake },
            // The slot belongs to THIS attempt: armed before the proof, marked
            // before the POST, and only ever cleared by its own owner, so a run
            // for another document never throws away the trace this one is
            // relying on. TODO(PROTOCOL-LEAD-B): marker shape awaiting Rarimo
            // confirmation (utils/registration-pending-slot.ts).
            pendingSlot: (() => {
              const attempt = {
                network: captured.network,
                passportHash: captured.passportHash,
                privateKey: captured.privateKey,
              };
              // Every write names THIS run explicitly. Nothing reads a shared
              // "currently armed attempt" any more: a second document scanned
              // while this proof runs used to steal the marker (wave 2a,
              // constat 1).
              return {
                ageMs: () => pendingSlotAgeMs(Date.now(), attempt),
                arm: () => { pendingOwner = armPendingSlot(attempt); },
                markSent: () =>
                  markRegistrationSent({ network: captured.network, owner: pendingOwner }),
                write: () =>
                  writePendingSlot({ network: captured.network, owner: pendingOwner }),
                clear: () => clearPendingSlot(pendingOwner),
              };
            })(),
            ui: {
              confirming: () => say(t('voting.step7Confirming')),
              stillConfirming: () => say(t('voting.step7StillConfirming')),
            },
            log: (l) => console.log(l),
          });
          if (captured.network === 'mainnet') console.log('[Step7][mainnet] SMT confirmed');
        }

        if (!alive()) {
          console.log('[Step7] step inactive at completion — skipping onSuccess');
          return;
        }
        hasCalledCallback.current = true;
        // The CSCA masters and their merkle tree have done their job — nothing
        // downstream of here needs them, and the vote proof that follows is the
        // memory peak of the session. Give them back before it starts.
        // Only the build this run warmed: a newer run's build is not ours.
        if (mastersGeneration !== null) {
          const generation = mastersGeneration;
          import('@/utils/csca-bootstrap')
            .then((m) => m.releaseMastersCache(generation))
            .catch(() => {});
        }
        console.log(`[Step7] Verification complete — calling onSuccess (didRegister=${needsRegistration})`);
        say(t('voting.step7Verified'));
        onSuccess?.(needsRegistration);
      } catch (err: any) {
        console.error('[Step7] Verification error:', err);
        if (!alive()) {
          console.log('[Step7] step inactive at error — skipping onError');
          return;
        }
        hasCalledCallback.current = true;
        // Sentinels ([VOTE_INELIGIBLE], [CSCA_MISSING], the relayer dry run's
        // [IDENTITY_BOUND_ELSEWHERE] / [REGISTRATION_REVERT]), device storage,
        // service down, then formatRpcError — see utils/step7-error-message.ts.
        const text = step7ErrorMessage(err, {
          docSfx,
          keyLinkedToOtherDocument,
          t,
          fallback: formatRpcError,
        });
        // Whatever the class, the user stays here with this message —
        // voting-flow's handleVerificationError never advances.
        setErrorMessage(text);
        setErrorObject(err);
        onError?.(text, err);
      }
    })();
  }, [hasStarted, rarime, passport, attemptKey, initError, freedomTool, onSuccess, onError]);

  return (
    // Bounded and scrollable (QA 2.0.2, item 3): at font scale 1.3 on a
    // 320 x 568 screen "Relancer le vote" ended ~154 dp below the screen.
    <View style={[{ width: containerWidth }, slideBoxStyle(slideAreaHeight)]} onLayout={onLayout}>
      <ScrollView
        style={{ flex: 1, width: '100%' }}
        contentContainerStyle={slideScrollContent(stepSpecificStyles.step7Container)}
        bounces={false}
      >
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

        {/* Step 7's errors are terminal — voting-flow keeps the user here with
            only the X, so without this the screen is a dead end and the
            failure never reaches us. Step6 and Step12Error have carried this
            button for a while; Step 7 was the gap, which is why registration
            failures are the ones we hear about second-hand.
            ErrorReportButton hides itself for failures we already explain
            (isExpectedError), so predictable NFC/network noise stays quiet.
            forceShow overrides that for a registration-service failure: its
            "network request failed" surface overlaps isExpectedError and would
            otherwise be swallowed, and it is precisely the failure — relayer
            down vs proof reverting on chain — that we can only tell apart from
            a report. */}
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
            {dg11Fields?.placeOfBirth && (
              <Text style={{
                fontFamily: Typography.fontFamily.medium,
                fontSize: Typography.fontSize.small,
                color: colors.text,
                opacity: 0.7,
              }}>
                {t('voting.step7PlaceOfBirth', { value: dg11Fields.placeOfBirth })}
              </Text>
            )}
            {dg11Fields?.personalNumber && (
              <Text style={{
                fontFamily: Typography.fontFamily.medium,
                fontSize: Typography.fontSize.small,
                color: colors.text,
                opacity: 0.7,
              }}>
                {t('voting.step7PersonalNumber', { value: dg11Fields.personalNumber })}
              </Text>
            )}
          </View>
        )}
      </ScrollView>
      {/* The actions in a fixed footer, outside the scroll (2026-09-24, measured
          on an iPhone SE at text size 1.3: "Relancer le vote" ended 16 pt under
          the bottom of the window on the registration-pending and
          outcome-unknown states). The message above scrolls; the way out and
          the report button never move. Rendered only when one of them shows,
          so the verification states keep their layout. */}
      {errorMessage &&
        ((errorObject != null && !isOtherKeyRefusal(errorObject)) ||
          ((isOtherKeyRefusal(errorObject) ||
            isRegistrationPending(errorObject) ||
            isOutcomeUnknown(errorObject) ||
            isStatusReadTimeout(errorObject)) &&
            onRestart)) && (
        <View style={[slideFooterStyle(colors, Spacing.modal.step12ErrorPadding), { gap: 12 }]}>
        {errorMessage && errorObject != null && !isOtherKeyRefusal(errorObject) && (
          <ErrorReportButton
            error={errorObject}
            forceShow={isServiceUnavailableError(errorObject)}
            context={{ step: 7, network, isPassportFlow, docType: docSfx }}
          />
        )}

        {/* "Another key" is an expected refusal (dossier 2.0.2, item 14 e):
            no report button, and the first thing to try is a clean restart,
            which re-resolves the key and re-reads the status. */}
        {errorMessage &&
          (isOtherKeyRefusal(errorObject) ||
            isRegistrationPending(errorObject) ||
            // The lost-answer case shows the same "relancez le vote" text as
            // pending: it needs the same button (QA 2.0.2, item 9).
            isOutcomeUnknown(errorObject) ||
            isStatusReadTimeout(errorObject)) &&
          onRestart && (
          <TouchableOpacity
            style={stepSpecificStyles.step12ErrorButton}
            activeOpacity={0.8}
            onPress={onRestart}
            accessibilityRole="button"
          >
            <Text style={stepSpecificStyles.step12ErrorButtonText}>
              {t('voting.step7RestartVote')}
            </Text>
          </TouchableOpacity>
        )}

        </View>
      )}
    </View>
  );
};

export default Step7;
