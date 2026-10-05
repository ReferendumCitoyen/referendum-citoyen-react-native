import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import PreviousSessionNotice from './PreviousSessionNotice';
import {
  claimPreviousSessionOffer,
  clearPreviousSessionLog,
  readPreviousSessionLog,
} from '@/utils/logger';
import { sendPreviousSessionReport } from '@/utils/error-reporter';

let mockFocusVersion = 0;
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [mockFocusVersion]),
}));
jest.mock('@/constants/theme', () => ({
  useColors: () => ({ text: '#000', secondary: '#060', cardBackground: '#fff' }),
  Typography: { fontFamily: { medium: 'font' }, fontSize: { body: 16 } },
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/utils/logger', () => ({
  claimPreviousSessionOffer: jest.fn(),
  readPreviousSessionLog: jest.fn(),
  clearPreviousSessionLog: jest.fn(async () => {}),
}));
jest.mock('@/utils/error-reporter', () => ({ sendPreviousSessionReport: jest.fn() }));

const offer = jest.mocked(claimPreviousSessionOffer);
const send = jest.mocked(sendPreviousSessionReport);
const clear = jest.mocked(clearPreviousSessionLog);
const flush = async () => {
  await act(async () => {});
};
const sendLabel = 'settings.sendPreviousLog';
const declineLabel = 'errorReport.previousSessionDecline';

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusVersion = 0;
  offer.mockResolvedValue(true);
  jest.mocked(readPreviousSessionLog).mockResolvedValue('PRIVATE-LOG-CONTENT');
  send.mockResolvedValue('sent');
});

it('shows a proposal without preparing or sending a report', async () => {
  const screen = render(<PreviousSessionNotice />);
  await flush();
  expect(screen.getByText('errorReport.previousSessionNotice')).toBeTruthy();
  expect(screen.getByText(sendLabel)).toBeTruthy();
  expect(screen.getByText(declineLabel)).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
  expect(screen.queryByText('PRIVATE-LOG-CONTENT')).toBeNull();
  expect(clear).not.toHaveBeenCalled();
});

it.each([false, undefined])(
  'has no proposal when a log is unavailable or already offered (%s)',
  async (available) => {
    offer.mockResolvedValue(available as boolean);
    const screen = render(<PreviousSessionNotice />);
    await flush();
    expect(screen.queryByText(sendLabel)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  }
);

it('refusal hides and forgets the log without calling the sender', async () => {
  const screen = render(<PreviousSessionNotice />);
  await flush();
  fireEvent.press(screen.getByText(declineLabel));
  await flush();
  expect(screen.queryByText(sendLabel)).toBeNull();
  expect(clear).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});

it.each(['sent', 'cancelled', 'none'] as const)(
  'hides after the existing sender returns %s',
  async (outcome) => {
    send.mockResolvedValue(outcome);
    const screen = render(<PreviousSessionNotice />);
    await flush();
    fireEvent.press(screen.getByText(sendLabel));
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith();
    expect(screen.queryByText(sendLabel)).toBeNull();
    expect(clear).toHaveBeenCalledTimes(outcome === 'cancelled' ? 1 : 0);
  }
);

it('ignores double taps while consent or transport is open', async () => {
  let resolve!: (value: 'sent') => void;
  send.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  const screen = render(<PreviousSessionNotice />);
  await flush();
  const button = screen.getByText(sendLabel);
  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(screen.getByText(declineLabel));
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(clear).not.toHaveBeenCalled();
  await act(async () => resolve('sent'));
  expect(screen.queryByText(sendLabel)).toBeNull();
});

it('allows an explicit retry or refusal after failure without showing error contents', async () => {
  send.mockRejectedValueOnce(new Error('PRIVATE-LOG-CONTENT'));
  const screen = render(<PreviousSessionNotice />);
  await flush();
  fireEvent.press(screen.getByText(sendLabel));
  await flush();
  expect(screen.getByText('errorReport.previousSessionFailed')).toBeTruthy();
  expect(screen.queryByText('PRIVATE-LOG-CONTENT')).toBeNull();
  expect(clear).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText(sendLabel));
  await flush();
  expect(send).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(sendLabel)).toBeNull();
});

it('does nothing when storage is unavailable', async () => {
  offer.mockRejectedValue(new Error('unavailable'));
  const screen = render(<PreviousSessionNotice />);
  await flush();
  expect(screen.queryByText(sendLabel)).toBeNull();
  expect(send).not.toHaveBeenCalled();
});

it('ignores a late offer after unmount', async () => {
  let resolve!: (value: boolean) => void;
  offer.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  const screen = render(<PreviousSessionNotice />);
  screen.unmount();
  await act(async () => resolve(true));
  expect(send).not.toHaveBeenCalled();
});

it('does not show an offer whose log has since been sent elsewhere', async () => {
  jest.mocked(readPreviousSessionLog).mockResolvedValue(null);
  const screen = render(<PreviousSessionNotice />);
  await flush();
  expect(screen.queryByText(sendLabel)).toBeNull();
  expect(send).not.toHaveBeenCalled();
});

it('removes the offer on returning home after sending from Settings', async () => {
  const screen = render(<PreviousSessionNotice />);
  await flush();
  expect(screen.getByText(sendLabel)).toBeTruthy();
  jest.mocked(readPreviousSessionLog).mockResolvedValue(null);
  mockFocusVersion++;
  screen.rerender(<PreviousSessionNotice />);
  await flush();
  expect(screen.queryByText(sendLabel)).toBeNull();
  expect(offer).toHaveBeenCalledTimes(1);
});

it('a late availability check cannot restore a refused offer', async () => {
  const screen = render(<PreviousSessionNotice />);
  await flush();
  let resolve!: (value: string) => void;
  jest.mocked(readPreviousSessionLog).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  mockFocusVersion++;
  screen.rerender(<PreviousSessionNotice />);
  await flush();
  fireEvent.press(screen.getByText(declineLabel));
  await act(async () => resolve('LOCAL-LOG'));
  expect(screen.queryByText(sendLabel)).toBeNull();
  expect(send).not.toHaveBeenCalled();
});
