#!/usr/bin/env bash
# Start the dashboard.
#
# The dashboard has no backend: the CFR solver is compiled into the bundle and
# runs in the browser (frontend/lib/solver/). The Python implementation in
# backend/ is the reference the port is checked against - run its tests with
# ./run.sh test, and the numerical parity check with ./run.sh parity.
set -euo pipefail
cd "$(dirname "$0")"

ensure_venv() {
  if [ ! -d backend/.venv ]; then
    echo "Creating Python virtualenv..."
    python3 -m venv backend/.venv
    ./backend/.venv/bin/pip install -q -r backend/requirements.txt
  fi
}

ensure_node() {
  if [ ! -d frontend/node_modules ]; then
    echo "Installing frontend dependencies..."
    (cd frontend && npm install)
  fi
}

case "${1:-dev}" in
  dev)
    ensure_node
    echo
    echo "  Dashboard  http://localhost:3000"
    echo
    (cd frontend && npm run dev)
    ;;
  test)
    ensure_venv
    ./backend/.venv/bin/python -m pytest backend/tests -q
    ;;
  parity)
    ensure_venv
    ensure_node
    ./backend/.venv/bin/python scripts/check_parity.py
    ;;
  build)
    ensure_node
    (cd frontend && npm run build)
    echo "Static site written to frontend/out/"
    ;;
  *)
    echo "usage: ./run.sh [dev|test|parity|build]" >&2
    exit 1
    ;;
esac
