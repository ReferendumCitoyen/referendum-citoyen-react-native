const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log("🔧 Stripping bitcode from OpenSSL framework...");

// Path to OpenSSL framework binary (the actual executable that contains bitcode)
const opensslBinaryPath = 'ios/Pods/OpenSSL-Universal/Frameworks/OpenSSL.xcframework/ios-arm64/OpenSSL.framework/OpenSSL';
const fullPath = path.join(__dirname, '..', opensslBinaryPath);

if (!fs.existsSync(fullPath)) {
  console.log(`⚠️  OpenSSL framework not found at ${opensslBinaryPath}`);
  console.log("ℹ️  This script should run after 'pod install' during EAS build");
  process.exit(0);
}

try {
  console.log(`🔧 Stripping bitcode from ${opensslBinaryPath}...`);
  execSync(
    `xcrun bitcode_strip -r "${fullPath}" -o "${fullPath}"`,
    { stdio: 'inherit' }
  );
  console.log(`✅ Successfully stripped bitcode from OpenSSL.framework`);
} catch (error) {
  console.error(`❌ Failed to strip bitcode from OpenSSL:`, error.message);
  process.exit(1);
}
