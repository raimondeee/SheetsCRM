#!/bin/bash
# First-time macOS setup (via "Install SheetsCRM.command").
# Opens Privacy & Security for Gatekeeper guidance, then ensures Homebrew, Node 22 LTS,
# Xcode CLT headers, .env, npm packages, and data/. Does not start the CRM server.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# better-sqlite3 (native) needs an LTS Node with prebuilds. Homebrew's plain `node`
# formula can install a too-new major (e.g. 26) that fails to compile.
MINIMUM_NODE_MAJOR=20
MAXIMUM_NODE_MAJOR=22
PREFERRED_NODE_FORMULA="node@22"

pause_before_exit() {
  echo ""
  read -r -p "Press Enter to close…"
}

open_privacy_and_security() {
  echo "Opening macOS Privacy & Security…"

  # Ventura and later use System Settings. The legacy URL supports older macOS
  # versions. Neither URL changes any security setting on the user's behalf.
  if ! open "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension" 2>/dev/null; then
    open "x-apple.systempreferences:com.apple.preference.security?General" 2>/dev/null || true
  fi
}

load_homebrew() {
  local brew_prefix

  if command -v brew >/dev/null 2>&1; then
    eval "$(brew shellenv)"
    return
  fi

  for brew_prefix in /opt/homebrew /usr/local; do
    if [ -x "$brew_prefix/bin/brew" ]; then
      eval "$("$brew_prefix/bin/brew" shellenv)"
      return
    fi
  done
}

node_major_version() {
  node -p 'process.versions.node.split(".")[0]'
}

node_version_ok() {
  local major
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi
  major="$(node_major_version)"
  [ "$major" -ge "$MINIMUM_NODE_MAJOR" ] && [ "$major" -le "$MAXIMUM_NODE_MAJOR" ]
}

ensure_path_has_no_spaces() {
  if [[ "$ROOT" == *" "* ]]; then
    echo "The project folder path contains a space:"
    echo "  $ROOT"
    echo ""
    echo "Native packages (better-sqlite3) fail to build when the path has spaces."
    echo "Rename or move the folder so there are no spaces, for example:"
    echo "  ~/Documents/SheetsCRM"
    echo "Then run this installer again."
    pause_before_exit
    exit 1
  fi
}

ensure_homebrew() {
  load_homebrew
  if command -v brew >/dev/null 2>&1; then
    echo "Homebrew is already installed: $(brew --version | awk 'NR==1 { print $1, $2 }')"
    return
  fi

  echo "Homebrew is required to install Node.js."
  echo "The official Homebrew installer will run next and may ask for your Mac password."
  read -r -p "Install Homebrew now? [y/N] " reply
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    echo "Homebrew was not installed. Setup cannot continue."
    pause_before_exit
    exit 1
  fi

  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  load_homebrew

  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew finished installing but is not on this shell's PATH."
    echo "Follow the 'Next steps' printed by Homebrew, then run this installer again."
    pause_before_exit
    exit 1
  fi

  # Persist PATH for future Terminal sessions (Apple Silicon / Intel).
  local brew_bin
  brew_bin="$(command -v brew)"
  if [ -n "$brew_bin" ] && ! grep -q 'brew shellenv' "${HOME}/.zprofile" 2>/dev/null; then
    {
      echo ""
      echo "# Homebrew (added by SheetsCRM installer)"
      echo "eval \"\$(${brew_bin} shellenv)\""
    } >> "${HOME}/.zprofile"
    echo "Added Homebrew to ~/.zprofile for future Terminal windows."
  fi
}

prefer_node22_on_path() {
  local node22_prefix
  node22_prefix="$(brew --prefix "$PREFERRED_NODE_FORMULA" 2>/dev/null || true)"
  if [ -n "$node22_prefix" ] && [ -x "${node22_prefix}/bin/node" ]; then
    PATH="${node22_prefix}/bin:${PATH}"
    export PATH
    hash -r
  fi
}

install_node_lts() {
  echo "Installing Node.js 22 LTS via Homebrew (${PREFERRED_NODE_FORMULA})…"
  echo "SheetsCRM needs Node ${MINIMUM_NODE_MAJOR}–${MAXIMUM_NODE_MAJOR} (not the latest Homebrew 'node', which can be too new)."
  brew install "$PREFERRED_NODE_FORMULA"
  prefer_node22_on_path

  if ! node_version_ok; then
    # keg-only formulas sometimes need an explicit link for this shell
    brew link --overwrite --force "$PREFERRED_NODE_FORMULA" 2>/dev/null || true
    prefer_node22_on_path
  fi
}

ensure_node() {
  local major

  prefer_node22_on_path

  if node_version_ok; then
    echo "Node.js $(node --version) is already installed (supported ${MINIMUM_NODE_MAJOR}–${MAXIMUM_NODE_MAJOR})."
    return
  fi

  if command -v node >/dev/null 2>&1; then
    major="$(node_major_version)"
    if [ "$major" -gt "$MAXIMUM_NODE_MAJOR" ]; then
      echo "Node.js $(node --version) is too new for SheetsCRM's SQLite package."
      echo "Installing Node.js ${MAXIMUM_NODE_MAJOR} LTS alongside it…"
    else
      echo "Node.js $(node --version) is too old; SheetsCRM requires Node.js ${MINIMUM_NODE_MAJOR}–${MAXIMUM_NODE_MAJOR}."
    fi
  else
    echo "Node.js is not installed."
  fi

  install_node_lts

  if ! node_version_ok; then
    echo "A supported Node.js version (${MINIMUM_NODE_MAJOR}–${MAXIMUM_NODE_MAJOR}) was not available after installation."
    echo "Try: brew install ${PREFERRED_NODE_FORMULA} && brew link --overwrite --force ${PREFERRED_NODE_FORMULA}"
    pause_before_exit
    exit 1
  fi

  echo "Using Node.js $(node --version)"
}

ensure_command_line_tools() {
  local sdk_path

  if ! xcode-select -p >/dev/null 2>&1; then
    echo ""
    echo "Xcode Command Line Tools are needed to compile a native dependency."
    echo "macOS will show Apple's installer. Complete it, then run this installer again."
    xcode-select --install || true
    pause_before_exit
    exit 0
  fi

  sdk_path="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"
  if [ -n "$sdk_path" ] && [ -f "$sdk_path/usr/include/c++/v1/climits" ]; then
    return
  fi

  echo ""
  echo "The active Xcode Command Line Tools installation is incomplete."
  echo "SheetsCRM needs the macOS C++ headers to compile its local SQLite dependency."
  echo "macOS may say the tools are 'already installed' even when the headers are missing."
  echo ""
  echo "Fix this by removing and reinstalling Command Line Tools (requires your Mac password):"
  echo "  sudo rm -rf /Library/Developer/CommandLineTools"
  echo "  sudo xcode-select --install"
  echo ""
  echo "Finish Apple's installer, then run this SheetsCRM installer again."
  echo "Alternatively: System Settings → General → Software Update, install any pending updates, then retry."
  pause_before_exit
  exit 1
}

install_project() {
  if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example (demo mode is enabled)."
  else
    echo "Keeping the existing .env file."
  fi

  echo ""
  echo "Installing SheetsCRM packages (Node $(node --version))…"
  rm -rf node_modules
  npm ci

  echo ""
  echo "Preparing the local database folder…"
  npm run db:migrate

  if [ ! -f data/market-managers.json ] && [ -f data/market-managers.example.json ]; then
    cp data/market-managers.example.json data/market-managers.json
    echo "Created data/market-managers.json from the example file (replace with your MM directory)."
  fi
}

main() {
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "This installer is for macOS. Use the manual setup instructions for other operating systems."
    pause_before_exit
    exit 1
  fi

  echo "SheetsCRM macOS setup"
  echo "Project: $ROOT"
  echo ""
  echo "Privacy & Security is opening for reference only."
  echo "If macOS blocked this file, choose 'Open Anyway' or right-click the .command file and choose Open."
  echo "This installer cannot approve Gatekeeper prompts or grant permissions for you."
  open_privacy_and_security

  ensure_path_has_no_spaces
  ensure_homebrew
  ensure_node
  ensure_command_line_tools
  install_project

  echo ""
  echo "Installing attachments folder + Finder opener (crmfolder://)…"
  bash "$ROOT/scripts/install-crmfolder-helper.sh"

  echo ""
  echo "Setup complete."
  echo "Next: double-click 'Open SheetsCRM.command' to start the CRM."
  echo "Attachments save under ~/Documents/SheetsCRM-Attachments (Row {n} subfolders)."
  if [ -f .env ] && grep -qE '^[[:space:]]*GOOGLE_CLIENT_ID=.*apps\.googleusercontent\.com' .env \
    && ! grep -qE 'your-google-oauth' .env; then
    echo "Google OAuth client is already in .env — open the CRM and Sign in with Google."
  else
    echo "For live Google data, configure OAuth credentials in Setup → Environment (or use a team share zip that already includes them)."
  fi
  pause_before_exit
}

main "$@"
