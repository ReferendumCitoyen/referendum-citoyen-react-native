/**
 * The sha256 of every binary this repository tracks and ships.
 *
 * Why (wave 4b, M5). `modules/noir-16k/noir.aar` holds `libnoir_java.so`, the
 * prover that receives DG1, the SOD and the private key as its witness. It is
 * copied over the SDK's own aar at every `npm install`
 * (scripts/postinstall-aligned-noir.js) and at every `expo prebuild`
 * (plugins/withAlignedNoir.js), so it is on the critical path of every build.
 * Until now NO expected digest was recorded anywhere, the build recipe that
 * produced it is not in the repository, and the only trace of provenance was a
 * string read out of the binary, which a byte patch forges. A contributor, or
 * anyone who compromises a contributor's machine, could rebuild it to write
 * the witness to disk, or, quieter, to bias one bit of the prover's randomness
 * and make proofs correlatable. No review can catch that in a seven megabyte
 * binary diff.
 *
 * Recording the digest does not make the binary trustworthy. It makes a
 * SUBSTITUTION detectable: any change to one of these files fails
 * constants/native-binaries.test.ts, so it has to be a deliberate, explained
 * commit rather than something that slips through.
 *
 * WHAT THIS IS NOT, and it should be said in the README before publication:
 * these digests live in the same repository and the same commit as the files
 * they cover, so they are an integrity check against accidental or silent
 * substitution, not an attestation. Only a reproducible build recipe, or a
 * signature from outside the repository, would be that.
 *
 * TO UPDATE a line, deliberately, after replacing a binary:
 *
 *     shasum -a 256 modules/noir-16k/noir.aar
 *     # or, for all of them at once, from the repository root:
 *     git ls-files | grep -E '\.(aar|so|a|zkey|dat)$' | xargs shasum -a 256
 *
 * FOR THE OPERATIONS LEAD, the part that cannot be settled from here:
 * nothing in the repository says how `noir.aar` was built, from which
 * revision of which Noir toolchain, or by whom. The digest below pins the
 * file we build from today and nothing more. What is still needed is the
 * build recipe, committed, and ideally a digest published somewhere that is
 * not this repository.
 */
export interface TrackedBinary {
  /** Path relative to the repository root. */
  path: string;
  /** sha256, lowercase hex, of the file as committed. */
  sha256: string;
  /** Size in bytes, a cheap first check and a readable sanity anchor. */
  bytes: number;
  /** What it is and where it came from, as far as the repository knows. */
  provenance: string;
}

export const TRACKED_BINARIES: readonly TrackedBinary[] = [
  {
    path: 'modules/noir-16k/noir.aar',
    sha256: 'a384d20227ef3c1aaeebfe7d32bb25d97646c3af50db705a1194734fc311606e',
    bytes: 6_950_109,
    provenance:
      'Noir prover (libnoir_java.so) rebuilt for 16 KB pages, copied over the SDK aar by ' +
      'scripts/postinstall-aligned-noir.js. Build recipe NOT in the repository: see the note above.',
  },
  {
    path: 'assets/circuits/query_identity.dat',
    sha256: '51cbf13c4fedad8a8f4fbb43fd942b00dd9ec48fae275a33bc87409c0a292d26',
    bytes: 1_208_320,
    provenance: 'Groth16 vote witness graph, bundled rather than downloaded.',
  },
  {
    path: 'assets/circuits/query_identity_zkey.zkey',
    sha256: '754b2bd2b5e43d2bfe42cea6bb46272da7c0b6b76ba2eed79347dcd64714b72b',
    bytes: 14_547_433,
    provenance: 'Groth16 vote proving key, bundled (utils/groth16-vote.ts).',
  },
  {
    path: 'modules/witnesscalculator/android/src/main/jniLibs/arm64-v8a/libwitnesscalc_queryIdentity.so',
    sha256: '18151012a1a7a59b14fec20c79c678113efaafb057f85f0286f96ad7b4ecb91e',
    bytes: 11_722_784,
    provenance: 'Android witness calculator for the vote circuit.',
  },
  {
    path: 'modules/witnesscalculator/ios/libs/libwitnesscalc_queryIdentity.a',
    sha256: '85c312cadf9893475b77c596b5a4373a52aa1eeab15bd6b2a3d89bfeea4dafff',
    bytes: 5_560_776,
    provenance: 'iOS witness calculator for the vote circuit.',
  },
  {
    path: 'modules/witnesscalculator/ios/libs/RmoCalcs.xcframework/ios-arm64_arm64e/libCombined.a',
    sha256: '5e1483641ba3098930a7464b76d437b16c60f2c1f6a1db8c62b34a83abb15541',
    bytes: 30_722_032,
    provenance:
      'iOS device slice of the Rarimo witness calculator framework (witnesscalc, GPL-3.0, ' +
      'statically linked with GNU GMP, LGPL-3.0-or-later). Stripped in this repository on ' +
      '23/09/2026: `strip -S` removed the __DWARF sections, then the __LLVM,__bitcode section ' +
      'of every member was zeroed in place (scripts/strip-rmocalcs-debug-paths.mjs). Both ' +
      'carried the build directory of a third-party developer, 2052 occurrences of one home ' +
      'path, 511 of which reached the linked application. The exported symbol table is ' +
      'unchanged, 4043 symbols over the two architectures, and the simulator slice already ' +
      'shipped in exactly this state. Previous digest, as Rarimo published it: ' +
      '9b48f82b7e9695dfd56f1ebfb0e592e0581c583d1180c753cdccc5b2b82e234f (35 824 160 bytes). ' +
      'Re-running the script does NOT reproduce this digest to the byte: `strip` rewrites the ' +
      'two __.SYMDEF member timestamps from the clock, 8 bytes at offsets 64 and 24 488 064. ' +
      'Everything else is reproducible.',
  },
  {
    path: 'modules/witnesscalculator/ios/libs/RmoCalcs.xcframework/ios-arm64_arm64e-simulator/libCombined.a',
    sha256: 'e3bb0dc49f50972969da79d4f6d95d0bccfdc690b26227d6423b066a9407798e',
    bytes: 20_392_720,
    provenance: 'iOS simulator slice of the Rarimo witness calculator framework.',
  },
];
