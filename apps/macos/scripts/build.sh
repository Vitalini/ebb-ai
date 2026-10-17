#!/bin/sh
# Release build of Tidegap.app, ad-hoc signed, into apps/macos/build/.
# It embeds the Safari Web Extension, so it needs Node (sync-safari-extension.sh).
# Usage: apps/macos/scripts/build.sh
set -eu
cd "$(dirname "$0")/.."
scripts/sync-safari-extension.sh
xcodebuild \
  -project Tidegap.xcodeproj \
  -scheme Tidegap \
  -configuration Release \
  -derivedDataPath build/DerivedData \
  CODE_SIGN_IDENTITY=- \
  build
rm -rf build/Tidegap.app
ditto build/DerivedData/Build/Products/Release/Tidegap.app build/Tidegap.app
test -f "build/Tidegap.app/Contents/PlugIns/Tidegap Safari Extension.appex/Contents/Resources/manifest.json"
codesign --verify --deep --strict build/Tidegap.app
codesign -dv build/Tidegap.app 2>&1 | grep -E "^(Identifier|Signature)="
echo "built: $(pwd)/build/Tidegap.app"
