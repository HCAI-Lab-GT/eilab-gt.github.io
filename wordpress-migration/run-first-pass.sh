#!/usr/bin/env bash
set -uo pipefail

MIGRATION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$MIGRATION_DIR"

if [[ ! -f ../_config.yml || ! -d ../_data ]]; then
  echo "ERROR: Place migration/ inside a clone of HCAI-Lab-GT/eilab-gt.github.io." >&2
  exit 2
fi

if command -v python3 >/dev/null 2>&1; then
  BASE_PYTHON="${PYTHON:-python3}"
elif command -v python >/dev/null 2>&1; then
  BASE_PYTHON="${PYTHON:-python}"
else
  echo "ERROR: Python 3.11+ is required." >&2
  exit 2
fi

if [[ ! -d .venv ]]; then
  "$BASE_PYTHON" -m venv .venv || exit 2
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip || exit 2
python -m pip install -r requirements.txt || exit 2

mkdir -p build

echo "== 1/4 Source audit =="
python scripts/audit_source.py --source-root ..
AUDIT_STATUS=$?

echo "== 2/4 Public WordPress discovery (GET only) =="
python scripts/discover_wordpress.py
DISCOVERY_STATUS=$?
if [[ $DISCOVERY_STATUS -ne 0 ]]; then
  echo "NOTE: Public REST discovery did not complete. This is non-fatal; local generation will continue."
fi

echo "== 3/4 Local migration build =="
python scripts/run_pipeline.py --source-root ..
BUILD_STATUS=$?

echo "== 4/4 Tests =="
pytest -q
TEST_STATUS=$?

cat > build/first-pass-status.txt <<EOF
source_audit_exit=$AUDIT_STATUS
wordpress_discovery_exit=$DISCOVERY_STATUS
local_build_exit=$BUILD_STATUS
tests_exit=$TEST_STATUS
target=https://sites.gatech.edu/hcailab
EOF

if [[ $AUDIT_STATUS -ne 0 || $BUILD_STATUS -ne 0 || $TEST_STATUS -ne 0 ]]; then
  echo "First pass completed with local errors. Review build/ and fix them before any WordPress mutation." >&2
  exit 2
fi

if [[ $DISCOVERY_STATUS -ne 0 ]]; then
  echo
  echo "Local package built successfully. Next run: make browser-discover"
else
  echo
  echo "First pass succeeded. Review build/wordpress-capabilities.md and build/pipeline-report.json."
fi
