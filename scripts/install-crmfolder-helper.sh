#!/bin/bash
# Create the standard attachments folder and register the crmfolder:// helper app.
# Idempotent — safe to run from Install SheetsCRM.command and Open SheetsCRM.command.
set -euo pipefail

ATTACHMENTS_DIR="${HOME}/Documents/SheetsCRM-Attachments"
SUPPORT_DIR="${HOME}/Library/Application Support/SheetsCRM"
APP_NAME="SheetsCRM Folder Opener.app"
APP_PATH="${SUPPORT_DIR}/${APP_NAME}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_SCRIPT="${SCRIPT_DIR}/crmfolder-opener.applescript"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "crmfolder helper is macOS-only; skipping."
  exit 0
fi

mkdir -p "$ATTACHMENTS_DIR"
mkdir -p "$SUPPORT_DIR"

if [ ! -f "$SOURCE_SCRIPT" ]; then
  echo "Missing $SOURCE_SCRIPT" >&2
  exit 1
fi

TMP_APP="$(mktemp -d)/${APP_NAME}"
osacompile -o "$TMP_APP" "$SOURCE_SCRIPT"

PLIST="${TMP_APP}/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.sheetscrm.folder-opener" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.sheetscrm.folder-opener" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleName SheetsCRM Folder Opener" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleName string SheetsCRM Folder Opener" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST"

# Replace URL types (idempotent rebuilds).
/usr/libexec/PlistBuddy -c "Delete :CFBundleURLTypes" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string SheetsCRM Folder" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string crmfolder" "$PLIST"

rm -rf "$APP_PATH"
mv "$TMP_APP" "$APP_PATH"

if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -f "$APP_PATH" >/dev/null 2>&1 || true
fi

# Nudge Launch Services to bind crmfolder:// (on run is a silent no-op).
open -ga "$APP_PATH" >/dev/null 2>&1 || true

echo "Attachments folder: $ATTACHMENTS_DIR"
echo "Finder opener:      $APP_PATH (crmfolder://)"
