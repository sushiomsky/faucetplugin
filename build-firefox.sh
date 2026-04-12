#!/bin/bash
set -e

echo "Building Firefox version of FaucetPick..."

BUILD_DIR="faucetplugin-firefox-build"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Read version from manifest
VERSION=$(cat manifest.json | grep '"version"' | head -1 | awk -F '"' '{print $4}')
echo "Detected version: $VERSION"

# Files and directories to include
FILES=(
  "auth.js"
  "background.js"
  "captcha.js"
  "constants.js"
  "content.js"
  "crypto-utils.js"
  "dice.js"
  "faucet.js"
  "popup.css"
  "popup.html"
  "popup.js"
  "selectors.js"
  "setup.html"
  "setup.js"
  "utils.js"
  "version.json"
  "withdraw.js"
)

DIRS=(
  "icons"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    cp "$file" "$BUILD_DIR/"
  else
    echo "Warning: Could not find file $file"
  fi
done

for dir in "${DIRS[@]}"; do
  if [ -d "$dir" ]; then
    cp -r "$dir" "$BUILD_DIR/"
  else
    echo "Warning: Could not find directory $dir"
  fi
done

# Copy firefox manifest
cp manifest-firefox.json "$BUILD_DIR/manifest.json"

# Zip it up
ZIP_FILE="faucet-pro-v$VERSION-firefox.zip"
rm -f "$ZIP_FILE"
cd "$BUILD_DIR"
zip -r "../$ZIP_FILE" ./* > /dev/null
cd ..

# Clean up build dir
rm -rf "$BUILD_DIR"

echo "Build complete: $ZIP_FILE"
