import React, { useState, useEffect, useRef } from 'react';
import { View, Text, LayoutChangeEvent } from 'react-native';
import LottieView from 'lottie-react-native';
import { createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';

interface Step11Props {
  containerWidth: number;
  isActive?: boolean;
  onSuccess?: () => void;
  onError?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step11: React.FC<Step11Props> = ({ containerWidth, isActive, onSuccess, onError, onLayout }) => {
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [countdown, setCountdown] = useState(5);
  const [willSucceed] = useState(() => Math.random() < 0.75);
  const hasCalledCallback = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (isActive && !hasStarted) {
      setHasStarted(true);
      setCountdown(5);
    }
  }, [isActive, hasStarted]);

  useEffect(() => {
    if (hasStarted && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (hasStarted && countdown === 0 && !hasCalledCallback.current) {
      hasCalledCallback.current = true;
      if (willSucceed && onSuccess) {
        onSuccess();
      } else if (!willSucceed && onError) {
        onError();
      }
    }
  }, [hasStarted, countdown, willSucceed, onSuccess, onError]);

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step11Container}>
        <LottieView
          source={require('@/assets/animations/loading.json')}
          style={stepSpecificStyles.step11Loading}
          autoPlay
          loop
        />

        <Text style={{
          fontFamily: Typography.fontFamily.medium,
          fontWeight: Typography.fontWeight.medium,
          fontSize: Typography.fontSize.small,
          color: colors.text,
        }}>
          {countdown} ({willSucceed ? 'Success' : 'Fail'})
        </Text>
      </View>
    </View>
  );
};

export default Step11;
