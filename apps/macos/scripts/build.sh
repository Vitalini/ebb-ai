#!/bin/sh
# Release build of Tidegap.app, ad-hoc signed, into apps/macos/build/.
# Usage: apps/macos/scripts/build.sh
set -eu
cd "$(dirname "$0")/.."
xcodebuild \
  -project Tidegap.xcodeproj \
  -scheme Tidegap \
  -configuration Release \
  -derivedDataPath build/DerivedData \
  CODE_SIGN_IDENTITY=- \
  build
rm -rf build/Tidegap.app
ditto build/DerivedData/Build/Products/Release/Tidegap.app build/Tidegap.app
codesign -dv build/Tidegap.app 2>&1 | grep -E "^(Identifier|Signature)="
echo "built: $(pwd)/build/Tidegap.app"
