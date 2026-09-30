// QA web preview only (QA_WEB=1): the real
// expo-modules-core, except that a native module with no web build (the
// prover, the witness calculator, the chip reader…) comes back as a stub
// instead of throwing at import time.
const real = require('expo-modules-core');
const stub = require('./native-module');
function requireNativeModule(name) {
  try {
    return real.requireNativeModule(name);
  } catch {
    return stub;
  }
}
module.exports = { ...real, requireNativeModule, requireOptionalNativeModule: (n) => requireNativeModule(n) };
