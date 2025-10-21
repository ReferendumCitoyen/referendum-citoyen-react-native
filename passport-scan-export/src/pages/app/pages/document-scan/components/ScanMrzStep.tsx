import { useAppState } from '@react-native-community/hooks'
import { useIsFocused } from '@react-navigation/native'
import { parse } from 'mrz'
import { useCallback, useEffect, useMemo } from 'react'
import { ScrollView, Text, View } from 'react-native'
import {
  Camera,
  runAtTargetFps,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera'
import { useTextRecognition } from 'react-native-vision-camera-text-recognition'
import { Worklets } from 'react-native-worklets-core'

import { bus, DefaultBusEvents, ErrorHandler } from '@/core'
import { useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton } from '@/ui'
import { DocType } from '@/utils/e-document/e-document'

const useMrzParser = (docType: DocType) => {
  const idCardParser = useCallback((lines: string[]) => {
    const numlinesToCheck = 3

    const possibleMRZLines = lines?.slice(-numlinesToCheck)

    if (!possibleMRZLines?.length || possibleMRZLines.length !== numlinesToCheck) return

    // const tdLength = possibleMRZLines[1].length
    const tdLength = 30

    const sanitizedMRZLines = possibleMRZLines.map(el => {
      return el.replaceAll('«', '<<').replaceAll(' ', '').toUpperCase()
    })

    sanitizedMRZLines[2] = sanitizedMRZLines[2].padEnd(tdLength, '<').toUpperCase()

    return parse(sanitizedMRZLines, {
      autocorrect: true,
    })
  }, [])

  const passportParser = useCallback((lines: string[]) => {
    const numlinesToCheck = 2

    const possibleMRZLines = lines?.slice(-numlinesToCheck)

    if (!possibleMRZLines?.length || possibleMRZLines.length !== numlinesToCheck) return

    // const tdLength = possibleMRZLines[1].length
    const tdLength = 44

    const sanitizedMRZLines = possibleMRZLines.map(el => {
      return el.replaceAll('«', '<<').replaceAll(' ', '').toUpperCase()
    })

    sanitizedMRZLines[0] = sanitizedMRZLines[0].padEnd(tdLength, '<').toUpperCase()

    return parse(sanitizedMRZLines, {
      autocorrect: true,
    })
  }, [])

  return {
    [DocType.ID]: idCardParser,
    [DocType.PASSPORT]: passportParser,
  }[docType]
}

export default function ScanMrzStep() {
  const { docType, setTempMrz } = useDocumentScanContext()

  const isFocused = useIsFocused()
  const currentAppState = useAppState()

  const device = useCameraDevice('back')
  const { hasPermission, requestPermission } = useCameraPermission()

  const { scanText } = useTextRecognition({
    language: 'latin',
  })

  const mrzParser = useMrzParser(docType ?? DocType.PASSPORT)

  const onMRZDetected = Worklets.createRunOnJS((lines: string[]) => {
    try {
      const result = mrzParser(lines)

      if (result?.valid) {
        bus.emit(DefaultBusEvents.success, {
          message: 'MRZ Detected',
        })
        setTempMrz(result.fields)
      }
    } catch (error) {
      ErrorHandler.processWithoutFeedback(error)
    }
  })

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet'

      // FIXME: https://github.com/mrousavy/react-native-vision-camera/issues/2820
      runAtTargetFps(2, () => {
        'worklet'

        const data = scanText(frame)

        try {
          let resultText: string = ''

          if (data) {
            if (data?.length) {
              resultText = data.map(el => el.resultText).join('\n')
            } else if ('resultText' in data) {
              resultText = data.resultText as string
            } else {
              resultText = ''
            }

            if (resultText) {
              onMRZDetected(resultText.split('\n'))
            }
          }
        } catch (error) {
          ErrorHandler.processWithoutFeedback(error)
        }
      })
    },
    [scanText, onMRZDetected],
  )

  const isActive = useMemo(() => {
    return isFocused && currentAppState === 'active'
  }, [currentAppState, isFocused])

  useEffect(() => {
    if (hasPermission) return

    requestPermission()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <View className='flex flex-1 flex-col'>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        {isActive && (
          <>
            {hasPermission ? (
              <>
                {device && (
                  <Camera
                    style={{
                      marginTop: 50,
                      width: '100%',
                      height: '50%',
                    }}
                    device={device}
                    isActive={isActive}
                    enableFpsGraph={true}
                    frameProcessor={frameProcessor}
                  />
                )}
              </>
            ) : (
              <View>
                <Text className='typography-h4 text-textPrimary'>Requesting Camera Permission</Text>

                <UiButton onPress={requestPermission} title='Request Permission' />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}
