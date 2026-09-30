// QA web preview only (QA_WEB=1): stands in for native
// modules that have no web build (NFC, camera, the Rarimo prover, the chip
// reader). Every property is a function that resolves to nothing, so a screen
// that only imports them renders; anything that really needs them fails
// quietly, as on a device without the feature.
const noop = () => Promise.resolve(undefined);
const handler = {
  get(_t, key) {
    if (key === '__esModule') return true;
    if (key === 'default') return proxy;
    if (key === 'then') return undefined;
    return typeof key === 'string' && /^[A-Z]/.test(key) ? class {} : noop;
  },
};
const proxy = new Proxy({}, handler);
module.exports = proxy;
