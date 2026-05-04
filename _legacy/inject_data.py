#!/usr/bin/env python3
"""Inject chart_data.json into chart-builder.html between the
/*__CHART_DATA_START__*/ ... /*__CHART_DATA_END__*/ markers.

Run after editing the spreadsheet/JSON to refresh the live HTML.
"""
import json, re, shutil
from pathlib import Path

DATA = Path("chart_data.json")
HTML = Path("chart-builder.html")

data_text = DATA.read_text()
html_text = HTML.read_text()

# Compact (no indent) for smaller file size, but use sort_keys=False to preserve order
# Validate first
data = json.loads(data_text)
compact = json.dumps(data, separators=(",", ":"), ensure_ascii=False)

new_html, n = re.subn(
    r"/\*__CHART_DATA_START__\*/.*?/\*__CHART_DATA_END__\*/",
    "/*__CHART_DATA_START__*/" + compact + "/*__CHART_DATA_END__*/",
    html_text,
    count=1,
    flags=re.DOTALL,
)
assert n == 1, "Markers not found in HTML"
HTML.write_text(new_html)
print(f"Injected {len(compact):,} bytes of data into {HTML.name}")
print(f"  tanks: {len(data['tanks'])}  add-ons: {len(data['addOnOptions'])}")
