// Global Dynamic-Type cap for the whole app.
//
// Why not the classic `Text.defaultProps.maxFontSizeMultiplier = …` one-liner?
// React 19 dropped defaultProps for function components, and RN 0.81's <Text>
// is exactly that (a plain function component). On-device that one-liner is a
// silent no-op. Instead we replace the `react-native` Text/TextInput exports
// with thin wrappers that pass `maxFontSizeMultiplier` as a REAL prop — which
// is honoured identically in jest and on Fabric. Anything that sets the prop
// (or `allowFontScaling={false}`) explicitly still wins, because caller props
// are spread last.
import React from 'react';

// Named Dynamic-Type caps (multipliers of the design font size). CAP_BIG is the
// app-wide default; CAP_SMALL is a tighter cap for space-constrained screens
// (e.g. the intro voting-flow steps) so their fixed layouts don't overflow.
export const CAP_BIG = 1.5;
export const CAP_SMALL = 1.3;

const TARGETS = ['Text', 'TextInput'] as const;

let capValue = CAP_BIG;
let installed = false;

export function installFontScaleCap(max = 1.5): void {
  // Re-callable: updates the live cap (the wrappers read `capValue`), but the
  // export swap only happens once so we never wrap our own wrapper.
  capValue = max;
  if (installed) return;
  installed = true;

  // require (not import) so we get the live module.exports object to redefine
  // Text/TextInput on; an `import * as` namespace is read-only.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const RN: Record<string, any> = require('react-native');

  for (const name of TARGETS) {
    const Original = RN[name];
    if (typeof Original !== 'function' && typeof Original !== 'object') continue;

    const Capped = (props: Record<string, unknown>) =>
      React.createElement(Original, { maxFontSizeMultiplier: capValue, ...props });

    // Preserve statics (e.g. TextInput.State) some callers rely on.
    Object.assign(Capped, Original);
    (Capped as { displayName?: string }).displayName = `FontScaleCapped(${name})`;

    Object.defineProperty(RN, name, {
      configurable: true,
      enumerable: true,
      get: () => Capped,
    });
  }
}
