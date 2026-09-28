/**
 * Where the beta finds its test scrutins.
 *
 * The signed index (`public-data/proposals.json`) is what every build shows
 * by default: `active` to everyone, `devOnly` in dev mode. The beta adds,
 * in dev mode only, whatever exists on chain from the floor below upward
 * (utils/proposal-discovery.ts), so a freshly created test scrutin appears
 * with nothing to edit and nothing to sign. Outside dev mode the beta shows
 * exactly the store list, so a tester sees what a voter will see.
 *
 * Until 2026-09-14 the beta also showed signed devOnly ids at or above the
 * floor, and everything discovered on chain, WITHOUT dev mode; the launch
 * list made that a liability (test scrutins next to the real question).
 */
import { isBetaBuild } from './app-flavour';

export const AUTO_VISIBLE_PROPOSAL_ID_FROM = 52;

/** True when a proposal id is at or above the auto-visible floor. Tolerant of
 *  string ids and junk — anything non-numeric is not auto-promoted. */
export function isAutoVisibleProposalId(id: string | number): boolean {
  const n = typeof id === 'number' ? id : parseInt(id, 10);
  return Number.isFinite(n) && n >= AUTO_VISIBLE_PROPOSAL_ID_FROM;
}

/**
 * On the Beta flavour, in dev mode, also find the proposals on chain.
 *
 * The index is published from the PRODUCTION repo and served to the production
 * app. Adding a test scrutin to it so Beta can reach it would also put it in
 * front of real voters — the exact thing the index exists to prevent. That
 * leaves the test build depending on a file it must not edit, while test
 * proposals get created faster than anyone wants to publish a signed list.
 *
 * So Beta walks ProposalsState from the floor upward and takes what is there
 * (utils/proposal-discovery.ts): a new scrutin appears as soon as it exists,
 * with nothing to edit and nothing to sign.
 *
 * Production keeps the index, deliberately. Curation is the point there — a
 * voter should see the scrutins the team published, not every test proposal
 * that happens to be on chain. Keyed off the bundle id, the only thing that
 * really separates the two builds: `…fr.beta` against `…fr`.
 */
export function discoverProposalsFromChain(): boolean {
  return isBetaBuild();
}
