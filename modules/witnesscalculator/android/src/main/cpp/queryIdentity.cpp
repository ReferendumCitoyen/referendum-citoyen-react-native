/**
 * JNI wrapper for libwitnesscalc_queryIdentity.so.
 *
 * Why this exists: the prebuilt `libwitnesscalc_queryIdentity.so` (shipped in
 * jniLibs/arm64-v8a/, sourced from rarime-android-app's cpp/lib/) only
 * exports the plain C entrypoint `witnesscalc_queryIdentity(...)`. Kotlin's
 * `external fun` requires JNI-named symbols (Java_<package>_<class>_<method>)
 * so we cannot call the C entrypoint directly from Kotlin. This file bridges
 * the gap.
 *
 * Mirrors `rarimo/rarime-android-app/app/src/main/cpp/rarime.cpp`'s
 * `Java_com_rarilabs_rarime_util_ZkpUtil_queryIdentity` exactly — same
 * argument marshalling, same release pattern, same return semantics
 * (0 = OK, 1 = error, 2 = short buffer). The only difference is the JNI
 * symbol name, which has to match our package path.
 *
 * Symbol name expected by the Kotlin `external fun queryIdentity(...)` on
 * the `expo.modules.witnesscalculator.WitnesscalcQueryNative` class:
 *
 *   Java_expo_modules_witnesscalculator_WitnesscalcQueryNative_queryIdentity
 *
 * If you rename the Kotlin class, this JNI symbol must move in lockstep.
 */

#include <jni.h>
#include "witnesscalc_queryIdentity.h"

extern "C"
JNIEXPORT jint JNICALL
Java_expo_modules_witnesscalculator_WitnesscalcQueryNative_queryIdentity(
    JNIEnv *env,
    jobject /* thiz */,
    jbyteArray circuit_buffer,
    jlong circuit_size,
    jbyteArray json_buffer,
    jlong json_size,
    jbyteArray wtns_buffer,
    jlongArray wtns_size,
    jbyteArray error_msg,
    jlong error_msg_max_size
) {
    // Pin the JVM byte arrays so the native lib can read/write them directly.
    // Released below via SetByteArrayRegion / Release* calls.
    const char *circuitBuffer =
        reinterpret_cast<const char *>(env->GetByteArrayElements(circuit_buffer, nullptr));
    const char *jsonBuffer =
        reinterpret_cast<const char *>(env->GetByteArrayElements(json_buffer, nullptr));
    char *wtnsBuffer =
        reinterpret_cast<char *>(env->GetByteArrayElements(wtns_buffer, nullptr));
    char *errorMsg =
        reinterpret_cast<char *>(env->GetByteArrayElements(error_msg, nullptr));

    // wtns_size is in/out: caller pre-fills it with the wtns_buffer capacity,
    // witnesscalc_queryIdentity overwrites with the actual bytes written on
    // success (or the required size on short-buffer error). The pointer
    // returned by GetLongArrayElements MUST be paired with a matching
    // ReleaseLongArrayElements call below or the JVM leaks the pinned array
    // (the previous implementation discarded the pointer after dereferencing
    // index 0 — silent JNI ref leak on every witness calc).
    jlong *wtnsSizePtr = env->GetLongArrayElements(wtns_size, nullptr);
    unsigned long wtnsSize = static_cast<unsigned long>(wtnsSizePtr[0]);

    int result = witnesscalc_queryIdentity(
        circuitBuffer, static_cast<unsigned long>(circuit_size),
        jsonBuffer, static_cast<unsigned long>(json_size),
        wtnsBuffer, &wtnsSize,
        errorMsg, static_cast<unsigned long>(error_msg_max_size));

    // Write back the new wtnsSize for the Kotlin caller and release the
    // pinned array. Using mode 0 (JNI_COMMIT + free) so the SetLongArrayRegion
    // below stays valid; that call writes directly to the JVM array.
    env->SetLongArrayRegion(wtns_size, 0, 1, reinterpret_cast<jlong *>(&wtnsSize));
    env->ReleaseLongArrayElements(wtns_size, wtnsSizePtr, 0);

    // JNI_ABORT (mode 2) for read-only inputs: skip the copy-back and just
    // free the pin. The native lib never writes through these pointers, so
    // a commit-back is wasted work and on devices that returned a copy
    // (rather than a direct pin) it would write potentially-stale bytes
    // over the Java array.
    env->ReleaseByteArrayElements(
        circuit_buffer, reinterpret_cast<jbyte *>(const_cast<char *>(circuitBuffer)), JNI_ABORT);
    env->ReleaseByteArrayElements(
        json_buffer, reinterpret_cast<jbyte *>(const_cast<char *>(jsonBuffer)), JNI_ABORT);
    // wtns_buffer and error_msg are out parameters — must commit (mode 0).
    env->ReleaseByteArrayElements(wtns_buffer, reinterpret_cast<jbyte *>(wtnsBuffer), 0);
    env->ReleaseByteArrayElements(error_msg, reinterpret_cast<jbyte *>(errorMsg), 0);

    return result;
}
