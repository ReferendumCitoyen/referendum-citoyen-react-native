# CMakeLists for the queryIdentity JNI wrapper.
#
# Builds `libwitnesscalc_queryIdentity_jni.so` which the Kotlin
# `expo.modules.witnesscalculator.WitnesscalcQueryNative.queryIdentity` external
# fun loads via System.loadLibrary("witnesscalc_queryIdentity_jni").
#
# The prebuilt witnesscalc_queryIdentity.so (which actually does the
# witness calculation work) lives next to this wrapper in
# ../jniLibs/<ABI>/. We declare it as an IMPORTED library so CMake can link
# our wrapper against its `witnesscalc_queryIdentity(...)` symbol.
#
# Why two libs instead of one: the prebuilt is opaque (we don't have its
# source) and exports only the plain C entrypoint. JNI needs Java_*-named
# symbols, which we have to add in our own thin shim.

cmake_minimum_required(VERSION 3.18)
project(witnesscalc_queryIdentity_jni)

set(CMAKE_CXX_STANDARD 14)

# ANDROID_ABI is set by the Android Gradle Plugin per-architecture
# (arm64-v8a, armeabi-v7a, x86_64, x86). The jniLibs/ directory layout that
# bundles the prebuilt .so already matches this — we just point at it.
set(PREBUILT_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI})

# The actual witness calculator library, shipped as a prebuilt binary.
add_library(witnesscalc_queryIdentity_prebuilt SHARED IMPORTED)
set_target_properties(witnesscalc_queryIdentity_prebuilt PROPERTIES
    IMPORTED_LOCATION ${PREBUILT_DIR}/libwitnesscalc_queryIdentity.so
)

# Our JNI shim — compiled from queryIdentity.cpp, linked against the prebuilt
# witnesscalc library + the NDK's log + jni.
add_library(witnesscalc_queryIdentity_jni SHARED
    queryIdentity.cpp
)
target_include_directories(witnesscalc_queryIdentity_jni PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)
target_link_libraries(witnesscalc_queryIdentity_jni
    witnesscalc_queryIdentity_prebuilt
    log
)
