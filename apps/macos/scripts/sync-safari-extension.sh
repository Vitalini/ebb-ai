#!/bin/sh
# Builds the extension's safari target (apps/extension/dist/safari) and copies
# it into SafariExtension/Resources/, which the "Tidegap Safari Extension"
# target bundles. build.sh runs it first; run it by hand before building in
# Xcode. Needs Node 22 or later, no npm install.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
ext="$here/../../extension"
dest="$here/../SafariExtension/Resources"

node "$ext/scripts/build.mjs" safari >/dev/null
rm -rf "$dest"
mkdir -p "$dest"
ditto "$ext/dist/safari" "$dest"

# The Resources group in project.pbxproj lists each folder (explicitFolders);
# a folder missing there would ship flattened into the appex.
for dir in "$dest"/*/; do
  name="$(basename "$dir")"
  if ! grep -Eq "^[[:space:]]+$name,\$" "$here/../Tidegap.xcodeproj/project.pbxproj"; then
    echo "sync-safari-extension: add $name to explicitFolders of the Resources group in project.pbxproj" >&2
    exit 1
  fi
done
echo "synced: $dest"
