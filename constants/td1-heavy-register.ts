// Whether a French national ID card (CNIe / TD1) registers through the HEAVY
// Noir register circuit on Mainnet instead of Rarimo's light registrator.
// Read by Step7's routing gate (components/voting-modal/Step7.tsx) and by
// nothing else.
//
// Like MOCK_BACKEND in ./mock-backend.ts, this is a single-point switch over a
// whole route, kept as a one-line revert rather than a deleted code path.
// UNLIKE MOCK_BACKEND, it is no longer a "flip it locally for one manual test"
// flag: as of 2026-08-31 the heavy route is the committed default for TD3 AND
// TD1, and `false` is the escape hatch, not the resting state.
//
// Why it now defaults to `true`
// -----------------------------
// The premise the whole flag was built on — "the TD1 heavy proof generates
// fine, but it cannot complete on-chain" — is dead. Registration2
// (0x11BB4B14AA6e4b836580F3DBBa741dD89423B971) dispatches proof verification on
// keccak(zkType), and the TD1 zkType now resolves to a real deployed verifier.
// Verified live 2026-08-31 against https://l2.rarimo.com at block 0x108fe:
//
//   passportVerifiers(keccak("Z_NOIR_PASSPORT_1_256_1_6_960_248_NA"))
//     zkType   0xe39d060618707c7996e21efea05e4dd0698ca1fc200d2f7e9b9015a338844f8c  // nosec: public TD1 zkType keccak, derived from a public circuit name
//     verifier 0xeDA16d0aA50D8a66C306525D0d6e95fA485d0658
//
// The SAME read returned the zero address on 2026-08-24. Comments and docs
// elsewhere in this tree were written against that older read, so if you find
// one still claiming the TD1 zkType is unregistered, it is stale, not a
// contradiction — trust the date.
//
// That the deployed contract is the verifier for OUR bundled circuit is not
// taken on faith. It holds 11236 bytes of runtime bytecode; its dispatch table
// begins with selector 0x937f6a10 = getVerificationKeyHash(), the Aztec
// BaseUltraVerifier interface; and that bytecode CONTAINS the string
// 7415b2b306477c432a1c4ff6839aa9fd96848af2af11b5c629becc6b95e7c43d — byte for  // nosec: generated verifier artifact constant (VK hash), not a secret
// byte the Verification Key Hash recorded in the header comment of
// circuits/registerIdentity_1_256_1_6_960_248_NA.sol, which is the .sol emitted
// from the very circuit we ship in assets/circuits/. The circuit author
// (Rarimo) confirmed it in writing on 2026-08-31 — "This is
// final TD1 verifier" — and supplied the deployment transaction:
// https://scan.rarimo.com/tx/0x8ec3056d8df82eb43c8ded0a1fd9ed4c07c74b48e68ebd807d7752c8b74084ae  // nosec: public Mainnet transaction hash
//
// TD3 is the unchanged control, re-read at the same block:
// passportVerifiers(keccak("Z_NOIR_PASSPORT_1_256_3_5_576_248_NA")) =
// 0x4B0E9F154Ee86c2F156Af8AAc82633d1F057b419.
//
// What flipping it back to `false` does
// -------------------------------------
// Sends a CNIe back down Rarimo's light registrator (`/registerid`), which
// still works. It is the path Rarimo supports for ID cards on BOTH networks
// (confirmed with the Rarimo team 2026-05-21) and the one every CNIe
// registration to date has gone through — including the Mainnet vote recorded
// at app/(tabs)/index.tsx, which could only have happened on top of a
// successful TD1 registration. TD3 is unaffected either way, but be precise
// about the scope: Step7's gate is `network === 'mainnet' && heavyCircuitName`,
// so a passport stays heavy unconditionally ON MAINNET ONLY. On testnet a TD3
// falls into the light `else` alongside everything else, and that is a
// known-broken route — the light registrator returned HTTP 400 for a passport
// on both networks when probed 2026-05-18. So "TD3 stays heavy" is a mainnet
// statement; TD3 on testnet takes a light path that has historically failed,
// and nothing here changes that either way.
//
// Reach for `false` if the relayer starts rejecting registerViaNoir for TD1, if
// devices show the proof generating but Step7's SMT confirmation poll never
// confirming, or if the extra on-device cost below proves unacceptable on
// low-end hardware. Note what it is NOT: it is a per-build revert, not a
// per-user one. It changes where the next unregistered CNIe goes; it cannot
// undo a bond already written on-chain.
//
// The one thing this flip does NOT discharge
// ------------------------------------------
// No TD1 registerViaNoir has ever landed on-chain. The verifier is provably the
// right one, but "the deployed verifier accepts a proof THIS app generated on a
// real phone" remains inference, not observation. And the heavy path has no
// fallback: if registerIdentityViaNoir throws, Step7 does not retry through
// rarime.registerIdentity — the light call lives in the mutually exclusive
// `else` — so with this flag `true` a Mainnet CNIe can only ever take the heavy
// branch. This codebase has already been bitten once by exactly the "proof
// generates on Android, deployed verifier rejects the pairing" failure class:
// see the 0xd71fd263 / PAIRING_FAILED handling in Step11, and note that Step7
// has no equivalent branch.
//
// So this flag ships on the back of a process step, not a code change: one
// real-CNIe end-to-end run on a device — register → SMT confirm → vote — before
// the build reaches testers. What to watch for, in order:
//   1. `[Step7] heavy circuit for dg1=95B: registerIdentity_1_256_1_6_960_248_NA`
//   2. `[buildHeavyRegisterInputs] idCard ABI shape — dg1=95/95 ec=313/313
//      sa=152/152` (__DEV__ only; 313/152 came off the circuit author's own
//      sample chip, so a differing card is a real finding to escalate)
//   3. `[registerViaNoir] relayer accepted: tx_hash=…` AND the tx status on
//      scan.rarimo.com — a relayer ACK is not a mined transaction.
//   4. `[Step7][mainnet] SMT confirmed in …ms` — the single strongest signal
//      that the circuit's passportHash / identityKey match the SDK's.
//   5. A vote that reaches executeTD1Noir and returns a receipt. That is what
//      closes the dgCommit question below, and nothing before it does.
//
// Who this actually affects
// -------------------------
// Exactly one population: CNIe holders on Mainnet who are NOT yet registered.
//
// Step7 calls rarime.getDocumentStatus(passport) BEFORE the routing gate, and
// the entire heavy branch — prove, CSCA bootstrap, relayer POST, 60 s SMT poll
// — is nested inside `if (needsRegistration)`. That status check is
// registrar-agnostic: it keys on passport.getPassportKey(), which for a
// document with no DG15 falls through to getPassportHash() —
// Poseidon(<252-bit truncation of hash(signedAttributes)>), i.e. the digest is
// truncated to 252 bits and THEN Poseidon-hashed, not used raw (see
// node_modules/@rarimo/rarime-rn-sdk/src/RarimePassport.ts::getPassportHash).
// Every input to that is the chip's own bytes, with no dependence on which
// contract wrote the bond, on DG1 length, or on the registration route — which
// is the part the argument below rests on. So a CNIe already
// light-registered under the key this device holds comes back
// RegisteredWithThisPk, falls straight through to onSuccess, and pays exactly
// one eth_call: no 20 s prove, no relayer POST, no revert. The flip is
// invisible to them.
//
// Both routes bond the SAME on-chain identity
// -------------------------------------------
// This does not create a second identity. Light bonds
// passport.getPassportHash() + RarimeUtils.getProfileKey(sk); heavy bonds the
// circuit's pub_signals[1] (passportHash) + pub_signals[3] (identityKey,
// derived from the same sk_identity out of SecureStore), and StateKeeper
// computes the same Poseidon(passportKey, profileKey) RegistrationSMT leaf
// either way. The two passportHashes agree because both sides hash the same
// bytes: utils/e-document/sod.ts's signed-attributes DER SET is a byte-identical
// reimplementation of the SDK's own.
//
// The load-bearing link we CANNOT verify from inside this repo is the dgCommit
// convention. Light writes it as pub_signals[0] of register_light_256, heavy as
// pub_signals[2], and query_identity recomputes it from dg1 + sk at vote time.
// If the heavy TD1 circuit's dgCommit disagreed with what query_identity_td1
// recomputes, registration would SUCCEED and voting would fail forever on that
// document. The evidence that the convention is shared is TD3: heavy Noir
// register and a completely separate Circom query_identity interoperate on
// Mainnet today. Step 5 of the device test above is what settles it for TD1.
//
// Be blunt about the shape of a wrong bond, because it is not a revert: it is a
// real bond written at a key the app never looks up, the 60 s poll timing out,
// and — a French document carries no DG15 — Registration2.revoke() blocked, so
// that card is unrecoverable and its holder can only ever vote with a different
// document. That asymmetry, not any doubt about the verifier, is why this flag
// still exists instead of being deleted.
//
// Also worth naming plainly: the flip creates a cross-product nobody has run.
// Exercised today are heavy register + Circom query (TD3) and light register +
// Noir TD1 query (TD1). From here TD1 is heavy register + Noir TD1 query.
//
// What the heavy route costs the user
// -----------------------------------
// Light is one round trip and the server does all the certificate work. Heavy
// is a ~20 s prove on-device, possibly a real Mainnet CSCA-bootstrap
// transaction plus a ~30 s wait and then a SECOND ~20 s prove, then the 60 s
// SMT confirmation poll — worst case around two and a half minutes on a
// Volla-class phone, on top of the trusted-setup download. It also newly
// exposes CNIe holders to the CSCA-bootstrap failure modes ([CSCA_MISSING],
// missing AKI, CSCA not in the bundle) that the light path never touched: a
// CNIe's DS chain is not the passport chain that was bootstrapped into
// CertificatesSMT at block 2329.
//
// What this flag does NOT gate
// ----------------------------
// Routing only. The TD1 circuit stays pinned to the bundled asset and stays
// registered at boot (app/voting-flow.tsx) whatever the value here — pinning
// the bundled file rather than resolving it from Rarimo's CDN is exactly what
// the circuit author asked for, and any out-of-band diagnostic that calls
// `generateHeavyNoirProof` directly needs the circuit registered to work.
//
// Nor does it gate the vote. For a CNIe the vote never touches the Groth16
// pipeline — Step11 branches on dg1.length, so a 95-byte DG1 always goes
// through freedomTool.submitProposal → executeTD1Noir — and query_identity
// reads only the StateKeeper bond and RegistrationSMT membership. It has no
// knowledge of which registrar wrote them.
//
// Not an argument either way: cross-document double voting
// -------------------------------------------------------
// The circuit author (Rarimo) was asked on 2026-08-31 what stops one person
// registering both a passport and a CNIe and voting twice across the two
// document types. Verbatim:
// "Currently- nothing. This is the next step." It is a protocol-level gap that
// Rarimo owns and intends to close — not a bug in this app — and it behaves
// identically under either TD1 route, so it argues neither for nor against this
// flag. Do NOT invent a client-side workaround for it; document it and leave
// it. Fuller treatment in circuits/README.md.
//
// One divergence from upstream, stated so nobody trips over it
// -----------------------------------------------------------
// Flipping MOCK_BACKEND alone is meant to restore real,
// upstream-equivalent behaviour. That now has exactly one exception: upstream
// routes a CNIe through the light registrator, and this build routes it heavy.
// To reproduce upstream's TD1 behaviour exactly, set this to `false` as well.
export const TD1_HEAVY_REGISTER = true;
