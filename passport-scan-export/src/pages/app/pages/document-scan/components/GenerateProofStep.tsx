import { Text, View } from 'react-native'

import { useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'

export default function GenerateProofStep() {
  const { circuitLoadingDetails } = useDocumentScanContext()

  return (
    <View className='flex-1 p-5'>
      <View>
        <Text className='typography-subtitle4 text-textPrimary'>Downloading Progress:</Text>
        <Text className='typography-body3 text-textPrimary'>
          {circuitLoadingDetails?.downloadingProgress}
        </Text>

        <Text className='typography-subtitle4 text-textPrimary'>isLoaded:</Text>
        <Text className='typography-body3 text-textPrimary'>
          {String(circuitLoadingDetails?.isLoaded)}
        </Text>

        <Text className='typography-subtitle4 text-textPrimary'>isCircuitsLoadFailed:</Text>
        <Text className='typography-body3 text-textPrimary'>
          {String(circuitLoadingDetails?.isLoadFailed)}
        </Text>
      </View>
    </View>
  )
}
