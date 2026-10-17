#!/bin/sh
# Builds Tidegap.app, quits a running copy, replaces ~/Applications/Tidegap.app
# and opens it. Arguments after `--` go to the app, for example:
#   apps/macos/scripts/install.sh -- -tidegapCommand "node $PWD/packages/cli/dist/index.js"
# INSTALL_DIR overrides the target folder (default: ~/Applications).
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
target_dir="${INSTALL_DIR:-$HOME/Applications}"
target="$target_dir/Tidegap.app"

if [ "${1:-}" = "--" ]; then shift; fi

"$here/build.sh"

if pgrep -x Tidegap >/dev/null 2>&1; then
  osascript -e 'tell application id "com.tidegap.mac" to quit' >/dev/null 2>&1 || true
  i=0
  while pgrep -x Tidegap >/dev/null 2>&1 && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  pkill -x Tidegap 2>/dev/null || true
fi

mkdir -p "$target_dir"
rm -rf "$target"
ditto "$here/../build/Tidegap.app" "$target"
echo "installed: $target"
if [ $# -gt 0 ]; then
  open "$target" --args "$@"
else
  open "$target"
fi
