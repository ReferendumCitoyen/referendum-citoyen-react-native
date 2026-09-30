import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withTiming,
  useSharedValue,
  interpolate,
  Extrapolation,
  Easing
} from 'react-native-reanimated';
import { useColors, Typography, Spacing } from '@/constants/theme';
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

const URL_REGEX = /(https?:\/\/[^\s)]+)/g;

function renderContentWithLinks(text: string, linkColor: string) {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    if (part.match(URL_REGEX)) {
      return (
        <Text
          key={i}
          style={{ color: linkColor, textDecorationLine: 'underline' }}
          onPress={() => Linking.openURL(part)}
        >
          {part}
        </Text>
      );
    }
    return <Text key={i}>{part}</Text>;
  });
}

export default function Accordion({ title, content, defaultExpanded = false, showBorder = true }: AccordionProps) {
  const colors = useColors();
  const styles = createStyles(colors);
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
            <CaretDownIcon color={colors.icon} size={Spacing.icon.size} />
          </Animated.View>
        </View>
      </TouchableOpacity>

      {/* Measurement view - invisible but rendered to get height */}
      <View style={styles.measurementContainer} onLayout={onContentLayout}>
        <View style={styles.contentInner}>
          <Text style={styles.content}>{renderContentWithLinks(content, colors.secondary)}</Text>
        </View>
      </View>

      {/* Animated visible content */}
      <Animated.View style={contentAnimatedStyle}>
        <Animated.View style={innerContentStyle}>
          <View style={styles.contentInner}>
            <Text style={styles.content}>{renderContentWithLinks(content, colors.secondary)}</Text>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: {
    backgroundColor: colors.cardBackground,
    padding: Spacing.accordion.padding,
  },
  containerWithBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.accordion.titleGap,
  },
  title: {
    flex: 1,
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
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
    color: colors.text,
  },
});
