import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('lottie-react-native', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});
jest.mock('react-native-mmkv', () => ({
  MMKV: class {
    getString() { return undefined; }
    getBoolean() { return undefined; }
    set() {}
    delete() {}
  },
}));

import Step8 from './Step8';
import { ThemeProvider } from '@/contexts/ThemeContext';

// i18n fr: "Votez maintenant" / "Recommencer"; the raw keys are accepted as a
// fallback in case i18n isn't initialised in the jest environment.
const VOTE_NOW = /Votez maintenant|step8VoteNow/;
const RESTART = /Recommencer|step8Restart/;

const mount = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

// Step 8 is only meant to be reached after Step 7 verified the registration.
// Production reports (2026-06-11/12, iOS, proposal #54; again on the
// 2026-09-08 test night) show users arriving here without one — and the
// original guard, which silently ignored the tap, left them staring at a
// "vote now" button that did nothing. An unverified Step 8 must say so and
// offer a way back; a verified one must still let the user through.
describe('Step8', () => {
  it('lets a verified user through to the vote', () => {
    const onVoteSuccess = jest.fn();
    const r = mount(
      <Step8 containerWidth={300} verificationResult="success" onVoteSuccess={onVoteSuccess} />,
    );
    fireEvent.press(r.getByText(VOTE_NOW));
    expect(onVoteSuccess).toHaveBeenCalledTimes(1);
    expect(r.queryByText(RESTART)).toBeNull();
  });

  it.each([null, undefined])(
    'shows no vote button when verificationResult is %s',
    (vr) => {
      const r = mount(
        <Step8 containerWidth={300} verificationResult={vr} onVoteSuccess={jest.fn()} />,
      );
      expect(r.queryByText(VOTE_NOW)).toBeNull();
      expect(r.getByText(RESTART)).toBeTruthy();
    },
  );

  it('offers a restart instead, which calls onRestart', () => {
    const onVoteSuccess = jest.fn();
    const onRestart = jest.fn();
    const r = mount(
      <Step8
        containerWidth={300}
        verificationResult={null}
        onVoteSuccess={onVoteSuccess}
        onRestart={onRestart}
      />,
    );
    fireEvent.press(r.getByText(RESTART));
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onVoteSuccess).not.toHaveBeenCalled();
  });
});
