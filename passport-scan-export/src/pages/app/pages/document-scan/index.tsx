import {
  ScanContextProvider,
  Steps,
  useDocumentScanContext,
} from '@/pages/app/pages/document-scan/ScanProvider'
import type { AppStackScreenProps } from '@/route-types'

import {
  DocumentPreviewStep,
  GenerateProofStep,
  RevocationStep,
  ScanMrzStep,
  ScanNfcStep,
  SelectDocTypeStep,
  SuccessStep,
} from './components'

export default function DocumentScanScreen({ route }: AppStackScreenProps<'Scan'>) {
  return (
    <ScanContextProvider docType={route.params?.documentType}>
      <DocumentScanContent />
    </ScanContextProvider>
  )
}

function DocumentScanContent() {
  const { currentStep } = useDocumentScanContext()

  return (
    <>
      {{
        [Steps.SelectDocTypeStep]: () => <SelectDocTypeStep />,
        [Steps.ScanMrzStep]: () => <ScanMrzStep />,
        [Steps.ScanNfcStep]: () => <ScanNfcStep />,
        [Steps.DocumentPreviewStep]: () => <DocumentPreviewStep />,
        [Steps.GenerateProofStep]: () => <GenerateProofStep />,
        [Steps.RevocationStep]: () => <RevocationStep />,
        [Steps.FinishStep]: () => <SuccessStep />,
      }[currentStep]()}
    </>
  )
}
