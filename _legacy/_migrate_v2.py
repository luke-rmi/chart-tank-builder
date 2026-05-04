#!/usr/bin/env python3
"""One-shot migration: chart-data.json v1 → v2.

Changes:
  * Remove VJ-L / VJ-R rows from Tank Model step on the 5 affected tanks.
  * Add tank-level vjvLeft / vjvRight fields (consumed by Option #12).
  * Add heroImage path to every tank.
  * Add image path to every add-on option (where mapped).

After this runs, the spreadsheet rebuild script will lock in the new schema.
"""
from __future__ import annotations
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent
SRC = REPO / "chart-data.json"

# (tankId, base partNumber kept on Tank Model, vj-right partNumber, vj-left partNumber)
VJ_MIGRATION = {
    "1000L-HP-TF": ("PERMA-14556157-HP1000-VJVR", "PERMA-20858365-HP1000-VJVL"),
    "1500L-HP-TF": ("PERMA-14556165-HP1500-VJVR", "PERMA-20858388-HP1500-VJVL"),
    "2000L-HP-TF": ("PERMA-14556173-HP2000-VJVR", "PERMA-20858392-HP2000-VJVL"),
    "3000L-HP-TF": ("PERMA-14497492-HP3000-VJVR", "PERMA-20858395-HP3000-VJV"),
    "5500L-MP-FF": ("PERMA-21891166-MP5500-VJVR-FF", "PERMA-21891165-MP5500-VJVL-FF"),
}

# Image mapping for add-on options (matches OPTION_IMAGE_MAP in build_images.py)
OPT_IMAGE_OWNERS = {
    1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
}


def migrate(d: dict) -> dict:
    # Tanks
    for t in d["tanks"]:
        # 1. Hero image path (every tank gets one — even if file isn't built yet,
        #    the JS handles missing files gracefully)
        t["heroImage"] = f"images/tanks/{t['id']}.webp"

        # 2. VJ migration
        if t["id"] in VJ_MIGRATION:
            vjvr, vjvl = VJ_MIGRATION[t["id"]]
            t["vjvRight"] = {"partNumber": vjvr}
            t["vjvLeft"] = {"partNumber": vjvl}
            # Strip VJ rows from Tank Model step
            for step in t["configSteps"]:
                if step["stepName"] == "Tank Model":
                    step["options"] = [
                        o for o in step["options"]
                        if "Vacuum Jacket" not in o["label"] and "VJ-" not in o["label"]
                    ]
                    break

    # Add-on option images
    for opt in d["addOnOptions"]:
        if opt["number"] in OPT_IMAGE_OWNERS:
            opt["image"] = f"images/options/opt-{opt['number']:02d}.webp"
        else:
            opt["image"] = ""  # explicit empty for #4 (no photo in catalog)

    # Bump _meta version
    d["_meta"]["version"] = "2.0"
    d["_meta"]["schemaNotes"] = (
        "v2 schema: tanks gain heroImage and optional vjvLeft/vjvRight; "
        "addOnOptions gain image; VJ removed from Tank Model step."
    )
    return d


def main() -> None:
    d = json.loads(SRC.read_text())
    d2 = migrate(d)
    SRC.write_text(json.dumps(d2, indent=2))

    # Spot-check
    print("✓ Migrated chart-data.json")
    print(f"  Schema version: {d2['_meta']['version']}")
    n_with_vj = sum(1 for t in d2["tanks"] if t.get("vjvLeft"))
    print(f"  Tanks with VJ fields: {n_with_vj} (expect 5)")
    n_with_hero = sum(1 for t in d2["tanks"] if t.get("heroImage"))
    print(f"  Tanks with heroImage: {n_with_hero} (expect 31)")
    n_opts_with_image = sum(1 for o in d2["addOnOptions"] if o.get("image"))
    print(f"  Options with image path: {n_opts_with_image} (expect 17)")

    # Verify VJ tanks now have 1 option in Tank Model
    print("\nTank Model option counts after migration:")
    for tid in VJ_MIGRATION:
        t = next(t for t in d2["tanks"] if t["id"] == tid)
        first = t["configSteps"][0]
        n = len(first["options"])
        flag = "✓" if n == 1 else "✗"
        print(f"  {flag} {tid:18s} → {n} option(s) (was 3)")


if __name__ == "__main__":
    main()
