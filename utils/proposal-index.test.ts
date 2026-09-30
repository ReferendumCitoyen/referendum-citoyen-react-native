jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// Signature checking is covered on a device against the real key; here the
// download path is exercised without a signature so the date rule is what
// decides. The app's constant stays `true`.
jest.mock('@/constants/proposal-index-signing', () => ({
  PROPOSAL_INDEX_PUBLIC_KEY_HEX: '00'.repeat(32),
  PROPOSAL_INDEX_VERIFICATION_REQUIRED: false,
}));

import {
  closedForNetwork,
  getProposalIndex,
  idsForNetwork,
  isOlderThanBundled,
  pagesForNetwork,
  parseProposalIndex,
  readCachedIndex,
  twinsForNetwork,
} from './proposal-index';

const base = {
  version: 1,
  mainnet: { active: ['52'], devOnly: [] },
  testnet: { active: [], devOnly: [] },
};

describe('proposal index twins', () => {
  it('reads a twins table, passport id → card id', () => {
    const idx = parseProposalIndex({ ...base, mainnet: { ...base.mainnet, twins: { '68': '69' } } });
    expect(idx).not.toBeNull();
    expect(twinsForNetwork(idx!, 'mainnet')).toEqual({ '68': '69' });
    expect(twinsForNetwork(idx!, 'testnet')).toEqual({});
  });

  it('is optional: an index without it still parses', () => {
    const idx = parseProposalIndex(base);
    expect(idx).not.toBeNull();
    expect(twinsForNetwork(idx!, 'mainnet')).toEqual({});
  });

  it('drops a malformed table but keeps the list', () => {
    for (const twins of [['68', '69'], { '68': 69 }, { abc: '69' }, 'x']) {
      const idx = parseProposalIndex({ ...base, mainnet: { ...base.mainnet, twins } });
      expect(idx?.mainnet.active).toEqual(['52']);
      expect(twinsForNetwork(idx!, 'mainnet')).toEqual({});
    }
  });
});

describe('proposal index pages', () => {
  it('reads a page map, proposal id → slug on the site', () => {
    const idx = parseProposalIndex({ ...base, mainnet: { ...base.mainnet, pages: { '72': 'plan-marianne' } } });
    expect(pagesForNetwork(idx!, 'mainnet')).toEqual({ '72': 'plan-marianne' });
    expect(pagesForNetwork(idx!, 'testnet')).toEqual({});
  });

  it('is optional: an index without it still parses', () => {
    expect(pagesForNetwork(parseProposalIndex(base)!, 'mainnet')).toEqual({});
  });

  it('drops a map that is not id → slug, so a signed index can point nowhere but the site', () => {
    for (const pages of [
      { '72': 'https://evil.example/x' },
      { '72': '../cgu.html' },
      { '72': 'plan marianne' },
      { '72': '' },
      { abc: 'plan-marianne' },
      ['72', 'plan-marianne'],
      'plan-marianne',
    ]) {
      const idx = parseProposalIndex({ ...base, mainnet: { ...base.mainnet, pages } });
      expect(idx?.mainnet.active).toEqual(['52']);
      expect(pagesForNetwork(idx!, 'mainnet')).toEqual({});
    }
  });
});

describe('idsForNetwork', () => {
  const idx = parseProposalIndex({
    ...base,
    mainnet: { active: ['80'], closed: ['52'], devOnly: ['70'], twins: { '80': '81', '70': '71', '99': '98' } },
  })!;

  it('fetches the ID-card twin of every listed passport id, so the pair can fold and the card can vote', () => {
    expect(idsForNetwork(idx, 'mainnet', false)).toEqual(['80', '52', '81']);
  });

  it('includes devOnly ids and their twins in dev mode only', () => {
    expect(idsForNetwork(idx, 'mainnet', true)).toEqual(['80', '52', '70', '81', '71']);
  });

  it('never surfaces a twin whose passport id is not listed', () => {
    expect(idsForNetwork(idx, 'mainnet', true)).not.toContain('98');
  });
});

describe('a list older than the bundled one is ignored', () => {
  const dated = (updatedAt: string | undefined, active: string[]) => ({
    ...base,
    updatedAt,
    mainnet: { active, devOnly: [] },
  });
  const bundled = parseProposalIndex(require('@/public-data/proposals.json'))!;

  it('compares updatedAt; an undated list counts as older', () => {
    const ref = parseProposalIndex(dated('2026-09-14T19:00:00Z', ['72']))!;
    expect(isOlderThanBundled(parseProposalIndex(dated('2026-06-15T12:30:00Z', ['52']))!, ref)).toBe(true);
    expect(isOlderThanBundled(parseProposalIndex(dated(undefined, ['52']))!, ref)).toBe(true);
    expect(isOlderThanBundled(parseProposalIndex(dated('2026-09-14T19:00:00Z', ['72']))!, ref)).toBe(false);
    expect(isOlderThanBundled(parseProposalIndex(dated('2026-10-01T00:00:00Z', ['80']))!, ref)).toBe(false);
  });

  it('never rejects anything when the bundled list itself is undated', () => {
    const ref = parseProposalIndex(dated(undefined, ['72']))!;
    expect(isOlderThanBundled(parseProposalIndex(dated('2026-06-15T12:30:00Z', ['52']))!, ref)).toBe(false);
  });

  it("June's published list is older than the launch file this build carries", () => {
    expect(bundled.updatedAt).toBeDefined();
    expect(isOlderThanBundled(parseProposalIndex(dated('2026-06-15T12:30:00Z', ['52', '53', '54', '55', '56']))!)).toBe(true);
    expect(isOlderThanBundled(bundled)).toBe(false);
  });

  describe('through getProposalIndex / readCachedIndex', () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const realFetch = global.fetch;
    afterEach(async () => {
      global.fetch = realFetch;
      await AsyncStorage.clear();
    });

    const serving = (body: string) =>
      jest.fn(async (url: string) =>
        url.endsWith('.sig') ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => body },
      ) as any;

    it('a stale download yields the bundled list and is not cached', async () => {
      global.fetch = serving(JSON.stringify(dated('2026-06-15T12:30:00Z', ['52'])));
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      const idx = await getProposalIndex();
      expect(idx.mainnet.active).toEqual(bundled.mainnet.active);
      expect(await AsyncStorage.getItem('proposal_index_v2')).toBeNull();
      expect(log.mock.calls.flat().join('\n')).toMatch(/published list \(2026-06-15T12:30:00Z\) is older than the bundled one/);
      log.mockRestore();
    });

    it('a newer download is used and cached', async () => {
      global.fetch = serving(JSON.stringify(dated('2027-01-01T00:00:00Z', ['90'])));
      const idx = await getProposalIndex();
      expect(idx.mainnet.active).toEqual(['90']);
      expect(await AsyncStorage.getItem('proposal_index_v2')).not.toBeNull();
    });

    it('a stale cache paints the bundled list, a newer cache paints itself', async () => {
      await AsyncStorage.setItem('proposal_index_v2', JSON.stringify(dated('2026-06-15T12:30:00Z', ['52'])));
      expect((await readCachedIndex())!.mainnet.active).toEqual(bundled.mainnet.active);
      await AsyncStorage.setItem('proposal_index_v2', JSON.stringify(dated('2027-01-01T00:00:00Z', ['90'])));
      expect((await readCachedIndex())!.mainnet.active).toEqual(['90']);
    });
  });
});

describe('the launch file this build carries', () => {
  const bundled = parseProposalIndex(require('@/public-data/proposals.json'))!;
  const everyone = idsForNetwork(bundled, 'mainnet', false);

  it('shows the main question to everyone by its ID-card id alone, on its site page', () => {
    // ID card only (2026-09-15): the passport twin #72 is not listed anywhere,
    // so no passport proof can be sent to it.
    expect(everyone).toContain('73');
    expect(everyone).not.toContain('72');
    expect(twinsForNetwork(bundled, 'mainnet')).toEqual({});
    expect(pagesForNetwork(bundled, 'mainnet')['73']).toBe('plan-marianne');
  });

  it('shows the five June scrutins to everyone, as finished, and nothing else without dev mode', () => {
    expect(everyone.sort()).toEqual(['52', '53', '54', '55', '56', '73']);
    expect([...closedForNetwork(bundled, 'mainnet')].sort()).toEqual(['52', '53', '54', '55', '56']);
    const dev = idsForNetwork(bundled, 'mainnet', true);
    expect(dev).toEqual(expect.arrayContaining(['67', '68', '69', '70', '71']));
  });
});
