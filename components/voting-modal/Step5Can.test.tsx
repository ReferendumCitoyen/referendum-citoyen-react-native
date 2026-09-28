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

import Step5Can from './Step5Can';
import { ThemeProvider } from '@/contexts/ThemeContext';

// i18n fr strings, with the raw keys as a fallback when i18n is not
// initialised in the jest environment.
const CONTINUE = /Continuer|common\.continue/;
const FIELD = /6 chiffres|step5CanPlaceholder/;

const mount = () => {
  const onSubmit = jest.fn();
  const r = render(
    <ThemeProvider>
      <Step5Can containerWidth={300} onSubmit={onSubmit} />
    </ThemeProvider>,
  );
  return { ...r, onSubmit };
};

// The CAN opens the chip: six digits, nothing else may be handed on.
describe('Step5Can', () => {
  it('does nothing until six digits are typed', () => {
    const r = mount();
    fireEvent.changeText(r.getByPlaceholderText(FIELD), '12345');
    fireEvent.press(r.getByText(CONTINUE));
    expect(r.onSubmit).not.toHaveBeenCalled();
  });

  it('hands over exactly the six digits', () => {
    const r = mount();
    fireEvent.changeText(r.getByPlaceholderText(FIELD), '123456');
    fireEvent.press(r.getByText(CONTINUE));
    expect(r.onSubmit).toHaveBeenCalledWith('123456');
  });

  it('drops anything that is not a digit as it is typed', () => {
    const r = mount();
    const field = r.getByPlaceholderText(FIELD);
    fireEvent.changeText(field, '12 34-5x6');
    expect(field.props.value).toBe('123456');
  });

  // Item 5 (2.0.2): the keyboard's "done" and the button both submit.
  it('a double submit hands the CAN on once', () => {
    const r = mount();
    const field = r.getByPlaceholderText(FIELD);
    fireEvent.changeText(field, '123456');
    fireEvent(field, 'submitEditing');
    fireEvent.press(r.getByText(CONTINUE));
    fireEvent.press(r.getByText(CONTINUE));
    expect(r.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Continue works again after Back from step 6, without retyping', () => {
    const onSubmit = jest.fn();
    const tree = (isActive: boolean) => (
      <ThemeProvider>
        <Step5Can containerWidth={300} onSubmit={onSubmit} isActive={isActive} />
      </ThemeProvider>
    );
    const r = render(tree(true));
    fireEvent.changeText(r.getByPlaceholderText(FIELD), '123456');
    fireEvent.press(r.getByText(CONTINUE));
    // On to step 6: Step5Can stays mounted, inactive, and keeps its value.
    r.rerender(tree(false));
    fireEvent.press(r.getByText(CONTINUE));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Back to step 5.
    r.rerender(tree(true));
    expect(r.getByPlaceholderText(FIELD).props.value).toBe('123456');
    fireEvent.press(r.getByText(CONTINUE));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('keeps only the first six digits', () => {
    const r = mount();
    const field = r.getByPlaceholderText(FIELD);
    fireEvent.changeText(field, '1234567');
    expect(field.props.value).toBe('123456');
  });
});
