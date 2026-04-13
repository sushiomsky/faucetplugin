#!/bin/bash
set -e

# Build configuration for FaucetPick
BUILD_DIR="release_staging"
MANIFEST_FILE="manifest.json"

# Extract version from manifest
VERSION=$(grep '"version":' "$MANIFEST_FILE" | head -1 | awk -F '"' '{print $4}')
ZIP_NAME="faucet-pro-v$VERSION.zip"

echo "🚀 Starting build for FaucetPick v$VERSION..."

# Clean old artifacts
rm -rf "$BUILD_DIR"
rm -f "$ZIP_NAME"

# Create staging area
mkdir -p "$BUILD_DIR"

# Define WHITELIST of essential files
# Pruned for v2.7.9: removed auth.js, captcha.js (unused by manifest)
FILES=(
  "manifest.json"
  "version.json"
  "background.js"
  "content.js"
  "constants.js"
  "crypto-utils.js"
  "dice.js"
  "faucet.js"
  "selectors.js"
  "utils.js"
  "withdraw.js"
  "popup.html"
  "popup.js"
  "popup.css"
  "setup.html"
  "setup.js"
)

echo "📦 Copying essential files (Whitelist Mode)..."
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    cp "$f" "$BUILD_DIR/"
  else
    echo "⚠️ Warning: File $f not found!"
  fi
done

# Copy icons directory
if [ -d "icons" ]; then
    echo "🖼️  Copying icons..."
    cp -r "icons" "$BUILD_DIR/"
fi

# Cleanup staging area of common OS/Dev trash before zipping
echo "🧹 Cleaning staging area..."
find "$BUILD_DIR" -name ".DS_Store" -delete
find "$BUILD_DIR" -name "._*" -delete
find "$BUILD_DIR" -name "Thumbs.db" -delete

# Create zip from staging (to avoid including parent folder or hidden files)
echo "🔒 Packaging release zip..."
cd "$BUILD_DIR"
# Use -r for recursive, -X for no extras (metadata/extended attributes)
# Explicitly exclude hidden files from the root of the zip
zip -r -X "../$ZIP_NAME" ./* -x ".*" > /dev/null
cd ..

# Verification
if [ -f "$ZIP_NAME" ]; then
    echo "✅ Release created: $ZIP_NAME"
    echo "📊 Size: $(du -sh "$ZIP_NAME" | cut -f1)"
else
    echo "❌ Error: Failed to create zip."
    exit 1
fi

# Final Cleanup of staging
rm -rf "$BUILD_DIR"
