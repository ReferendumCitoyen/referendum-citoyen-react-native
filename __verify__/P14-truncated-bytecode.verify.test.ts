/**
 * P14: the vote proof failed with "MalformedJsonException ... Unterminated
 * string at line 1 column 671736 path $.bytecode": the query circuit's
 * bytecode file in the cache was truncated. Replays a phone whose cache holds
 * such a file (well over the 1 KB floor, cut mid-string) and a server that
 * serves the full file: after the preload the cached bytecode must be whole.
 */
type FileEntry = { content: string; size: number };
const mockFiles = new Map<string, FileEntry>();
const mockDownloads: string[] = [];

const mockGood = JSON.stringify({ noir_version: '1', bytecode: 'H4sIA' + 'A'.repeat(700_000) });

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  getInfoAsync: async (uri: string) => {
    if (uri === 'file:///doc/noir') return { exists: true, isDirectory: true };
    const f = mockFiles.get(uri);
    return f ? { exists: true, size: f.size, uri } : { exists: false };
  },
  makeDirectoryAsync: async () => {},
  readAsStringAsync: async (uri: string) => {
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
      cb({ totalBytesWritten: mockGood.length, totalBytesExpectedToWrite: mockGood.length });
      mockFiles.set(fileUri, { content: mockGood, size: mockGood.length });
      return { uri: fileUri, status: 200, headers: { 'Content-Length': String(mockGood.length) } };
    },
  }),
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: async () => {},
  deactivateKeepAwake: () => {},
}));

const SETUP = 'file:///doc//noir/ultraPlonkTrustedSetup.dat';
const BYTECODE = 'file:///doc//noir/query_identity-bytecode.json';

jest.mock('@rarimo/rarime-rn-sdk/build/RnNoirModule', () => {
  const exists = (uri: string) => (mockFiles.has(uri) ? uri : null);
  return {
    NoirCircuitParams: {
      TrustedSetupFileName: 'file:///doc//noir/ultraPlonkTrustedSetup.dat',
      getTrustedSetupUri: async () => exists('file:///doc//noir/ultraPlonkTrustedSetup.dat'),
      getByteCodeUri: async (name: string) => exists(name),
      // The SDK's own download: straight to the final name, skipped when a
      // file already exists there.
      downloadTrustedSetup: async () => {},
      fromName: () => ({
        byteCodeUri:
          'https://storage.googleapis.com/rarimo-store/passport-zk-circuits-noir/id_cards/query_identity_td1.json',
        downloadByteCode: async () => {
          const uri = 'file:///doc//noir/query_identity-bytecode.json';
          if (!mockFiles.has(uri)) {
            mockDownloads.push('sdk');
            mockFiles.set(uri, { content: mockGood, size: mockGood.length });
          }
          return mockFiles.get(uri)!.content;
        },
      }),
    },
  };
});

import { preloadCircuits } from '@/utils/circuit-preload';

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn();
    return 0 as any;
  }) as any);
});
afterEach(() => jest.restoreAllMocks());

describe('P14: a truncated cached bytecode is not handed to the prover', () => {
  it('after the preload the cached bytecode parses and carries its bytecode', async () => {
    const BIG = 200 * 1024 * 1024;
    mockFiles.set(SETUP, { content: '', size: BIG });
    mockFiles.set(SETUP + '.size', { content: String(BIG), size: 9 });
    // Cut in the middle of the bytecode string, as in the report.
    const truncated = mockGood.slice(0, 671_736);
    mockFiles.set(BYTECODE, { content: truncated, size: truncated.length });

    await preloadCircuits();

    const f = mockFiles.get(BYTECODE);
    expect(f).toBeDefined();
    let parsed: any = null;
    try { parsed = JSON.parse(f!.content); } catch { /* stays null */ }
    expect(parsed?.bytecode?.length).toBeGreaterThan(0);
    expect(mockDownloads.length).toBeGreaterThan(0);
  });
});
