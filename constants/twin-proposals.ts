/**
 * Declared twin proposals, passport id → ID-card id.
 *
 * The list already pairs same-question proposals by title and options on its
 * own (utils/proposal-pairing.ts). An entry here pins a pair whatever the
 * metadata says — this is where the table goes when a question is created on
 * both contracts and one of the two texts came out a character different.
 * Mainnet ids only; the key is the passport-contract id.
 */
export const TWIN_PROPOSALS: Readonly<Record<string, string>> = {
  '68': '69', // TEST DOUBLE — passeport et carte (2026-09-12)
  '70': '71', // TEST DOUBLE 18+ — FRA, 18+, expiry, no max age (2026-09-13)
  '72': '73', // Le référendum d'initiative citoyenne — main question, 15 Sept → 24 Dec 2026
};
