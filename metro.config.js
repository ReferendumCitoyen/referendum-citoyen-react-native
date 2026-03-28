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

// Force resolution of packages that don't have React Native exports
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Use browser export for @iden3/js-crypto on iOS/Android
  if (moduleName === '@iden3/js-crypto') {
    return {
      filePath: path.resolve(__dirname, 'node_modules/@iden3/js-crypto/dist/browser/esm/index.js'),
      type: 'sourceFile',
    };
  }
  // Let Metro handle everything else
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
