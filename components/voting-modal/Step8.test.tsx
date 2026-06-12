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

// The "Vote now" button must only advance the flow when Step 7 actually
// verified the registration. Three production reports (2026-06-11/12, all
// iOS, proposal #54) show users reaching the vote screens with NO NFC scan
// and NO registration — Step 11 then dead-ends on "Unknown vote error".
// Whatever the (still unidentified) jump path is, this guard makes it
// harmless: an unverified user cannot advance past Step 8.
describe('Step8 vote-now guard', () => {
  const press = (ui: React.ReactElement) => {
    const r = render(<ThemeProvider>{ui}</ThemeProvider>);
    // i18n fr: "Votez maintenant"; fall back to the raw key if i18n isn't
    // initialised in the jest environment.
    fireEvent.press(r.getByText(/Votez maintenant|step8VoteNow/));
    return r;
  };

  it('fires onVoteSuccess when verification succeeded', () => {
    const onVoteSuccess = jest.fn();
    press(<Step8 containerWidth={300} verificationResult="success" onVoteSuccess={onVoteSuccess} />);
    expect(onVoteSuccess).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined, 'error'] as const)(
    'does NOT fire onVoteSuccess when verificationResult is %s',
    (vr) => {
      const onVoteSuccess = jest.fn();
      press(
        <Step8
          containerWidth={300}
          verificationResult={vr as any}
          onVoteSuccess={onVoteSuccess}
        />,
      );
      expect(onVoteSuccess).not.toHaveBeenCalled();
    },
  );
});
