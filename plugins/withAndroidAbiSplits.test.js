/**
 * The 32 bit lock. The plugin must leave Gradle with exactly one ABI,
 * arm64-v8a, on BOTH knobs the React Native Gradle plugin unions together
 * (see the header of withAndroidAbiSplits.js). A regression on either knob
 * ships an armeabi-v7a split without libnoir_java.so again.
 */
const { parsePropertiesFile, propertiesListToString } =
  require('@expo/config-plugins/build/android/Properties');
const plugin = require('./withAndroidAbiSplits');

// The relevant lines of app/build.gradle as `expo prebuild` (SDK 54) emits it.
const BUILD_GRADLE = `android {
    namespace 'fr.referendumcitoyen.app'
    defaultConfig {
        applicationId 'fr.referendumcitoyen.app'
        minSdkVersion rootProject.ext.minSdkVersion
    }
}
`;

// The relevant lines of gradle.properties as the SDK 54 template ships them
// (expo-template-bare-minimum 54.0.53, line 31): all four ABIs.
const TEMPLATE_PROPERTIES = `# ./gradlew <task> -PreactNativeArchitectures=x86_64
reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64

# Use this property to enable support to the new architecture.
newArchEnabled=true
`;

describe('withAndroidAbiSplits: knob 1, ndk.abiFilters in app/build.gradle', () => {
  it('injects a single arm64-v8a filter inside defaultConfig', () => {
    const out = plugin.inject(BUILD_GRADLE);
    const defaultConfigAt = out.indexOf('defaultConfig {');
    const ndkAt = out.indexOf("abiFilters 'arm64-v8a'");
    const applicationIdAt = out.indexOf('applicationId');
    expect(ndkAt).toBeGreaterThan(defaultConfigAt);
    expect(ndkAt).toBeLessThan(applicationIdAt);
    expect(out.match(/abiFilters/g)).toHaveLength(1);
    expect(out).not.toMatch(/armeabi|x86/);
  });

  it('is idempotent under prebuild --clean re-runs', () => {
    const once = plugin.inject(BUILD_GRADLE);
    expect(plugin.inject(once)).toBe(once);
  });
});

describe('withAndroidAbiSplits: knob 2, reactNativeArchitectures in gradle.properties', () => {
  it("replaces the template's four ABIs with arm64-v8a, in place", () => {
    const props = plugin.setArchitectures(parsePropertiesFile(TEMPLATE_PROPERTIES));
    const text = propertiesListToString(props);
    expect(text).toMatch(/^reactNativeArchitectures=arm64-v8a$/m);
    // No property value names another ABI (the template's comment line
    // legitimately mentions x86_64 and must survive untouched).
    const values = props.filter((p) => p.type === 'property').map((p) => p.value);
    expect(values.join('\n')).not.toMatch(/armeabi|x86/);
    // Only that one line changed.
    expect(text).toContain('# ./gradlew <task> -PreactNativeArchitectures=x86_64');
    expect(text).toContain('newArchEnabled=true');
    expect(text.split('\n')).toHaveLength(TEMPLATE_PROPERTIES.split('\n').length);
  });

  it('adds the property when a future template drops it', () => {
    const props = plugin.setArchitectures(parsePropertiesFile('newArchEnabled=true\n'));
    const text = propertiesListToString(props);
    expect(text).toMatch(/^reactNativeArchitectures=arm64-v8a$/m);
    expect(text.match(/reactNativeArchitectures=/g)).toHaveLength(1);
  });
});

describe('withAndroidAbiSplits: both mods are registered', () => {
  it('registers the appBuildGradle and the gradleProperties mods', () => {
    const config = plugin({ name: 'x', slug: 'x' });
    expect(typeof config.mods.android.appBuildGradle).toBe('function');
    expect(typeof config.mods.android.gradleProperties).toBe('function');
  });
});
