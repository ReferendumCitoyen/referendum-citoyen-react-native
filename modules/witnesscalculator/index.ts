import { Asset } from 'expo-asset'
import WitnesscalculatorModule from './src/WitnesscalculatorModule'
// expo-file-system v18+ split the API: documentDirectory + EncodingType +
// DownloadProgressData are now under /legacy. Without this, the module loads
// but the FileSystem.* references resolve to undefined at runtime.
import * as FileSystem from 'expo-file-system/legacy'
import { unzip } from 'react-native-zip-archive'

export type CircomZKProof = {
  proof: ProofData
  pub_signals: string[]
}

export type ProofData = {
  pi_a: string[]
  pi_b: string[][]
  pi_c: string[]
  protocol: string
}

class CircomCircuitParams {
  constructor(
    public name: string,
    public retrieveZkeyNDat: (opts?: {
      onDownloadStart?: () => void
      onDownloadingProgress?: (downloadProgressData: FileSystem.DownloadProgressData) => void
      onLoaded?: () => void
      onFailed?: (error?: Error) => void
    }) => Promise<{
      zkeyLocalUri: string
      datBytes: Uint8Array
    }>,
    public wtnsCalcMethod: (
      descriptionFileDataBase64: Uint8Array,
      privateInputsJsonBase64: Uint8Array,
    ) => Promise<Uint8Array>,
  ) {}

  static fromName(circuitName: string): CircomCircuitParams {
    const found = supportedCircomCircuits.find(el => el.name === circuitName)

    if (!found) {
      throw new Error(`Circuit with name ${circuitName} not found`)
    }

    return found
  }
}

export class LocalCircomCircuitParams extends CircomCircuitParams {
  static fromName(circuitName: string): LocalCircomCircuitParams {
    return super.fromName(circuitName) as LocalCircomCircuitParams
  }

  constructor(
    public name: string,

    public zkeyAssetModuleId: string,
    public datAssetModuleId: string,

    public wtnsCalcMethod: (
      descriptionFileDataBase64: Uint8Array,
      privateInputsJsonBase64: Uint8Array,
    ) => Promise<Uint8Array>,
  ) {
    super(
      name,
      async () => {
        const [datAssetInfo] = await Asset.loadAsync(datAssetModuleId)

        if (!datAssetInfo.localUri) throw new TypeError('Dat file not found')

        const datFileInfo = await FileSystem.getInfoAsync(datAssetInfo.localUri)

        if (!datFileInfo?.exists) throw new TypeError('Dat file not found')

        const datBase64 = await FileSystem.readAsStringAsync(datFileInfo.uri, {
          encoding: FileSystem.EncodingType.Base64,
        })

        const [zkeyAssetInfo] = await Asset.loadAsync(zkeyAssetModuleId)

        if (!zkeyAssetInfo.localUri) throw new TypeError('Zkey file not found')

        const zkeyFileInfo = await FileSystem.getInfoAsync(zkeyAssetInfo.localUri)

        if (!zkeyFileInfo?.exists) throw new TypeError('Zkey file not found')

        return {
          zkeyLocalUri: zkeyFileInfo.uri.replace('file://', ''), // TODO: check if replace is for iOS only
          datBytes: Buffer.from(datBase64, 'base64'),
        }
      },
      wtnsCalcMethod,
    )
  }
}

export class ExternalCircomCircuitParams extends CircomCircuitParams {
  static fromName(circuitName: string): ExternalCircomCircuitParams {
    return super.fromName(circuitName) as ExternalCircomCircuitParams
  }

  static async #checkCircuitsLoaded(zkeyPath: string, datPath: string) {
    const zkeyInfo = await FileSystem.getInfoAsync(zkeyPath)
    const datInfo = await FileSystem.getInfoAsync(datPath)

    return zkeyInfo.exists && datInfo.exists
  }

  constructor(
    public name: string,

    public downloadUrl: string,

    public wtnsCalcMethod: (
      descriptionFileDataBase64: Uint8Array,
      privateInputsJsonBase64: Uint8Array,
    ) => Promise<Uint8Array>,
  ) {
    super(
      name,
      async opts => {
        opts?.onDownloadStart?.()

        try {
          const fileUri = `${FileSystem.documentDirectory}${name}.zip`
          const targetPath = `${FileSystem.documentDirectory}${name}`

          const circuitDirSubpath = `${name}-download`
          const zkeyPath = `${targetPath}/${circuitDirSubpath}/circuit_final.zkey`
          const datPath = `${targetPath}/${circuitDirSubpath}/${name}.dat`

          const isCircuitsLoaded = await ExternalCircomCircuitParams.#checkCircuitsLoaded(
            zkeyPath,
            datPath,
          )

          if (isCircuitsLoaded) {
            const dat = await FileSystem.readAsStringAsync(datPath, {
              encoding: FileSystem.EncodingType.Base64,
            })

            opts?.onLoaded?.()

            return {
              zkeyLocalUri: zkeyPath,
              datBytes: Buffer.from(dat, 'base64'),
            }
          }

          const downloadResumable = FileSystem.createDownloadResumable(
            downloadUrl,
            fileUri,
            {},
            downloadProgress => {
              opts?.onDownloadingProgress?.(downloadProgress)
            },
          )

          const downloadResult = await downloadResumable.downloadAsync()

          if (!downloadResult) {
            throw new TypeError('Download failed: downloadResult is undefined')
          }

          await unzip(downloadResult.uri, targetPath)

          const dat = await FileSystem.readAsStringAsync(datPath, {
            encoding: FileSystem.EncodingType.Base64,
          })

          opts?.onLoaded?.()

          return {
            zkeyLocalUri: zkeyPath,
            datBytes: Buffer.from(dat, 'base64'),
          }
        } catch (error) {
          console.error('Error in loadCircuit: ', error)
          opts?.onFailed?.(error instanceof Error ? error : new Error(String(error)))
        }

        throw new TypeError('Circuit loading failed without error')
      },
      wtnsCalcMethod,
    )
  }
}

export const supportedCircomCircuits: CircomCircuitParams[] = [
  // The original `auth` LocalCircomCircuitParams entry was removed: it
  // require()'d zkey/dat files at assets/circuits/auth/ which this app does
  // not bundle. The auth circuit isn't used by the Mainnet vote flow either
  // (that uses query_identity, driven directly via calcWtnsQueryIdentity in
  // utils/groth16-vote.ts — not via this registry).

  new ExternalCircomCircuitParams(
    'registerIdentity_1_256_3_5_576_248_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.0/registerIdentity_1_256_3_5_576_248_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_1_256_3_6_576_248_1_2432_5_296',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.0/registerIdentity_1_256_3_6_576_248_1_2432_5_296-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_2_256_3_6_336_264_21_2448_6_2008',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.0/registerIdentity_2_256_3_6_336_264_21_2448_6_2008-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_21_256_3_7_336_264_21_3072_6_2008',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.0/registerIdentity_21_256_3_7_336_264_21_3072_6_2008-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_1_256_3_6_576_264_1_2448_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.1/registerIdentity_1_256_3_6_576_264_1_2448_3_256-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_2_256_3_6_336_248_1_2432_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.1/registerIdentity_2_256_3_6_336_248_1_2432_3_256-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_2_256_3_6_576_248_1_2432_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.1/registerIdentity_2_256_3_6_576_248_1_2432_3_256-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),

  new ExternalCircomCircuitParams(
    'registerIdentity_11_256_3_3_576_248_1_1184_5_264',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.2/registerIdentity_11_256_3_3_576_248_1_1184_5_264-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_12_256_3_3_336_232_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.2/registerIdentity_12_256_3_3_336_232_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_1_256_3_4_336_232_1_1480_5_296',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.2/registerIdentity_1_256_3_4_336_232_1_1480_5_296-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_1_256_3_4_600_248_1_1496_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.8/registerIdentity_1_256_3_4_600_248_1_1496_3_256-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),

  new ExternalCircomCircuitParams(
    'registerIdentity_1_160_3_4_576_200_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.3/registerIdentity_1_160_3_4_576_200_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_21_256_3_3_336_232_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.3/registerIdentity_21_256_3_3_336_232_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_24_256_3_4_336_232_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.3/registerIdentity_24_256_3_4_336_232_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),

  new ExternalCircomCircuitParams(
    'registerIdentity_20_256_3_3_336_224_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.4/registerIdentity_20_256_3_3_336_224_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_1_256_3_3_576_248_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.4/registerIdentity_1_256_3_3_576_248_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_1_160_3_3_576_200_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.4/registerIdentity_1_160_3_3_576_200_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_10_256_3_3_576_248_1_1184_5_264',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.5/registerIdentity_10_256_3_3_576_248_1_1184_5_264-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_11_256_3_5_576_248_1_1808_4_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.5/registerIdentity_11_256_3_5_576_248_1_1808_4_256-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_21_256_3_3_576_232_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.5/registerIdentity_21_256_3_3_576_232_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),

  new ExternalCircomCircuitParams(
    'registerIdentity_3_160_3_3_336_200_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.7-fix/registerIdentity_3_160_3_3_336_200_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_3_160_3_4_576_216_1_1512_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.7-fix/registerIdentity_3_160_3_4_576_216_1_1512_3_256-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_2_256_3_6_336_264_1_2448_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.7-fix/registerIdentity_2_256_3_6_336_264_1_2448_3_256-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),

  new ExternalCircomCircuitParams(
    'registerIdentity_21_256_3_4_576_232_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.8/registerIdentity_21_256_3_4_576_232_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_11_256_3_3_576_240_1_864_5_264',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.8/registerIdentity_11_256_3_3_576_240_1_864_5_264-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),

  new ExternalCircomCircuitParams(
    'registerIdentity_11_256_3_5_576_248_1_1808_5_296',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.9/registerIdentity_11_256_3_5_576_248_1_1808_5_296-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),

  new ExternalCircomCircuitParams(
    'registerIdentity_11_256_3_3_336_248_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.10/registerIdentity_11_256_3_3_336_248_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_14_256_3_4_336_64_1_1480_5_296',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.10/registerIdentity_14_256_3_4_336_64_1_1480_5_296-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_21_256_3_5_576_232_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.10/registerIdentity_21_256_3_5_576_232_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),

  new ExternalCircomCircuitParams(
    'registerIdentity_1_256_3_6_336_560_1_2744_4_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.11/registerIdentity_1_256_3_6_336_560_1_2744_4_256-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_1_256_3_6_336_248_1_2744_4_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.11/registerIdentity_1_256_3_6_336_248_1_2744_4_256-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_20_256_3_5_336_72_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.11/registerIdentity_20_256_3_5_336_72_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),

  new ExternalCircomCircuitParams(
    'registerIdentity_4_160_3_3_336_216_1_1296_3_256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.12/registerIdentity_4_160_3_3_336_216_1_1296_3_256-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_15_512_3_3_336_248_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.12/registerIdentity_15_512_3_3_336_248_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentity_20_160_3_3_736_200_NA',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.12/registerIdentity_20_160_3_3_736_200_NA-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),

  new ExternalCircomCircuitParams(
    'registerIdentityLight160',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.6-light/registerIdentityLight160-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentityLight224',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.6-light/registerIdentityLight224-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentityLight256',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.6-light/registerIdentityLight256-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentityLight384',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.6-light/registerIdentityLight384-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
  new ExternalCircomCircuitParams(
    'registerIdentityLight512',
    'https://storage.googleapis.com/rarimo-store/passport-zk-circuits/v0.2.6-light/registerIdentityLight512-download.zip',
    WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048,
  ),
]

export async function calcWtnsAuth(
  descriptionFileDataBase64: Uint8Array,
  privateInputsJsonBase64: Uint8Array,
): Promise<Uint8Array> {
  return await WitnesscalculatorModule.calcWtnsAuth(
    new Uint8Array(descriptionFileDataBase64),
    new Uint8Array(privateInputsJsonBase64),
  )
}

export async function calcWtnsRegisterIdentityUniversalRSA2048(
  descriptionFileDataBase64: Uint8Array,
  privateInputsJsonBase64: Uint8Array,
): Promise<Uint8Array> {
  return await WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA2048(
    new Uint8Array(descriptionFileDataBase64),
    new Uint8Array(privateInputsJsonBase64),
  )
}

export async function calcWtnsRegisterIdentityUniversalRSA4096(
  descriptionFileDataBase64: Uint8Array,
  privateInputsJsonBase64: Uint8Array,
): Promise<Uint8Array> {
  return await WitnesscalculatorModule.calcWtnsRegisterIdentityUniversalRSA4096(
    new Uint8Array(descriptionFileDataBase64),
    new Uint8Array(privateInputsJsonBase64),
  )
}
