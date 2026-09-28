import React, { useState, useEffect, useRef } from 'react';
import { View, Text, LayoutChangeEvent } from 'react-native';
import LottieView from 'lottie-react-native';
import { createStepSpecificStyles, slideFrameStyle } from './styles';
import { useColors, Typography } from '@/constants/theme';
import { getFreedomToolConfig, type Network } from '@/constants/rarime-config';
import type { ProposalInfo, Rarime, RarimePassport, FreedomTool } from '@rarimo/rarime-rn-sdk';
import { useTranslation } from 'react-i18next';
import { Buffer } from 'buffer';
import { ensureCircuitsReady } from '@/utils/circuit-preload';
import { prepareMainnetVote, submitPreparedVote } from '@/utils/mainnet-vote-flow';
import { assertBirthDateEligible, todayMrzUtc } from '@/utils/mrz-date-bounds';
import { readLocalProposalIndex } from '@/utils/proposal-index';
import {
  checkVoteEligibility,
  localEligibilityContext,
  type IneligibilityReason,
  type VoteDocument,
} from '@/utils/vote-eligibility';
import {
  ballotMayBeOnChain,
  classifyVoteError,
  codeForIneligibility,
  voteErrorMessage,
  votePostBoundFired,
  votePostMaybeSent,
  VoteRefusal,
  type VoteErrorCode,
} from '@/utils/vote-error-table';
import {
  BOUND_RECHECK_ATTEMPTS,
  BOUND_RECHECK_DELAY_MS,
  clearOutcome,
  decideAfterPost,
  decideBeforeAttempt,
  voteAttemptKey,
} from '@/utils/vote-attempt';
import { waitForVoteReceipt } from '@/utils/vote-confirmation';
import { purgeVoteTrace, registerPublicAddress } from '@/utils/logger';
import { isMockBackend, mockDelay, mockTxHash } from '@/constants/mock-backend';

// The slide's height comes from the measured slide area (slideFrameStyle,
// QA 2.0.2 item 12), no longer from 75 % of the window.

interface Step11Props {
  containerWidth: number;
  isActive?: boolean;
  /** `confirmed` reflects the on-chain receipt: true = mined with status 1,
   * false = submitted but not yet confirmed (Step12 shows a neutral pending
   * message rather than a definitive success). A reverted tx never calls this
   * — it routes to onError instead. */
  onSuccess?: (txHash: string, confirmed: boolean) => void;
  /** `code` is the vote-error table entry (utils/vote-error-table.ts): it,
   * not the translated `reason`, decides Retry and the report button. */
  onError?: (reason?: string, error?: unknown, code?: VoteErrorCode) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  freedomTool?: FreedomTool;
  rarime?: Rarime;
  passport?: RarimePassport;
  proposalInfo?: ProposalInfo;
  answerIndex?: number;
  /** Active network from NetworkContext. The vote path is picked by both
   * network *and* document type (confirmed with Rarimo team 2026-05-21):
   *
   *   TD3 (passport) + mainnet → Groth16 pipeline (utils/mainnet-vote-flow.ts).
   *     The deployed BioPassportVoting (0x8Dea…) is Groth16; the SDK's
   *     Noir path doesn't match its ABI.
   *
   *   everything else → freedomTool.submitProposal(). The SDK auto-routes
   *     via `proposalInfo.sendVoteContractAddress` to IDCardVoting/
   *     executeTD1Noir (TD1) or BioPassportVoting/executeNoir (TD3 testnet),
   *     and posts to the v3 vote relayer. Base URLs come from the network-
   *     specific FreedomTool config so the same call works on both networks.
   */
  network?: Network;
  /** The document the user actually chose. Do not re-derive this from the
   * loaded passport: the one branch that shows document-specific copy is the
   * missing-data timeout, which by definition fires when `passport` is absent,
   * so deriving it there always yielded the ID-card wording. */
  isPassportFlow?: boolean;
  /** The BJJ key resolved for THIS document in this attempt, the same one the
   * SDK instance was built with (voting-flow, dossier 2.0.2 R2). The passport
   * vote proves with it; it is never re-read from the global slot, which a
   * later scan of another document may have rewritten. */
  privateKey?: string;
  /** devMode && isBetaBuild(): the eligibility rule then waives the index
   * listing only (utils/vote-eligibility.ts). */
  devAllowed?: boolean;
  /** Measured slide area (voting-flow). */
  slideAreaHeight?: number;
  /** Overrides the 15 s missing-data timeout. Only the QA gallery passes it:
   *  the state it publishes as "Préparation..." must still be that state when
   *  the run reaches it (QA iPhone 2.0.2, item 1). */
  missingDataTimeoutMs?: number;
}

/** How long step 11 waits for the SDK refs before it calls it a failure. */
export const STEP11_MISSING_DATA_TIMEOUT_MS = 15_000;

const Step11: React.FC<Step11Props> = ({
  containerWidth,
  isActive,
  onSuccess,
  onError,
  onLayout,
  freedomTool,
  rarime,
  passport,
  proposalInfo,
  answerIndex,
  network = 'testnet',
  isPassportFlow = false,
  privateKey,
  devAllowed = false,
  slideAreaHeight,
  missingDataTimeoutMs = STEP11_MISSING_DATA_TIMEOUT_MS,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [statusText, setStatusText] = useState('');
  const hasCalledCallback = useRef(false);
  const isSubmitting = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);

  // The Groth16 mainnet path (TD3 only) bypasses the SDK entirely; every
  // other path needs freedomTool. Default isTd3=false until passport loads
  // so we don't drop the freedomTool requirement prematurely.
  const isTd3Doc = !!passport && passport.dataGroup1.length === 93;
  // Suffix for doc-type-aware keys (step11MissingData, step11AlreadyVoted).
  // Comes from the user's choice, not from isTd3Doc: step11MissingData is shown
  // precisely when `passport` never arrived, so deriving it from the passport
  // meant a passport voter was always told to "scan your ID card first".
  const docSfx = isPassportFlow ? 'passport' : 'idCard';
  const usesGroth16MainnetPath = network === 'mainnet' && isTd3Doc;
  const canSubmitReal = usesGroth16MainnetPath
    ? rarime && passport && proposalInfo && answerIndex !== undefined
    : freedomTool && rarime && passport && proposalInfo && answerIndex !== undefined;

  useEffect(() => {
    if (isActive && !hasStarted) {
      setHasStarted(true);
      hasCalledCallback.current = false;
      isSubmitting.current = false;
      setStatusText(t('voting.step11Preparing'));
    } else if (!isActive && hasStarted) {
      // Same race as Step 7 — see that file's comment. Don't clear the
      // ref guards on deactivation; the submit effect would otherwise re-fire
      // in the same commit and trigger a duplicate vote-submit.
      setHasStarted(false);
    }
  }, [isActive, hasStarted]);

  // Fallback: if the required refs somehow never arrive, fail after a
  // generous timeout instead of waiting forever.
  useEffect(() => {
    if (!hasStarted || hasCalledCallback.current) return;
    if (canSubmitReal) return;
    const timer = setTimeout(() => {
      if (hasCalledCallback.current || canSubmitReal) return;
      hasCalledCallback.current = true;
      const msg = t(`voting.step11MissingData_${docSfx}`);
      // This fires when the user reached the vote step WITHOUT the NFC scan /
      // registration refs (see the #54 step-skip reports). Log it (this path
      // was previously silent) and pass the localized reason through so
      // Step12Error shows "scannez d'abord votre document" instead of the
      // meaningless "Unknown vote error".
      console.warn(`[Step11] missing-data timeout (${missingDataTimeoutMs}ms) — rarime/passport/proposal refs never arrived`);
      setStatusText(msg);
      onError?.(msg, undefined, 'missing-data');
    }, missingDataTimeoutMs);
    return () => clearTimeout(timer);
  }, [hasStarted, canSubmitReal, onError, t, missingDataTimeoutMs]);

  useEffect(() => {
    if (!hasStarted || hasCalledCallback.current || isSubmitting.current) return;

    // Same wait pattern as Step 7: refs may be populated asynchronously by
    // voting-flow's init. Only hard-fail with "missing data" if they never
    // arrive (see timeout below).
    if (!canSubmitReal) return;

    isSubmitting.current = true;
    (async () => {
      if (isMockBackend()) {
        // Beta build: skip the relayer / proof generation / on-chain submit
        // entirely and simulate the same status-text sequence, so the vote
        // UX still feels real. See constants/mock-backend.ts.
        setStatusText(t('voting.step11Preparing'));
        await mockDelay(700);
        setStatusText(t('voting.step11GeneratingProof'));
        await mockDelay(1000);
        setStatusText(t('voting.step11Confirming'));
        await mockDelay(700);
        hasCalledCallback.current = true;
        const fakeTxHash = mockTxHash();
        console.log('[Step11][mock] simulated vote success — no relayer/on-chain calls made:', fakeTxHash);
        onSuccess?.(fakeTxHash, true);
        return;
      }

      // Everything this attempt votes with, captured once: a proposal refresh,
      // a new scan or a re-render during the 3 to 5 minutes of the proof
      // changes nothing about what is proved and sent.
      const attempt = Object.freeze({
        freedomTool: freedomTool,
        rarime: rarime!,
        passport: passport!,
        proposal: proposalInfo!,
        answer: answerIndex!,
        document: (isTd3Doc ? 'passport' : 'idCard') as VoteDocument,
        // The key captured for this document at step 7 (R2), frozen with the
        // rest: the passport vote proves with it, never with the global slot.
        privateKey,
      });
      // One UTC date for the attempt (R5): captured right before the age
      // check, handed to the SDK for its own pre-check and the proof input.
      let attemptDate: string | null = null;

      const fail = (code: VoteErrorCode, error?: unknown) => {
        hasCalledCallback.current = true;
        // The ballot may be on chain (R4): this attempt's lines, the one
        // above included, leave the log before the error screen or any report
        // can be built (R8, utils/logger.ts::purgeVoteTrace).
        if (ballotMayBeOnChain(code, error)) void purgeVoteTrace();
        const msg = voteErrorMessage(t, code, docSfx);
        setStatusText(msg);
        onError?.(msg, error ?? new VoteRefusal(code), code);
      };

      // The eligibility rule every entry point shares (utils/vote-eligibility.ts),
      // on the local index only. Run before any proof and again on a failure.
      const localIneligibility = async (): Promise<IneligibilityReason | null> => {
        try {
          const index = await readLocalProposalIndex();
          const verdict = checkVoteEligibility(
            attempt.proposal,
            attempt.document,
            localEligibilityContext(index, network, devAllowed),
          );
          return verdict.ok ? null : verdict.reason;
        } catch {
          // Unreadable local lists: refuse rather than guess.
          return 'not-listed';
        }
      };

      // The one approved status re-read (R4): the request this step already
      // makes before a vote, reused, never a new one.
      const readAlreadyVoted = async (): Promise<boolean> => {
        if (!attempt.freedomTool) throw new Error('no status reader');
        return attempt.freedomTool.isAlreadyVoted(attempt.proposal, attempt.rarime);
      };
      let documentId = 'document';
      try {
        documentId = String(attempt.passport.getPassportHash());
      } catch {
        // Keeps the key per proposal and network; in memory only either way.
      }
      const outcomeKey = voteAttemptKey(network, attempt.proposal.id, documentId);

      // Gate "success" on the on-chain receipt, NOT on the relayer ACK. The
      // relayer returns a tx hash the moment it broadcasts; a tx that later
      // reverts (identity registered after the proposal cutoff, failed proof,
      // used nullifier) still has a hash and decodable vote calldata. Poll the
      // receipt: status 1 → success; status 0 → surface as an error (vote NOT
      // registered); still-pending at timeout → optimistic success flagged
      // unconfirmed so Step12 shows a neutral "awaiting confirmation" message.
      const confirmAndFinish = async (txHash: string) => {
        hasCalledCallback.current = true;
        clearOutcome(outcomeKey);
        setStatusText(t('voting.step11Confirming'));
        try {
          const { JsonRpcProvider } = await import('ethers');
          const rpcUrl = getFreedomToolConfig(network).api.votingRpcUrl;
          const outcome = await waitForVoteReceipt(new JsonRpcProvider(rpcUrl), txHash);
          if (outcome === 'reverted') {
            console.warn('[Step11] vote tx reverted on-chain:', txHash);
            fail('reverted');
            return;
          }
          // The vote is on chain: its trace leaves the ring buffer and the
          // crash tail before anything else can read it (R8). voting-flow
          // purges again on entering step 12; a second purge is harmless.
          void purgeVoteTrace();
          onSuccess?.(txHash, outcome === 'success');
        } catch (confirmErr: any) {
          // Couldn't read the receipt (RPC down). Don't claim failure on a tx
          // that may well have succeeded — show optimistic + unconfirmed.
          console.warn('[Step11] receipt confirmation failed:', confirmErr?.message ?? confirmErr);
          void purgeVoteTrace();
          onSuccess?.(txHash, false);
        }
      };

      // The vote is on chain but its transaction id is lost with the answer:
      // the success screen, "confirmation en attente", no serial number.
      const finishPending = () => {
        hasCalledCallback.current = true;
        console.log('[Step11] vote found on chain after a lost answer: confirmation pending');
        // A post-POST network error followed by a vote found on chain (R4):
        // purged like any successful vote (R8).
        void purgeVoteTrace();
        onSuccess?.('', false);
      };

      try {
        // Refused locally before anything else: no proof, no request.
        const refusal = await localIneligibility();
        if (refusal) {
          console.log(`[Step11] proposal #${attempt.proposal.id} refused locally before the proof: ${refusal}`);
          fail(codeForIneligibility(refusal));
          return;
        }

        // A previous POST of this very vote got no answer: never send a second
        // one while the first may still land (R4).
        const before = await decideBeforeAttempt({ key: outcomeKey, read: readAlreadyVoted });
        if (before === 'success-pending') {
          finishPending();
          return;
        }
        if (before === 'still-unknown') {
          console.log('[Step11] previous vote outcome still unknown: not sending again');
          fail('outcome-still-unknown');
          return;
        }

        // ----------------------------------------------------------------
        // Vote-path routing (by network + doc type, see props comment):
        //
        //   TD3 + mainnet  → prepareMainnetVote() + submitPreparedVote()
        //                    Groth16 against BioPassportVoting (this branch).
        //                    Those two are what castMainnetVote composes; this
        //                    branch calls them separately only so the verifier
        //                    rehearsal can run in the gap between them.
        //
        //   everything else → freedomTool.submitProposal() Noir, SDK auto-
        //                    routes destination per proposal.sendVoteContract
        //                    (the testnet branch below). Covers TD1 on both
        //                    networks + TD3 testnet.
        // ----------------------------------------------------------------
        if (usesGroth16MainnetPath) {
          const p = attempt.passport;
          const proposal = attempt.proposal;
          const ai = attempt.answer;

          setStatusText(t('voting.step11Preparing'));
          const mrzData = p.getMRZData();
          // Age rule, with the circuit's century reading and the attempt's UTC
          // day — a French refusal now rather than a witness error later.
          attemptDate = todayMrzUtc();
          assertBirthDateEligible(mrzData.birthDate, proposal.criteria, attemptDate);
          // The attempt's own key, captured before the registration (R2). No
          // fallback to the global slot: proving with another document's key
          // is exactly the failure this prop exists to rule out.
          const sk = attempt.privateKey;
          if (!sk) throw new Error('[Step11] no key was resolved for this document in this attempt');
          const passportHashBig = p.getPassportHash();
          // RarimeUtils.getProfileKey returns the 64-char hex profile key
          // (Poseidon of the BJJ pubpoint). We import it lazily to avoid
          // pulling the SDK into the module evaluation cost on testnet.
          const { RarimeUtils } = await import('@rarimo/rarime-rn-sdk');
          const profileKeyHex = RarimeUtils.getProfileKey(sk);

          // answerIndex omitted — anonymous vote (see Step9Vote comment).
          console.log(`[Step11][mainnet] casting vote on proposal #${proposal.id}`);
          setStatusText(t('voting.step11GeneratingProof'));

          // Split at the seam rather than calling castMainnetVote: everything
          // the verifier rehearsal needs — the Groth16 proof and the proposal's
          // event id — is function-local inside preparation and was previously
          // discarded. castMainnetVote is still exactly these two calls; see
          // utils/mainnet-vote-flow.ts.
          const prepared = await prepareMainnetVote({
            dg1: new Uint8Array(p.dataGroup1),
            bjjPrivateKeyHex: sk,
            passportHash: passportHashBig,
            profileKey: '0x' + profileKeyHex,
            proposalId: Number(proposal.id),
            citizenship: mrzData.issuingCountry,
            voteIndices: [ai],
            // The same captured date the age pre-check above used, exactly as
            // the card path passes it at the submitProposal call (R5, wave 2a
            // constat 2). Parked behind CARD_ONLY_LAUNCH, correct anyway.
            ...(attemptDate ? { currentDate: attemptDate } : {}),
            // On first vote ever, the 757 MB zkey download dominates. Surface
            // progress through the status line so the user isn't staring at
            // a silent spinner for many minutes.
            onZkeyProgress: (p) => {
              if (p.totalBytesExpectedToWrite > 0) {
                const pct = Math.round(
                  (p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100,
                );
                setStatusText(t('voting.step11DownloadingData', { percent: pct }));
              }
            },
          });

          const { txId } = await submitPreparedVote(prepared);
          console.log('[Step11][mainnet] vote tx id:', txId);
          await confirmAndFinish(txId);
          return;
        }

        // ----------------------------------------------------------------
        // SDK Noir flow (freedomTool.submitProposal). Covers everything
        // except TD3-on-mainnet: TD1 testnet, TD1 mainnet, TD3 testnet.
        // The SDK reads proposalInfo.sendVoteContractAddress to pick the
        // right destination (IDCardVoting vs BioPassportVoting) and
        // selects executeTD1Noir vs executeNoir per doc type internally.
        // ----------------------------------------------------------------
        const ft = attempt.freedomTool!;
        const r = attempt.rarime;
        const p = attempt.passport;
        const proposal = attempt.proposal;
        const ai = attempt.answer;
        // Pre-check: already voted?
        setStatusText(t('voting.step11Preparing'));
        const alreadyVoted = await ft.isAlreadyVoted(proposal, r);
        if (alreadyVoted) {
          console.log('[FreedomTool] Step11: Already voted on this proposal');
          fail('already-voted');
          return;
        }

        // Make sure the Noir trusted setup + circuit bytecode are on disk
        // before calling submitProposal. Normally preloaded on the home
        // screen, but surface progress here as a fallback so the user
        // isn't staring at a silent spinner for several minutes.
        try {
          await ensureCircuitsReady((p) => {
            if (p.stage === 'trusted-setup' || p.stage === 'bytecode') {
              const percent = Math.max(0, Math.min(100, Math.round(p.overallPercent * 100)));
              setStatusText(t('voting.step11DownloadingData', { percent }));
            } else if (p.stage === 'checking') {
              setStatusText(t('voting.step11FinalizingData'));
            }
          });
        } catch (dlErr: any) {
          console.error('[FreedomTool] Step11: Circuit preload failed:', dlErr);
          fail('download-failed', dlErr);
          return;
        }

        setStatusText(t('voting.step11GeneratingProof'));
        const mrzData = p.getMRZData();
        // Age rule, checked here with the circuit's own century reading so a
        // refusal is a French sentence and not a witness error five minutes
        // in (utils/mrz-date-bounds.ts). Same UTC day as the proof.
        attemptDate = todayMrzUtc();
        assertBirthDateEligible(mrzData.birthDate, proposal.criteria, attemptDate);
        const citizenshipHex = BigInt("0x" + Buffer.from(mrzData.issuingCountry).toString("hex")).toString();
        console.log(`[FreedomTool] Step11: Submitting vote...`);
        console.log(`[FreedomTool] Step11: proposal=#${proposal.id} "${proposal.title}"`);
        // answerIndex / variant intentionally NOT logged — anonymous vote.
        // SECURITY: `issuingCountry` is a 3-letter country code (too short
        // for the digit-length filter); the redaction labels catch
        // `citizenship` but the trailing `(FRA)` in parens would still
        // leak the country. Gate the per-user nationality dump out of
        // release builds entirely. The citizenshipWhitelist + selector +
        // sendVoteContract are properties of the proposal, not the
        // voter, and are safe to keep.
        if (__DEV__) {
          console.log(`[FreedomTool] Step11: citizenshipMask=${citizenshipHex} (${mrzData.issuingCountry})`);
        }
        console.log(`[FreedomTool] Step11: citizenshipWhitelist=[${proposal.criteria.citizenshipWhitelist.map(String).join(', ')}]`);
        // Public infrastructure, not identity — allowlist it so the redactor
        // doesn't mask the one address a failed vote needs to name.
        registerPublicAddress(proposal.sendVoteContractAddress);
        console.log(`[FreedomTool] Step11: selector=${proposal.criteria.selector}, sendVoteContract=${proposal.sendVoteContractAddress}`);

        // Pre-flight eligibility via the SDK's own check. This looks at voting
        // period and already-voted — it does NOT compare passport.issueTimestamp
        // to criteria.timestampUpperbound, because the SDK's buildQueryProofParams
        // deliberately bypasses that bound (UINT64_MAX-1) for recently re-registered
        // identities so they can still vote on open proposals.
        try {
          await ft.verify(proposal, p, r, attemptDate);
        } catch (vErr: any) {
          console.warn('[Step11] SDK verify() rejected:', vErr?.message);
          throw vErr;
        }

        // No withRetry here on purpose: submitProposal runs the full ~3–5 min
        // proof generation. Retrying a failure re-runs the whole thing and on
        // Android tends to leave the HTTP stack in a worse state (see logs
        // showing JsonRpcProvider "failed to detect network" after repeated
        // FileSystemLegacyModule aborts). Surface the error; let the user
        // retry from a clean slate.
        const txHash = await ft.submitProposal({
          answers: [ai],
          proposalInfo: proposal,
          rarime: r,
          passport: p,
          currentDate: attemptDate,
        });

        console.log('[FreedomTool] Step11: Vote TX hash:', txHash);
        await confirmAndFinish(txHash);
      } catch (err: any) {
        console.error('[FreedomTool] Step11: Vote error:', err);
        console.error('[FreedomTool] Step11: Error details:', JSON.stringify({ message: err?.message, code: err?.code, data: err?.data, status: err?.status }, null, 2));
        hasCalledCallback.current = true;
        // Language-independent: the table code, not the text, decides what
        // the voter reads, whether Retry is offered, and the report button.
        const ineligibleNow = await localIneligibility();
        const dateChanged = attemptDate !== null && attemptDate !== todayMrzUtc();
        let code = classifyVoteError(err, { localIneligibility: ineligibleNow, dateChanged });

        // R4: the vote POST may have left. Re-read the status once before
        // showing anything; never "not recorded" once the POST left.
        if (votePostMaybeSent(err) && (code === 'outcome-unknown' || code === 'relayer-server')) {
          // REG-11. One read is the right question after a lost answer: the
          // relayer had broadcast long before the connection dropped, so the
          // chain already knows. It is the wrong question at the instant the
          // 90 s bound fires, because that is exactly the statement that the
          // relayer is still working, and a vote seconds from landing then
          // read as "issue inconnue" where 2.0.1, which had no bound, showed
          // the success screen. The bound stays and nothing is POSTed twice:
          // the phone simply keeps asking the chain for a bounded while, and
          // says so instead of freezing.
          const boundFired = votePostBoundFired(err);
          if (boundFired) setStatusText(t('voting.step11Confirming'));
          const decision = await decideAfterPost({
            key: outcomeKey,
            outcomeUnknown: code === 'outcome-unknown',
            read: readAlreadyVoted,
            ...(boundFired
              ? {
                  recheck: {
                    attempts: BOUND_RECHECK_ATTEMPTS,
                    delayMs: BOUND_RECHECK_DELAY_MS,
                    onWaiting: () => setStatusText(t('voting.step11Confirming')),
                  },
                }
              : {}),
          });
          if (decision.kind === 'success-pending') {
            finishPending();
            return;
          }
          if (decision.kind === 'unknown') code = 'outcome-unknown';
        }
        console.log(`[Step11] vote failed: ${code}`);
        fail(code, err);
      }
    })();
  }, [hasStarted, canSubmitReal, freedomTool, rarime, passport, proposalInfo, answerIndex, privateKey, onSuccess, onError, network, devAllowed, isTd3Doc, docSfx]);

  return (
    <View style={[{ width: containerWidth }, slideFrameStyle(slideAreaHeight)]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step11Container}>
        <LottieView
          source={require('@/assets/animations/loading.json')}
          style={stepSpecificStyles.step11Loading}
          autoPlay
          loop
        />

        <Text style={{
          fontFamily: Typography.fontFamily.medium,
          fontWeight: Typography.fontWeight.medium,
          fontSize: Typography.fontSize.small,
          color: colors.text,
        }}>
          {statusText}
        </Text>
      </View>
    </View>
  );
};

export default Step11;
