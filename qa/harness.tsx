/**
 * Renders one gallery state under jest, inside the app's real providers
 * (theme, dev mode, network, terms, extra proposals, error reports, safe
 * area), and reads the result back: visible texts, pressable elements.
 *
 * Used by qa/production-guard.test.tsx. Requires
 * qa/test-setup.ts to have been imported first.
 */
import React from 'react';
import { act, render, fireEvent, type RenderResult } from '@testing-library/react-native';
import i18n from '@/locales';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { DevModeProvider } from '@/contexts/DevModeContext';
import { NetworkProvider } from '@/contexts/NetworkContext';
import { TermsProvider } from '@/contexts/TermsContext';
import { ExtraProposalsProvider } from '@/contexts/ExtraProposalsContext';
import { ErrorReportProvider } from '@/contexts/ErrorReportContext';
import { recordAction } from './fixtures/recorder';
import type { GalleryCtx, GalleryState, PreludeStep } from './fixtures/types';

export const ctx: GalleryCtx = {
  act: (id: string, label?: string) => () => recordAction(id, label),
  width: 375,
};

/** Lets pending promises run, then moves the fake clock by `ms`. */
export async function advance(ms = 0): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  let left = ms;
  while (left > 0) {
    const step = Math.min(left, 500);
    await act(async () => {
      jest.advanceTimersByTime(step);
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    left -= step;
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <ErrorReportProvider>
        <ThemeProvider>
          <DevModeProvider>
            <NetworkProvider>
              <TermsProvider>
                <ExtraProposalsProvider>{children}</ExtraProposalsProvider>
              </TermsProvider>
            </NetworkProvider>
          </DevModeProvider>
        </ThemeProvider>
      </ErrorReportProvider>
    </SafeAreaProvider>
  );
}

// ---------------------------------------------------------------------------
// Reading the tree
// ---------------------------------------------------------------------------

/** The parts of react-test-renderer's ReactTestInstance used here (its
 *  types package is not installed). */
export interface TestNode {
  type: unknown;
  props: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  parent: TestNode | null;
  children: (TestNode | string)[];
  findAll(predicate: (n: TestNode) => boolean, options?: { deep: boolean }): TestNode[];
}
type Node = TestNode;
export const rootOf = (r: RenderResult): TestNode => r.UNSAFE_root as unknown as TestNode;

/** Every string rendered in a host Text, outermost Text only. */
export function visibleTexts(root: Node): string[] {
  const out: string[] = [];
  const walk = (n: Node, insideText: boolean) => {
    const isText = n.type === 'Text';
    if (isText && !insideText) out.push(hostText(n));
    for (const c of n.children) if (typeof c !== 'string') walk(c as Node, insideText || isText);
  };
  walk(root, false);
  return out.filter((s) => s.length > 0);
}

function hostText(n: Node): string {
  return n.children.map((c: Node | string) => (typeof c === 'string' ? c : hostText(c))).join('');
}

const TOUCHABLES = new Set(['TouchableOpacity', 'Pressable', 'TouchableHighlight', 'TouchableWithoutFeedback']);

function typeName(type: unknown): string {
  if (!type) return '';
  if (typeof type === 'string') return type;
  const t = type as { displayName?: string; name?: string; render?: { name?: string; displayName?: string }; type?: unknown };
  return t.displayName || t.name || t.render?.displayName || t.render?.name || (t.type ? typeName(t.type) : '');
}

export interface PressableInfo {
  node: Node;
  label: string;
  hasOnPress: boolean;
  disabled: boolean;
  testID?: string;
}

/** Every touchable component in the tree, with the label a screen reader
 *  would announce (accessibilityLabel, else its text). */
export function pressables(root: Node): PressableInfo[] {
  const found = root.findAll((n) => typeof n.type !== 'string' && TOUCHABLES.has(typeName(n.type)), { deep: true });
  // A Pressable wraps nothing named Pressable, but TouchableOpacity is a
  // forwardRef around a class also named TouchableOpacity: keep the outermost.
  const outer = found.filter((n) => !found.some((o) => o !== n && isAncestor(o, n)));
  return outer.map((node) => {
    const p = node.props as Record<string, unknown>;
    const texts = visibleTexts(node);
    return {
      node,
      label: String(p.accessibilityLabel ?? texts.join(' ')).trim(),
      hasOnPress: typeof p.onPress === 'function',
      disabled: p.disabled === true,
      testID: p.testID as string | undefined,
    };
  });
}

function isAncestor(a: Node, b: Node): boolean {
  let cur: Node | null = b.parent;
  while (cur) {
    if (cur === a) return true;
    cur = cur.parent;
  }
  return false;
}

export function press(p: PressableInfo) {
  fireEvent.press(p.node as unknown as Parameters<typeof fireEvent.press>[0]);
}

// ---------------------------------------------------------------------------
// Rendering a state
// ---------------------------------------------------------------------------

export function tr(key: string, params?: Record<string, unknown>): string {
  return String(i18n.t(key, params));
}

export async function runPrelude(r: RenderResult, prelude: PreludeStep[] | undefined) {
  for (const step of prelude ?? []) {
    if ('wait' in step) {
      await advance(step.wait);
    } else if ('type' in step) {
      const inputs = rootOf(r).findAll((n) => n.type === 'TextInput');
      const target = step.into?.key
        ? inputs.find((n) => n.props.accessibilityLabel === tr(step.into!.key!)) ?? inputs[0]
        : inputs[0];
      if (!target) throw new Error('prelude: no TextInput to type into');
      fireEvent.changeText(target, step.type);
      await advance(0);
    } else {
      const label = step.tap.key ? tr(step.tap.key) : step.tap.text ?? step.tap.testID!;
      const p = step.tap.testID
        ? pressables(rootOf(r)).find((x) => x.testID === step.tap.testID)
        : pressables(rootOf(r)).find((x) => x.label === label);
      if (!p) throw new Error(`prelude: no button "${label}"`);
      press(p);
      await advance(0);
    }
  }
}

export async function renderState(state: GalleryState, lang: 'fr' | 'en'): Promise<RenderResult> {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
  if (!state.render) throw new Error(`${state.id} has no render`);
  const r = render(<Providers>{state.render(ctx)}</Providers>);
  await advance(50);
  await runPrelude(r, state.prelude);
  await advance(state.settleMs ?? 100);
  return r;
}
