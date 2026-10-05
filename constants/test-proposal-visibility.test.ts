/**
 * What this protects: the floor that decides which test proposals a tester can
 * reach without dev mode. Too low and unfinished proposals leak to everyone;
 * a broken parse and the floor stops working silently, sending testers back to
 * typing proposal numbers by hand.
 */

import { AUTO_VISIBLE_PROPOSAL_ID_FROM, isAutoVisibleProposalId } from './test-proposal-visibility';

describe('isAutoVisibleProposalId', () => {
  it('promotes ids at or above the floor', () => {
    expect(isAutoVisibleProposalId(AUTO_VISIBLE_PROPOSAL_ID_FROM)).toBe(true);
    expect(isAutoVisibleProposalId(AUTO_VISIBLE_PROPOSAL_ID_FROM + 1)).toBe(true);
    expect(isAutoVisibleProposalId(999)).toBe(true);
  });

  it('leaves ids below the floor alone', () => {
    expect(isAutoVisibleProposalId(AUTO_VISIBLE_PROPOSAL_ID_FROM - 1)).toBe(false);
    expect(isAutoVisibleProposalId(1)).toBe(false);
    expect(isAutoVisibleProposalId(48)).toBe(false);
  });

  it('accepts string ids, as the index stores them', () => {
    expect(isAutoVisibleProposalId(String(AUTO_VISIBLE_PROPOSAL_ID_FROM))).toBe(true);
    expect(isAutoVisibleProposalId('51')).toBe(false);
    expect(isAutoVisibleProposalId('56')).toBe(true);
  });

  it('does not promote junk', () => {
    expect(isAutoVisibleProposalId('')).toBe(false);
    expect(isAutoVisibleProposalId('abc')).toBe(false);
    expect(isAutoVisibleProposalId(NaN)).toBe(false);
  });

  it('is 52 for this round', () => {
    // Documents the current value so a change is a deliberate, reviewed edit.
    expect(AUTO_VISIBLE_PROPOSAL_ID_FROM).toBe(52);
  });
});
