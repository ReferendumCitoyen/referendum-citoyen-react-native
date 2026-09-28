const os = require('os');
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Node < 18.17 lacks os.availableParallelism; Metro expects it.
if (typeof os.availableParallelism !== 'function') {
  os.availableParallelism = () => (os.cpus() ? os.cpus().length : 1);
}

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  crypto: require.resolve('crypto-browserify'),
  stream: require.resolve('readable-stream'),
  buffer: require.resolve('buffer'),
};

// Groth16 vote flow needs to load:
//   - .dat (cpp witnesscalc binary descriptor, assets/circuits/query_identity.dat)
//   - .zkey (Groth16 zkey — too big to bundle, downloaded at runtime)
// CSCA bootstrap (utils/icao-master-tree.ts) needs:
//   - .pem (ICAO master list bundle, assets/certificates/master_000316.pem)
// None are in Metro's default assetExts, so require() of these files would
// throw "Unable to resolve module" without this.
config.resolver.assetExts = [...config.resolver.assetExts, 'zkey', 'dat', 'pem'];

// Force resolution of packages that don't have React Native exports.
// @iden3/js-crypto only ships browser ESM — point Metro at that bundle so the
// SDK (which imports it transitively from RarimePassport / Rarime.ts) works
// without an "Unable to resolve module" error at app start.
// QA web preview only (QA_WEB=1 npx expo export --platform web):
// native-only modules resolve to stubs on web. Inert for
// every native build and for a web build without QA_WEB.
const QA_WEB_STUBS =
  process.env.QA_WEB === '1'
    ? {
        'lottie-react-native': 'qa/web-stubs/lottie-react-native.js',
        'react-native-nfc-manager': 'qa/web-stubs/native-module.js',
        'react-native-vision-camera': 'qa/web-stubs/native-module.js',
        'react-native-vision-camera-text-recognition': 'qa/web-stubs/native-module.js',
        'react-native-worklets-core': 'qa/web-stubs/native-module.js',
        '@rarimo/rarime-rn-sdk': 'qa/web-stubs/native-module.js',
        'react-native-mmkv': 'qa/web-stubs/native-module.js',
      }
    : {};

// The QA gallery is kept OUT of the store app's binary, not merely disabled in
// it (audit item C6). The rule, and why it is scoped to the store release
// bundle only, lives in qa/bundle-exclusion.js so that it can be tested
// without loading Metro.
const { applyQaGalleryExclusion } = require('./qa/bundle-exclusion.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && QA_WEB_STUBS[moduleName]) {
    return { filePath: path.resolve(__dirname, QA_WEB_STUBS[moduleName]), type: 'sourceFile' };
  }
  if (platform === 'web' && process.env.QA_WEB === '1') {
    if (/modules\/e-document\/src\/EDocumentModule$/.test(moduleName)) {
      return { filePath: path.resolve(__dirname, 'qa/web-stubs/native-module.js'), type: 'sourceFile' };
    }
    const wrapper = path.resolve(__dirname, 'qa/web-stubs/expo-modules-core.js');
    if (moduleName === 'expo-modules-core' && context.originModulePath !== wrapper) {
      return { filePath: wrapper, type: 'sourceFile' };
    }
    // tslib's ESM entry destructures a default export Metro's web interop
    // does not provide: use its CommonJS build.
    if (moduleName === 'tslib') {
      return { filePath: path.resolve(__dirname, 'node_modules/tslib/tslib.js'), type: 'sourceFile' };
    }
    if (moduleName.startsWith('@rarimo/rarime-rn-sdk/')) {
      return { filePath: path.resolve(__dirname, 'qa/web-stubs/native-module.js'), type: 'sourceFile' };
    }
    if (/utils\/font-scale-cap$/.test(moduleName)) {
      return { filePath: path.resolve(__dirname, 'qa/web-stubs/font-scale-cap.js'), type: 'sourceFile' };
    }
  }
  if (moduleName === '@iden3/js-crypto') {
    return {
      filePath: path.resolve(__dirname, 'node_modules/@iden3/js-crypto/dist/browser/esm/index.js'),
      type: 'sourceFile',
    };
  }
  return applyQaGalleryExclusion(
    context.resolveRequest(context, moduleName, platform),
    platform,
  );
};

module.exports = config;
