#!/usr/bin/env bash
# TS-44 — el build de release y el humo del binario que produce, más el viaje
# completo hasta el lanzador instalado. Vive fuera de `npm test` y de `cargo
# test` a propósito: tarda minutos y depende del entorno (WebKitGTK, red para
# el bundler de AppImage), así que no puede estar en el bucle de desarrollo.
#
#   bash tests/smoke/build-smoke.sh              # build + humo completo
#   bash tests/smoke/build-smoke.sh --no-build   # reusa el build anterior
#
# No escribe nada fuera de `src-tauri/target`, `dist` y un directorio temporal
# propio: el HOME y el prefijo de la instalación de prueba son temporales.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_DIR="$REPO_ROOT/src-tauri/target/release"

RUN_BUILD=1
if [[ $# -gt 1 ]] || { [[ $# -eq 1 ]] && [[ "$1" != "--no-build" ]]; }; then
  echo "uso: build-smoke.sh [--no-build]" >&2
  exit 64
fi
[[ "${1:-}" == "--no-build" ]] && RUN_BUILD=0

FAILURES=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() {
  printf '  \033[31m✗\033[0m %s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/reviewv4-smoke-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
FAKE_HOME="$WORK/home"
PREFIX="$WORK/prefix"
OUTSIDE="$WORK/outside"
mkdir -p "$FAKE_HOME" "$OUTSIDE"
printf '# rc del smoke\n' > "$FAKE_HOME/.bashrc"
printf '# rc del smoke\n' > "$FAKE_HOME/.profile"

# El PATH deliberadamente no lleva ~/.local/bin: el instalador tiene que avisar,
# no arreglarlo por su cuenta.
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
  '  sin argumentos   revisa los cambios sin commitear del repo actual'
  '  <commit>         revisa un commit concreto'
  '  <a>..<b>         revisa el acumulado de un rango de commits'
)

# El binario se ejecuta desde un directorio que no es un repo git y con un HOME
# de usar y tirar: `--help` no puede depender de dónde se lanza.
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
      fail "$label: falta la línea de uso: $line"
      return
    fi
  done
  pass "$label"
}

echo "TS-44 — build de release y humo del binario"

if [[ $RUN_BUILD -eq 1 ]]; then
  BUILD_LOG="$WORK/build.log"
  if (cd "$REPO_ROOT" && npm run tauri build) > "$BUILD_LOG" 2>&1; then
    pass "npm run tauri build termina sin errores"
  else
    fail "npm run tauri build falla (últimas líneas):"
    tail -n 25 "$BUILD_LOG" >&2
  fi
else
  pass "build omitido (--no-build): se reusa $RELEASE_DIR"
fi

mapfile -t BINARIES < <(find "$RELEASE_DIR" -maxdepth 1 -type f -perm -u+x ! -name '*.d' ! -name '*.so' 2>/dev/null | sort)

BINARY=""
if [[ ${#BINARIES[@]} -eq 1 ]]; then
  BINARY="${BINARIES[0]}"
  pass "el build deja un único ejecutable: $(basename "$BINARY")"
elif [[ ${#BINARIES[@]} -eq 0 ]]; then
  fail "el build no deja ningún ejecutable en $RELEASE_DIR"
else
  fail "el build deja más de un ejecutable en $RELEASE_DIR: ${BINARIES[*]}"
fi

HELP=""
if [[ -n "$BINARY" ]]; then
  if HELP="$(help_output "$BINARY")"; then
    pass "el binario responde a --help con código 0"
  else
    fail "el binario sale con código distinto de 0 en --help: $HELP"
  fi
  check_usage "el --help del binario documenta reviewer [<commit>|<a>..<b>]" "$HELP"
fi

DEB="$(find "$RELEASE_DIR/bundle" -name '*.deb' 2>/dev/null | head -n 1)"
APPIMAGE="$(find "$RELEASE_DIR/bundle" -name '*.AppImage' 2>/dev/null | head -n 1)"
[[ -n "$DEB" ]] && pass "el bundle deb existe: $(basename "$DEB")" || fail "no hay ningún .deb en $RELEASE_DIR/bundle"
[[ -n "$APPIMAGE" ]] && pass "el bundle AppImage existe: $(basename "$APPIMAGE")" || fail "no hay ninguna .AppImage en $RELEASE_DIR/bundle"

echo
echo "TS-45 — instalación real bajo un prefijo temporal"

LAUNCHER="$PREFIX/bin/reviewer"
DESKTOP="$PREFIX/share/applications/reviewer.desktop"

if [[ ! -x "$REPO_ROOT/deploy/install.sh" ]]; then
  fail "deploy/install.sh no existe o no es ejecutable"
else
  set +e
  INSTALL_OUT="$(cd "$REPO_ROOT" && sandboxed ./deploy/install.sh --prefix "$PREFIX" 2>&1)"
  INSTALL_CODE=$?
  set -e
  if [[ $INSTALL_CODE -eq 0 ]]; then
    pass "install.sh --prefix termina con código 0"
  else
    fail "install.sh --prefix sale con código $INSTALL_CODE: $INSTALL_OUT"
  fi

  [[ -x "$LAUNCHER" ]] && pass "instala el lanzador ejecutable $LAUNCHER" || fail "no instala un lanzador ejecutable en $LAUNCHER"
  [[ -f "$DESKTOP" ]] && pass "instala la entrada de escritorio $DESKTOP" || fail "no instala la entrada de escritorio en $DESKTOP"

  if [[ -x "$LAUNCHER" ]]; then
    set +e
    INSTALLED_HELP="$(help_output "$LAUNCHER")"
    INSTALLED_CODE=$?
    set -e
    if [[ $INSTALLED_CODE -eq 0 ]]; then
      check_usage "el lanzador instalado responde a --help" "$INSTALLED_HELP"
    else
      fail "el lanzador instalado sale con código $INSTALLED_CODE: $INSTALLED_HELP"
    fi
  fi

  if [[ -f "$DESKTOP" ]]; then
    EXEC_LINE="$(grep -m 1 '^Exec=' "$DESKTOP" || true)"
    EXEC_CMD="${EXEC_LINE#Exec=}"
    EXEC_BIN="${EXEC_CMD%% *}"
    EXEC_BIN="${EXEC_BIN%\"}"
    EXEC_BIN="${EXEC_BIN#\"}"
    if [[ "$EXEC_BIN" == "$LAUNCHER" ]]; then
      pass "el Exec del .desktop instalado apunta al lanzador instalado"
    else
      fail "el Exec del .desktop instalado es '$EXEC_BIN' y no el lanzador $LAUNCHER"
    fi
    MISSING=""
    for key in '^\[Desktop Entry\]' '^Type=Application$' '^Name=.\+' '^Icon=.\+' '^Categories=.\+'; do
      grep -q "$key" "$DESKTOP" || MISSING="$MISSING $key"
    done
    if [[ -z "$MISSING" ]]; then
      pass "el .desktop instalado tiene cabecera, Type, Name, Icon y Categories"
    else
      fail "al .desktop instalado le faltan líneas:$MISSING"
    fi
  fi

  if [[ -e "$FAKE_HOME/.local" ]]; then
    fail "install.sh --prefix escribió en ~/.local del HOME de prueba"
  else
    pass "install.sh --prefix no toca ~/.local"
  fi
  if grep -rqs 'local/bin' "$FAKE_HOME/.bashrc" "$FAKE_HOME/.profile"; then
    fail "install.sh --prefix modificó los ficheros de arranque del shell"
  else
    pass "install.sh --prefix no toca el PATH del usuario"
  fi
fi

if [[ -x "$REPO_ROOT/deploy/uninstall.sh" ]]; then
  set +e
  UNINSTALL_OUT="$(cd "$REPO_ROOT" && sandboxed ./deploy/uninstall.sh --prefix "$PREFIX" 2>&1)"
  UNINSTALL_CODE=$?
  set -e
  if [[ $UNINSTALL_CODE -eq 0 && ! -e "$LAUNCHER" && ! -e "$DESKTOP" ]]; then
    pass "uninstall.sh --prefix deshace la instalación"
  else
    fail "uninstall.sh --prefix (código $UNINSTALL_CODE) deja el prefijo a medias: $UNINSTALL_OUT"
  fi
else
  fail "deploy/uninstall.sh no existe o no es ejecutable"
fi

echo
echo "README — el uso documentado es el que imprime el binario"
README="$REPO_ROOT/README.md"
if [[ ! -f "$README" ]]; then
  fail "no hay README.md"
else
  README_OK=1
  for line in "${USAGE_LINES[@]}"; do
    if ! grep -qF -- "$line" "$README"; then
      fail "el README no documenta la línea de uso: $line"
      README_OK=0
    fi
  done
  [[ $README_OK -eq 1 ]] && pass "el README reproduce el uso del CLI" || true
fi

echo
if [[ $FAILURES -eq 0 ]]; then
  printf '\033[32mhumo en verde\033[0m: TS-44 y la instalación real pasan\n'
  exit 0
fi
printf '\033[31m%d comprobación(es) en rojo\033[0m\n' "$FAILURES" >&2
exit 1
