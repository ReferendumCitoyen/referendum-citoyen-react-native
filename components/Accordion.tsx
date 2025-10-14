import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withTiming,
  useSharedValue,
  interpolate,
  Extrapolation,
  Easing
} from 'react-native-reanimated';
import { Colors, Typography, Spacing } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';

interface AccordionProps {
  title: string;
  content: string;
  defaultExpanded?: boolean;
  showBorder?: boolean;
}

const CaretDownIcon = ({ color, size = 24 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M6 9L12 15L18 9"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export default function Accordion({ title, content, defaultExpanded = false, showBorder = true }: AccordionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [contentHeight, setContentHeight] = useState(0);
  const [measured, setMeasured] = useState(false);
  const rotation = useSharedValue(defaultExpanded ? 180 : 0);
  const animatedHeight = useSharedValue(defaultExpanded ? 1 : 0);

  const toggleExpanded = () => {
    setExpanded(!expanded);
    rotation.value = withTiming(expanded ? 0 : 180, {
      duration: 350,
      easing: Easing.bezier(0.4, 0.0, 0.2, 1)
    });
    animatedHeight.value = withTiming(expanded ? 0 : 1, {
      duration: 350,
      easing: Easing.bezier(0.4, 0.0, 0.2, 1)
    });
  };

  const iconAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const contentAnimatedStyle = useAnimatedStyle(() => {
    const height = interpolate(
      animatedHeight.value,
      [0, 1],
      [0, contentHeight || 1000],
      Extrapolation.CLAMP
    );

    return {
      height,
      opacity: animatedHeight.value,
      overflow: 'hidden',
    };
  });

  const innerContentStyle = useAnimatedStyle(() => {
    return {
      height: contentHeight || undefined,
    };
  });

  const onContentLayout = (event: any) => {
    const { height } = event.nativeEvent.layout;
    if (!measured && height > 0) {
      setContentHeight(height);
      setMeasured(true);
    }
  };

  return (
    <View style={[styles.container, showBorder && styles.containerWithBorder]}>
      <TouchableOpacity onPress={toggleExpanded} activeOpacity={0.7}>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{title}</Text>
          <Animated.View style={[styles.iconContainer, iconAnimatedStyle]}>
            <CaretDownIcon color={Colors.secondary} size={Spacing.icon.size} />
          </Animated.View>
        </View>
      </TouchableOpacity>

      {/* Measurement view - invisible but rendered to get height */}
      <View style={styles.measurementContainer} onLayout={onContentLayout}>
        <View style={styles.contentInner}>
          <Text style={styles.content}>{content}</Text>
        </View>
      </View>

      {/* Animated visible content */}
      <Animated.View style={contentAnimatedStyle}>
        <Animated.View style={innerContentStyle}>
          <View style={styles.contentInner}>
            <Text style={styles.content}>{content}</Text>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.white,
    padding: Spacing.accordion.padding,
  },
  containerWithBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.accordion.titleGap,
  },
  title: {
    flex: 1,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: Colors.primary,
  },
  iconContainer: {
    width: Spacing.icon.size,
    height: Spacing.icon.size,
    justifyContent: 'center',
    alignItems: 'center',
  },
  measurementContainer: {
    position: 'absolute',
    opacity: 0,
    zIndex: -1,
  },
  contentInner: {
    paddingTop: Spacing.accordion.contentGap,
  },
  content: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: Colors.primary,
  },
});
