/**
 * Drop-in <Image> that shows a pulsing skeleton while the bitmap decodes and
 * cross-fades the picture in once it is ready.
 *
 * Two details make this feel right rather than flickery:
 *
 * 1. The skeleton is delayed. These are bundled assets — in a release build
 *    they come off local disk and are usually ready within a frame or two, so
 *    painting a placeholder immediately would just flash. It only appears if
 *    loading actually takes longer than SKELETON_DELAY_MS, which in practice
 *    means during development (Metro serves them over HTTP) and on the first
 *    decode of a larger image.
 *
 * 2. The underlying Image gets fadeDuration={0}. Android fades images in over
 *    300ms by default; combined with our own fade that reads as a slow double
 *    dissolve, and it was the reason images looked sluggish in the first place.
 *
 * Pass the layout style as you would to <Image> — it is applied to the wrapper,
 * and the image fills it, so surrounding layout is unchanged.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, type ImageProps, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/constants/theme';

const SKELETON_DELAY_MS = 90;
const FADE_MS = 180;
const PULSE_MS = 700;

type Props = Omit<ImageProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
};

export default function FadeInImage({ style, onLoadEnd, ...imageProps }: Props) {
  const colors = useColors();
  const [loaded, setLoaded] = useState(false);
  const [skeletonVisible, setSkeletonVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0.35)).current;

  // Only admit to loading if it is taking long enough to notice.
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => setSkeletonVisible(true), SKELETON_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loaded]);

  useEffect(() => {
    if (!skeletonVisible || loaded) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.7, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [skeletonVisible, loaded, pulse]);

  // onLoadEnd rather than onLoad: a bitmap that fails to decode must still
  // clear the skeleton, otherwise it pulses forever over an empty box.
  const handleLoadEnd = useCallback(() => {
    setLoaded(true);
    Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start();
    onLoadEnd?.();
  }, [opacity, onLoadEnd]);

  return (
    <Animated.View style={[style, { overflow: 'hidden' }]}>
      {skeletonVisible && !loaded && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.border, opacity: pulse }]}
        />
      )}
      <Animated.Image
        {...imageProps}
        // width/height as well as absoluteFill. Inset-only positioning left the
        // image free to fall back to its intrinsic size — a single-resolution
        // 700×230 asset is 700×230 *points*, which then rendered anchored at the
        // top-left and was clipped by the overflow:hidden above, silently
        // cropping the picture no matter what resizeMode the caller asked for.
        // Stating the size removes the fallback.
        style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }, { opacity }]}
        fadeDuration={0}
        onLoadEnd={handleLoadEnd}
      />
    </Animated.View>
  );
}
