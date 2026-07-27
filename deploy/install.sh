#!/usr/bin/env bash
# Installs the already built binary as `reviewer`, plus its desktop entry.
# It builds nothing and never edits the user's PATH: it only warns.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname -- "$SCRIPT_DIR")"
BINARY="$REPO_ROOT/src-tauri/target/release/reviewv4"
ICON_SOURCE="$REPO_ROOT/src-tauri/icons/128x128.png"
TEMPLATE="$SCRIPT_DIR/reviewer.desktop"

usage() {
  cat <<'FIN'
uso: install.sh [--prefix <dir>] [--dry-run]
  --prefix <dir>   dónde instalar; por defecto ~/.local
  --dry-run        dice lo que haría y no escribe nada
  --help, -h       muestra esta ayuda

Instala <dir>/bin/reviewer y <dir>/share/applications/reviewer.desktop
a partir del binario de release ya construido (npm run tauri build).
FIN
}

die() {
  local code="$1"
  shift
  printf '  ✗ %s\n' "$*" >&2
  exit "$code"
}

PREFIX=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --prefix)
      if [[ -z "${2:-}" ]]; then
        die 64 "--prefix necesita un directorio"
      fi
      # Without this, `install.sh --prefix --dry-run` installs into a directory
      # named `--dry-run` right when writing nothing was what was asked for.
      if [[ "$2" == -* ]]; then
        die 64 "--prefix necesita un directorio, no la opción $2 (usa --prefix=$2 si de verdad se llama así)"
      fi
      PREFIX="$2"
      shift
      ;;
    --prefix=*)
      PREFIX="${1#--prefix=}"
      if [[ -z "$PREFIX" ]]; then
        die 64 "--prefix necesita un directorio"
      fi
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die 64 "opción desconocida: $1 (prueba install.sh --help)"
      ;;
  esac
  shift
done

if [[ -z "$PREFIX" ]]; then
  if [[ -z "${HOME:-}" ]]; then
    die 64 "sin HOME en el entorno hace falta --prefix <dir>"
  fi
  PREFIX="$HOME/.local"
fi
# A relative prefix has to be resolved before it lands in the desktop `Exec`.
case "$PREFIX" in
  /*) ;;
  *) PREFIX="$PWD/$PREFIX" ;;
esac

LAUNCHER="$PREFIX/bin/reviewer"
DESKTOP="$PREFIX/share/applications/reviewer.desktop"
ICON="$PREFIX/share/icons/hicolor/128x128/apps/reviewer.png"

pretty() {
  local target="$1"
  if [[ -n "${HOME:-}" && "$target" == "$HOME/"* ]]; then
    printf '~%s' "${target#"$HOME"}"
  else
    printf '%s' "$target"
  fi
}

path_note() {
  local bin="$PREFIX/bin"
  case ":${PATH:-}:" in
    *":$bin:"*)
      printf '  ✓ %s ya está en el PATH\n' "$(pretty "$bin")"
      ;;
    *)
      printf '  ! %s no está en el PATH; añádelo a tu shell:\n' "$(pretty "$bin")"
      printf '      export PATH="%s:$PATH"\n' "$bin"
      ;;
  esac
}

# Atomic write: the temporary lands in the same directory and is renamed, so
# reinstalling over a `reviewer` that is running never leaves it half written.
# Whatever fails before the rename takes the temporary down with the script.
TEMPORARY=""
trap 'if [[ -n "$TEMPORARY" ]]; then rm -f -- "$TEMPORARY"; fi' EXIT

# Checked for every target before the first write, so a prefix that cannot take
# the whole installation is refused instead of half filled.
check_target() {
  local target="$1" dir
  # `mv` onto a directory would move the file inside it instead of failing.
  if [[ -d "$target" ]]; then
    die 1 "en $(pretty "$target") hay un directorio, no el fichero que instalo: quítalo y vuelve a intentarlo"
  fi
  dir="$(dirname -- "$target")"
  # A dangling symlink stops the walk: `-e` alone would step over it and let
  # `mkdir -p` blow up later, with the launcher already in place.
  while [[ ! -e "$dir" && ! -L "$dir" ]]; do
    dir="$(dirname -- "$dir")"
  done
  if [[ ! -d "$dir" ]]; then
    die 1 "$(pretty "$dir") no es un directorio: no puedo instalar $(pretty "$target")"
  fi
  if [[ ! -w "$dir" || ! -x "$dir" ]]; then
    die 1 "sin permiso de escritura en $(pretty "$dir"): no puedo instalar $(pretty "$target")"
  fi
}

begin_write() {
  local target="$1"
  check_target "$target"
  mkdir -p -- "$(dirname -- "$target")"
  TEMPORARY="$target.tmp.$$"
}

finish_write() {
  local target="$1" mode="$2"
  chmod "$mode" "$TEMPORARY"
  mv -f -- "$TEMPORARY" "$target"
  TEMPORARY=""
}

# A launcher reads the value back as a string, then applies the quoting rule,
# then expands field codes, so the escapes go on in the reverse order. Anything
# less and a prefix with a space or a `$` gives an entry the desktop won't run.
exec_escape() {
  local value="$1"
  value="${value//%/%%}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\`/\\\`}"
  value="${value//\$/\\\$}"
  value="${value//\\/\\\\}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\t'/\\t}"
  value="${value//$'\r'/\\r}"
  printf '%s' "$value"
}

# Spelled out instead of `${text//@PREFIX@/$value}` because bash >= 5.2 expands
# an `&` in the replacement to the matched text and leaves the marker behind.
render_template() {
  local value="$1" text
  text="$(<"$TEMPLATE")"
  while [[ "$text" == *@PREFIX@* ]]; do
    printf '%s%s' "${text%%@PREFIX@*}" "$value"
    text="${text#*@PREFIX@}"
  done
  printf '%s\n' "$text"
}

place() {
  local source="$1" target="$2" mode="$3"
  begin_write "$target"
  cp -- "$source" "$TEMPORARY"
  finish_write "$target" "$mode"
}

if [[ $DRY_RUN -eq 1 ]]; then
  if [[ ! -x "$BINARY" ]]; then
    printf '  [dry-run] aviso: no hay binario en %s; constrúyelo con npm run tauri build\n' "$(pretty "$BINARY")"
  fi
  printf '  [dry-run] escribiría %s\n' "$(pretty "$LAUNCHER")"
  printf '  [dry-run] escribiría %s\n' "$(pretty "$DESKTOP")"
  if [[ -f "$ICON_SOURCE" ]]; then
    printf '  [dry-run] escribiría %s\n' "$(pretty "$ICON")"
  fi
  path_note
  exit 0
fi

if [[ ! -x "$BINARY" ]]; then
  die 1 "no hay binario construido en $(pretty "$BINARY"): ejecuta npm run tauri build y vuelve a intentarlo"
fi
if [[ ! -f "$TEMPLATE" ]]; then
  die 1 "falta la plantilla de escritorio $(pretty "$TEMPLATE")"
fi

check_target "$LAUNCHER"
check_target "$DESKTOP"
if [[ -f "$ICON_SOURCE" ]]; then
  check_target "$ICON"
fi

place "$BINARY" "$LAUNCHER" 755
printf '  ✓ binario     %s\n' "$(pretty "$LAUNCHER")"

begin_write "$DESKTOP"
render_template "$(exec_escape "$PREFIX")" > "$TEMPORARY"
finish_write "$DESKTOP" 644
printf '  ✓ escritorio  %s\n' "$(pretty "$DESKTOP")"

if [[ -f "$ICON_SOURCE" ]]; then
  place "$ICON_SOURCE" "$ICON" 644
  printf '  ✓ icono       %s\n' "$(pretty "$ICON")"
else
  printf '  ! sin icono: falta %s\n' "$(pretty "$ICON_SOURCE")"
fi

path_note
