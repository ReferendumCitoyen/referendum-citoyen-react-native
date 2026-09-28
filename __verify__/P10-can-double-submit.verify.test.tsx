/**
 * P10: step 7 entered with no chip read. In the reports `[flow] step 5 → 6`
 * is followed by `step 6 → 7 (next)` with no scan in between (144 ms apart on
 * one phone, 11 to 23 s on two iPhones, with no `handleAnalyzePress` either).
 * The only `(next)` source reachable at step 6 without a scan result is the
 * CAN screen submitting again: Step 5 stays mounted at step 6 (±1 rule), its
 * keyboard "done" and its button both submit, and every submission calls the
 * flow's handleNext.
 *
 * Replays: the CAN is typed and submitted, the flow moves to step 6 (the
 * parent re-renders Step 5 as no longer current), then the keyboard's done
 * key and the button fire again. Only the first submission may reach the flow.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-mmkv', () => ({
  MMKV: class {
    getString() { return undefined; }
    getBoolean() { return undefined; }
    set() {}
    delete() {}
  },
}));

import Step5Can from '@/components/voting-modal/Step5Can';
import { ThemeProvider } from '@/contexts/ThemeContext';

const CONTINUE = /Continuer|common\.continue/;
const FIELD = /6 chiffres|step5CanPlaceholder/;

describe('P10: the CAN screen hands the flow one submission per visit', () => {
  it('a second submit after the flow moved to step 6 does not reach the flow', () => {
    const onSubmit = jest.fn();
    const tree = (isActive: boolean) => (
      <ThemeProvider>
        {/* isActive is ignored by a Step5Can that does not know it. */}
        <Step5Can containerWidth={300} onSubmit={onSubmit} {...({ isActive } as any)} />
      </ThemeProvider>
    );
    const r = render(tree(true));
    const field = r.getByPlaceholderText(FIELD);
    fireEvent.changeText(field, '123456');
    fireEvent.press(r.getByText(CONTINUE));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // The flow is at step 6 now; Step 5 is still mounted, off screen.
    r.rerender(tree(false));
    fireEvent(r.getByPlaceholderText(FIELD), 'submitEditing');
    fireEvent.press(r.getByText(CONTINUE));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a double tap on Continue submits once', () => {
    const onSubmit = jest.fn();
    const r = render(
      <ThemeProvider>
        <Step5Can containerWidth={300} onSubmit={onSubmit} />
      </ThemeProvider>,
    );
    fireEvent.changeText(r.getByPlaceholderText(FIELD), '123456');
    fireEvent.press(r.getByText(CONTINUE));
    fireEvent.press(r.getByText(CONTINUE));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
