const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log("🔧 Checking for bitcode in OpenSSL framework...");

// Paths to OpenSSL libraries
const opensslPaths = [
  'ios/Pods/OpenSSL-Universal/ios/lib/libssl.a',
  'ios/Pods/OpenSSL-Universal/ios/lib/libcrypto.a',
];

let strippedCount = 0;

opensslPaths.forEach((libPath) => {
  const fullPath = path.join(__dirname, '..', libPath);

  if (!fs.existsSync(fullPath)) {
    console.log(`⏭️  Skipping ${libPath} (not found)`);
    return;
  }

  try {
    console.log(`🔧 Stripping bitcode from ${libPath}...`);
    execSync(
      `xcrun -sdk iphoneos bitcode_strip -r "${fullPath}" -o "${fullPath}"`,
      { stdio: 'inherit' }
    );
    strippedCount++;
  } catch (error) {
    console.warn(`⚠️  Could not strip bitcode from ${libPath}:`, error.message);
  }
});

if (strippedCount > 0) {
  console.log(`✅ Successfully stripped bitcode from ${strippedCount} file(s)`);
} else {
  console.log("ℹ️  No bitcode stripping performed");
}
