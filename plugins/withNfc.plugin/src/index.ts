import type { ExpoConfig } from '@expo/config'
import type { AndroidManifest, ConfigPlugin } from '@expo/config-plugins'
import { CodeGenerator, withAppBuildGradle, withMainActivity ,
  AndroidConfig,
  withAndroidManifest,
  withEntitlementsPlist,
  withInfoPlist,
} from '@expo/config-plugins'
import type { PluginConfigType } from 'expo-build-properties/build/pluginConfig'

const NFC_DISPATCH_TAG = 'withNfc:foreground-dispatch'

const NFC_READER = 'Interact with nearby NFC devices'

function withIosPermission(
  c: ExpoConfig,
  props: {
    nfcPermission?: boolean
  } = {},
) {
  const { nfcPermission } = props
  return withInfoPlist(c, config => {
    // https://developer.apple.com/documentation/bundleresources/information_property_list/nfcreaderusagedescription?language=objc
    config.modResults.NFCReaderUsageDescription =
      nfcPermission || config.modResults.NFCReaderUsageDescription || NFC_READER
    return config
  })
}

function addValuesToArray(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj: Record<string, any>,
  key: string,
  values: string[] | string | undefined,
) {
  if (!Array.isArray(values) || !values.length) {
    return obj
  }
  if (!Array.isArray(obj[key])) {
    obj[key] = []
  }
  // Add the required values
  obj[key].push(...values)

  // Remove duplicates
  obj[key] = [...new Set(obj[key])]

  // Prevent adding empty arrays to Info.plist or *.entitlements
  if (!obj[key].length) {
    delete obj[key]
  }

  return obj
}

function withIosNfcEntitlement(
  c: ExpoConfig,
  {
    includeNdefEntitlement = false,
  }: {
    includeNdefEntitlement?: boolean
  },
) {
  return withEntitlementsPlist(c, config => {
    // Add the required formats
    let entitlements = ['NDEF', 'TAG']
    if (includeNdefEntitlement === false) {
      entitlements = ['TAG']
    }
    config.modResults = addValuesToArray(
      config.modResults,
      'com.apple.developer.nfc.readersession.formats',
      entitlements,
    )

    return config
  })
}

function withIosNfcSelectIdentifiers(
  c: ExpoConfig,
  {
    selectIdentifiers,
  }: {
    selectIdentifiers?: string[]
  },
) {
  const ids = selectIdentifiers || [
    // AIDs
    'A000000018434D00',
    'A0000000180C000001634200',
    '5041524449532C4D41544952414E20',
    // DFs / EFs
    '3F00',
    '5100',
    '5040',
    '5000',
    '0303',

    // react-native-nfc-manager
    'D2760000850100',
    'D2760000850101',

    // inid ca
    'A000000018434D00',
    '80CA9F7F2D',
    '00A40000023F00',
    '00A40000025100',
    '00A4020C025040',
    '00A4000C023F00',
    '00A4000C025100',
    'A0000000180C000001634200',
    '00A40000025000',
    '00A4000C025000',
    '00A4020C020303',

    // e-doc
    'A0000002471001',
    'A0000002472001',
    'E80704007F00070302',
    'A000000167455349474E',
    'A0000002480100',
    'A0000002480200',
    'A0000002480300',
    'A00000045645444C2D3031',
  ]

  return withInfoPlist(c, config => {
    config.modResults = addValuesToArray(
      config.modResults,
      'com.apple.developer.nfc.readersession.iso7816.select-identifiers',
      ids,
    )
    return config
  })
}

function withIosNfcSystemCodes(
  c: ExpoConfig,
  {
    systemCodes,
  }: {
    systemCodes?: string[]
  },
) {
  return withInfoPlist(c, config => {
    // Add the user defined identifiers
    config.modResults = addValuesToArray(
      config.modResults,
      // https://developer.apple.com/documentation/bundleresources/information_property_list/systemcodes
      'com.apple.developer.nfc.readersession.felica.systemcodes',
      systemCodes || ['8005', '8008', '0003', 'fe00', '90b7', '927a', '12FC', '86a7'],
    )

    return config
  })
}

// FIXME: couldn't be chained with other similar configs
// const withNFCPassportReader: ConfigPlugin<PluginConfigType> = (c: ExpoConfig, props) => {
//   return withBuildProperties(c, {
//     ...props,
//     ios: {
//       ...props.ios,
//       extraPods: [
//         ...(props?.ios?.extraPods ?? []),
//         {
//           name: 'NFCPassportReader',
//           git: 'https://github.com/rarimo/NFCPassportReader.git',
//           commit: '4c463a687f59eb6cc5c7955af854c7d41295d54f',
//         },
//       ],
//     },
//   })
// }

function addNfcUsesFeatureTagToManifest(androidManifest: AndroidManifest) {
  if (!Array.isArray(androidManifest.manifest['uses-feature'])) {
    androidManifest.manifest['uses-feature'] = []
  }

  if (
    !androidManifest.manifest['uses-feature'].find(
      item => item.$['android:name'] === 'android.hardware.nfc',
    )
  ) {
    androidManifest.manifest['uses-feature']?.push({
      $: {
        'android:name': 'android.hardware.nfc',
        'android:required': 'true',
      },
    })
  }
  return androidManifest
}

function withCustomBuildGradle(config: ExpoConfig) {
  return withAppBuildGradle(config, async c => {
    if (c.modResults.language === 'groovy') {
      c.modResults.contents += `

    // this configuration is added by a custom expo mod (plugin) to resolve "Duplicate class org.bouncycastle.." error
    configurations {
        all*.exclude group: 'org.bouncycastle', module: 'bcprov-jdk15to18'
        all*.exclude group: 'org.bouncycastle', module: 'bcutil-jdk15to18'
    }
    `
    } else {
      throw new Error(
        "The 'withCustomBuildGradle' plugin is only compatible with Groovy gradle files.",
      )
    }
    return c
  })
}

const withNfcAndroidManifest: ConfigPlugin = c => {
  return withAndroidManifest(c, config => {
    config.modResults = addNfcUsesFeatureTagToManifest(config.modResults)

    return config
  })
}

// Expo's default Android template + transitive native modules pull in a set of
// permissions the app never uses (no overlay UI, no audio recording, no
// external-storage I/O on legacy SDKs). Leaving them declared in production
// is a real attack surface: SYSTEM_ALERT_WINDOW in particular lets an app
// draw on top of others, and is treated as sensitive by Play Protect and
// many MDMs. Strip them on every prebuild so a `--clean` regeneration can't
// silently re-introduce them.
const UNUSED_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
]

// Emit `<uses-permission … tools:node="remove"/>` for each unused permission
// rather than deleting the node. Deleting (the old AndroidConfig.Permissions.
// removePermissions approach) only strips the entry from *this* manifest — the
// manifest merger then freely re-introduces it from library manifests
// (expo-av pulls in RECORD_AUDIO / *_EXTERNAL_STORAGE, Play Services pulls in
// the install-referrer binding). The `tools:node="remove"` marker is the only
// thing the merger honours as "keep this out of the final APK". This also
// reinforces Expo's `android.blockedPermissions` instead of fighting it: this
// plugin runs last, so deleting nodes previously clobbered the very markers
// blockedPermissions had just added.
const withTrimmedPermissions: ConfigPlugin = c => {
  return withAndroidManifest(c, config => {
    const manifest = config.modResults.manifest
    // Ensure the `tools` namespace is declared so `tools:node` is valid.
    manifest.$ = manifest.$ || ({} as typeof manifest.$)
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools'
    }

    manifest['uses-permission'] = manifest['uses-permission'] || []
    const usesPermissions = manifest['uses-permission']

    for (const name of UNUSED_PERMISSIONS) {
      const existing = usesPermissions.find(p => p.$?.['android:name'] === name)
      if (existing) {
        existing.$['tools:node'] = 'remove'
      } else {
        usesPermissions.push({
          $: { 'android:name': name, 'tools:node': 'remove' },
        } as (typeof usesPermissions)[number])
      }
    }

    return config
  })
}

/**
 * Patch MainActivity.kt to enable NFC foreground dispatch while the app is in
 * the foreground. Without this, after the e-document module releases reader
 * mode (at the end of a scan, or while the user lifts their card), Android
 * dispatches stray TAG_DISCOVERED intents and opens its NFC app chooser.
 *
 * ANDROID-ONLY: `withMainActivity` targets `android/app/src/main/java/.../
 * MainActivity.kt`. iOS builds never see this — iOS NFC is handled entirely
 * by the e-document Swift module via CoreNFC.
 */
function withNfcForegroundDispatch(c: ExpoConfig): ExpoConfig {
  return withMainActivity(c, config => {
    if (config.modResults.language !== 'kt') {
      // The project currently uses Kotlin; leave Java untouched rather than
      // guessing at syntax differences.
      return config
    }

    let contents = config.modResults.contents

    // 1. Imports
    const importLines = [
      'import android.app.PendingIntent',
      'import android.nfc.NfcAdapter',
    ]
    for (const line of importLines) {
      if (!contents.includes(line)) {
        // Insert after the last existing `import` line to keep imports grouped.
        contents = contents.replace(
          /((?:^import [^\n]+\n)+)/m,
          (match) => match + line + '\n',
        )
      }
    }

    // 2. Class fields + onResume/onPause methods, inserted right after the
    //    `class MainActivity : ReactActivity() {` opening brace.
    const classBlock = `
  private var nfcAdapter: NfcAdapter? = null
  private var nfcPendingIntent: PendingIntent? = null

  override fun onResume() {
    super.onResume()
    try {
      nfcAdapter?.enableForegroundDispatch(this, nfcPendingIntent, null, null)
    } catch (_: Exception) {
      // Safe: activity may not be in the right state, or reader mode owns NFC.
    }
  }

  override fun onPause() {
    super.onPause()
    try {
      nfcAdapter?.disableForegroundDispatch(this)
    } catch (_: Exception) {
      // Nothing to disable if it wasn't enabled.
    }
  }
`
    const classMerge = CodeGenerator.mergeContents({
      src: contents,
      newSrc: classBlock,
      tag: `${NFC_DISPATCH_TAG}/class`,
      anchor: /class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{/,
      offset: 1,
      comment: '//',
    })
    contents = classMerge.contents

    // 3. Initialise the adapter + pending intent at the end of onCreate, after
    //    the existing `super.onCreate(null)` call.
    const onCreateInit = `
    nfcAdapter = NfcAdapter.getDefaultAdapter(this)
    val nfcIntent = android.content.Intent(this, javaClass).apply {
      addFlags(android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val nfcPiFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
      PendingIntent.FLAG_MUTABLE
    else
      0
    nfcPendingIntent = PendingIntent.getActivity(this, 0, nfcIntent, nfcPiFlags)`
    const onCreateMerge = CodeGenerator.mergeContents({
      src: contents,
      newSrc: onCreateInit,
      tag: `${NFC_DISPATCH_TAG}/onCreate`,
      anchor: /super\.onCreate\(null\)/,
      offset: 1,
      comment: '//',
    })
    contents = onCreateMerge.contents

    config.modResults.contents = contents
    return config
  })
}

// const addSPMDependenciesToMainTarget: ConfigPlugin<{
//   version?: string
//   commit?: string
//   repositoryUrl: string
//   repoName: string
//   productName: string
// }> = (config, options) =>
//   withXcodeProject(config, config => {
//     const { version, commit, repositoryUrl, repoName, productName } = options
//     const xcodeProject = config.modResults

//     // update XCRemoteSwiftPackageReference
//     const spmReferences = xcodeProject.hash.project.objects['XCRemoteSwiftPackageReference']

//     if (!spmReferences) {
//       xcodeProject.hash.project.objects['XCRemoteSwiftPackageReference'] = {}
//     }

//     const packageReferenceUUID = xcodeProject.generateUuid()

//     xcodeProject.hash.project.objects['XCRemoteSwiftPackageReference'][
//       `${packageReferenceUUID} /* XCRemoteSwiftPackageReference "${repoName}" */`
//     ] = {
//       isa: 'XCRemoteSwiftPackageReference',
//       repositoryURL: repositoryUrl,
//       ...(version && {
//         requirement: {
//           kind: 'upToNextMajorVersion',
//           minimumVersion: version,
//         },
//       }),
//       ...(commit && { commit }),
//     }

//     // update XCSwiftPackageProductDependency
//     const spmProducts = xcodeProject.hash.project.objects['XCSwiftPackageProductDependency']

//     if (!spmProducts) {
//       xcodeProject.hash.project.objects['XCSwiftPackageProductDependency'] = {}
//     }

//     const packageUUID = xcodeProject.generateUuid()

//     xcodeProject.hash.project.objects['XCSwiftPackageProductDependency'][
//       `${packageUUID} /* ${productName} */`
//     ] = {
//       isa: 'XCSwiftPackageProductDependency',
//       // from step before
//       package: `${packageReferenceUUID} /* XCRemoteSwiftPackageReference "${repoName}" */`,
//       productName: productName,
//     }

//     // update PBXProject
//     const projectId = Object.keys(xcodeProject.hash.project.objects['PBXProject']).at(0)

//     if (!xcodeProject.hash.project.objects['PBXProject'][projectId]['packageReferences']) {
//       xcodeProject.hash.project.objects['PBXProject'][projectId]['packageReferences'] = []
//     }

//     xcodeProject.hash.project.objects['PBXProject'][projectId]['packageReferences'] = [
//       ...xcodeProject.hash.project.objects['PBXProject'][projectId]['packageReferences'],
//       `${packageReferenceUUID} /* XCRemoteSwiftPackageReference "${repoName}" */`,
//     ]

//     // update PBXBuildFile
//     const frameworkUUID = xcodeProject.generateUuid()

//     xcodeProject.hash.project.objects['PBXBuildFile'][`${frameworkUUID}_comment`] =
//       `${productName} in Frameworks`
//     xcodeProject.hash.project.objects['PBXBuildFile'][frameworkUUID] = {
//       isa: 'PBXBuildFile',
//       productRef: packageUUID,
//       productRef_comment: productName,
//     }

//     // update PBXFrameworksBuildPhase
//     const buildPhaseId = Object.keys(
//       xcodeProject.hash.project.objects['PBXFrameworksBuildPhase'],
//     ).at(0)

//     if (!xcodeProject.hash.project.objects['PBXFrameworksBuildPhase'][buildPhaseId]['files']) {
//       xcodeProject.hash.project.objects['PBXFrameworksBuildPhase'][buildPhaseId]['files'] = []
//     }

//     xcodeProject.hash.project.objects['PBXFrameworksBuildPhase'][buildPhaseId]['files'] = [
//       ...xcodeProject.hash.project.objects['PBXFrameworksBuildPhase'][buildPhaseId]['files'],
//       `${frameworkUUID} /* ${productName} in Frameworks */`,
//     ]

//     return config
//   })

export const withNfc: ConfigPlugin<
  PluginConfigType & {
    includeNdefEntitlement?: boolean
    nfcPermission?: boolean
    selectIdentifiers?: string[]
    systemCodes?: string[]
  }
> = (config, props = {}) => {
  const { nfcPermission, selectIdentifiers, systemCodes, includeNdefEntitlement } = props
  config = withIosNfcEntitlement(config, { includeNdefEntitlement })
  config = withIosNfcSelectIdentifiers(config, { selectIdentifiers })
  config = withIosNfcSystemCodes(config, { systemCodes })
  config = withCustomBuildGradle(config)
  // config = addSPMDependenciesToMainTarget(config, {
  //   commit: '4c463a687f59eb6cc5c7955af854c7d41295d54f',
  //   repositoryUrl: 'https://github.com/rarimo/NFCPassportReader.git',
  //   repoName: 'NFCPassportReader',
  //   productName: 'NFCPassportReader',
  // })
  // config = withNFCPassportReader(config, props)

  // We start to support Android 12 from v3.11.1, and you will need to update compileSdkVersion to 31,
  // otherwise the build will fail:
  config = AndroidConfig.Version.withBuildScriptExtMinimumVersion(config, {
    name: 'compileSdkVersion',
    minVersion: 31,
  })

  if (nfcPermission !== false) {
    config = withIosPermission(config, props)
    config = AndroidConfig.Permissions.withPermissions(config, ['android.permission.NFC'])
    config = withNfcAndroidManifest(config)
    // Android-only: see the function's header comment. iOS builds never run
    // this mod because `withMainActivity` is a no-op outside Android.
    config = withNfcForegroundDispatch(config)
  }

  // Strip unused-but-declared Android permissions last so it overrides any
  // permission added earlier in the pipeline by Expo's defaults or other mods.
  config = withTrimmedPermissions(config)

  return config
}

export default withNfc
