/**
 * Pre-downloads the Noir trusted setup and circuit bytecode used by the
 * Rarime SDK, so the download doesn't happen inside Step 11 (where a failing
 * ~150–300 MB download on Android shows up as a silent 4-minute spinner and
 * then a `FileSystemLegacyModule: Software caused connection abort`).
 *
 * - Kick off from app startup / home screen: `preloadCircuits()`.
 * - Gate Step 11 on completion: `ensureCircuitsReady(onProgress)`.
 * - Partial files from a previous aborted download are detected (size check)
 *   and deleted so the SDK's `getInfoAsync(exists).exists` short-circuit
 *   doesn't return a corrupt file as "already downloaded".
 */

import * as FileSystem from 'expo-file-system/legacy';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { NoirCircuitParams } from '@rarimo/rarime-rn-sdk/build/RnNoirModule';

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

async function validTrustedSetup(): Promise<boolean> {
  const uri = await NoirCircuitParams.getTrustedSetupUri();
  if (!uri) return false;
  const size = await fileSize(uri);
  if (size < MIN_TRUSTED_SETUP_BYTES) {
    try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
    return false;
  }
  return true;
}

async function validBytecode(): Promise<boolean> {
  const uri = await NoirCircuitParams.getByteCodeUri(BYTECODE_FILE_NAME);
  if (!uri) return false;
  const size = await fileSize(uri);
  if (size < MIN_BYTECODE_BYTES) {
    try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
    return false;
  }
  return true;
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
            await NoirCircuitParams.downloadTrustedSetup({
              onDownloadingProgress: (p) => {
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
            const stale = await NoirCircuitParams.getTrustedSetupUri();
            if (stale) {
              await FileSystem.deleteAsync(stale, { idempotent: true });
            }
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
            await circuit.downloadByteCode({
              onDownloadingProgress: (p) => {
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
            const stale = await NoirCircuitParams.getByteCodeUri(BYTECODE_FILE_NAME);
            if (stale) {
              await FileSystem.deleteAsync(stale, { idempotent: true });
            }
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
