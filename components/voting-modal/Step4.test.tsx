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
jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: () => ({ hasPermission: true, requestPermission: jest.fn() }),
}));
jest.mock('expo-video', () => ({ VideoView: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import Step4 from './Step4';
import { ThemeProvider } from '@/contexts/ThemeContext';

const draw = (nfcUnsupported: boolean) => {
  const onStartAnalysis = jest.fn();
  const r = render(
    <ThemeProvider>
      <Step4 player={null} containerWidth={300} onStartAnalysis={onStartAnalysis} nfcUnsupported={nfcUnsupported} />
    </ThemeProvider>,
  );
  return { ...r, onStartAnalysis };
};

// Item 11 E: an iPad learns it at step 4, before typing a CAN, never at step 6.
describe('Step4 without an NFC reader', () => {
  it('says so and offers no start button', () => {
    const r = draw(true);
    expect(r.getByText('voting.nfcUnsupportedDevice')).toBeTruthy();
    expect(r.queryByText('voting.step4Start')).toBeNull();
  });

  it('with a reader, the start button works as before', () => {
    const r = draw(false);
    expect(r.queryByText('voting.nfcUnsupportedDevice')).toBeNull();
    fireEvent.press(r.getByText('voting.step4Start'));
    expect(r.onStartAnalysis).toHaveBeenCalledTimes(1);
  });
});
