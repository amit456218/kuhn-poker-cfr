#!/usr/bin/env bash
# Start the solver API and the dashboard together.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d backend/.venv ]; then
  echo "Creating Python virtualenv..."
  python3 -m venv backend/.venv
  ./backend/.venv/bin/pip install -q -r backend/requirements.txt
fi
if [ ! -d frontend/node_modules ]; then
  echo "Installing frontend dependencies..."
  (cd frontend && npm install)
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd backend && ./.venv/bin/uvicorn app.main:app --port 8000) &
(cd frontend && npm run dev) &

echo
echo "  Dashboard  http://localhost:3000"
echo "  API docs   http://localhost:8000/docs"
echo
wait
