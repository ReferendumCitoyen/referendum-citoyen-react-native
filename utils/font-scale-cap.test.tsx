// Verifies the global Dynamic-Type cap actually applies a real
// `maxFontSizeMultiplier` prop to RN <Text>/<TextInput> (NOT via defaultProps,
// which React 19 ignores for function components). This test is the guardrail:
// if a future RN/Expo upgrade changes how Text is exported, it fails loudly
// instead of the cap silently becoming a no-op on-device. Relative import —
// jest has no `@/` moduleNameMapper.
import React from 'react';
import { Text, TextInput } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { installFontScaleCap } from './font-scale-cap';

describe('installFontScaleCap', () => {
  test('caps a bare <Text> at the configured multiplier', () => {
    installFontScaleCap(1.5);
    render(<Text>hello</Text>);
    expect(screen.getByText('hello').props.maxFontSizeMultiplier).toBe(1.5);
  });

  test('an explicit maxFontSizeMultiplier on the element wins over the global cap', () => {
    installFontScaleCap(1.5);
    render(<Text maxFontSizeMultiplier={1.2}>welcome</Text>);
    expect(screen.getByText('welcome').props.maxFontSizeMultiplier).toBe(1.2);
  });

  test('leaves allowFontScaling={false} intact so frozen chrome stays frozen', () => {
    installFontScaleCap(1.5);
    render(<Text allowFontScaling={false}>fermer</Text>);
    expect(screen.getByText('fermer').props.allowFontScaling).toBe(false);
  });

  test('also caps <TextInput>', () => {
    installFontScaleCap(1.5);
    render(<TextInput testID="ti" value="x" onChangeText={() => {}} />);
    expect(screen.getByTestId('ti').props.maxFontSizeMultiplier).toBe(1.5);
  });
});
