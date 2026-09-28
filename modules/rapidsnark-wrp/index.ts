// Import the native module. On web, it will be resolved to RapidsnarkWrp.web.ts
// and on native platforms to RapidsnarkWrp.ts

import RapidsnarkWrpModule from './src/RapidsnarkWrpModule'

// io.iden3:rapidsnark beta.5 dropped the byte-array-zkey variant of
// groth16Prove; only the file-path form survives. The previously-exported
// `groth16Prove(wtns, zkey)` had no remaining JS callers and was removed.
export const groth16ProveWithZKeyFilePath = async (
  wtns: Uint8Array,
  zkeyFilePath: string,
  proofBufferSize?: number,
  publicBufferSize?: number,
  errorBufferSize?: number,
): Promise<Uint8Array> => {
  return await RapidsnarkWrpModule.groth16ProveWithZKeyFilePath(
    new Uint8Array(wtns),
    zkeyFilePath,
    proofBufferSize,
    publicBufferSize,
    errorBufferSize,
  )
}
