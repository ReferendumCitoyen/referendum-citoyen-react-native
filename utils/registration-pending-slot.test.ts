/**
 * The durable "registration in flight" marker: what it is allowed to leave on
 * disk (audit item C1) and when it is written (AV4).
 *
 * AsyncStorage is plain text, it is included in iOS and Android phone backups
 * and it survives "delete everything". The record therefore holds a timestamp,
 * the state it is in, and the opaque ownership tag that stops one attempt from
 * adopting or deleting another's marker. These tests fail the moment anything
 * else reaches it: a transaction hash, a document hash, a key, a nullifier, an
 * address.
 *
 * TODO(PROTOCOL-LEAD-B): the stored shape is still open (buildSlotRecord is
 * the one place that decides it). The behaviour pinned below does not depend
 * on the shape: a marker exists before the POST, it expires on its own, and
 * one attempt never adopts or deletes another attempt's marker.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PENDING_MARKER_MAX_AGE_MS,
  PENDING_SLOT_MAX_AGE_MS,
  SLOT_FIELDS,
  armPendingSlot,
  buildSlotRecord,
  clearPendingSlot,
  markRegistrationSent,
  pendingSlotAgeMs,
  writePendingSlot,
} from '@/utils/registration-pending-slot';

const SLOT_KEY = 'registration-pending-v1';

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(async (k: string, v: string) => {
      mockStore.set(k, v);
    }),
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    removeItem: jest.fn(async (k: string) => {
      mockStore.delete(k);
    }),
    clear: jest.fn(async () => {
      mockStore.clear();
    }),
  },
}));

// Shapes an adversary holding the phone or a backup would look for.
const HEX64 = /0x?[0-9a-fA-F]{40,}/;
const BASE64ISH = /[A-Za-z0-9+/]{32,}={0,2}/;

const ATTEMPT = { network: 'mainnet', passportHash: 'doc-X', privateKey: 'key-X' };
const OTHER = { network: 'mainnet', passportHash: 'doc-Y', privateKey: 'key-Y' };
const T0 = 1_000_000;
/** What Step 7 hands to every write for ATTEMPT. */
const OWNER = armPendingSlot(ATTEMPT);

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('what the pending slot writes', () => {
  it('stores the acceptance time and its state, and nothing else', async () => {
    await writePendingSlot(undefined, 1_700_000_000_000);
    const raw = mockStore.get(SLOT_KEY) as string;
    expect(JSON.parse(raw)).toEqual({ acceptedAt: 1_700_000_000_000, state: 'accepted' });
    expect(Object.keys(JSON.parse(raw))).toEqual(['acceptedAt', 'state']);
  });

  it('never writes a transaction hash or any key material', async () => {
    await writePendingSlot(undefined, 1_700_000_000_000);
    const raw = mockStore.get(SLOT_KEY) as string;
    expect(raw).not.toMatch(HEX64);
    expect(raw).not.toMatch(BASE64ISH);
    expect(raw).not.toMatch(/hash|key|nullifier|proof|address|passport|commit|sig|dg1|sod/i);
  });

  it('takes no transaction hash: the only parameter is the clock', async () => {
    // Before C1 the signature was writePendingSlot(txHash, now) and the hash
    // was stored verbatim. The only argument left is a timestamp.
    // Its two parameters are an ownership token and a clock, nothing else.
    expect(writePendingSlot.length).toBe(1); // ownership, then a defaulted clock
    await writePendingSlot(undefined, ('0x' + 'ab'.repeat(32)) as unknown as number);
    const raw = mockStore.get(SLOT_KEY) as string;
    // A non-number handed in is stored as-is by JSON, so it would show — but
    // it can only be the acceptedAt field, and pendingSlotAgeMs then refuses
    // the slot instead of trusting it.
    expect(Object.keys(JSON.parse(raw))).toEqual(['acceptedAt', 'state']);
    expect(await pendingSlotAgeMs(Date.now())).toBeNull();
  });

  it('buildSlotRecord is the whole definition of the stored shape', () => {
    expect(buildSlotRecord(42)).toEqual({ acceptedAt: 42, state: 'accepted' });
    expect(JSON.stringify(buildSlotRecord(42))).toBe('{"acceptedAt":42,"state":"accepted"}');
    expect(buildSlotRecord(42, 'sent')).toEqual({ acceptedAt: 42, state: 'sent' });
    // The list of field names is closed: a new one is a decision, not a patch.
    expect([...SLOT_FIELDS]).toEqual(['acceptedAt', 'state', 'network', 'owner']);
    for (const state of ['sent', 'accepted'] as const) {
      const record = buildSlotRecord(42, state, { network: 'mainnet', owner: 'deadbeefdeadbeef' });
      expect(Object.keys(record).every((k) => (SLOT_FIELDS as readonly string[]).includes(k))).toBe(
        true,
      );
      // acceptedAt is the one number; every other value is a short label, and
      // a hash or a key is how a long opaque string would come back in.
      expect(typeof record.acceptedAt).toBe('number');
      for (const [k, v] of Object.entries(record)) {
        if (k === 'acceptedAt') continue;
        expect(typeof v).toBe('string');
        expect(String(v).length).toBeLessThanOrEqual(16);
      }
    }
  });

  it('the write path stores exactly what buildSlotRecord returns', async () => {
    await writePendingSlot(undefined, 7);
    expect(JSON.parse(mockStore.get(SLOT_KEY) as string)).toEqual(buildSlotRecord(7));
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(SLOT_KEY, JSON.stringify(buildSlotRecord(7)));
  });
});

describe('reading it back', () => {
  it('reports the age of a fresh slot', async () => {
    await writePendingSlot(undefined, 1_000);
    expect(await pendingSlotAgeMs(61_000)).toBe(60_000);
  });

  it('deletes and ignores one older than the hour', async () => {
    await writePendingSlot(undefined, 0);
    expect(await pendingSlotAgeMs(PENDING_SLOT_MAX_AGE_MS + 1)).toBeNull();
    expect(mockStore.has(SLOT_KEY)).toBe(false);
  });

  it('still reads a slot left by an older build, and keeps only its age', async () => {
    // Forward compatibility with a phone that upgraded: the old record had a
    // txHash. It is never read, and the next write drops it.
    mockStore.set(SLOT_KEY, JSON.stringify({ txHash: '0x' + 'cd'.repeat(32), acceptedAt: 1_000 }));
    expect(await pendingSlotAgeMs(2_000)).toBe(1_000);
    await writePendingSlot(undefined, 3_000);
    expect(mockStore.get(SLOT_KEY)).not.toContain('txHash');
  });

  it('clears', async () => {
    await writePendingSlot(undefined, 1);
    await clearPendingSlot();
    expect(mockStore.has(SLOT_KEY)).toBe(false);
  });
});

describe('the marker written before the POST', () => {
  it('exists as soon as the request is about to leave', async () => {
    expect(await pendingSlotAgeMs(T0)).toBeNull();

    await markRegistrationSent({ network: 'mainnet', owner: OWNER }, T0);
    expect(await pendingSlotAgeMs(T0 + 5_000, ATTEMPT)).toBe(5_000);
  });

  it('expires on its own, so a request that never left stops costing a poll', async () => {

    await markRegistrationSent({ network: 'mainnet', owner: OWNER }, T0);
    expect(await pendingSlotAgeMs(T0 + PENDING_MARKER_MAX_AGE_MS - 1, ATTEMPT)).not.toBeNull();
    expect(await pendingSlotAgeMs(T0 + PENDING_MARKER_MAX_AGE_MS + 1, ATTEMPT)).toBeNull();
    // …and it is gone from disk, not merely ignored.
    expect(mockStore.has(SLOT_KEY)).toBe(false);
  });

  it('lives an hour once the relayer accepted it', async () => {

    await writePendingSlot({ network: 'mainnet', owner: OWNER }, T0);
    expect(await pendingSlotAgeMs(T0 + PENDING_MARKER_MAX_AGE_MS + 1, ATTEMPT)).not.toBeNull();
    expect(await pendingSlotAgeMs(T0 + PENDING_SLOT_MAX_AGE_MS + 1, ATTEMPT)).toBeNull();
  });

  it('does not downgrade an accepted slot of the same attempt', async () => {

    await writePendingSlot({ network: 'mainnet', owner: OWNER }, T0);
    await markRegistrationSent({ network: 'mainnet', owner: OWNER }, T0 + 1_000);
    // Still the accepted slot: its age is counted from the acceptance.
    expect(await pendingSlotAgeMs(T0 + 2_000, ATTEMPT)).toBe(2_000);
  });
});

describe('ownership', () => {
  it('another attempt neither adopts the marker nor deletes it', async () => {
    const owner = OWNER;
    await markRegistrationSent({ network: 'mainnet', owner: OWNER }, T0);
    expect(await pendingSlotAgeMs(T0 + 1_000, OTHER)).toBeNull();
    await clearPendingSlot('not-this-owner');
    // Untouched: the attempt that sent it still finds it.
    expect(await pendingSlotAgeMs(T0 + 1_000, ATTEMPT)).toBe(1_000);
    await clearPendingSlot(owner);
    expect(await pendingSlotAgeMs(T0 + 1_000, ATTEMPT)).toBeNull();
  });

  it('a slot with no owner (written by an earlier build) is still usable', async () => {
    mockStore.set(SLOT_KEY, JSON.stringify({ txHash: '0xold', acceptedAt: T0 }));
    expect(await pendingSlotAgeMs(T0 + 1_000, ATTEMPT)).toBe(1_000);
    await clearPendingSlot('whoever');
    expect(await pendingSlotAgeMs(T0 + 1_000, ATTEMPT)).toBeNull();
  });
});

describe('what reaches disk once an attempt owns the slot', () => {
  it('never stores the document hash or the key, in any field', async () => {

    await markRegistrationSent({ network: 'mainnet', owner: OWNER }, T0);
    const raw = mockStore.get(SLOT_KEY) ?? '';
    expect(raw).not.toContain(ATTEMPT.passportHash);
    expect(raw).not.toContain(ATTEMPT.privateKey);
    expect(raw).not.toMatch(HEX64);
    expect(raw).not.toMatch(BASE64ISH);
    // and every stored name is one the closed list allows.
    for (const k of Object.keys(JSON.parse(raw) as Record<string, unknown>)) {
      expect(SLOT_FIELDS as readonly string[]).toContain(k);
    }
  });
});

describe('two runs in flight at once (wave 2a, constat 1)', () => {
  /**
   * R3 lets a registration run outlive its screen, so the voter can close the
   * vote and scan a second document while the first is still proving. Both
   * runs are then between their arm and their markSent. Each write must name
   * its OWN run: while a module-level "currently armed attempt" decided it,
   * document A's marker was written under document B's name, A re-proved and
   * re-POSTed the same registration on the next run, and B paid a 60 s
   * confirmation wait for a registration that was not its own.
   */
  it('the marker written for A names A, not the document scanned meanwhile', async () => {
    const ownerA = armPendingSlot(ATTEMPT);
    const ownerB = armPendingSlot(OTHER);
    expect(ownerA).not.toBe(ownerB);

    // A arms, B arms (B's run starts while A is still proving), then A writes.
    await markRegistrationSent({ network: ATTEMPT.network, owner: ownerA }, T0);

    const slot = JSON.parse(mockStore.get(SLOT_KEY) as string) as { owner?: string };
    expect(slot.owner).toBe(ownerA);
    // A finds its own marker again, so it polls instead of proving twice…
    expect(await pendingSlotAgeMs(T0 + 1_000, ATTEMPT)).toBe(1_000);
    // …and B does not inherit a wait for a registration that is not its own.
    expect(await pendingSlotAgeMs(T0 + 1_000, OTHER)).toBeNull();
    // A can still clear its own trace once it is confirmed.
    await clearPendingSlot(ownerA);
    expect(mockStore.has(SLOT_KEY)).toBe(false);
  });

  it('the promotion to accepted keeps the same owner', async () => {
    const ownerA = armPendingSlot(ATTEMPT);
    armPendingSlot(OTHER);
    await writePendingSlot({ network: ATTEMPT.network, owner: ownerA }, T0);
    expect(
      (JSON.parse(mockStore.get(SLOT_KEY) as string) as { owner?: string }).owner,
    ).toBe(ownerA);
    expect(await pendingSlotAgeMs(T0 + 1_000, OTHER)).toBeNull();
  });

  it('nothing outside a caller can name an owner: buildSlotRecord reads no module state', () => {
    armPendingSlot(ATTEMPT);
    // No ownership passed in, so none is stored — previously the record would
    // have picked up whatever attempt was armed last.
    expect(buildSlotRecord(T0, 'sent')).toEqual({ acceptedAt: T0, state: 'sent' });
  });
});
