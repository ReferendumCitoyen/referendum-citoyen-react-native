import { Image } from 'expo-image'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import AppContainer from '@/pages/app/components/AppContainer'
import { useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiCard, UiHorizontalDivider, UiScreenScrollable } from '@/ui'
import { EID, EPassport } from '@/utils/e-document/e-document'

export default function DocumentPreviewStep() {
  const insets = useSafeAreaInsets()
  const { tempEDoc, createIdentity } = useDocumentScanContext()

  if (tempEDoc instanceof EPassport) {
    if (!tempEDoc?.personDetails) return null

    const { firstName, lastName, gender, passportImageRaw, ...restDetails } = tempEDoc.personDetails

    return (
      <UiScreenScrollable
        className='pb-20'
        style={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <View className='flex-1 flex-col gap-4 p-5'>
          <UiCard>
            <View className='flex flex-row'>
              <View className='flex flex-1 flex-col gap-2'>
                <Text className='text-textPrimary'>{`${firstName} ${lastName}`}</Text>
                <Text className='text-textPrimary'>{gender}</Text>
              </View>

              <Image
                style={{ width: 120, height: 120, borderRadius: 1000 }}
                source={{
                  uri: `data:image/png;base64,${passportImageRaw}`,
                }}
              />
            </View>
          </UiCard>

          <View className='mt-6 flex flex-col gap-4'>
            {restDetails &&
              Object.keys(restDetails).map(key => {
                return (
                  <View key={key} className='flex flex-row items-center justify-between gap-2'>
                    <Text className='typography-body3 capitalize text-textPrimary'>{key}</Text>
                    <Text className='typography-subtitle4 text-textPrimary'>
                      {restDetails?.[key as keyof typeof tempEDoc.personDetails]}
                    </Text>
                  </View>
                )
              })}

            <View className='flex flex-row items-center justify-between gap-2'>
              <Text className='typography-body3 capitalize text-textPrimary'>dg1</Text>
              <Text className='typography-subtitle4 text-textPrimary'>
                {tempEDoc.dg1Bytes.length} length
              </Text>
            </View>

            <View className='flex flex-row items-center justify-between gap-2'>
              <Text className='typography-body3 capitalize text-textPrimary'>dg11</Text>
              <Text className='typography-subtitle4 text-textPrimary'>
                {tempEDoc.dg11Bytes?.length} length
              </Text>
            </View>

            <View className='flex flex-row items-center justify-between gap-2'>
              <Text className='typography-body3 capitalize text-textPrimary'>dg15</Text>
              <Text className='typography-subtitle4 text-textPrimary'>
                {tempEDoc.dg15Bytes?.length ?? 0} length
              </Text>
            </View>

            <View className='flex flex-row items-center justify-between gap-2'>
              <Text className='typography-body3 capitalize text-textPrimary'>signature</Text>
              <Text className='typography-subtitle4 text-textPrimary'>
                {tempEDoc?.aaSignature?.length ?? 0} length
              </Text>
            </View>
          </View>

          <View className='mt-auto'>
            <UiHorizontalDivider className='my-5' />
            <UiButton title='Generate Proof' onPress={createIdentity} />
          </View>
        </View>
      </UiScreenScrollable>
    )
  }

  if (tempEDoc instanceof EID) {
    return (
      <AppContainer className='flex-1 items-center justify-center'>
        <Text className='typography-title1 text-textPrimary'>EID Document Preview</Text>
        <Text className='typography-body2 mt-2 text-textPrimary'>
          EID document preview is not implemented yet.
        </Text>
      </AppContainer>
    )
  }

  return (
    <AppContainer className='flex-1 items-center justify-center'>
      <Text className='typography-title1 text-textPrimary'>Document Preview</Text>
      <Text className='typography-body2 mt-2 text-textPrimary'>
        Document preview is not available for this document type.
      </Text>
    </AppContainer>
  )
}
