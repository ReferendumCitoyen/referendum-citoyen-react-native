import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Height, in dp, that the software keyboard covers at the bottom of the
 * window. 0 when it is closed.
 *
 * iOS only. A `KeyboardAvoidingView` with `behavior="padding"` pads the view
 * from the OUTSIDE: inside the voting flow, whose slide is bounded by the
 * measured slide area and clipped by `slidingWrapper` (`overflow: 'hidden'`),
 * that padding grew the slide past its frame instead of shrinking the scroll,
 * and the bottom of the step, which is where the button is, was clipped away
 * with nothing to scroll to it (QA iPhone 2.0.2, item 2: "Continuer"
 * unreachable on step 5 as soon as the CAN was typed). The inset belongs
 * inside the scroll, as content padding, which is what this returns.
 *
 * On Android the window is resized by `adjustResize`, so the slide already
 * shrinks and adding the inset would count the keyboard twice: 0 there.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (e) =>
      setInset(Math.max(0, Math.round(e?.endCoordinates?.height ?? 0))),
    );
    const hide = Keyboard.addListener('keyboardWillHide', () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return inset;
}

export default useKeyboardInset;
