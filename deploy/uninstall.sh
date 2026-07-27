#!/usr/bin/env bash
# Undoes what install.sh put there: the launcher, the desktop entry and the
# icon. Those three files and nothing else; the directories stay.
set -euo pipefail

usage() {
  cat <<'FIN'
uso: uninstall.sh [--prefix <dir>] [--dry-run]
  --prefix <dir>   de dónde desinstalar; por defecto ~/.local
  --dry-run        dice lo que borraría y no borra nada
  --help, -h       muestra esta ayuda
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
      # `uninstall.sh --prefix --dry-run` would take the option for a directory
      # and report on a prefix nobody asked about.
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
      die 64 "opción desconocida: $1 (prueba uninstall.sh --help)"
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
case "$PREFIX" in
  /*) ;;
  *) PREFIX="$PWD/$PREFIX" ;;
esac

INSTALLED=(
  "$PREFIX/bin/reviewer"
  "$PREFIX/share/applications/reviewer.desktop"
  "$PREFIX/share/icons/hicolor/128x128/apps/reviewer.png"
)

pretty() {
  local target="$1"
  if [[ -n "${HOME:-}" && "$target" == "$HOME/"* ]]; then
    printf '~%s' "${target#"$HOME"}"
  else
    printf '%s' "$target"
  fi
}

REMOVED=0
BLOCKED=0
for target in "${INSTALLED[@]}"; do
  if [[ ! -e "$target" && ! -L "$target" ]]; then
    continue
  fi
  # A symlink to a directory is still ours to unlink; a real directory is not,
  # and letting `rm` fail here would abort before the remaining two.
  if [[ -d "$target" && ! -L "$target" ]]; then
    BLOCKED=$((BLOCKED + 1))
    printf '  ✗ en %s hay un directorio, no el fichero que instalé: lo dejo como está\n' "$(pretty "$target")" >&2
    continue
  fi
  REMOVED=$((REMOVED + 1))
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  [dry-run] borraría %s\n' "$(pretty "$target")"
  else
    rm -f -- "$target"
    printf '  ✓ borrado %s\n' "$(pretty "$target")"
  fi
done

if [[ $REMOVED -eq 0 && $BLOCKED -eq 0 ]]; then
  printf '  · no hay nada instalado en %s\n' "$(pretty "$PREFIX")"
fi

if [[ $BLOCKED -gt 0 ]]; then
  exit 1
fi
