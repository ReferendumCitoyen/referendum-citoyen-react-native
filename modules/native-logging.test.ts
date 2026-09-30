/**
 * Nothing in the native modules writes to the device log in a release build.
 *
 * The JavaScript side has a redactor and a release console that only ever
 * emits the redacted line (utils/logger.ts). The native side has neither: a
 * Swift `print` or a Kotlin `Log.d` goes straight to the unified system log or
 * to logcat, past every filter this app owns, and stays there for whoever can
 * read the device's logs.
 *
 * So the rule is mechanical and checked here rather than remembered:
 *   - every `print` / `NSLog` / `os_log` in modules/**\/*.swift sits inside an
 *     `#if DEBUG` block;
 *   - every Kotlin logging call is on the allow-list below, each with the
 *     reason it is harmless, so a new one fails this test and has to be
 *     argued for.
 *
 * The CocoaPod NFCPassportReader is NOT covered here: it is a dependency, not
 * part of this repository, and it is being fixed separately.
 */
import * as fs from 'fs';
import * as path from 'path';

const MODULES = path.resolve(__dirname);

function filesWithExtension(ext: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'build' || e.name === '.gradle') continue;
        walk(p);
      } else if (e.name.endsWith(ext)) out.push(p);
    }
  };
  walk(MODULES);
  return out.sort();
}

/** Line numbers of console writes that are NOT inside an `#if DEBUG` block. */
function unguardedSwiftLogs(source: string): number[] {
  const CONSOLE = /(^|[^A-Za-z0-9_.])(print|NSLog|os_log)\s*\(/;
  const out: number[] = [];
  // Depth of `#if DEBUG` nesting; any other `#if` is tracked so its `#endif`
  // does not close a DEBUG block by mistake.
  const stack: boolean[] = [];
  source.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (/^#if\b/.test(line)) {
      stack.push(/^#if\s+DEBUG\b/.test(line));
      return;
    }
    if (/^#elseif\b/.test(line)) {
      if (stack.length) stack[stack.length - 1] = false;
      return;
    }
    if (/^#else\b/.test(line)) {
      if (stack.length) stack[stack.length - 1] = false;
      return;
    }
    if (/^#endif\b/.test(line)) {
      stack.pop();
      return;
    }
    if (line.startsWith('//') || line.startsWith('///')) return;
    if (!CONSOLE.test(line)) return;
    if (!stack.some(Boolean)) out.push(i + 1);
  });
  return out;
}

describe('Swift: nothing reaches the device log in release', () => {
  const files = filesWithExtension('.swift');

  it('finds the Swift sources', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(
    // Named relative to modules/ so a failure reads as a file:line list.
    filesWithExtension('.swift').map((f) => [path.relative(MODULES, f), f] as const),
  )('%s', (_name, file) => {
    const lines = unguardedSwiftLogs(fs.readFileSync(file, 'utf8'));
    expect(lines).toEqual([]);
  });

  it('the detector itself works', () => {
    expect(unguardedSwiftLogs('print("x")')).toEqual([1]);
    expect(unguardedSwiftLogs('#if DEBUG\nprint("x")\n#endif')).toEqual([]);
    expect(unguardedSwiftLogs('#if DEBUG\n#if os(iOS)\nprint("x")\n#endif\n#endif')).toEqual([]);
    expect(unguardedSwiftLogs('#if DEBUG\n#endif\nprint("x")')).toEqual([3]);
    expect(unguardedSwiftLogs('#if DEBUG\nprint("a")\n#else\nprint("b")\n#endif')).toEqual([4]);
    expect(unguardedSwiftLogs('// print("x")')).toEqual([]);
  });
});

describe('Kotlin: only the lines argued for reach logcat', () => {
  // file -> the substrings of the allowed logging lines. Each one carries no
  // card data: a PACE object identifier and parameter id are constants of the
  // ICAO/BSI specification, the rest are status words of our own making.
  // The APDU transcripts (LoggingCardService) never come through here: they
  // go to the onDebugLog callback, which EDocumentModule.kt arms only on a
  // FLAG_DEBUGGABLE build.
  const ALLOWED: Record<string, string[]> = {
    'e-document/android/src/main/java/expo/modules/edocument/DocumentScanner.kt': [
      '=== Trying PACE Authentication ===',
      'Reading EF_CARD_ACCESS...',
      'PACE OID: ${paceInfo.objectIdentifier}',
      'PACE paramId: ${paceInfo.parameterId}',
      '=== PACE SUCCEEDED ===',
      '[ERROR] PACE failed: ${e.message}',
    ],
    'witnesscalculator/android/src/main/java/expo/modules/witnesscalculator/WitnesscalculatorModule.kt': [
      '"Witnesscalculator",',
    ],
  };

  it('no Kotlin file logs anything outside the allow-list', () => {
    const CALL = /(^|[^A-Za-z0-9_.])(android\.util\.Log\.[dviwe]|Log\.[dviwe]|println)\s*\(/;
    const offenders: string[] = [];
    for (const file of filesWithExtension('.kt')) {
      const rel = path.relative(MODULES, file);
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((raw, i) => {
        const line = raw.trim();
        if (line.startsWith('//') || line.startsWith('*')) return;
        if (!CALL.test(line)) return;
        // The message may be on the same line or on the next ones.
        const window = lines.slice(i, i + 4).join(' ');
        if ((ALLOWED[rel] ?? []).some((allowed) => window.includes(allowed))) return;
        offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the APDU transcript can only be armed on a debuggable build', () => {
    const module = fs.readFileSync(
      path.join(MODULES, 'e-document/android/src/main/java/expo/modules/edocument/EDocumentModule.kt'),
      'utf8',
    );
    expect(module).toContain('ApplicationInfo.FLAG_DEBUGGABLE');
    // Every DEBUG_LOG emission is behind that flag.
    const emissions = module.split('sendEvent(DocumentScanEvents.DEBUG_LOG.value');
    expect(emissions.length).toBeGreaterThan(1);
    for (const before of emissions.slice(0, -1)) {
      expect(before.slice(-200)).toContain('if (debugLoggingEnabled)');
    }
    // and LoggingCardService only ever writes through that callback.
    const service = fs.readFileSync(
      path.join(MODULES, 'e-document/android/src/main/java/expo/modules/edocument/LoggingCardService.kt'),
      'utf8',
    );
    expect(service).not.toMatch(/android\.util\.Log\.|(^|[^A-Za-z0-9_.])println\s*\(/m);
  });
});
