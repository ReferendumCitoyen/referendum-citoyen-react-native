import React, { useState, useEffect, useRef } from 'react';
import { View, Text } from 'react-native';
import { VideoView } from 'expo-video';
import { stepSpecificStyles } from './styles';
import { Colors, Typography } from '@/constants/theme';

interface Step7Props {
  containerWidth: number;
  player: any;
  onSuccess?: () => void;
  onError?: () => void;
}

const Step7: React.FC<Step7Props> = ({ containerWidth, player, onSuccess, onError }) => {
  const [countdown, setCountdown] = useState(10);
  const [willSucceed] = useState(() => Math.random() >= 0.5);
  const hasCalledCallback = useRef(false);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0 && !hasCalledCallback.current) {
      hasCalledCallback.current = true;
      if (willSucceed && onSuccess) {
        onSuccess();
      } else if (!willSucceed && onError) {
        onError();
      }
    }
  }, [countdown, willSucceed, onSuccess, onError]);

  return (
    <View style={[{ width: containerWidth }]}>
      <View style={stepSpecificStyles.step7Container}>
        <Text style={stepSpecificStyles.step7Title}>Vérification locale</Text>

        <VideoView
          style={stepSpecificStyles.step7Image}
          player={player}
          contentFit="contain"
          nativeControls={false}
        />

        <Text style={stepSpecificStyles.step7Description}>
          Vérification de votre âge et nationalité localement sur votre appareil. Veuillez patienter, cela peut prendre jusqu'à 1 minute…{' '}
          <Text style={{
            fontFamily: Typography.fontFamily.medium,
            fontWeight: Typography.fontWeight.medium,
            fontSize: Typography.fontSize.small,
            color: Colors.primary,
          }}>
            {countdown} ({willSucceed ? 'Success' : 'Fail'})
          </Text>
        </Text>
      </View>
    </View>
  );
};

export default Step7;
