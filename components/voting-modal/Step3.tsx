import React from 'react';
import { View, Text, LayoutChangeEvent, Platform, Image } from 'react-native';
import { VideoView } from 'expo-video';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';

interface Step3Props {
  player: any;
  containerWidth: number;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step3: React.FC<Step3Props> = ({ player, containerWidth, onLayout }) => {
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  return (
    <View style={[modalStyles.stepSlide, { width: containerWidth }]} onLayout={onLayout}>
      <View style={modalStyles.mediaContainer}>
        {Platform.OS === 'android' ? (
          <Image
            source={require('@/assets/images/poster-ballot.png')}
            style={stepSpecificStyles.ballotImage}
            resizeMode="contain"
          />
        ) : (
          <VideoView
            style={stepSpecificStyles.ballotImage}
            player={player}
            contentFit="contain"
            nativeControls={false}
            surfaceType="textureView"
          />
        )}
      </View>
      <View style={modalStyles.contentSection}>
        <View style={modalStyles.stepContent}>
          <View style={modalStyles.stepHeader}>
            <View style={modalStyles.numberCircle}>
              <Text style={modalStyles.numberText}>3</Text>
            </View>
            <Text style={modalStyles.stepTitle}>Vote anonyme</Text>
          </View>
          <Text style={modalStyles.stepDescription}>
            Une fois vos données vérifiées et authentiques, l'application produit un jeton anonyme vous permettant de voter.
          </Text>
        </View>
      </View>
    </View>
  );
};

export default Step3;