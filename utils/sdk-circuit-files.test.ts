/**
 * Dossier 2.0.2, item 15 / R9 (plan D12, P14): the patched SDK never trusts a
 * cached circuit file it has not checked, and publishes a download only after
 * it is complete and valid. Uses the markers shared with
 * utils/circuit-preload.ts (`.ok` for the bytecode, `.size` for the setup).
 *
 * Runs the patched build files (utils/testing/load-sdk-build.ts).
 */
import { loadSdkBuild } from './testing/load-sdk-build';
import {
  setCircuitValidationGate,
  validateCircuitJson,
} from '@rarimo/rarime-rn-sdk/build/helpers/circuitValidation';

type Entry = { text: string; size: number };

function harness(contents = '{"bytecode":"valid"}', expected?: number, interrupted = false) {
  const files = new Map<string, Entry>();
  const fs = {
    documentDirectory: 'doc/',
    getInfoAsync: jest.fn(async (uri: string) => ({
      exists: files.has(uri),
      uri,
      size: files.get(uri)?.size,
      modificationTime: 1,
    })),
    readAsStringAsync: jest.fn(async (uri: string) => {
      if (!files.has(uri)) throw new Error('missing');
      return files.get(uri)!.text;
    }),
    writeAsStringAsync: jest.fn(async (uri: string, text: string) => {
      files.set(uri, { text, size: text.length });
    }),
    deleteAsync: jest.fn(async (uri: string) => { files.delete(uri); }),
    makeDirectoryAsync: jest.fn(async () => {}),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
    createDownloadResumable: jest.fn((_url: string, uri: string, _o: unknown, progress: (p: any) => void) => ({
      downloadAsync: async () => {
        files.set(uri, { text: contents, size: contents.length });
        if (interrupted) throw new Error('interrupted');
        progress({ totalBytesExpectedToWrite: expected ?? contents.length, totalBytesWritten: contents.length });
        return { status: 200, headers: {} };
      },
    })),
  };
  const mod = loadSdkBuild(
    'helpers/circuitFiles.js',
    { 'expo-file-system/legacy': fs, './circuitValidation': { validateCircuitJson } },
    require,
  );
  return { files, fs, validCircuitFile: mod.validCircuitFile, atomicCircuitDownload: mod.atomicCircuitDownload };
}

describe('SDK circuit cache (helpers/circuitFiles)', () => {
  it('replaces a truncated cache atomically and remembers the validation in the .ok marker', async () => {
    const h = harness();
    h.files.set('circuit', { text: '{"bytecode":"broken', size: 18 });
    expect(await h.validCircuitFile('circuit', true)).toBe(false);
    await h.atomicCircuitDownload('existing-host', 'circuit', true);
    expect(h.fs.moveAsync).toHaveBeenCalledWith({ from: 'circuit.partial', to: 'circuit' });
    expect(h.files.get('circuit.ok')?.text).toBe(String('{"bytecode":"valid"}'.length));
    h.fs.readAsStringAsync.mockClear();
    expect(await h.validCircuitFile('circuit', true)).toBe(true);
    // Only the small marker is read, never the circuit itself.
    expect(h.fs.readAsStringAsync.mock.calls).toEqual([['circuit.ok']]);
  });

  it('a cached bytecode without a marker is validated once, then trusted by its marker', async () => {
    const h = harness();
    h.files.set('circuit', { text: '{"bytecode":"valid"}', size: 20 });
    expect(await h.validCircuitFile('circuit', true)).toBe(true);
    expect(h.files.get('circuit.ok')?.text).toBe('20');
  });

  it('a marker that no longer matches the size forces a new validation', async () => {
    const h = harness();
    h.files.set('circuit', { text: '{"bytecode":"brok', size: 17 });
    h.files.set('circuit.ok', { text: '20', size: 2 });
    expect(await h.validCircuitFile('circuit', true)).toBe(false);
  });

  it.each(['interrupted', 'short', 'malformed'])('does not publish %s downloads', async (mode) => {
    const h = harness(
      mode === 'malformed' ? '{"bytecode":"broken' : undefined,
      mode === 'short' ? 10_000 : undefined,
      mode === 'interrupted',
    );
    await expect(h.atomicCircuitDownload('existing-host', 'circuit', true)).rejects.toThrow();
    expect(h.files.has('circuit')).toBe(false);
    expect(h.files.has('circuit.partial')).toBe(false);
    expect(h.fs.moveAsync).not.toHaveBeenCalled();
  });

  it('checks the setup size without loading the setup into JavaScript', async () => {
    const h = harness();
    const size = 150 * 1024 * 1024;
    h.files.set('setup', { text: 'must never be read', size });
    h.files.set('setup.size', { text: String(size), size: 9 });
    expect(await h.validCircuitFile('setup', false)).toBe(true);
    expect(h.fs.readAsStringAsync.mock.calls).toEqual([['setup.size']]);
    h.files.get('setup')!.size--;
    expect(await h.validCircuitFile('setup', false)).toBe(false);
  });

  it('a setup from before the markers is kept when it is at least 50 MB (no 300 MB re-download)', async () => {
    const h = harness();
    h.files.set('setup', { text: '', size: 160 * 1024 * 1024 });
    expect(await h.validCircuitFile('setup', false)).toBe(true);
    h.files.set('setup', { text: '', size: 1024 });
    expect(await h.validCircuitFile('setup', false)).toBe(false);
  });

  it('coalesces concurrent downloads of the same circuit', async () => {
    const h = harness();
    await Promise.all([
      h.atomicCircuitDownload('existing-host', 'circuit', true),
      h.atomicCircuitDownload('existing-host', 'circuit', true),
    ]);
    expect(h.fs.createDownloadResumable).toHaveBeenCalledTimes(1);
  });
});

describe('SDK circuit validation (helpers/circuitValidation)', () => {
  it.each([
    '{"bytecode":"abc"',
    '{"bytecode":""}',
    '{"bytecode":4}',
    '{"bytecode":"a",}',
    '{"bytecode":"abc"}garbage',
    '{"bytecode":"\\z"}',
    '{"abi":{}}',
  ])('rejects malformed or absent bytecode: %s', async (input) => {
    await expect(validateCircuitJson(input)).rejects.toThrow('CIRCUIT_UNAVAILABLE');
  });

  it('validates all JSON, including nested compiler metadata', async () => {
    await expect(
      validateCircuitJson(
        JSON.stringify({ bytecode: 'abc', abi: { parameters: [1, true, null, 'quote"'], numbers: -1.2e-3 } }),
      ),
    ).resolves.toBeUndefined();
  });

  it('pauses while an NFC read owns the phone and resumes afterwards', async () => {
    jest.useFakeTimers();
    let available = false;
    let done = false;
    setCircuitValidationGate(() => available);
    const result = validateCircuitJson('{"bytecode":"abc"}').then(() => { done = true; });
    await jest.advanceTimersByTimeAsync(500);
    expect(done).toBe(false);
    available = true;
    await jest.advanceTimersByTimeAsync(100);
    await result;
    expect(done).toBe(true);
    setCircuitValidationGate(() => true);
    jest.useRealTimers();
  });
});

describe('the app closes the gate during an NFC read', () => {
  it('isAnyNfcScanInProgress follows the scan owner', async () => {
    const { createNfcScanOwner, isAnyNfcScanInProgress } = jest.requireActual('./e-document/nfc-scan-owner');
    const owner = createNfcScanOwner({ platform: 'android', cancelNative: async () => {} });
    let finish!: (v: string) => void;
    const handle = owner.start({ scan: () => new Promise<string>((r) => { finish = r; }) });
    expect(isAnyNfcScanInProgress()).toBe(true);
    finish('chip');
    await handle.done;
    expect(isAnyNfcScanInProgress()).toBe(false);
  });
});
