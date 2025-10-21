import {
  EDocumentModuleEvents,
  EDocumentModuleListener,
  EDocumentModuleRemoveAllListeners,
} from '@modules/e-document'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'

import { UiButton, UiIcon } from '@/ui'

import { useDocumentScanContext } from '../ScanProvider'

export default function RevocationStep() {
  const { revokeIdentity } = useDocumentScanContext()
  const [isScanning, setIsScanning] = useState(false)

  const [title, setTitle] = useState('Scan NFC')

  useEffect(() => {
    EDocumentModuleListener(EDocumentModuleEvents.ScanStarted, () => {
      setTitle('ScanStarted')
      setIsScanning(true)
    })
    EDocumentModuleListener(EDocumentModuleEvents.RequestPresentPassport, () => {
      setTitle('RequestPresentPassport')
    })
    EDocumentModuleListener(EDocumentModuleEvents.AuthenticatingWithPassport, () => {
      setTitle('AuthenticatingWithPassport')
    })
    EDocumentModuleListener(EDocumentModuleEvents.ReadingDataGroupProgress, () => {
      setTitle('ReadingDataGroupProgress')
    })
    EDocumentModuleListener(EDocumentModuleEvents.ActiveAuthentication, () => {
      setTitle('ActiveAuthentication')
    })
    EDocumentModuleListener(EDocumentModuleEvents.SuccessfulRead, () => {
      setTitle('SuccessfulRead')
    })
    EDocumentModuleListener(EDocumentModuleEvents.ScanError, () => {
      setTitle('ScanError')
      setIsScanning(false)
    })
    EDocumentModuleListener(EDocumentModuleEvents.ScanStopped, () => {
      setTitle('ScanStopped')
      setIsScanning(false)
    })

    return () => {
      EDocumentModuleRemoveAllListeners(EDocumentModuleEvents.ScanStarted)
      EDocumentModuleRemoveAllListeners(EDocumentModuleEvents.RequestPresentPassport)
      EDocumentModuleRemoveAllListeners(EDocumentModuleEvents.AuthenticatingWithPassport)
      EDocumentModuleRemoveAllListeners(EDocumentModuleEvents.ReadingDataGroupProgress)
      EDocumentModuleRemoveAllListeners(EDocumentModuleEvents.ActiveAuthentication)
      EDocumentModuleRemoveAllListeners(EDocumentModuleEvents.SuccessfulRead)
      EDocumentModuleRemoveAllListeners(EDocumentModuleEvents.ScanError)
      EDocumentModuleRemoveAllListeners(EDocumentModuleEvents.ScanStopped)
    }
  }, [])

  return (
    <View className='flex flex-1 flex-col justify-center'>
      <Text className='typography-h5 text-center text-textPrimary'>Revocation</Text>
      <Text className='typography-h5 text-center text-textPrimary'>{title}</Text>
      {isScanning ? (
        <View className='flex items-center'>
          <UiIcon customIcon='bellFillIcon' className='size-[120] text-textPrimary' />
        </View>
      ) : (
        <UiButton onPress={revokeIdentity} title='Try Scan Again' />
      )}
    </View>
  )
}
