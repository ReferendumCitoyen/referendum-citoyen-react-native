import React from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Platform, Image } from 'react-native';
import { VideoView } from 'expo-video';
import { useCameraPermission } from 'react-native-vision-camera';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';

interface Step4Props {
  player: any;
  containerWidth: number;
  onStartAnalysis?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step4: React.FC<Step4Props> = ({ player, containerWidth, onStartAnalysis, onLayout }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const { hasPermission, requestPermission } = useCameraPermission();

  const handleStartAnalysis = async () => {
    console.log('🔘 Step4: Start analysis pressed, hasPermission:', hasPermission);

    // Request camera permission before proceeding
    if (!hasPermission) {
      console.log('📸 Step4: Requesting camera permission...');
      const granted = await requestPermission();
      console.log('📸 Step4: Permission result:', granted);

      if (!granted) {
        // Permission denied - stay on this step
        console.log('❌ Step4: Camera permission denied');
        return;
      }
    }

    // Permission granted or already had it - proceed to next step
    console.log('✅ Step4: Permission OK, proceeding to Step 5');
    onStartAnalysis?.();
  };
  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step4Container}>
        <View style={stepSpecificStyles.step4Content}>
          <Text style={stepSpecificStyles.step4Title}>{t('voting.step4Title')}</Text>
          <Text style={stepSpecificStyles.step4Description}>
            {t('voting.step4Description')}
          </Text>
        </View>
        {Platform.OS === 'android' ? (
          <Image
            source={require('@/assets/images/poster-card.png')}
            style={stepSpecificStyles.step4Video}
            resizeMode="cover"
          />
        ) : (
          <VideoView
            style={stepSpecificStyles.step4Video}
            player={player}
            contentFit="cover"
            nativeControls={false}
            surfaceType="textureView"
          />
        )}
        <TouchableOpacity
          style={stepSpecificStyles.step4Button}
          activeOpacity={0.8}
          onPress={handleStartAnalysis}
        >
          <Text style={stepSpecificStyles.step4ButtonText}>{t('voting.step4Start')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step4;
