package expo.modules.witnesscalculator

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WitnesscalculatorModule : Module() {
  // Each module class must implement the definition function. The definition consists of components
  // that describes the module's functionality and behavior.
  // See https://docs.expo.dev/modules/module-api for more details about available components.
  override fun definition() = ModuleDefinition {
    // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
    // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
    // The module will be accessible from `requireNativeModule('Witnesscalculator')` in JavaScript.
    Name("Witnesscalculator")

    // Witness calculator for the `query_identity` Groth16 circuit used by
    // the Mainnet vote flow. We shim it ourselves via WitnesscalcQueryNative
    // (which JNI-binds the prebuilt libwitnesscalc_queryIdentity.so in
    // jniLibs/<ABI>/).
    //
    // The register/auth witness calculators that previously lived here
    // (backed by RmoCalcs.aar's com.example.rmocalcs.WtnsUtils) were removed:
    // registration now runs through the Rarime SDK's Noir module, so the
    // Groth16 register/auth path was dead code. Dropping RmoCalcs.aar also
    // removed four 4 KB-aligned prebuilts that blocked Android 15+ 16 KB
    // page-size compatibility.
    AsyncFunction("calcWtnsQueryIdentity") { dat: ByteArray, inputs: ByteArray ->
      val witnessCalculator = WtnsCalculator()
      val native = WitnesscalcQueryNative()
      val res = witnessCalculator.calculateWtns(dat, inputs, native::queryIdentity)
      return@AsyncFunction res
    }
  }
}

class WtnsCalculator {
  companion object {
    // First-pass witness buffer size. The old code hardcoded 100 MiB (copied
    // from Rarimo's reference app as a fits-any-circuit constant), but a Java
    // ByteArray is zero-filled and fully committed against the ART heap
    // growth limit — on low-RAM devices the single 100 MiB allocation OOMs
    // before any computation starts (seen in production error reports with
    // "74MB until OOM" at the vote step). 32 MiB fits that headroom and is
    // expected to cover query_identity comfortably; if it ever falls short,
    // the native lib tells us the exact size and we retry once (see below).
    // iOS keeps its 100 MB constant: it allocates with UnsafeMutablePointer
    // (native malloc, lazy page commit, no growth limit), so it isn't at risk.
    private const val INITIAL_WTNS_BUFFER_SIZE = 32L * 1024 * 1024

    private const val WITNESSCALC_OK = 0
    private const val WITNESSCALC_ERROR = 1
    private const val WITNESSCALC_ERROR_SHORT_BUFFER = 2
  }

  fun calculateWtns(
    datFile: ByteArray,
    inputs: ByteArray,
    wtnsCalcFunction: (
      circuitBuffer: ByteArray,
      circuitSize: Long,
      jsonBuffer: ByteArray,
      jsonSize: Long,
      wtnsBuffer: ByteArray,
      wtnsSize: LongArray,
      errorMsg: ByteArray,
      errorMsgMaxSize: Long
    ) -> Int
  ): ByteArray {
    val msg = ByteArray(256)
    var capacity = INITIAL_WTNS_BUFFER_SIZE

    // Two-pass adaptive sizing per the witnesscalc C API contract
    // (witnesscalc_queryIdentity.h): on WITNESSCALC_ERROR_SHORT_BUFFER the
    // lib writes the minimum required size into wtnsSize[0], so the second
    // attempt allocates exactly that. Costs one repeated native compute
    // (~1–3 s) in the rare short-buffer case; saves ~70 MiB of committed
    // Java heap in the common case.
    repeat(2) {
      if (capacity > Int.MAX_VALUE) {
        throw Exception("wtns buffer required size $capacity exceeds ByteArray limit")
      }
      val witnessLen = longArrayOf(capacity)
      val byteArr = try {
        ByteArray(capacity.toInt())
      } catch (e: OutOfMemoryError) {
        // Surface the byte count instead of a raw ART OOM so production
        // error reports say *what* didn't fit.
        throw Exception("Not enough memory to allocate $capacity byte wtns buffer")
      }

      val res = wtnsCalcFunction(
        datFile,
        datFile.size.toLong(),
        inputs,
        inputs.size.toLong(),
        byteArr,
        witnessLen,
        msg,
        256
      )

      when (res) {
        WITNESSCALC_OK -> {
          val len = witnessLen[0].toInt()
          // Skip the copy when the buffer is exact (always true on the
          // second pass) — the old unconditional copyOfRange doubled peak
          // memory by allocating the witness while the big buffer was live.
          return if (len == byteArr.size) byteArr else byteArr.copyOfRange(0, len)
        }
        WITNESSCALC_ERROR_SHORT_BUFFER -> {
          android.util.Log.w(
            "Witnesscalculator",
            "wtns buffer short: $capacity < required ${witnessLen[0]} bytes; retrying exact-size"
          )
          capacity = witnessLen[0]
        }
        else -> throw Exception("Error during wtns calculation ${msg.decodeToString().substringBefore('\u0000')}")
      }
    }

    throw Exception("wtns calculation still short after exact-size retry ($capacity bytes)")
  }
}
