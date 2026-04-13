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
FILES=(
  "manifest.json"
  "version.json"
  "background.js"
  "content.js"
  "auth.js"
  "captcha.js"
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

echo "📦 Copying essential files..."
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

# Create zip from staging (to avoid including parent folder or hidden files)
echo "🔒 Packaging release zip..."
cd "$BUILD_DIR"
zip -r "../$ZIP_NAME" ./* > /dev/null
cd ..

# Verification
if [ -f "$ZIP_NAME" ]; then
    echo "✅ Release created: $ZIP_NAME"
    echo "📊 Size: $(du -sh "$ZIP_NAME" | cut -f1)"
else
    echo "❌ Error: Failed to create zip."
    exit 1
fi

# Cleanup
rm -rf "$BUILD_DIR"
