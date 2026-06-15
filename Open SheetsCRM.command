#!/bin/bash
# Run in this Terminal window only — do not spawn a second window via osascript.
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec bash "$ROOT/scripts/run-sheetscrm.sh"
