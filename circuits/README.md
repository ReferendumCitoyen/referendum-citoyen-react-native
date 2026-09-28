# Circuit verify/deploy artifacts (not bundled into the app)

Everything in this directory is a **host-side** artifact: it is used on a laptop
(or by a deployer) to check or deploy a circuit. Nothing here is `require()`d by
the app, and nothing here should move under `assets/` — Metro only ships what the
JS entry graph reaches via `require()`, and these have no runtime consumer.

The *prover* input (the compiled `.json` ACIR bytecode) is the one artifact that
does have a runtime consumer, so it lives in `assets/circuits/` instead and is
registered at boot in `app/voting-flow.tsx`.

## Which build of each circuit is bundled

`constants/bundled-circuits.ts` is the manifest: source, date, the artifact's own
Noir `hash`, and which certificate-tree leaf it commits to. A test pins each entry
to the file in `assets/circuits/`, and `generateHeavyNoirProof` logs the entry, so
an error report says which build ran.

**2026-09-05 — Rarimo changed the certificate-tree leaf.** CertificatesSMT now
keys a DS certificate by `sha256(modulus)` (high 248 bits) instead of Poseidon
over its low 960 bits, and every register verifier on Mainnet was replaced the
same day, without notice. A circuit built before that proves the old leaf and
fails at `prove()`; the app's own lookup was fixed in `utils/e-document/smt-key.ts`.
Rarimo's release notes for v0.2.7 say it outright: "mixing old verifiers with
new circuits (or the reverse) makes registrations fail".

- **TD3 / passport — `registerIdentity_1_256_3_5_576_248_NA`:** replaced
  2026-09-09 with the build from
  [`passport-zk-circuits-noir` v0.2.7](https://github.com/rarimo/passport-zk-circuits-noir/releases/tag/v0.2.7),
  on the circuit author's instruction. ABI byte-identical to the previous build (only error
  strings differ), so `utils/heavy-noir-inputs.ts` is unchanged.
  `scripts/verify-register-verifier.ts` confirms the verifier Mainnet dispatches
  to for this zkType carries every verification-key constant of the release's
  `.sol` (59/59), while the pre-Sept-5 verifier shared only the generic ones (24/59).
- **TD1 / CNIe — `registerIdentity_1_256_1_6_960_248_NA`:** still the 2026-08-24
  build from the circuit author at Rarimo, which is not in any Rarimo release. Whether it commits to
  the old or the new leaf is unconfirmed (asked 2026-09-09). Until answered,
  expect ID-card registrations to fail at `prove()` with a constraint error —
  Step 7 now says so and asks for a report.

## `registerIdentity_1_256_1_6_960_248_NA.*` — TD1 / CNIe heavy register circuit

Supplied by the circuit author (Rarimo) 2026-08-24, compiled from Rarimo's
`passport-zk-circuits-noir` for **TD1** (French national ID card) documents. It is
the TD1 sibling of the TD3 passport circuit the app already shipped
(`registerIdentity_1_256_3_5_576_248_NA`).

| file | size | what it is | consumed by |
| --- | --- | --- | --- |
| `assets/circuits/registerIdentity_1_256_1_6_960_248_NA.json` | 3.1 MB | `nargo compile` artifact — ACIR bytecode + ABI. **The prover input.** | the app, at runtime |
| `registerIdentity_1_256_1_6_960_248_NA.vk` | 1.8 KB | barretenberg UltraPlonk verification key (binary) | `bb verify` on a laptop |
| `registerIdentity_1_256_1_6_960_248_NA.sol` | 140 KB | Aztec `BaseUltraVerifier` Solidity contract for this circuit | the deployer — **now live on Mainnet**, see below |

### ABI (read out of the `.json`, not guessed)

`noir_version 1.0.0-beta.1+03b58fa2dfcc8acc8cf5198b1b23b55676fbdb02` — byte-identical
version string to the bundled TD3 artifact, so both were built with the same toolchain.

```
dg1                u8[95]      (TD3: u8[93])
dg15               u8[0]       empty — no Active Authentication
ec                 u8[313]     (TD3: u8[297])
sa                 u8[152]     (TD3: u8[104])
pk                 Field[18]   slave-cert RSA-2048 modulus, 120-bit limbs LE
reduction_pk       Field[18]   Barrett reduction parameter
sig                Field[18]   SOD RSA signature
sk_identity        Field
icao_root          Field
inclusion_branches Field[80]
-> returns a PUBLIC tuple of 5 Fields
```

Those three lengths are **fixed-size Noir arrays**, which is the whole reason TD1
needs its own compiled circuit: a 95-byte CNIe DG1 cannot be proved with TD3
bytecode that declares `[u8; 93]`. The 5-field public return is why the SDK circuit
registry entry for both circuits carries `pub_signals_count = 5`.

### Verification key header (parsed from the binary)

```
circuit_type      = 2          (ULTRA / UltraPlonk)
circuit_size      = 131072     (2^17)
num_public_inputs = 5
23 named commitments (ID_1..4, Q_1..4, Q_ARITHMETIC, Q_AUX, Q_C, Q_ELLIPTIC,
Q_M, Q_SORT, SIGMA_1..4, TABLE_1..4, TABLE_TYPE)
```

The `.sol` agrees: `vk.circuit_size = 0x20000`, `vk.num_inputs = 5`, and its header
comment carries `Verification Key Hash: 7415b2b306477c432a1c4ff6839aa9fd96848af2af11b5c629becc6b95e7c43d`. <!-- // nosec: generated verifier artifact constant, not a secret -->

That hash is now load-bearing for more than bookkeeping: it is the string that
ties the verifier Rarimo deployed on Mainnet back to *this* artifact. See
"The deployed verifier is provably ours" below.

## The on-chain zkType IS registered — the heavy TD1 submit can land

`Registration2` dispatches proof verification on `keccak256(zkType)`, where zkType
is `"Z_NOIR_PASSPORT_" + <circuit name after the first underscore>` (see
`utils/register-via-noir.ts`). For this circuit that is

`keccak("Z_NOIR_PASSPORT_1_256_1_6_960_248_NA")` =
`0xe39d060618707c7996e21efea05e4dd0698ca1fc200d2f7e9b9015a338844f8c` <!-- // nosec: public keccak dispatch constant, derived from a public circuit-name string -->

**Verified live 2026-08-31** — read from Rarimo Mainnet L2 (`https://l2.rarimo.com`)
against `Registration2` at `0x11BB4B14AA6e4b836580F3DBBa741dD89423B971`, block
`0x108fe`. The date is stated inline deliberately: an undated on-chain read is
what let the previous version of this section go stale without anyone noticing.

| zkType | `passportVerifiers(keccak(zkType))` | status |
| --- | --- | --- |
| TD1 / CNIe — `Z_NOIR_PASSPORT_1_256_1_6_960_248_NA` | `0xeDA16d0aA50D8a66C306525D0d6e95fA485d0658` | **deployed and registered** |
| TD3 / passport — `Z_NOIR_PASSPORT_1_256_3_5_576_248_NA` | `0x4B0E9F154Ee86c2F156Af8AAc82633d1F057b419` | unchanged control |

Deployment tx, supplied by the circuit author (Rarimo) on
2026-08-31: `https://scan.rarimo.com/tx/0x8ec3056d8df82eb43c8ded0a1fd9ed4c07c74b48e68ebd807d7752c8b74084ae` <!-- // nosec: public Rarimo L2 transaction hash -->

His words on the same day, verbatim: **"This is final TD1 verifier"** — i.e. not a
staging deployment to be replaced, and not something to re-derive a zkType
against later.

> **Historical note.** The same read taken on **2026-08-24** — the date of the
> artifacts in this directory, and the read this file was originally written
> around (first committed 776e51f, 2026-08-25) — returned the **zero address**,
> and everything downstream of it (the success criterion, the routing default,
> several code comments across the repo) was scoped around "the proof is all we
> can get". Note what that date does and does not say: 2026-08-24 is when the
> zero address was **last observed**, not when it changed. The verifier was
> deployed at some unknown point between then and 2026-08-31. The sections
> below were rewritten on 2026-08-31. If you find prose elsewhere in the repo
> still claiming the TD1 submit reverts by design, it is stale; this section is
> the ground truth.

### The deployed verifier is provably ours

The address above is not taken on trust. It was checked against the artifact in
this directory, and the two agree at the byte level:

```
address        0xeDA16d0aA50D8a66C306525D0d6e95fA485d0658
code size      11236 bytes of deployed runtime bytecode
dispatch table begins with selector 0x937f6a10 = getVerificationKeyHash()
               — the Aztec BaseUltraVerifier interface, which is exactly the
               shape registerIdentity_1_256_1_6_960_248_NA.sol generates
runtime code   contains the byte run 7415b2b3…c43d
```

That last line is the whole argument. `7415b2b3…c43d` is the full 32-byte
`Verification Key Hash` recorded in the `.sol` header comment above, reproduced
byte-for-byte inside the deployed contract's runtime bytecode. An Aztec
`BaseUltraVerifier` embeds the hash of the verification key it was generated
from, so a match means the deployed verifier was generated from the same
verification key as **our bundled circuit** — not a sibling TD1 circuit, not a
recompile with different constraints. Combined with the `getVerificationKeyHash()`
selector at the head of the dispatch table, that is a positive identification
rather than an inference from naming.

### The success criterion is now end to end, on-chain

The old goal stopped at the prover, because the chain could not answer. It now
can, so the bar is:

> real CNIe → circuit → proof generates on-device → `registerViaNoir` submits →
> the tx lands on Rarimo L2 → Step7's registration→SMT poll confirms the bond →
> the same card votes and the vote receipt confirms.

Off-chain `bb verify` against this `.vk` (recipe below) is still worth keeping,
but it has been demoted to a **diagnostic**: it separates "did the prover emit a
well-formed proof for this circuit" from "did the chain accept it". Reach for it
when an on-chain submit fails and you need to know which half broke. It is no
longer the finish line, and a passing `bb verify` on its own no longer counts as
the deliverable.

Two things that remain untested and should not be assumed from the above: the
heavy register path has never actually landed a TD1 bond on-chain, and the
combination *heavy Noir register + Noir TD1 `query_identity` vote* has never
been exercised end to end (TD3 pairs heavy register with a Circom query; TD1
used to pair the light registrator with the Noir query). The byte-level match
proves the verifier is ours; it does not prove the two circuits agree on the
`dgCommit` convention. Only a real device run does that.

### The voting flow now routes CNIe registration through this circuit

Until 2026-08-31 a CNIe registered through Rarimo's light registrator
(`/registerid`), a hosted service that handles ID cards on both networks and
that every TD1 registration up to that date went through. With the verifier
live, the heavy route is the aligned one — the same path TD3 passports have
always taken, self-contained, with no dependency on a service we do not control
— so `TD1_HEAVY_REGISTER` in `constants/td1-heavy-register.ts` now defaults to
`true`, and Step7's routing gate sends a 95-byte DG1 into this circuit.

Things worth knowing before debugging a CNIe registration on this route:

- **Step 7 is much longer than the light round trip.** Roughly 20 s in the
  prover, then the relayer submit, then Step7's 60 s registration→SMT
  confirmation poll. A slave certificate missing from the on-chain SMT adds a
  real CSCA-bootstrap tx, a wait for it to land, and a *second* ~20 s prove.
- **There is no automatic fallback.** Step7's light-registrator call lives in
  the mutually exclusive `else` of the routing gate, so once a mainnet CNIe
  takes the heavy branch it cannot fall back to `/registerid` within the same
  run.
- **Already-registered documents are untouched.** Step7 reads
  `getDocumentStatus` *before* routing, and that check is registrar-agnostic —
  it compares StateKeeper's `activeIdentity` for the chip's passport key against
  this device's profile key. A CNIe already registered under the key this phone
  holds short-circuits to success without proving anything, whichever route
  wrote the original bond.

TD3 passports are unaffected by the flag, but the scope is narrower than "stays
heavy unconditionally": Step7's gate is `network === 'mainnet' &&
heavyCircuitName`, so a passport is routed heavy **on mainnet only**. On testnet
a TD3 falls into the same light `else` as everything else — and that route is
known-broken for a passport, having returned HTTP 400 on both networks when
probed 2026-05-18. Mainnet is the only network where "TD3 has no working light
path, therefore it goes heavy" actually holds; on testnet a passport takes the
broken light path instead.

What is *not* conditional, and never was, is the pinning the circuit author
asked for: the TD1 circuit is bundled from `assets/circuits/` and registered at
boot regardless of any flag, never resolved from Rarimo's CDN.

## Diagnostic: capturing a proof from the phone and verifying it off-chain

Use this when an on-chain registration fails and you need to know whether the
prover or the chain is at fault. It is not the acceptance test any more — see
"The success criterion is now end to end, on-chain" above.

1. Get a real CNIe's chip data through the circuit. Two routes:

   **a. The dev screen — preferred, no code edits.** `app/french-id-test.tsx`
   has a "Preuve TD1 (circuit lourd)" card: scan the card, tap the button. It
   calls `generateHeavyNoirProof()` directly, so it needs no flag flipped and
   never touches a proposal, an eligibility check or the relayer. This is the
   route to use for a pure prover-side check, because it isolates proof
   generation from everything else.

   **b. Through the real voting flow.** Only if you specifically want to
   exercise Step7's routing and the real submit. `TD1_HEAVY_REGISTER` already
   defaults to `true`, so the only flip needed is `MOCK_BACKEND` → `false` in
   `constants/mock-backend.ts` (**locally only** — it must keep its committed
   value in git), so Step7 stops short-circuiting to a simulated success.

   Either way the proof is generated on-device and then dumped; route (b) goes
   on to submit it through the relayer to `Registration2`, which — with the
   verifier now registered — is expected to verify and land, then be confirmed
   by Step7's SMT poll.
2. `generateHeavyNoirProof()` writes a dump to the app's document directory and
   opens the share sheet — see `utils/heavy-proof-dump.ts`. AirDrop / share it
   to the laptop.
3. The dump is JSON:
   ```jsonc
   {
     "circuitName": "registerIdentity_1_256_1_6_960_248_NA",
     "pub_signals": ["<64 hex>", ... 5 entries],
     "proof": "<hex, no 0x>",
     "bbProofHex": "<pub_signals joined, then proof — the raw prover output>"
   }
   ```
4. Turn `bbProofHex` back into a binary file:
   ```sh
   jq -r .bbProofHex dump.json | xxd -r -p > proof
   ```
5. Verify:
   ```sh
   bb verify -k registerIdentity_1_256_1_6_960_248_NA.vk -p proof
   ```

### What is established vs. what is not

**Established from the code** (`node_modules/@rarimo/rarime-rn-sdk/src/RnNoirModule.ts`,
`NoirCircuitParams.prove()`): native `provePlonk` returns ONE hex string and the SDK
splits it as `pub_signals = first (5 × 64) hex chars`, `proof = the rest`. So the
native output already *is* the conventional bb layout
`publicInputs (5 × 32 B, big-endian) || proofBytes`, and re-concatenating
`pub_signals.join('') + proof` reproduces it byte-for-byte. Expected total:
160 + 2144 = **2304 bytes / 4608 hex chars**. The 2144 is not folklore — the highest
proof calldata offset in the `.sol` is `add(data_ptr, 0x840)` = 2112, +0x20 = 2144.

**NOT established, do not treat step 5 above as verified** (and note that none of
this blocks anything any more — an on-chain submit settles proof validity
without ever resolving the `bb` questions below; these only matter if you are
running the off-chain diagnostic):

- The exact `bb` release tag to use. All that could be recovered offline is the
  revision the prover was built from: `strings` on `modules/noir-16k/noir.aar`
  → `jni/arm64-v8a/libnoir_java.so` yields aztec-packages rev `e1af688`
  (barretenberg), noir rev `03b58fa` (matches the artifact's `noir_version`), and
  noir_rs rev `30a017c`. Which published bb version that maps to is unknown.
- The exact `bb verify` flags. Later bb releases **dropped UltraPlonk entirely** and
  split the proof file into separate `proof` + `public_inputs` files, so
  `-k`/`-p` semantics vary by version. If the command above fails, try feeding the
  2144-byte tail as `proof` and the 5 × 32 B head as `public_inputs` separately.
  That is exactly why the dump carries *both* the split (`proof` + `pub_signals`)
  and the concatenated (`bbProofHex`) forms — reshaping on the laptop is free,
  another CNIe scan is ~20 s of prover time plus an NFC session.
- Whether this `.vk` binary is byte-compatible with whatever `bb` build is on hand.

Note the `.sol` verifier takes proof and public inputs **separately**
(`verify(bytes calldata _proof, bytes32[] calldata _publicInputs)`), so do not feed
it the concatenated blob.
