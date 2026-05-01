#!/usr/bin/env bash
# Regenerate chart-data.json from the spreadsheet.
#
# After editing 'Chart Tank Data.xlsx', run:
#   ./regenerate.sh
#
# Then commit + push the updated chart-data.json (Cursor will prompt).
#
# Requires: python3, openpyxl. (Install once: `pip3 install openpyxl`)
set -euo pipefail
cd "$(dirname "$0")"

python3 xlsx_to_json.py
echo ""
echo "✓ chart-data.json updated."
echo "  Next steps:"
echo "    1. In Cursor, open Source Control, stage 'chart-data.json', commit & push."
echo "    2. Wait ~30 seconds for GitHub Pages to redeploy."
echo "    3. Refresh the live page (the JS bumps a cache-buster automatically)."
