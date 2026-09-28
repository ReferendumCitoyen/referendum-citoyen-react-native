/**
 * REG-10: when the eligibility rule refuses, the voter is told why.
 *
 * 2.0.1 showed the Vote button for every active single-question proposal, and
 * its one refusal, a multi-question ballot, had a greyed button carrying a
 * sentence. 2.0.2 added four rules that can refuse (the pinned contract list,
 * the on-chain rules read, the published minimum version and the citizenship
 * filter) and rendered the button only when the verdict was ok. Every other
 * outcome rendered NOTHING: the card said "En cours", showed the results, and
 * ended there. The voter had nothing to touch and nothing to read, which is
 * the failure that produces a support email carrying no information.
 *
 * What is pinned here: every reason that can reach the home card has a message
 * key, both locales have the string, and the two transient reasons say "try
 * again" rather than anything that reads as final.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import fr from '@/locales/fr.json';
import en from '@/locales/en.json';
import { refusalMessageKey, type IneligibilityReason } from '@/utils/vote-eligibility';

const ALL_REASONS: IneligibilityReason[] = [
  'not-listed',
  'closed',
  'not-started',
  'ended',
  'unknown-contract',
  'wrong-document',
  'multi-question',
  'unknown-rules',
  'citizenship',
  'app-outdated',
];

function lookup(dict: unknown, key: string): string | undefined {
  return key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    dict,
  ) as string | undefined;
}

describe('every refusal has something to show the voter', () => {
  it.each(ALL_REASONS)('%s resolves to a key', (reason) => {
    expect(refusalMessageKey(reason)).toMatch(/^[a-zA-Z]+(\.[a-zA-Z_]+)+$/);
  });

  it.each(ALL_REASONS)('%s has a French string behind that key', (reason) => {
    const text = lookup(fr, refusalMessageKey(reason));
    expect(typeof text).toBe('string');
    expect((text as string).length).toBeGreaterThan(10);
  });

  it.each(ALL_REASONS)('%s has an English string behind that key', (reason) => {
    expect(typeof lookup(en, refusalMessageKey(reason))).toBe('string');
  });
});

describe('the two reasons the wave 2b regressions produce', () => {
  // REG-1 and REG-3 both end on unknown-contract, REG-2 on unknown-rules.
  it('unknown-contract and unknown-rules got the keys that were missing', () => {
    expect(refusalMessageKey('unknown-contract')).toBe('voting.voteErrors.contractUnknown');
    expect(refusalMessageKey('unknown-rules')).toBe('voting.voteErrors.rulesUnknown');
  });

  it('unknown-rules invites a retry, because the SDK stub is transient', () => {
    // An all-zero selector is what an RPC hiccup or a slow IPFS gateway looks
    // like, not a property of the question. Saying "closed" would be a lie.
    const text = lookup(fr, refusalMessageKey('unknown-rules'))!;
    expect(text).toMatch(/[Rr]éessayez/);
    expect(text).not.toMatch(/close|termin[ée]|interdit/i);
  });

  it('unknown-contract points at the app, not at the voter', () => {
    const text = lookup(fr, refusalMessageKey('unknown-contract'))!;
    expect(text).toMatch(/application/);
    expect(text).not.toMatch(/votre document|votre carte/i);
  });

  it('app-outdated and citizenship reuse the sentences the flow already used', () => {
    expect(refusalMessageKey('app-outdated')).toBe('voting.voteErrors.appOutdated');
    expect(refusalMessageKey('citizenship')).toBe('voting.voteErrors.citizenship');
  });
});

describe('the wording keeps the house style', () => {
  it.each(ALL_REASONS)('%s carries no jargon and no em dash', (reason) => {
    const text = lookup(fr, refusalMessageKey(reason))!;
    expect(text).not.toContain('—');
    for (const word of ['selector', 'RPC', 'IPFS', 'contract', 'SDK', 'nullifier']) {
      expect(text).not.toContain(word);
    }
  });

  // multi-question keeps its own branch and its own short button label, which
  // 2.0.1 already showed; the rest are sentences the voter reads.
  it.each(ALL_REASONS.filter((r) => r !== 'multi-question'))(
    '%s is a sentence, not a code',
    (reason) => {
      const text = lookup(fr, refusalMessageKey(reason))!;
      expect(text).toMatch(/[.!?]$/);
      expect(text.split(' ').length).toBeGreaterThan(4);
    },
  );
});
