#!/usr/bin/env bash
# Undoes what install.sh put there: the launcher, the desktop entry and the
# icon. Those three files and nothing else; the directories stay.
set -euo pipefail

usage() {
  cat <<'FIN'
usage: uninstall.sh [--prefix <dir>] [--dry-run]
  --prefix <dir>   installation prefix; defaults to ~/.local
  --dry-run        print planned removals without deleting anything
  --help, -h       show this help
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
        die 64 "--prefix requires a directory"
      fi
      # `uninstall.sh --prefix --dry-run` would take the option for a directory
      # and report on a prefix nobody asked about.
      if [[ "$2" == -* ]]; then
        die 64 "--prefix requires a directory, not option $2 (use --prefix=$2 if that is really its name)"
      fi
      PREFIX="$2"
      shift
      ;;
    --prefix=*)
      PREFIX="${1#--prefix=}"
      if [[ -z "$PREFIX" ]]; then
        die 64 "--prefix requires a directory"
      fi
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die 64 "unknown option: $1 (try uninstall.sh --help)"
      ;;
  esac
  shift
done

if [[ -z "$PREFIX" ]]; then
  if [[ -z "${HOME:-}" ]]; then
    die 64 "--prefix <dir> is required when HOME is not set"
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
    printf '  ✗ %s is a directory, not the installed file; leaving it untouched\n' "$(pretty "$target")" >&2
    continue
  fi
  REMOVED=$((REMOVED + 1))
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  [dry-run] would remove %s\n' "$(pretty "$target")"
  else
    rm -f -- "$target"
    printf '  ✓ removed %s\n' "$(pretty "$target")"
  fi
done

if [[ $REMOVED -eq 0 && $BLOCKED -eq 0 ]]; then
  printf '  · nothing is installed under %s\n' "$(pretty "$PREFIX")"
fi

if [[ $BLOCKED -gt 0 ]]; then
  exit 1
fi
