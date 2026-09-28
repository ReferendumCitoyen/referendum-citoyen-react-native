module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
    env: {
      // Jest only. Nineteen production modules load heavy dependencies with
      // `await import(...)` on purpose — the Rarime SDK, the provers, the
      // bundled circuits — so a voter on a light path never pays their
      // module-evaluation cost. Metro handles that natively; Jest runs in
      // Node's VM, which refuses a real dynamic import outside
      // --experimental-vm-modules with "A dynamic import callback was
      // invoked", and does so at CALL time, so any test that reaches one of
      // those lines fails regardless of what it mocked. This rewrites
      // `import()` to a promise-wrapped `require()` under test, which Jest's
      // module registry (and therefore jest.mock) understands. Production
      // bundles are not affected: this block applies when BABEL_ENV or
      // NODE_ENV is "test", which is what jest-expo sets.
      //
      // PROVENANCE, stated honestly: the plugin is NOT a direct devDependency.
      // It reaches node_modules via @rarimo/rarime-rn-sdk → expo-module-scripts
      // → @babel/preset-env (npm ls confirms), i.e. through the SDK's own dev
      // tooling. If a future SDK release drops expo-module-scripts, this line
      // resolves nothing and EVERY test suite fails at transform time with
      // "Cannot find module '@babel/plugin-transform-dynamic-import'". The fix
      // when that happens is one command:
      //   npm install --save-dev @babel/plugin-transform-dynamic-import@7.27.1
      // That was attempted at the time of writing and hung on the registry
      // fetch, so it was left transitive rather than left half-installed.
      test: {
        plugins: ['@babel/plugin-transform-dynamic-import'],
      },
    },
  };
};
