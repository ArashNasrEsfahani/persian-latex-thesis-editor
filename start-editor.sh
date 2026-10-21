#!/usr/bin/env sh
# RTL LaTeX Live Editor launcher.  Usage: ./start-editor.sh [project folder] [extra server.py options]
# With no argument the bundled example project is opened.
cd "$(dirname "$0")" || exit 1
PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python
if [ -z "$1" ]; then
  exec "$PY" server.py --root example --open
fi
root="$1"; shift
exec "$PY" server.py --root "$root" --open "$@"
