/**
 * Dossier 2.0.2, item 15: a truncated circuit file in the cache blocked the
 * vote proof for ever, because any bytecode of 1 KB or more passed and the
 * SDK downloaded straight to the final name. These pin the replacement:
 * temporary download, validation, atomic publish, all inside the existing
 * retry budget, and the trusted setup never read in JavaScript.
 */

// ---- In-memory file system ------------------------------------------------
type FileEntry = { content: string; size: number };
const mockFiles = new Map<string, FileEntry>();
const mockReads: string[] = [];
const mockDownloads: string[] = [];
/** What the next downloads deliver, per URL, in order. */
const mockServe = new Map<string, { content: string; size?: number; contentLength?: number }[]>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  getInfoAsync: async (uri: string) => {
    if (uri === 'file:///doc/noir') return { exists: true, isDirectory: true };
    const f = mockFiles.get(uri);
    return f ? { exists: true, size: f.size, uri } : { exists: false };
  },
  makeDirectoryAsync: async () => {},
  readAsStringAsync: async (uri: string) => {
    mockReads.push(uri);
    const f = mockFiles.get(uri);
    if (!f) throw new Error('ENOENT');
    return f.content;
  },
  writeAsStringAsync: async (uri: string, content: string) => {
    mockFiles.set(uri, { content, size: content.length });
  },
  deleteAsync: async (uri: string) => { mockFiles.delete(uri); },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const f = mockFiles.get(from);
    if (!f) throw new Error('ENOENT');
    mockFiles.delete(from);
    mockFiles.set(to, f);
  },
  createDownloadResumable: (url: string, fileUri: string, _o: unknown, cb: (p: any) => void) => ({
    downloadAsync: async () => {
      mockDownloads.push(url);
      const next = mockServe.get(url)?.shift();
      if (!next) throw new Error('Software caused connection abort');
      const size = next.size ?? next.content.length;
      const contentLength = next.contentLength ?? size;
      cb({ totalBytesWritten: size, totalBytesExpectedToWrite: contentLength });
      mockFiles.set(fileUri, { content: next.content, size });
      return { uri: fileUri, status: 200, headers: { 'Content-Length': String(contentLength) } };
    },
  }),
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: async () => {},
  deactivateKeepAwake: () => {},
}));

const SETUP = 'file:///doc//noir/ultraPlonkTrustedSetup.dat';
const BYTECODE = 'file:///doc//noir/query_identity-bytecode.json';
const SETUP_URL =
  'https://storage.googleapis.com/rarimo-store/trusted-setups/ultraPlonkTrustedSetup.dat';
const BYTECODE_URL =
  'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/id_cards/query_identity_td1.json';

jest.mock('@rarimo/rarime-rn-sdk/build/RnNoirModule', () => {
  const exists = (uri: string) => (mockFiles.has(uri) ? uri : null);
  return {
    NoirCircuitParams: {
      TrustedSetupFileName: 'file:///doc//noir/ultraPlonkTrustedSetup.dat',
      getTrustedSetupUri: async () => exists('file:///doc//noir/ultraPlonkTrustedSetup.dat'),
      getByteCodeUri: async (name: string) => exists(name),
      fromName: () => ({
        byteCodeUri:
          'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/id_cards/query_identity_td1.json',
      }),
    },
  };
});

import { __resetCircuitPreloadForTests, preloadCircuits } from '@/utils/circuit-preload';

const BIG = 200 * 1024 * 1024;
const GOOD_BYTECODE = JSON.stringify({ noir_version: '1', bytecode: 'H4sIA' + 'A'.repeat(4000) });
const TRUNCATED_BYTECODE = GOOD_BYTECODE.slice(0, 3000);

beforeEach(() => {
  mockFiles.clear();
  mockReads.length = 0;
  mockDownloads.length = 0;
  mockServe.clear();
  __resetCircuitPreloadForTests();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  // The retry backoff (5 s, 10 s, …) is irrelevant here.
  jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn();
    return 0 as any;
  }) as any);
});
afterEach(() => jest.restoreAllMocks());

function haveGoodSetup() {
  mockFiles.set(SETUP, { content: '', size: BIG });
  mockFiles.set(SETUP + '.size', { content: String(BIG), size: 9 });
}

describe('circuit preload: bytecode', () => {
  it('a truncated cached bytecode is discarded and fetched again, then remembered as valid', async () => {
    haveGoodSetup();
    mockFiles.set(BYTECODE, { content: TRUNCATED_BYTECODE, size: TRUNCATED_BYTECODE.length });
    mockServe.set(BYTECODE_URL, [{ content: GOOD_BYTECODE }]);

    await preloadCircuits();

    expect(mockDownloads).toEqual([BYTECODE_URL]);
    expect(mockFiles.get(BYTECODE)?.content).toBe(GOOD_BYTECODE);
    expect(mockFiles.get(BYTECODE + '.ok')?.content).toBe(String(GOOD_BYTECODE.length));
    expect(mockFiles.has(BYTECODE + '.part')).toBe(false);

    // Next launch: no download, no second parse of the bytecode.
    __resetCircuitPreloadForTests();
    mockReads.length = 0;
    await preloadCircuits();
    expect(mockDownloads).toEqual([BYTECODE_URL]);
    expect(mockReads).not.toContain(BYTECODE);
  });

  it('a truncated download is never published, and is retried inside the existing budget', async () => {
    haveGoodSetup();
    mockServe.set(BYTECODE_URL, [
      // Server closed early: fewer bytes than announced.
      { content: TRUNCATED_BYTECODE, contentLength: GOOD_BYTECODE.length },
      // Complete bytes but not JSON (a proxy error page, say).
      { content: '<html>' + 'x'.repeat(2000) },
      { content: GOOD_BYTECODE },
    ]);
    await preloadCircuits();
    expect(mockDownloads).toHaveLength(3);
    expect(mockFiles.get(BYTECODE)?.content).toBe(GOOD_BYTECODE);
  });

  it('when the budget is spent the preload fails instead of reporting a cached file', async () => {
    haveGoodSetup();
    mockServe.set(
      BYTECODE_URL,
      Array.from({ length: 5 }, () => ({ content: TRUNCATED_BYTECODE, contentLength: 99_999 })),
    );
    await expect(preloadCircuits()).rejects.toThrow(/truncated/);
    expect(mockDownloads).toHaveLength(5);
    expect(mockFiles.has(BYTECODE)).toBe(false);
  });

  it('a download killed mid-way leaves only the temporary file: next launch is not "cached"', async () => {
    haveGoodSetup();
    mockFiles.set(BYTECODE + '.part', { content: TRUNCATED_BYTECODE, size: TRUNCATED_BYTECODE.length });
    mockServe.set(BYTECODE_URL, [{ content: GOOD_BYTECODE }]);
    await preloadCircuits();
    expect(mockDownloads).toEqual([BYTECODE_URL]);
    expect(console.log).toHaveBeenCalledWith('[preload] bytecode cached: false');
  });
});

describe('circuit preload: trusted setup', () => {
  it('is never read in JavaScript, and its size is checked against the recorded Content-Length', async () => {
    mockServe.set(SETUP_URL, [{ content: '', size: BIG }]);
    mockServe.set(BYTECODE_URL, [{ content: GOOD_BYTECODE }]);
    await preloadCircuits();
    expect(mockFiles.get(SETUP)?.size).toBe(BIG);
    expect(mockFiles.get(SETUP + '.size')?.content).toBe(String(BIG));
    expect(mockReads).not.toContain(SETUP);
    expect(mockReads).not.toContain(SETUP + '.part');
  });

  it('a cached setup whose size no longer matches is deleted and fetched again', async () => {
    mockFiles.set(SETUP, { content: '', size: BIG - 10 });
    mockFiles.set(SETUP + '.size', { content: String(BIG), size: 9 });
    mockServe.set(SETUP_URL, [{ content: '', size: BIG }]);
    mockServe.set(BYTECODE_URL, [{ content: GOOD_BYTECODE }]);
    await preloadCircuits();
    expect(mockDownloads[0]).toBe(SETUP_URL);
    expect(mockFiles.get(SETUP)?.size).toBe(BIG);
    expect(mockReads).not.toContain(SETUP);
  });

  it('a download shorter than its Content-Length is not published', async () => {
    mockServe.set(SETUP_URL, [
      { content: '', size: BIG - 1, contentLength: BIG },
      { content: '', size: BIG },
    ]);
    mockServe.set(BYTECODE_URL, [{ content: GOOD_BYTECODE }]);
    await preloadCircuits();
    expect(mockDownloads.filter((u) => u === SETUP_URL)).toHaveLength(2);
    expect(mockFiles.get(SETUP)?.size).toBe(BIG);
  });
});
