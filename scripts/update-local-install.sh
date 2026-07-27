#!/usr/bin/env bash
# Patch an existing local SheetsCRM install from a newer unzipped share folder.
#
# Preferred (after the install already has this script):
#   cd /path/to/existing-SheetsCRM
#   bash scripts/update-local-install.sh /path/to/SheetsCRM-share-new
#   # or double-click Update SheetsCRM.command and pick the new folder
#
# First update for an older install that lacks this script — run from the NEW zip:
#   bash scripts/update-local-install.sh --apply-to /path/to/existing-SheetsCRM
#
# Preserves on the install machine:
#   .env, overlay DB, market-managers.json, custom sounds, team-dashboard-sources.json
# Replaces application source / scripts / lockfile from the update package, then npm ci.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

pause_before_exit() {
  echo ""
  read -r -p "Press Enter to close…"
}

pick_update_folder() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo ""
    return
  fi
  osascript <<'APPLESCRIPT' 2>/dev/null || true
set theFolder to choose folder with prompt "Select the unzipped SheetsCRM update folder"
return POSIX path of theFolder
APPLESCRIPT
}

pick_install_folder() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo ""
    return
  fi
  osascript <<'APPLESCRIPT' 2>/dev/null || true
set theFolder to choose folder with prompt "Select your existing SheetsCRM install folder (to update)"
return POSIX path of theFolder
APPLESCRIPT
}

prefer_node22_on_path() {
  if [ -x /opt/homebrew/opt/node@22/bin/node ]; then
    PATH="/opt/homebrew/opt/node@22/bin:${PATH}"
    export PATH
  elif [ -x /usr/local/opt/node@22/bin/node ]; then
    PATH="/usr/local/opt/node@22/bin:${PATH}"
    export PATH
  fi
  hash -r 2>/dev/null || true
}

INSTALL_ROOT=""
UPDATE_SOURCE=""

if [[ "${1:-}" == "--apply-to" ]]; then
  # Running from the NEW package; first arg after flag is the existing install.
  UPDATE_SOURCE="$PACKAGE_ROOT"
  INSTALL_ROOT="${2:-}"
  if [[ -z "$INSTALL_ROOT" ]]; then
    INSTALL_ROOT="$(pick_install_folder | sed 's:/*$::')"
  fi
elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Update a local SheetsCRM install from a newer share folder."
  echo ""
  echo "From the existing install:"
  echo "  bash scripts/update-local-install.sh /path/to/unzipped-update"
  echo ""
  echo "From a new update zip (first time / older installs):"
  echo "  bash scripts/update-local-install.sh --apply-to /path/to/existing-install"
  pause_before_exit
  exit 0
else
  INSTALL_ROOT="$PACKAGE_ROOT"
  UPDATE_SOURCE="${1:-}"
  if [[ -z "$UPDATE_SOURCE" ]]; then
    UPDATE_SOURCE="$(pick_update_folder | sed 's:/*$::')"
  fi
fi

if [[ -z "${INSTALL_ROOT:-}" || -z "${UPDATE_SOURCE:-}" ]]; then
  echo "SheetsCRM update"
  echo ""
  echo "Usage:"
  echo "  bash scripts/update-local-install.sh /path/to/unzipped-update-folder"
  echo "  bash scripts/update-local-install.sh --apply-to /path/to/existing-install"
  echo ""
  echo "Or double-click Update SheetsCRM.command from the existing install."
  pause_before_exit
  exit 1
fi

INSTALL_ROOT="${INSTALL_ROOT/#\~/$HOME}"
UPDATE_SOURCE="${UPDATE_SOURCE/#\~/$HOME}"

if [[ ! -d "$INSTALL_ROOT" ]]; then
  echo "Install folder not found: $INSTALL_ROOT"
  pause_before_exit
  exit 1
fi
if [[ ! -d "$UPDATE_SOURCE" ]]; then
  echo "Update folder not found: $UPDATE_SOURCE"
  pause_before_exit
  exit 1
fi

INSTALL_ROOT="$(cd "$INSTALL_ROOT" && pwd)"
UPDATE_SOURCE="$(cd "$UPDATE_SOURCE" && pwd)"

if [[ "$UPDATE_SOURCE" == "$INSTALL_ROOT" ]]; then
  echo "The update folder is the same as the install folder."
  echo "Unzip the new share separately, then point at that folder."
  pause_before_exit
  exit 1
fi

if [[ ! -f "$UPDATE_SOURCE/package.json" ]] || [[ ! -f "$UPDATE_SOURCE/package-lock.json" ]]; then
  echo "That folder does not look like a SheetsCRM update package."
  echo "Expected package.json and package-lock.json in:"
  echo "  $UPDATE_SOURCE"
  pause_before_exit
  exit 1
fi

if [[ ! -f "$INSTALL_ROOT/package.json" ]]; then
  echo "That folder does not look like a SheetsCRM install:"
  echo "  $INSTALL_ROOT"
  pause_before_exit
  exit 1
fi

if [[ "$INSTALL_ROOT" == *" "* ]] || [[ "$UPDATE_SOURCE" == *" "* ]]; then
  echo "Paths with spaces can break native package installs."
  echo "Install:  $INSTALL_ROOT"
  echo "Update:   $UPDATE_SOURCE"
  echo "Rename folders to remove spaces, then retry."
  pause_before_exit
  exit 1
fi

cd "$INSTALL_ROOT"

echo "SheetsCRM update"
echo "Install:  $INSTALL_ROOT"
echo "Update:   $UPDATE_SOURCE"
echo ""
echo "This will replace app code/scripts from the update package."
echo "Kept on this Mac: .env, data/*.db, market-managers.json, custom sounds,"
echo "                  team-dashboard-sources.json"
echo ""
read -r -p "Continue? [y/N] " reply
if [[ ! "$reply" =~ ^[Yy]$ ]]; then
  echo "Update cancelled."
  pause_before_exit
  exit 1
fi

prefer_node22_on_path

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js / npm not found. Run Install SheetsCRM.command first."
  pause_before_exit
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ] || [ "$NODE_MAJOR" -gt 22 ]; then
  echo "Node.js $(node --version) is not supported (need v20–v22)."
  echo "Run Install SheetsCRM.command, or: brew install node@22"
  pause_before_exit
  exit 1
fi

BACKUP_DIR="$INSTALL_ROOT/data/update-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
if [[ -f "$INSTALL_ROOT/package.json" ]]; then
  cp "$INSTALL_ROOT/package.json" "$BACKUP_DIR/package.json"
fi
if [[ -f "$INSTALL_ROOT/package-lock.json" ]]; then
  cp "$INSTALL_ROOT/package-lock.json" "$BACKUP_DIR/package-lock.json"
fi
echo "Saved package.json / package-lock.json backup to:"
echo "  $BACKUP_DIR"
echo ""

echo "Copying update files…"
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.env.*.local' \
  --exclude 'data/*.db' \
  --exclude 'data/*.db-*' \
  --exclude 'data/market-managers.json' \
  --exclude 'data/custom-sounds' \
  --exclude 'data/team-dashboard-sources.json' \
  --exclude 'data/update-backups' \
  --exclude '.DS_Store' \
  --exclude 'coverage' \
  --exclude 'sheets-crm-tmp' \
  "$UPDATE_SOURCE/" "$INSTALL_ROOT/"

mkdir -p "$INSTALL_ROOT/data"

echo "Clearing Next.js build cache…"
rm -rf "$INSTALL_ROOT/.next"

echo "Reinstalling packages (Node $(node --version))…"
rm -rf "$INSTALL_ROOT/node_modules"
npm ci

echo "Preparing database folder…"
npm run db:migrate

echo ""
echo "Update complete."
echo "Next: double-click Open SheetsCRM.command (or npm run dev)."
echo "If Google added new OAuth scopes, sign out and sign in again."
pause_before_exit
