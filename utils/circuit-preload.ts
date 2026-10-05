/**
 * Pre-downloads the Noir trusted setup and circuit bytecode used by the
 * Rarime SDK, so the download doesn't happen inside Step 11 (where a failing
 * ~150–300 MB download on Android shows up as a silent 4-minute spinner and
 * then a `FileSystemLegacyModule: Software caused connection abort`).
 *
 * - Kick off from app startup / home screen: `preloadCircuits()`.
 * - Gate Step 11 on completion: `ensureCircuitsReady(onProgress)`.
 * - Both files are downloaded here under a temporary name, checked, and only
 *   then renamed to the name the SDK reads, so a partial file never reaches
 *   the prover (see downloadAtomically below). The patched SDK applies the
 *   same rule to the files it fetches itself (helpers/circuitFiles.js).
 */

import * as FileSystem from 'expo-file-system/legacy';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { NoirCircuitParams } from '@rarimo/rarime-rn-sdk/build/RnNoirModule';
import { setCircuitValidationGate } from '@rarimo/rarime-rn-sdk/build/helpers/circuitValidation';
import { isStorageFullError } from '@/utils/storage-errors';
import { isAnyNfcScanInProgress } from '@/utils/e-document/nfc-scan-owner';

// The SDK validates a cached circuit it has no marker for before handing it
// to the prover (patched RnNoirModule, helpers/circuitFiles). That validation
// pauses while an NFC read is in progress, so it never competes with the chip
// read for the JS thread (dossier 2.0.2, item 15; plan D12).
setCircuitValidationGate(() => !isAnyNfcScanInProgress());

const KEEP_AWAKE_TAG = 'circuit-preload';

const QUERY_CIRCUIT_NAME = 'query_identity';
const MIN_TRUSTED_SETUP_BYTES = 50 * 1024 * 1024;
const MIN_BYTECODE_BYTES = 1024;

const BYTECODE_FILE_NAME =
  `${FileSystem.documentDirectory}/noir/${QUERY_CIRCUIT_NAME}-bytecode.json`;

export type PreloadStage =
  | 'idle'
  | 'checking'
  | 'trusted-setup'
  | 'bytecode'
  | 'done'
  | 'error';

export type PreloadProgress = {
  stage: PreloadStage;
  stagePercent: number;
  overallPercent: number;
  error?: Error;
};

type Listener = (p: PreloadProgress) => void;

let currentState: PreloadProgress = {
  stage: 'idle',
  stagePercent: 0,
  overallPercent: 0,
};
let inflight: Promise<void> | null = null;
const listeners = new Set<Listener>();

function emit(next: PreloadProgress) {
  currentState = next;
  for (const l of listeners) {
    try { l(next); } catch {}
  }
}

// Log download progress at 10% increments so it's visible in adb logcat
// without spamming on every frame. State is reset per call.
let lastLoggedPct = -1;
function logProgressOnce(stage: string, pct: number) {
  const bucket = Math.floor(pct * 10);
  if (bucket !== lastLoggedPct) {
    lastLoggedPct = bucket;
    console.log(`[preload] ${stage} ${Math.round(pct * 100)}%`);
  }
}

// Google Storage + OkHttp under mobile networks drops the socket mid-stream
// with "Software caused connection abort". The SDK's downloadTrustedSetup has
// no resume, so we retry the whole thing. Backoff is intentional: if the
// server is rate-limiting / we're on a flaky cell, a brief pause helps.
const MAX_DOWNLOAD_RETRIES = 5;
async function withDownloadRetry<T>(
  label: string,
  fn: () => Promise<T>,
  cleanupPartial: () => Promise<void>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[preload] ${label}: retry ${attempt}/${MAX_DOWNLOAD_RETRIES}`);
      }
      return await fn();
    } catch (err: any) {
      lastErr = err;
      console.warn(`[preload] ${label}: attempt ${attempt} failed — ${err?.message}`);
      // Purge whatever was written so the next attempt restarts cleanly and
      // the SDK's "file exists, skip download" short-circuit doesn't fire.
      try { await cleanupPartial(); } catch {}
      // Disk-full / OOM is NOT retryable — re-downloading ~300 MB onto a full
      // disk just burns the user's data plan (observed: 4× ENOSPC retries in
      // the 2026-06-11 reports). Abort immediately; the UI maps this to a
      // "free up storage" message via isStorageFullError.
      if (isStorageFullError(err)) {
        console.warn(`[preload] ${label}: device storage/memory exhausted — not retrying`);
        throw err;
      }
      if (attempt < MAX_DOWNLOAD_RETRIES) {
        // 5s, 10s, 20s, 40s — capped backoff.
        const delayMs = Math.min(40_000, 5_000 * Math.pow(2, attempt - 1));
        console.log(`[preload] ${label}: waiting ${delayMs / 1000}s before retry`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

export function getCircuitPreloadState(): PreloadProgress {
  return currentState;
}

export function subscribeCircuitPreload(l: Listener): () => void {
  listeners.add(l);
  l(currentState);
  return () => { listeners.delete(l); };
}

export function isCircuitPreloadReady(): boolean {
  return currentState.stage === 'done';
}

async function fileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists ? info.size : 0;
}

async function deleteQuietly(uri: string): Promise<void> {
  try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
}

// ---------------------------------------------------------------------------
// Temporary download, validation, atomic publish (dossier 2.0.2, item 15 / R9)
//
// The unpatched SDK downloaded straight to the final name and trusted any
// file that existed there, so a download interrupted at 670 KB left a
// bytecode file that every later launch reported as "cached: true" and the vote proof failed on
// for ever (MalformedJsonException, field report of 19/09). Both files are
// now downloaded here, under a temporary name, from the SAME URLs the SDK
// uses (no new host), checked, and only then renamed to the name the SDK
// reads. A crash mid-download leaves only the temporary file, which is
// ignored and overwritten next time. The patched SDK now applies the same
// checks to the files it fetches itself (helpers/circuitFiles) and shares the
// .ok / .size markers written here.
//
// What "checked" means differs by size:
//   - the bytecode (a few MB of JSON) is parsed once, fully, after download,
//     and the result is remembered in a small marker beside it holding the
//     validated size, so later launches do not parse it again;
//   - the trusted setup (150 to 300 MB) is never read in JavaScript: its
//     expected size, taken from the download's Content-Length, is stored
//     beside it and compared with the size on disk.
// A cache that fails its check is deleted and fetched again through the
// existing retry budget (withDownloadRetry), never through a separate path.
// ---------------------------------------------------------------------------

/** Same URL as NoirCircuitParams.downloadTrustedSetup in the SDK. */
const TRUSTED_SETUP_URL =
  'https://storage.googleapis.com/rarimo-store/trusted-setups/ultraPlonkTrustedSetup.dat';
const TRUSTED_SETUP_FILE_NAME = NoirCircuitParams.TrustedSetupFileName;
const TRUSTED_SETUP_SIZE_FILE = `${TRUSTED_SETUP_FILE_NAME}.size`;
const BYTECODE_OK_FILE = `${BYTECODE_FILE_NAME}.ok`;
const PART_SUFFIX = '.part';

async function readSmallFile(uri: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return await FileSystem.readAsStringAsync(uri);
  } catch {
    return null;
  }
}

async function ensureNoirDir(): Promise<void> {
  const dir = `${FileSystem.documentDirectory}noir`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

function contentLengthOf(headers: Record<string, string> | undefined): number {
  if (!headers) return 0;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'content-length') {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
  }
  return 0;
}

/**
 * Download `url` to `finalUri + '.part'`, check it, and publish it under
 * `finalUri`. `check` receives the temporary file and its expected size; it
 * throws when the file is unusable and returns the content of the marker to
 * write beside the final file (written BEFORE the rename, so a crash between
 * the two leaves a marker without a file, which the validity checks treat as
 * "not cached").
 */
async function downloadAtomically(args: {
  url: string;
  finalUri: string;
  markerUri: string;
  onProgress: (p: FileSystem.DownloadProgressData) => void;
  check: (tmpUri: string, expectedBytes: number) => Promise<string>;
}): Promise<void> {
  await ensureNoirDir();
  const tmpUri = args.finalUri + PART_SUFFIX;
  await deleteQuietly(tmpUri);
  let expectedFromProgress = 0;
  const task = FileSystem.createDownloadResumable(args.url, tmpUri, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) expectedFromProgress = p.totalBytesExpectedToWrite;
    args.onProgress(p);
  });
  const result = await task.downloadAsync();
  if (!result) throw new Error('download cancelled');
  if (result.status !== 200) throw new Error(`download failed: HTTP ${result.status}`);
  const expected = contentLengthOf(result.headers) || expectedFromProgress;
  const marker = await args.check(tmpUri, expected);
  await FileSystem.writeAsStringAsync(args.markerUri, marker);
  await deleteQuietly(args.finalUri);
  await FileSystem.moveAsync({ from: tmpUri, to: args.finalUri });
}

/** The trusted setup's check: size only, never its content. */
async function checkTrustedSetupFile(tmpUri: string, expectedBytes: number): Promise<string> {
  const size = await fileSize(tmpUri);
  if (expectedBytes > 0 && size !== expectedBytes) {
    throw new Error(`trusted setup truncated (${size} of ${expectedBytes} bytes)`);
  }
  if (size < MIN_TRUSTED_SETUP_BYTES) {
    throw new Error(`trusted setup too small (${size} bytes)`);
  }
  return String(expectedBytes > 0 ? expectedBytes : size);
}

/**
 * The bytecode's check: the whole file parses as JSON and carries a non-empty
 * `bytecode` string. Nothing from the file is logged. Returns the validated
 * size, which is what the marker remembers.
 */
async function checkBytecodeFile(uri: string, expectedBytes: number): Promise<string> {
  const size = await fileSize(uri);
  if (expectedBytes > 0 && size !== expectedBytes) {
    throw new Error(`bytecode truncated (${size} of ${expectedBytes} bytes)`);
  }
  if (size < MIN_BYTECODE_BYTES) throw new Error(`bytecode too small (${size} bytes)`);
  const text = await FileSystem.readAsStringAsync(uri);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('bytecode is not valid JSON');
  }
  const bc = (parsed as { bytecode?: unknown } | null)?.bytecode;
  if (typeof bc !== 'string' || bc.length === 0) {
    throw new Error('bytecode JSON has no bytecode field');
  }
  return String(size);
}

async function validTrustedSetup(): Promise<boolean> {
  const uri = await NoirCircuitParams.getTrustedSetupUri();
  if (!uri) {
    await deleteQuietly(TRUSTED_SETUP_SIZE_FILE);
    return false;
  }
  const size = await fileSize(uri);
  const recorded = parseInt((await readSmallFile(TRUSTED_SETUP_SIZE_FILE)) ?? '', 10);
  // A file downloaded before this check existed has no recorded size: the
  // old size floor is all there is to go on for it.
  const ok = Number.isFinite(recorded) && recorded > 0
    ? size === recorded
    : size >= MIN_TRUSTED_SETUP_BYTES;
  if (!ok) {
    await deleteQuietly(uri);
    await deleteQuietly(TRUSTED_SETUP_SIZE_FILE);
    return false;
  }
  return true;
}

async function validBytecode(): Promise<boolean> {
  const uri = await NoirCircuitParams.getByteCodeUri(BYTECODE_FILE_NAME);
  if (!uri) {
    await deleteQuietly(BYTECODE_OK_FILE);
    return false;
  }
  const size = await fileSize(uri);
  // Validated before, and still the same file: no second parse.
  if ((await readSmallFile(BYTECODE_OK_FILE)) === String(size)) return true;
  // Never validated (a download from before this check, or the truncated file
  // of the 2026-09-19 report): parse it once, remember the answer.
  try {
    const marker = await checkBytecodeFile(uri, 0);
    await FileSystem.writeAsStringAsync(BYTECODE_OK_FILE, marker);
    return true;
  } catch (e: any) {
    console.warn(`[preload] cached bytecode rejected (${e?.message ?? 'invalid'}), deleting it`);
    await deleteQuietly(uri);
    await deleteQuietly(BYTECODE_OK_FILE);
    return false;
  }
}

/** Test hook. */
export function __resetCircuitPreloadForTests(): void {
  currentState = { stage: 'idle', stagePercent: 0, overallPercent: 0 };
  inflight = null;
  listeners.clear();
}

/**
 * Trigger the preload (idempotent — concurrent calls share the same promise).
 * Safe to call at startup; errors are captured in state and re-thrown to the
 * caller, so a background `void preloadCircuits()` still surfaces via
 * `subscribeCircuitPreload` without crashing.
 */
export function preloadCircuits(): Promise<void> {
  if (inflight) {
    console.log('[preload] preloadCircuits() called — already inflight, returning existing promise');
    return inflight;
  }
  if (currentState.stage === 'done') {
    console.log('[preload] preloadCircuits() called — already done, no-op');
    return Promise.resolve();
  }

  console.log('[preload] preloadCircuits() starting');
  inflight = (async () => {
    // The trusted setup is ~150–300 MB. On Android the expo-file-system
    // download uses OkHttp, and when the screen sleeps the OS kills the
    // socket ("Software caused connection abort" from FileSystemLegacyModule).
    // Hold a wakelock for the duration of the download so it can finish.
    let keepAwakeActive = false;
    try {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      keepAwakeActive = true;
      console.log('[preload] keep-awake activated');
    } catch (e: any) {
      console.warn('[preload] keep-awake failed to activate:', e?.message);
    }

    try {
      emit({ stage: 'checking', stagePercent: 0, overallPercent: 0 });
      console.log('[preload] checking existing files');

      // Trusted setup is the large (~150–300 MB) file; weight it at 90% of overall.
      const hasSetup = await validTrustedSetup();
      console.log(`[preload] trusted-setup cached: ${hasSetup}`);
      if (!hasSetup) {
        emit({ stage: 'trusted-setup', stagePercent: 0, overallPercent: 0 });
        console.log('[preload] downloading trusted setup (~150-300 MB)...');
        await withDownloadRetry(
          'trusted-setup',
          async () => {
            lastLoggedPct = -1;
            await downloadAtomically({
              url: TRUSTED_SETUP_URL,
              finalUri: TRUSTED_SETUP_FILE_NAME,
              markerUri: TRUSTED_SETUP_SIZE_FILE,
              check: checkTrustedSetupFile,
              onProgress: (p) => {
                const expected = p.totalBytesExpectedToWrite || 0;
                const pct = expected > 0 ? p.totalBytesWritten / expected : 0;
                logProgressOnce('trusted-setup', pct);
                emit({
                  stage: 'trusted-setup',
                  stagePercent: pct,
                  overallPercent: pct * 0.9,
                });
              },
            });
          },
          async () => {
            await deleteQuietly(TRUSTED_SETUP_FILE_NAME + PART_SUFFIX);
            await deleteQuietly(TRUSTED_SETUP_FILE_NAME);
            await deleteQuietly(TRUSTED_SETUP_SIZE_FILE);
          },
        );
        console.log('[preload] trusted-setup download finished');
        if (!(await validTrustedSetup())) {
          throw new Error('Trusted setup download ended but file is missing or too small');
        }
      }

      const hasBytecode = await validBytecode();
      console.log(`[preload] bytecode cached: ${hasBytecode}`);
      if (!hasBytecode) {
        emit({ stage: 'bytecode', stagePercent: 0, overallPercent: 0.9 });
        console.log('[preload] downloading circuit bytecode...');
        const circuit = NoirCircuitParams.fromName(QUERY_CIRCUIT_NAME);
        await withDownloadRetry(
          'bytecode',
          async () => {
            lastLoggedPct = -1;
            await downloadAtomically({
              url: circuit.byteCodeUri,
              finalUri: BYTECODE_FILE_NAME,
              markerUri: BYTECODE_OK_FILE,
              check: checkBytecodeFile,
              onProgress: (p) => {
                const expected = p.totalBytesExpectedToWrite || 0;
                const pct = expected > 0 ? p.totalBytesWritten / expected : 0;
                logProgressOnce('bytecode', pct);
                emit({
                  stage: 'bytecode',
                  stagePercent: pct,
                  overallPercent: 0.9 + pct * 0.1,
                });
              },
            });
          },
          async () => {
            await deleteQuietly(BYTECODE_FILE_NAME + PART_SUFFIX);
            await deleteQuietly(BYTECODE_FILE_NAME);
            await deleteQuietly(BYTECODE_OK_FILE);
          },
        );
        console.log('[preload] bytecode download finished');
        if (!(await validBytecode())) {
          throw new Error('Bytecode download ended but file is missing or too small');
        }
      }

      console.log('[preload] all files ready ✓');
      emit({ stage: 'done', stagePercent: 1, overallPercent: 1 });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error('[preload] failed:', e.message);
      emit({ stage: 'error', stagePercent: 0, overallPercent: 0, error: e });
      throw e;
    } finally {
      inflight = null;
      if (keepAwakeActive) {
        try {
          deactivateKeepAwake(KEEP_AWAKE_TAG);
          console.log('[preload] keep-awake deactivated');
        } catch {}
      }
    }
  })();

  return inflight;
}

/**
 * Await the preload (kicking it off if not yet started). Resolves once
 * circuits are on disk and valid. Optional `onProgress` receives updates
 * while waiting and is unsubscribed on resolution.
 */
export async function ensureCircuitsReady(
  onProgress?: Listener,
): Promise<void> {
  if (currentState.stage === 'done') return;
  const unsub = onProgress ? subscribeCircuitPreload(onProgress) : undefined;
  try {
    await preloadCircuits();
  } finally {
    unsub?.();
  }
}
