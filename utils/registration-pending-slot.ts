/**
 * One anonymous "registration in flight" slot (dossier 2.0.2, item 3, 2b, 2c
 * and AV4).
 *
 * TODO(PROTOCOL-LEAD-B): the SHAPE of this durable marker, which fields it
 * holds and whether the attempt tag stays a local fingerprint or becomes an
 * opaque hash agreed with Rarimo, is awaiting the protocol lead's
 * confirmation. Anything that touches exposure or personal data is that call.
 * Everything that decides what reaches disk is in `buildSlotRecord` below, and
 * nothing else builds the stored object: changing the shape is changing that
 * one function (and `PendingSlot`, which types it).
 *
 * Two moments write it, and that is the whole point of writing it early:
 *
 *   1. `markRegistrationSent` — BEFORE the POST leaves the phone. From that
 *      instant the registration may have reached the relayer, so a process
 *      killed before any answer (the OS reclaiming memory during the 90 s
 *      bound, the user swiping the app away) still leaves a trace on disk.
 *      The slot used to be written only once the relayer had answered, so
 *      exactly the case it exists for — a lost answer — left nothing behind,
 *      and the next run proved and POSTed the same registration again.
 *   2. `writePendingSlot` — once the relayer accepted, promoting the same
 *      record from "sent" to "accepted".
 *
 * If the user comes back within the slot's lifetime to a document the chain
 * still calls NotRegistered, Step 7 polls the registration SMT once for up to
 * 60 s before building a new proof, so a registration that was only slow is
 * not proved and submitted a second time.
 *
 * Lifetimes. A slot the relayer ACCEPTED lives an hour: the registration
 * exists, and an hour is well past any confirmation. A marker written before
 * the POST lives 30 minutes: the POST itself is bounded at 90 s and the
 * confirmation window at 300 s, so half an hour covers a phone that slept
 * through both, while a marker left by a request that never actually left the
 * device (airplane mode, DNS failure) stops costing the next attempt its 60 s
 * poll the same day. Neither ever blocks a registration: the worst a stale
 * slot can do is one bounded poll before proving.
 *
 * Ownership. The slot carries an opaque tag for the attempt that wrote it, so
 * a run for another document or another key neither adopts it nor deletes it.
 * The tag is a short non-reversible fingerprint computed from the network, the
 * document hash and the captured key: none of those three values, nor
 * anything derived from them that could be matched back, is ever stored.
 *
 * That tag is carried BY THE RUN and handed to every write. This module holds
 * no "currently armed attempt": a registration run outlives its screen (R3),
 * so scanning a second document while the first is still proving put two runs
 * between their arm and their markSent at once, and the shared variable gave
 * the first run's marker the second document's name (wave 2a, constat 1).
 *
 * What is NOT stored (audit item C1). AsyncStorage is plain text, it is swept
 * into phone backups, and it outlives "delete everything", so what is not read
 * back must not be written. Earlier versions also stored the registration
 * transaction hash: nothing ever read it, and it resolves publicly to the
 * registration transaction, hence to passportHash, dgCommit and the identity
 * key. `buildSlotRecord` below is the ONE place that decides what lands on
 * disk, `SLOT_FIELDS` is the closed list of names it may use, and a field
 * added anywhere else is a bug that
 * utils/registration-pending-slot.test.ts fails on.
 *
 * Deliberately minimal, as before:
 *   - one fixed AsyncStorage key, never keyed by anything about a document,
 *     and never a row in the passport-key DB (SecureStore);
 *   - never logged: only its age in seconds and its state may appear;
 *   - no background polling: it is read only when Step 7 runs.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const SLOT_KEY = 'registration-pending-v1';
/** A slot the relayer accepted. */
export const PENDING_SLOT_MAX_AGE_MS = 60 * 60 * 1000;
/** A marker written before the POST, outcome unknown. */
export const PENDING_MARKER_MAX_AGE_MS = 30 * 60 * 1000;

export type PendingSlotState = 'sent' | 'accepted';

/**
 * The closed list of field names a stored slot may carry. Anything outside it
 * never reaches disk, and the test asserts the record's keys against it.
 */
export const SLOT_FIELDS = ['acceptedAt', 'state', 'network', 'owner'] as const;

/**
 * TODO(PROTOCOL-LEAD-B): everything that reaches disk, in one type and one
 * builder. Provisional until Rarimo confirms what a pending marker may hold.
 */
interface PendingSlot {
  acceptedAt: number;
  /** Absent in slots written before this marker existed: read as 'accepted'. */
  state?: PendingSlotState;
  network?: string;
  /** Opaque attempt tag, never the values it is computed from. */
  owner?: string;
}

/**
 * The single place that decides what a stored slot contains: when it was
 * written, which of the two states it is in, and who it belongs to. No
 * transaction hash, no document hash, no key and nothing derived from a key.
 * TODO(PROTOCOL-LEAD-B): drop or replace fields here (e.g. an opaque hash
 * agreed with Rarimo in place of the local fingerprint) without touching
 * anything else.
 */
export function buildSlotRecord(
  at: number,
  state: PendingSlotState = 'accepted',
  ownership?: PendingSlotOwnership,
): PendingSlot {
  const record: PendingSlot = { acceptedAt: at, state };
  if (ownership?.network !== undefined) record.network = ownership.network;
  if (ownership?.owner !== undefined) record.owner = ownership.owner;
  return record;
}

/**
 * Who a write belongs to. It is ALWAYS passed in by the caller, never read
 * back from module state: rule R3 lets a registration run outlive its screen,
 * so two runs for two different documents can sit between their `arm` and
 * their `markSent` at the same time. A module-level "currently armed attempt"
 * would then hand the second run's tag to the first run's marker, and that is
 * exactly the double POST AV4 exists to prevent (wave 2a, constat 1).
 */
export interface PendingSlotOwnership {
  network?: string;
  owner?: string;
}

export interface PendingSlotAttempt {
  network: string;
  passportHash: string;
  privateKey: string;
}

/**
 * A short, non-reversible tag for one attempt. FNV-1a over the three values,
 * twice with different offsets: enough to tell two attempts apart on one
 * phone, and nothing anyone could walk back to a document or a key. It is an
 * ownership marker, not a secret and not an identifier — it never leaves the
 * device and is never logged.
 */
function attemptTag(attempt: PendingSlotAttempt): string {
  const input = `${attempt.network}\u0000${attempt.passportHash}\u0000${attempt.privateKey}`;
  const fnv = (seed: number): number => {
    let h = seed;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };
  return fnv(0x811c9dc5).toString(16).padStart(8, '0') + fnv(0x0f4b1e37).toString(16).padStart(8, '0');
}

/**
 * Name the attempt that is about to prove and send, so the marker the POST
 * writes belongs to it. Returns the owner token, which the run then carries
 * itself and hands to every write, to `clearPendingSlot` and to the relayer
 * POST. It keeps NO module state on purpose: see PendingSlotOwnership.
 * Called once per run, before the proof.
 */
export function armPendingSlot(attempt: PendingSlotAttempt): string {
  return attemptTag(attempt);
}

/**
 * AV4: the durable trace, written BEFORE the request goes out. Called
 * from the relayer POST itself, so it covers every path that sends, and it is
 * best-effort: failing to write it must never stop a registration.
 *
 * `ownership` is the run's own token, never a shared "currently armed" value:
 * two runs can be in flight at once (R3) and each marker must name its own.
 */
export async function markRegistrationSent(
  ownership?: PendingSlotOwnership,
  now = Date.now(),
): Promise<void> {
  // TODO(PROTOCOL-LEAD-B): provisional marker shape, see buildSlotRecord.
  try {
    const existing = await readSlot();
    // A slot this same attempt already got accepted: keep it.
    if (existing?.state === 'accepted' && existing.owner === ownership?.owner) return;
    await AsyncStorage.setItem(
      SLOT_KEY,
      JSON.stringify(buildSlotRecord(now, 'sent', ownership)),
    );
  } catch {
    // Best-effort: without it the next attempt simply cannot skip the proof.
  }
}

/**
 * The relayer accepted: the same record, now in its 'accepted' state and with
 * the longer lifetime. It takes no transaction hash, and the relayer's hash is
 * deliberately dropped by the caller (C1): the only arguments are who the run
 * is and the clock.
 */
export async function writePendingSlot(
  ownership?: PendingSlotOwnership,
  now = Date.now(),
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      SLOT_KEY,
      JSON.stringify(buildSlotRecord(now, 'accepted', ownership)),
    );
  } catch {
    // Best-effort: without it the next attempt simply cannot skip the proof.
  }
}

/**
 * Delete the slot. With an `owner`, only when the slot is that attempt's (or
 * carries no owner at all, as slots written before this did): one run never
 * throws away the trace another document's registration is relying on.
 */
export async function clearPendingSlot(owner?: string): Promise<void> {
  try {
    if (owner) {
      const existing = await readSlot();
      if (existing?.owner && existing.owner !== owner) return;
    }
    await AsyncStorage.removeItem(SLOT_KEY);
  } catch {}
}

async function readSlot(): Promise<PendingSlot | null> {
  try {
    const raw = await AsyncStorage.getItem(SLOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingSlot;
  } catch {
    return null;
  }
}

/**
 * Age of the slot in milliseconds when a usable one exists, else null.
 *
 * Usable means: within its state's lifetime, and — when `attempt` is given —
 * not a slot another attempt owns. Anything else is deleted on the way, so a
 * marker that nothing can act on never costs a second run.
 */
export async function pendingSlotAgeMs(
  now = Date.now(),
  attempt?: PendingSlotAttempt,
): Promise<number | null> {
  try {
    const slot = await readSlot();
    if (!slot) return null;
    const maxAge = slot.state === 'sent' ? PENDING_MARKER_MAX_AGE_MS : PENDING_SLOT_MAX_AGE_MS;
    const age = typeof slot.acceptedAt === 'number' ? now - slot.acceptedAt : NaN;
    if (!Number.isFinite(age) || age < 0 || age > maxAge) {
      await clearPendingSlot();
      return null;
    }
    if (attempt && slot.owner && slot.owner !== attemptTag(attempt)) {
      // Another document or another key sent it: not ours to wait for, and
      // not ours to delete either.
      return null;
    }
    return age;
  } catch {
    return null;
  }
}
