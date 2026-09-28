#!/usr/bin/env node
/**
 * Remove the third-party build paths from the device slice of
 * RmoCalcs.xcframework, and record how it was done.
 *
 * WHY. `modules/witnesscalculator/ios/libs/RmoCalcs.xcframework/
 * ios-arm64_arm64e/libCombined.a` shipped with the home directory of one
 * Rarimo developer written into it 2052 times, and 511 of those survived the
 * link into the application we submit. It is a real personal datum in a file
 * we publish, and the PII gate (verifier-pii.sh, detector M1-04) is right to
 * refuse it. The simulator slice of the very same xcframework has none: it was
 * already built, or already cleaned, without them. That slice is the proof
 * that nothing in the library needs them.
 *
 * WHAT IT DOES, in two passes, because one is not enough:
 *
 *   1. `strip -S` on the fat archive. Removes the __DWARF sections of every
 *      member. That accounts for 1022 of the 2052 occurrences.
 *   2. The remaining 1030 live in `__LLVM,__bitcode`: GMP was compiled with
 *      embedded bitcode, and an LLVM module carries its own compilation
 *      directory. Apple dropped bitcode with Xcode 14 and the linker ignores
 *      the section, but `strip` has no way to remove a section, and
 *      `bitcode_strip` is broken in Xcode 26 (it still shells out to the
 *      classic linker). So this script zeroes those bytes itself.
 *
 * HOW IT ZEROES, and why this shape was chosen. The section payload is
 * overwritten with zeros and the section's `size` field set to 0. NOTHING
 * MOVES: not one offset, not one load command size, not the file length, not
 * the archive index. That is the whole point. Removing the section properly
 * would mean renumbering every offset in 1030 Mach-O objects, which is a real
 * chance of a subtle corruption in the prover of a voting application, for no
 * gain: a section declared empty is a section no tool reads.
 *
 * WHAT WAS VERIFIED after running it (see the report of 23/09/2026):
 *   - occurrences of a home path: 2052 -> 0, and 511 -> 0 in a linked image;
 *   - the Mach-O exported symbol table is IDENTICAL, 4043 symbols across the
 *     two architectures, compared entry by entry and not through `nm` (`nm`
 *     reads the embedded bitcode when there is one, so it is not a witness
 *     here);
 *   - `ar t` lists the same 532 and 516 members, `ranlib -c` accepts both
 *     tables of contents, `file` still reads a universal ar archive;
 *   - an arm64 device link against the archive succeeds and produces an image
 *     whose symbols are identical to the one built before the change.
 *
 * LICENCE. witnesscalc is published by iden3 under GPL-3.0 and is linked here
 * with GNU GMP, LGPL-3.0-or-later. Both licences allow a modified binary to be
 * redistributed. Stripping debug information is in any case the ordinary way
 * such a library ships.
 *
 * RUN:  node scripts/strip-rmocalcs-debug-paths.mjs [--check]
 *   --check reports what it would do and changes nothing.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(
  ROOT,
  'modules/witnesscalculator/ios/libs/RmoCalcs.xcframework/ios-arm64_arm64e/libCombined.a',
);

const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const MH_MAGIC_64 = 0xfeedfacf;
const LC_SEGMENT_64 = 0x19;
const AR_HEADER = Buffer.from('!<arch>\n', 'ascii');

/** Byte ranges of each architecture slice; the whole buffer when thin. */
function slices(buf) {
  const magic = buf.readUInt32BE(0);
  if (magic !== FAT_MAGIC && magic !== FAT_MAGIC_64) return [{ off: 0, size: buf.length }];
  const n = buf.readUInt32BE(4);
  const wide = magic === FAT_MAGIC_64;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = 8 + i * (wide ? 32 : 20);
    out.push(
      wide
        ? { off: Number(buf.readBigUInt64BE(p + 8)), size: Number(buf.readBigUInt64BE(p + 16)) }
        : { off: buf.readUInt32BE(p + 8), size: buf.readUInt32BE(p + 12) },
    );
  }
  return out;
}

/** Data range of each member of the ar archive at [base, base+size). */
function members(buf, base, size) {
  const out = [];
  if (!buf.subarray(base, base + 8).equals(AR_HEADER)) return out;
  let off = base + 8;
  const end = base + size;
  while (off + 60 <= end) {
    const raw = buf.toString('ascii', off, off + 16).trimEnd();
    const msize = parseInt(buf.toString('ascii', off + 48, off + 58).trim(), 10);
    if (!Number.isFinite(msize)) break;
    const body = off + 60;
    let start = body;
    let len = msize;
    if (raw.startsWith('#1/')) {
      const n = parseInt(raw.slice(3), 10);
      start = body + n;
      len = msize - n;
    }
    out.push({ start, len });
    off = body + msize;
    if (off % 2) off += 1;
  }
  return out;
}

/** Zero __LLVM,__bitcode inside one Mach-O object. Returns bytes cleared. */
function clearBitcode(buf, base, dryRun) {
  if (buf.readUInt32LE(base) !== MH_MAGIC_64) return 0;
  const ncmds = buf.readUInt32LE(base + 16);
  let off = base + 32;
  let cleared = 0;
  for (let i = 0; i < ncmds; i++) {
    const cmd = buf.readUInt32LE(off);
    const cmdsize = buf.readUInt32LE(off + 4);
    if (cmd === LC_SEGMENT_64) {
      const nsects = buf.readUInt32LE(off + 64);
      let s = off + 72;
      for (let j = 0; j < nsects; j++) {
        const sect = buf.toString('ascii', s, s + 16).replace(/\0+$/, '');
        const seg = buf.toString('ascii', s + 16, s + 32).replace(/\0+$/, '');
        if (seg === '__LLVM' && sect === '__bitcode') {
          const ssize = Number(buf.readBigUInt64LE(s + 40));
          const soff = buf.readUInt32LE(s + 48);
          if (ssize > 0) {
            if (!dryRun) {
              buf.fill(0, base + soff, base + soff + ssize);
              buf.writeBigUInt64LE(0n, s + 40);
            }
            cleared += ssize;
          }
        }
        s += 80;
      }
    }
    off += cmdsize;
  }
  return cleared;
}

function homePathHits(buf) {
  return (buf.toString('latin1').match(/(?:\/Users\/|\/home\/|C:\\Users\\)[A-Za-z][\w.\-]{1,40}/g) ?? [])
    .length;
}

function main() {
  const dryRun = process.argv.includes('--check');
  if (!fs.existsSync(TARGET)) {
    console.error(`not found: ${TARGET}`);
    process.exit(1);
  }
  console.log(`before: ${homePathHits(fs.readFileSync(TARGET))} home-path occurrences`);

  if (!dryRun) execFileSync('strip', ['-S', TARGET], { stdio: 'inherit' });
  else console.log('--check: skipping `strip -S`');

  const buf = fs.readFileSync(TARGET);
  let objects = 0;
  let bytes = 0;
  for (const s of slices(buf)) {
    for (const m of members(buf, s.off, s.size)) {
      const c = clearBitcode(buf, m.start, dryRun);
      if (c > 0) {
        objects += 1;
        bytes += c;
      }
    }
  }
  if (!dryRun) {
    fs.writeFileSync(TARGET, buf);
    console.log(`zeroed __LLVM,__bitcode in ${objects} objects (${bytes} bytes)`);
    console.log(`after: ${homePathHits(fs.readFileSync(TARGET))} home-path occurrences`);
  } else {
    console.log(`--check: would zero ${bytes} bytes in ${objects} objects`);
  }
}

main();
