/**
 * Test-only loader for one file of the patched SDK build.
 *
 * The runtime executes node_modules/@rarimo/rarime-rn-sdk/build/*.js, which
 * are ES modules that jest's transform deliberately skips (node_modules). The
 * vote tests need to run the patched code itself, not a copy of it, so this
 * transpiles one file to CommonJS and evaluates it with the imports the test
 * chooses: anything in `mocks` is served from there, the rest from the real
 * module registry (ethers, @distributedlab/tools...).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';

export function loadSdkBuild(
  file: string,
  mocks: Record<string, unknown>,
  realRequire: (id: string) => unknown,
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const babel = require('@babel/core');
  const pkgDir = dirname(require.resolve('@rarimo/rarime-rn-sdk/package.json'));
  const path = join(pkgDir, 'build', file);
  const { code } = babel.transformSync(readFileSync(path, 'utf8'), {
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
    filename: path,
  });
  const module = { exports: {} as Record<string, any> };
  const req = (id: string) => (id in mocks ? mocks[id] : realRequire(id));
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', code)(req, module, module.exports);
  return module.exports;
}
