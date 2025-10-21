import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiCard, UiIcon } from '@/ui'
import { DocType } from '@/utils/e-document/e-document'

export default function SelectDocTypeStep() {
  const { setDocType } = useDocumentScanContext()
  const insets = useSafeAreaInsets()

  return (
    <View
      className='flex flex-1 flex-col'
      style={{
        paddingTop: insets.top,
      }}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className='flex flex-1 flex-col gap-4 p-5'>
          <Text className='typography-h4 my-4 text-center text-textPrimary'>
            Select doc type step
          </Text>

          <View className='flex flex-col gap-5'>
            <Pressable
              onPress={() => {
                setDocType(DocType.PASSPORT)
              }}
            >
              <UiCard className='flex flex-row items-center gap-2'>
                <UiIcon customIcon='starFillIcon' className='text-textPrimary' />
                <Text className='typography-subtitle4 text-textPrimary'>Passport</Text>
              </UiCard>
            </Pressable>

            <Pressable
              onPress={() => {
                setDocType(DocType.ID)
              }}
            >
              <UiCard className='flex flex-row items-center gap-2'>
                <UiIcon customIcon='cardholderIcon' className='text-textPrimary' />
                <Text className='typography-subtitle4 text-textPrimary'>ID CARD</Text>
              </UiCard>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
