import React, { useState, useEffect, useRef } from 'react';
import { View, Text, LayoutChangeEvent, Platform, Image } from 'react-native';
import { VideoView } from 'expo-video';
import { createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';

interface Step7Props {
  containerWidth: number;
  player: any;
  isActive?: boolean;
  nfcData?: any;
  onSuccess?: () => void;
  onError?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step7: React.FC<Step7Props> = ({ containerWidth, player, isActive, nfcData, onSuccess, onError, onLayout }) => {
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [countdown, setCountdown] = useState(5);
  const hasCalledCallback = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (isActive && !hasStarted) {
      setHasStarted(true);
      setCountdown(5);
      hasCalledCallback.current = false;
    } else if (!isActive && hasStarted) {
      // Reset when step becomes inactive
      setHasStarted(false);
      hasCalledCallback.current = false;
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
      if (onSuccess) {
        onSuccess();
      }
    }
  }, [hasStarted, countdown, onSuccess]);

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
          Vérification de votre âge et nationalité localement sur votre appareil. Veuillez patienter…{' '}
          <Text style={{
            fontFamily: Typography.fontFamily.medium,
            fontSize: Typography.fontSize.xs,
            color: colors.text,
            opacity: 0.5,
          }}>
            ({countdown}s)
          </Text>
        </Text>

        {nfcData?.personDetails && (
          <View style={{ marginTop: 16, padding: 16, backgroundColor: colors.white, borderRadius: 8 }}>
            <Text style={{
              fontFamily: Typography.fontFamily.semibold,
              fontSize: Typography.fontSize.body,
              color: colors.text,
              marginBottom: 8,
            }}>
              {`${nfcData.personDetails.firstName || ''} ${nfcData.personDetails.lastName || ''}`.trim() || 'Nom non disponible'}
            </Text>
            <Text style={{
              fontFamily: Typography.fontFamily.medium,
              fontSize: Typography.fontSize.small,
              color: colors.text,
              opacity: 0.7,
            }}>
              Né(e) le: {nfcData.personDetails.birthDate ?
                `${nfcData.personDetails.birthDate.slice(4, 6)}/${nfcData.personDetails.birthDate.slice(2, 4)}/${nfcData.personDetails.birthDate.slice(0, 2) >= '50' ? '19' : '20'}${nfcData.personDetails.birthDate.slice(0, 2)}`
                : 'N/A'}
            </Text>
            <Text style={{
              fontFamily: Typography.fontFamily.medium,
              fontSize: Typography.fontSize.small,
              color: colors.text,
              opacity: 0.7,
            }}>
              Nationalité: {nfcData.personDetails.nationality || 'N/A'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

export default Step7;
