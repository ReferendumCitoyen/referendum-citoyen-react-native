package expo.modules.witnesscalculator

/**
 * JNI binding for the `query_identity` witness calculator.
 *
 * The class name + method name here are part of the contract with
 * `src/main/cpp/queryIdentity.cpp` — the JNI symbol exported there is
 * `Java_expo_modules_witnesscalculator_WitnesscalcQueryNative_queryIdentity`.
 * If you rename either side, the link breaks at runtime with
 * UnsatisfiedLinkError on first invocation.
 *
 * The `companion object`'s `loadLibrary("witnesscalc_queryIdentity_jni")`
 * resolves to `libwitnesscalc_queryIdentity_jni.so`, the small shim
 * compiled from queryIdentity.cpp. That shim's NEEDED list includes
 * `libwitnesscalc_queryIdentity.so` (the heavy prebuilt witness calc lib
 * in jniLibs/), so loading the wrapper transitively loads the calculator.
 *
 * Used only by the Mainnet vote flow (Groth16 query proof). The
 * existing `WitnesscalculatorModule` AsyncFunctions for
 * registerIdentity/auth use a different .aar-bundled native binding.
 */
class WitnesscalcQueryNative {
    companion object {
        init {
            System.loadLibrary("witnesscalc_queryIdentity_jni")
        }
    }

    /**
     * Invoke the witness calculator for `query_identity`.
     *
     * @param circuitBuffer the .dat file bytes (assets/circuits/query_identity.dat)
     * @param circuitSize circuitBuffer.size as Long
     * @param jsonBuffer the inputs JSON bytes (from buildQueryIdentityInputs)
     * @param jsonSize jsonBuffer.size as Long
     * @param wtnsBuffer pre-allocated output buffer (caller picks the size,
     *                   usually 100 MiB; on success the calculator writes the
     *                   witness data into the prefix and sets wtnsSize[0] to
     *                   the byte count written)
     * @param wtnsSize 1-element long array: in = wtnsBuffer.size, out = bytes used
     * @param errorMsg pre-allocated 256-byte error buffer
     * @param errorMsgMaxSize errorMsg.size as Long
     * @return 0 = OK, 1 = error (errorMsg is filled), 2 = short buffer
     *         (wtnsSize[0] holds the required size)
     */
    external fun queryIdentity(
        circuitBuffer: ByteArray,
        circuitSize: Long,
        jsonBuffer: ByteArray,
        jsonSize: Long,
        wtnsBuffer: ByteArray,
        wtnsSize: LongArray,
        errorMsg: ByteArray,
        errorMsgMaxSize: Long,
    ): Int
}
