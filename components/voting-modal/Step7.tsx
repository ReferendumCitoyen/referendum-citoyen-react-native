import React, { useState, useEffect, useRef } from 'react';
import { View, Text, LayoutChangeEvent, Platform, Image } from 'react-native';
import { VideoView } from 'expo-video';
import { createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';

interface Step7Props {
  containerWidth: number;
  player: any;
  isActive?: boolean;
  onSuccess?: () => void;
  onError?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step7: React.FC<Step7Props> = ({ containerWidth, player, isActive, onSuccess, onError, onLayout }) => {
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
      <View style={stepSpecificStyles.step7Container}>
        <Text style={stepSpecificStyles.step7Title}>Vérification locale</Text>

        {Platform.OS === 'android' ? (
          <Image
            source={require('@/assets/images/poster-verify.png')}
            style={stepSpecificStyles.step7Image}
            resizeMode="contain"
          />
        ) : (
          <VideoView
            style={stepSpecificStyles.step7Image}
            player={player}
            contentFit="contain"
            nativeControls={false}
            surfaceType="textureView"
          />
        )}

        <Text style={stepSpecificStyles.step7Description}>
          Vérification de votre âge et nationalité localement sur votre appareil. Veuillez patienter, cela peut prendre jusqu'à 1 minute…{' '}
          <Text style={{
            fontFamily: Typography.fontFamily.medium,
            fontWeight: Typography.fontWeight.medium,
            fontSize: Typography.fontSize.small,
            color: colors.text,
          }}>
            {countdown} ({willSucceed ? 'Success' : 'Fail'})
          </Text>
        </Text>
      </View>
    </View>
  );
};

export default Step7;
