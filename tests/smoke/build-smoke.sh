#!/usr/bin/env bash
# TS-44 — the release build, a smoke test of the resulting binary, and the full
# path through the installed launcher. This deliberately lives outside
# `npm test` and `cargo test`: it takes minutes and depends on the environment
# (WebKitGTK and network access for the AppImage bundler), so it cannot be part
# of the fast development loop.
#
#   bash tests/smoke/build-smoke.sh              # build + full smoke test
#   bash tests/smoke/build-smoke.sh --no-build   # reuse the previous build
#
# It writes nothing outside `src-tauri/target`, `dist`, and its own temporary
# directory: HOME and the test installation prefix are temporary.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_DIR="$REPO_ROOT/src-tauri/target/release"

RUN_BUILD=1
if [[ $# -gt 1 ]] || { [[ $# -eq 1 ]] && [[ "$1" != "--no-build" ]]; }; then
  echo "usage: build-smoke.sh [--no-build]" >&2
  exit 64
fi
[[ "${1:-}" == "--no-build" ]] && RUN_BUILD=0

FAILURES=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() {
  printf '  \033[31m✗\033[0m %s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/local-reviewer-smoke-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
FAKE_HOME="$WORK/home"
PREFIX="$WORK/prefix"
OUTSIDE="$WORK/outside"
mkdir -p "$FAKE_HOME" "$OUTSIDE"
printf '# smoke-test rc\n' > "$FAKE_HOME/.bashrc"
printf '# smoke-test rc\n' > "$FAKE_HOME/.profile"

# PATH deliberately omits ~/.local/bin: the installer must warn about it, not
# change the user's environment.
sandboxed() {
  env -i \
    HOME="$FAKE_HOME" \
    PATH="/usr/local/bin:/usr/bin:/bin" \
    XDG_DATA_HOME="$FAKE_HOME/.local/share" \
    XDG_BIN_HOME="$FAKE_HOME/.local/bin" \
    XDG_CONFIG_HOME="$FAKE_HOME/.config" \
    XDG_CACHE_HOME="$FAKE_HOME/.cache" \
    LANG=C.UTF-8 \
    "$@"
}

USAGE_LINES=(
  'reviewer [<commit>|<a>..<b>]'
  '  no arguments    review uncommitted changes in the current repository'
  '  <commit>        review one commit'
  '  <a>..<b>        review the accumulated changes in a commit range'
)

# Run the binary outside a Git repository with a disposable HOME: `--help`
# must not depend on where it is launched.
help_output() {
  local binary="$1" out status
  set +e
  out="$(cd "$OUTSIDE" && sandboxed "$binary" --help 2>&1)"
  status=$?
  set -e
  printf '%s' "$out"
  return $status
}

check_usage() {
  local label="$1" output="$2" line
  for line in "${USAGE_LINES[@]}"; do
    if ! printf '%s\n' "$output" | grep -qF -- "$line"; then
      fail "$label: missing usage line: $line"
      return
    fi
  done
  pass "$label"
}

echo "TS-44 — release build and binary smoke test"

if [[ $RUN_BUILD -eq 1 ]]; then
  BUILD_LOG="$WORK/build.log"
  if (cd "$REPO_ROOT" && npm run tauri build) > "$BUILD_LOG" 2>&1; then
    pass "npm run tauri build completes successfully"
  else
    fail "npm run tauri build failed (last lines):"
    tail -n 25 "$BUILD_LOG" >&2
  fi
else
  pass "build skipped (--no-build): reusing $RELEASE_DIR"
fi

mapfile -t BINARIES < <(find "$RELEASE_DIR" -maxdepth 1 -type f -perm -u+x ! -name '*.d' ! -name '*.so' 2>/dev/null | sort)

BINARY=""
if [[ ${#BINARIES[@]} -eq 1 ]]; then
  BINARY="${BINARIES[0]}"
  pass "the build leaves exactly one executable: $(basename "$BINARY")"
elif [[ ${#BINARIES[@]} -eq 0 ]]; then
  fail "the build leaves no executable in $RELEASE_DIR"
else
  fail "the build leaves more than one executable in $RELEASE_DIR: ${BINARIES[*]}"
fi

HELP=""
if [[ -n "$BINARY" ]]; then
  if HELP="$(help_output "$BINARY")"; then
    pass "the binary answers --help with exit code 0"
  else
    fail "the binary exits with a nonzero code for --help: $HELP"
  fi
  check_usage "the binary --help documents reviewer [<commit>|<a>..<b>]" "$HELP"
fi

DEB="$(find "$RELEASE_DIR/bundle" -name '*.deb' 2>/dev/null | head -n 1)"
APPIMAGE="$(find "$RELEASE_DIR/bundle" -name '*.AppImage' 2>/dev/null | head -n 1)"
[[ -n "$DEB" ]] && pass "the deb bundle exists: $(basename "$DEB")" || fail "no .deb exists in $RELEASE_DIR/bundle"
[[ -n "$APPIMAGE" ]] && pass "the AppImage bundle exists: $(basename "$APPIMAGE")" || fail "no .AppImage exists in $RELEASE_DIR/bundle"

echo
echo "TS-45 — real installation under a temporary prefix"

LAUNCHER="$PREFIX/bin/reviewer"
DESKTOP="$PREFIX/share/applications/reviewer.desktop"

if [[ ! -x "$REPO_ROOT/deploy/install.sh" ]]; then
  fail "deploy/install.sh does not exist or is not executable"
else
  set +e
  INSTALL_OUT="$(cd "$REPO_ROOT" && sandboxed ./deploy/install.sh --prefix "$PREFIX" 2>&1)"
  INSTALL_CODE=$?
  set -e
  if [[ $INSTALL_CODE -eq 0 ]]; then
    pass "install.sh --prefix exits with code 0"
  else
    fail "install.sh --prefix exits with code $INSTALL_CODE: $INSTALL_OUT"
  fi

  [[ -x "$LAUNCHER" ]] && pass "installs the executable launcher at $LAUNCHER" || fail "does not install an executable launcher at $LAUNCHER"
  [[ -f "$DESKTOP" ]] && pass "installs the desktop entry at $DESKTOP" || fail "does not install the desktop entry at $DESKTOP"

  if [[ -x "$LAUNCHER" ]]; then
    set +e
    INSTALLED_HELP="$(help_output "$LAUNCHER")"
    INSTALLED_CODE=$?
    set -e
    if [[ $INSTALLED_CODE -eq 0 ]]; then
      check_usage "the installed launcher answers --help" "$INSTALLED_HELP"
    else
      fail "the installed launcher exits with code $INSTALLED_CODE: $INSTALLED_HELP"
    fi
  fi

  if [[ -f "$DESKTOP" ]]; then
    EXEC_LINE="$(grep -m 1 '^Exec=' "$DESKTOP" || true)"
    EXEC_CMD="${EXEC_LINE#Exec=}"
    EXEC_BIN="${EXEC_CMD%% *}"
    EXEC_BIN="${EXEC_BIN%\"}"
    EXEC_BIN="${EXEC_BIN#\"}"
    if [[ "$EXEC_BIN" == "$LAUNCHER" ]]; then
      pass "the installed .desktop Exec points to the installed launcher"
    else
      fail "the installed .desktop Exec is '$EXEC_BIN', not the launcher $LAUNCHER"
    fi
    MISSING=""
    for key in '^\[Desktop Entry\]' '^Type=Application$' '^Name=.\+' '^Icon=.\+' '^Categories=.\+'; do
      grep -q "$key" "$DESKTOP" || MISSING="$MISSING $key"
    done
    if [[ -z "$MISSING" ]]; then
      pass "the installed .desktop has a header, Type, Name, Icon, and Categories"
    else
      fail "the installed .desktop is missing lines:$MISSING"
    fi
  fi

  if [[ -e "$FAKE_HOME/.local" ]]; then
    fail "install.sh --prefix wrote to ~/.local in the test HOME"
  else
    pass "install.sh --prefix does not touch ~/.local"
  fi
  if grep -rqs 'local/bin' "$FAKE_HOME/.bashrc" "$FAKE_HOME/.profile"; then
    fail "install.sh --prefix changed shell startup files"
  else
    pass "install.sh --prefix does not touch the user's PATH"
  fi
fi

if [[ -x "$REPO_ROOT/deploy/uninstall.sh" ]]; then
  set +e
  UNINSTALL_OUT="$(cd "$REPO_ROOT" && sandboxed ./deploy/uninstall.sh --prefix "$PREFIX" 2>&1)"
  UNINSTALL_CODE=$?
  set -e
  if [[ $UNINSTALL_CODE -eq 0 && ! -e "$LAUNCHER" && ! -e "$DESKTOP" ]]; then
    pass "uninstall.sh --prefix reverses the installation"
  else
    fail "uninstall.sh --prefix (code $UNINSTALL_CODE) leaves a partial prefix: $UNINSTALL_OUT"
  fi
else
  fail "deploy/uninstall.sh does not exist or is not executable"
fi

echo
echo "README — documented usage matches the binary"
README="$REPO_ROOT/README.md"
if [[ ! -f "$README" ]]; then
  fail "README.md does not exist"
else
  README_OK=1
  for line in "${USAGE_LINES[@]}"; do
    if ! grep -qF -- "$line" "$README"; then
      fail "the README does not document this usage line: $line"
      README_OK=0
    fi
  done
  [[ $README_OK -eq 1 ]] && pass "the README reproduces the CLI usage" || true
fi

echo
if [[ $FAILURES -eq 0 ]]; then
  printf '\033[32mgreen smoke\033[0m: TS-44 and the real installation pass\n'
  exit 0
fi
printf '\033[31m%d failed check(s)\033[0m\n' "$FAILURES" >&2
exit 1
