import { discoverProposalIds } from '@/utils/proposal-discovery';

/** `exists` backed by a fixed set, counting the ids it was asked about. */
function chainWith(present: number[]) {
  const asked: number[] = [];
  const set = new Set(present);
  return {
    asked,
    exists: async (id: number) => {
      asked.push(id);
      return set.has(id);
    },
  };
}

describe('discoverProposalIds', () => {
  it('finds every proposal from the floor upward', async () => {
    const c = chainWith([52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66]);
    expect(await discoverProposalIds({ exists: c.exists })).toEqual(
      ['52','53','54','55','56','57','58','59','60','61','62','63','64','65','66'],
    );
  });

  it('starts where it is told', async () => {
    const c = chainWith([50, 51, 52, 53]);
    expect(await discoverProposalIds({ fromId: 52, exists: c.exists })).toEqual(['52', '53']);
    expect(c.asked).not.toContain(51);
  });

  // Ids are contiguous in practice, but a deleted or skipped one must not end
  // the walk and hide everything above it.
  it('walks over a gap', async () => {
    const c = chainWith([52, 53, 57, 58]);
    expect(await discoverProposalIds({ exists: c.exists })).toEqual(['52', '53', '57', '58']);
  });

  it('stops after a long enough run of nothing', async () => {
    const c = chainWith([52]);
    const ids = await discoverProposalIds({
      exists: c.exists,
      batchSize: 4,
      stopAfterConsecutiveMisses: 4,
    });
    expect(ids).toEqual(['52']);
    // 52-55 and 56-59: the second batch is all misses, which ends it.
    expect(Math.max(...c.asked)).toBeLessThan(64);
  });

  it('never runs past its ceiling', async () => {
    const c = chainWith(Array.from({ length: 500 }, (_, i) => i));
    const ids = await discoverProposalIds({ exists: c.exists, maxId: 60 });
    expect(ids).toEqual(['52','53','54','55','56','57','58','59','60']);
    expect(Math.max(...c.asked)).toBeLessThanOrEqual(60);
  });

  // One unreachable id must not abort the walk — an RPC hiccup on a single
  // call would otherwise empty the whole home screen.
  it('treats a failed lookup as absent and carries on', async () => {
    const ids = await discoverProposalIds({
      exists: async (id) => {
        if (id === 54) throw new Error('rpc blip');
        return id <= 56;
      },
    });
    expect(ids).toEqual(['52', '53', '55', '56']);
  });

  it('returns nothing when there is nothing', async () => {
    const c = chainWith([]);
    expect(await discoverProposalIds({ exists: c.exists })).toEqual([]);
  });
});
