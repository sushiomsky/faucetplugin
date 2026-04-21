#!/bin/bash
# bump.sh — Automatic Version Synchronization
set -e

if [ -z "$1" ]; then
  echo "Usage: ./bump.sh <new_version>"
  exit 1
fi

NEW_VERSION=$1
echo "🚀 Bumping project version to v$NEW_VERSION..."

# 1. Update manifest.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" manifest.json
echo "✓ Updated manifest.json"

# 2. Update version.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" version.json
# Also update the download URL pattern in version.json
sed -i '' "s/faucet-pro-v.*\.zip/faucet-pro-v$NEW_VERSION\.zip/" version.json
echo "✓ Updated version.json"

# 3. Update popup.html (Title and H1)
sed -i '' "s/v[0-9]\{1,\}\.[0-9]\{1,\}\.[0-9]\{1,\}/v$NEW_VERSION/g" popup.html
echo "✓ Updated popup.html"

# 4. Update tests/stubs/chrome.js
if [ -f "tests/stubs/chrome.js" ]; then
  sed -i '' "s/version: '.*'/version: '$NEW_VERSION'/" tests/stubs/chrome.js
  echo "✓ Updated tests/stubs/chrome.js"
fi

echo "✅ All files synchronized to v$NEW_VERSION"
