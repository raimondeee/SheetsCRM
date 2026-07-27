#!/bin/bash
# Patch this SheetsCRM install from a newer unzipped share folder.
# Preserves .env and local data. Run from the existing install, not the update zip alone.
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec bash "$ROOT/scripts/update-local-install.sh" "$@"
