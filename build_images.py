#!/usr/bin/env python3
"""Extract product photos from Chart microbulk PDFs into web-ready assets.

Run this any time the source PDFs change.

Inputs:
  source-pdfs/<tank>.pdf, ..., source-pdfs/options-1-18.pdf

Outputs:
  images/tanks/<tank-id>.webp        (~600px wide, ~25KB each)
  images/tanks/<tank-id>.jpg         (fallback)
  images/options/opt-NN.webp         (~280px wide, ~10KB each)
  images/options/opt-NN.jpg          (fallback)

Pipeline per image:
  1. pdfimages -j to extract embedded JPEG(s) from the PDF
  2. ImageMagick convert -channel cmyk -negate -colorspace sRGB
     (the inverted-CMYK trick that gives correct colors)
  3. Resize to web-friendly width
  4. Re-encode as WebP (q=80) and JPEG (q=85)

Dependencies:
  pdfimages (poppler-utils):  brew install poppler   /  apt install poppler-utils
  convert (ImageMagick):      brew install imagemagick
  WebP support comes with modern ImageMagick builds

Usage:
  python3 build_images.py
  python3 build_images.py --pdf-dir /path/to/pdfs
  python3 build_images.py --tanks-only
  python3 build_images.py --options-only
"""
from __future__ import annotations
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent
DEFAULT_PDF_DIR = REPO / "source-pdfs"
TANK_OUT = REPO / "images" / "tanks"
OPT_OUT = REPO / "images" / "options"

# Maps each tank ID in chart-data.json to its source PDF and (optionally) which
# tank section in that PDF (since some PDFs contain multiple tanks).
# When `image_index` is set, that's the 0-based index of the tank's hero among
# the embedded JPEGs > MIN_HERO_AREA on page 1; otherwise we pick the largest.
TANK_TO_PDF: dict[str, dict] = {
    # 230L
    "230L-HP-TF":           {"pdf": "230L-HP.pdf"},
    # 450L
    "450L-HP-DOT":          {"pdf": "450L-HP-DOT.pdf"},
    "450L-HP-ASME":         {"pdf": "450L-HP-ASME.pdf"},
    "450L-VHP-DOT":         {"pdf": "450L-DOT-VHP.pdf"},
    "450L-VHP-ASME":        {"pdf": "450L-ASME-VHP.pdf"},
    "450L-ZX-VHP":          {"pdf": "450ZX-VHP.pdf"},
    # 700L
    "700L-HP-TF":           {"pdf": "700L.pdf"},
    # 1000L
    "1000L-HP-TF":          {"pdf": "1000L.pdf"},
    "1000L-VHP-TF":         {"pdf": "1000L-VHP-topfill-flexfill.pdf"},
    "1000L-VHP-FF":         {"pdf": "1000L-VHP-topfill-flexfill.pdf"},
    # 1500L
    "1500L-HP-TF":          {"pdf": "1500L.pdf"},
    "1500L-VHP-TF":         {"pdf": "1500L-VHP-topfill-flexfill.pdf"},
    "1500L-VHP-FF":         {"pdf": "1500L-VHP-topfill-flexfill.pdf"},
    "1500L-ZX-VHP":         {"pdf": "1500L-3000L-ZX-VHP.pdf"},
    # 2000L
    "2000L-HP-TF":          {"pdf": "2000L-HP-topfill-flexfill.pdf"},
    "2000L-HP-FF":          {"pdf": "2000L-HP-topfill-flexfill.pdf"},
    "2000L-VHP-TF":         {"pdf": "2000L-VHP-topfill-flexfill.pdf"},
    "2000L-VHP-FF":         {"pdf": "2000L-VHP-topfill-flexfill.pdf"},
    # 3000L
    "3000L-HP-TF":          {"pdf": "3000L-HP-topfill-flexfill.pdf"},
    "3000L-HP-FF":          {"pdf": "3000L-HP-topfill-flexfill.pdf"},
    "3000L-VHP-TF":         {"pdf": "3000L-VHP-topfill-flexfill.pdf"},
    "3000L-VHP-FF":         {"pdf": "3000L-VHP-topfill-flexfill.pdf"},
    "3000L-ZX-VHP":         {"pdf": "1500L-3000L-ZX-VHP.pdf"},
    # 5500L / 7000L
    "5500L-MP-FF":          {"pdf": "5500L-MP.pdf"},
    "5500L-VHP-FF":         {"pdf": "5500L-VHP.pdf"},
    "7000L-VHP-FF":         {"pdf": "7000L-VHP.pdf"},
    # Perma-Max CO2 family
    "permamax-2200lb-HP-CO2":   {"pdf": "permamax-HP-CO2.pdf",      "page": 1},
    "permamax-3300lb-HP-CO2":   {"pdf": "permamax-HP-CO2.pdf",      "page": 2},
    "permamax-4400lb-HP-CO2":   {"pdf": "permamax-HP-CO2.pdf",      "page": 3},
    "permamax-6000lb-HP-CO2":   {"pdf": "permamax-HP-CO2.pdf",      "page": 4},
    "permamax-12000lb-VHP-CO2": {"pdf": "permamax-VHP-5500L-CO2.pdf"},
}

# Min image area (px²) to be considered a "hero" candidate (filters out tiny logos)
MIN_HERO_AREA = 100_000

TANK_HERO_WIDTH = 600
OPTION_WIDTH = 280

WEBP_QUALITY = 80
JPEG_QUALITY = 85


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def list_embedded_images(pdf: Path) -> list[dict]:
    """Run `pdfimages -list` and parse out per-image metadata."""
    p = subprocess.run(["pdfimages", "-list", str(pdf)],
                       capture_output=True, text=True, check=True)
    rows = []
    for line in p.stdout.splitlines():
        m = re.match(
            r"\s*(\d+)\s+(\d+)\s+(\w+)\s+(\d+)\s+(\d+)\s+(\w+)\s+\d+\s+\d+\s+(\w+)",
            line,
        )
        if not m:
            continue
        rows.append({
            "page": int(m.group(1)),
            "num": int(m.group(2)),
            "type": m.group(3),
            "width": int(m.group(4)),
            "height": int(m.group(5)),
            "color": m.group(6),
            "encoding": m.group(7),
        })
    return rows


def extract_all_jpegs(pdf: Path, into: Path, prefix: str = "img") -> list[Path]:
    """Use pdfimages -j to extract embedded JPEGs into `into` directory."""
    into.mkdir(parents=True, exist_ok=True)
    run(["pdfimages", "-j", "-p", str(pdf), str(into / prefix)])
    return sorted(into.glob(f"{prefix}-*.jpg"))


def cmyk_invert_to_srgb(src: Path, dst: Path) -> None:
    """Apply the CMYK-inverted trick to get correct sRGB colors from CMYK JPEGs."""
    run(["convert", str(src), "-channel", "cmyk", "-negate",
         "-colorspace", "sRGB", str(dst)])


def resize_and_encode(src: Path, out_webp: Path, out_jpg: Path, target_width: int) -> None:
    """Resize src to ~target_width and emit both .webp and .jpg fallbacks."""
    out_webp.parent.mkdir(parents=True, exist_ok=True)
    # WebP
    run([
        "convert", str(src),
        "-resize", f"{target_width}x>",
        "-strip",
        "-quality", str(WEBP_QUALITY),
        str(out_webp),
    ])
    # JPEG fallback
    run([
        "convert", str(src),
        "-resize", f"{target_width}x>",
        "-strip",
        "-quality", str(JPEG_QUALITY),
        "-background", "white", "-flatten",
        str(out_jpg),
    ])


def find_hero_jpeg_for_tank(extracted: list[Path], tank_meta: dict) -> Path | None:
    """Pick the appropriate hero JPEG for a given tank from a PDF's extracted set.

    Strategy:
      * Filter to JPEGs with area > MIN_HERO_AREA (skip logos, thumbnails).
      * If tank_meta["page"] is set (Perma-Max: separate tank per PDF page),
        prefer JPEGs on that page.
      * Otherwise pick the largest JPEG on page 1 (always the hero in the
        Chart catalog layout).
      * For the second-tank-on-the-page case (Top Fill + FlexFill in same
        spread), the hero photos are typically also on page 1 - we use the
        order of extraction (which follows page reading order).
    """
    candidates = []
    for p in extracted:
        # filenames are: prefix-PPP-NNN.jpg where PPP = page, NNN = num
        m = re.match(r".+-(\d+)-(\d+)\.jpg$", p.name)
        if not m:
            continue
        page = int(m.group(1))
        # We need image dimensions to filter; identify is fast
        try:
            r = subprocess.run(["identify", "-format", "%w %h", str(p)],
                               capture_output=True, text=True, check=True)
            w, h = map(int, r.stdout.split())
        except Exception:
            continue
        area = w * h
        if area < MIN_HERO_AREA:
            continue
        candidates.append((page, area, p))

    if not candidates:
        return None

    target_page = tank_meta.get("page", 1)
    same_page = [c for c in candidates if c[0] == target_page]
    pool = same_page or candidates
    pool.sort(key=lambda c: c[1], reverse=True)
    return pool[0][2]


def build_tanks(pdf_dir: Path) -> list[str]:
    issues: list[str] = []
    print(f"\n=== Building tank hero images ===")
    TANK_OUT.mkdir(parents=True, exist_ok=True)

    # Cache: each PDF is processed once, then we pick from its extracted set
    # for every tank that points to it.
    pdf_to_extracted: dict[str, list[Path]] = {}

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)

        # Group tank IDs by source PDF, then pick the best image per tank.
        # For multi-tank PDFs we currently reuse the same hero across tanks
        # (e.g. 1000L-VHP-TF and 1000L-VHP-FF share their PDF's hero photo).
        # If you want distinct heroes per fill type later, override per-tank
        # in TANK_TO_PDF with a custom 'image_index'.
        for tank_id, meta in TANK_TO_PDF.items():
            pdf = pdf_dir / meta["pdf"]
            if not pdf.exists():
                issues.append(f"  MISSING {pdf.name} (skipping {tank_id})")
                continue

            if meta["pdf"] not in pdf_to_extracted:
                stub = re.sub(r"[^A-Za-z0-9._-]+", "_", meta["pdf"])
                pdf_to_extracted[meta["pdf"]] = extract_all_jpegs(pdf, td, stub)

            extracted = pdf_to_extracted[meta["pdf"]]
            hero = find_hero_jpeg_for_tank(extracted, meta)
            if hero is None:
                issues.append(f"  NO HERO found in {pdf.name} for {tank_id}")
                continue

            srgb = td / f"{tank_id}.srgb.jpg"
            cmyk_invert_to_srgb(hero, srgb)
            out_webp = TANK_OUT / f"{tank_id}.webp"
            out_jpg = TANK_OUT / f"{tank_id}.jpg"
            resize_and_encode(srgb, out_webp, out_jpg, TANK_HERO_WIDTH)
            print(f"  ✓ {tank_id:30s} {out_webp.name}  ({out_webp.stat().st_size:>6,}b webp,"
                  f" {out_jpg.stat().st_size:>6,}b jpg)")

    return issues


# Map from catalog option number → 1-based index of the embedded JPEG on
# page 1 of options-1-18.pdf, in pdfimages extraction order.
#
# Verified by visual audit of all 13 page-1 images.  Identity mapping for
# #1–#12; #13–#18 (the six bulk-fill-kit rows) share the single bayonet
# photo at idx 13 — the catalog uses tables (no per-row images) for those.
OPTION_IMAGE_MAP = {
    1:  1,    # wall box
    2:  2,    # PB vaporizer coil
    3:  3,    # pallet base
    4:  4,    # SS plumbing
    5:  5,    # vent-out safety piping
    6:  6,    # fill isolation valve kit
    7:  7,    # horizontal shipping kit
    8:  8,    # dual safeties + rupture discs
    9:  9,    # phase line tee
    10: 10,   # phase line isolation valves
    11: 11,   # dual regulating manifolds
    12: 12,   # VJ valve + bayonet
    13: 13, 14: 13, 15: 13,  # top-fill bulk fill kit (shared photo)
    16: 13, 17: 13, 18: 13,  # flex-fill bulk fill kit (shared photo)
}


def build_options(pdf_dir: Path) -> list[str]:
    issues: list[str] = []
    print(f"\n=== Building add-on option images ===")
    OPT_OUT.mkdir(parents=True, exist_ok=True)
    pdf = pdf_dir / "options-1-18.pdf"
    if not pdf.exists():
        return [f"  MISSING {pdf.name}"]

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        extracted = extract_all_jpegs(pdf, td, "opt")
        # Filter to page-1 images only, in extraction order, that meet min area
        page1 = []
        for p in extracted:
            m = re.match(r".+-(\d+)-(\d+)\.jpg$", p.name)
            if not m: continue
            if int(m.group(1)) != 1: continue
            r = subprocess.run(["identify", "-format", "%w %h", str(p)],
                               capture_output=True, text=True, check=True)
            w, h = map(int, r.stdout.split())
            if w * h < 30_000:  # filter small icons
                continue
            page1.append(p)

        if not page1:
            return ["  No page-1 option photos found"]

        for opt_n in range(1, 19):
            idx_1based = OPTION_IMAGE_MAP.get(opt_n)
            if idx_1based is None:
                print(f"  ⊘ #{opt_n:02d}  no mapped image (will use placeholder)")
                continue
            if idx_1based - 1 >= len(page1):
                issues.append(f"  #{opt_n}: image index {idx_1based} out of range")
                continue
            src = page1[idx_1based - 1]
            srgb = td / f"opt-{opt_n:02d}.srgb.jpg"
            cmyk_invert_to_srgb(src, srgb)
            out_webp = OPT_OUT / f"opt-{opt_n:02d}.webp"
            out_jpg = OPT_OUT / f"opt-{opt_n:02d}.jpg"
            resize_and_encode(srgb, out_webp, out_jpg, OPTION_WIDTH)
            print(f"  ✓ #{opt_n:02d}  {out_webp.name}  ({out_webp.stat().st_size:>5,}b webp,"
                  f" {out_jpg.stat().st_size:>5,}b jpg)")

    return issues


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf-dir", default=str(DEFAULT_PDF_DIR),
                    help="Directory containing the source PDFs (default: ./source-pdfs)")
    ap.add_argument("--tanks-only", action="store_true")
    ap.add_argument("--options-only", action="store_true")
    args = ap.parse_args()

    pdf_dir = Path(args.pdf_dir).resolve()
    if not pdf_dir.exists():
        print(f"FATAL: PDF dir not found: {pdf_dir}", file=sys.stderr)
        print(f"  Hint: copy your tank PDFs + options-1-18.pdf into {pdf_dir}/",
              file=sys.stderr)
        return 2

    # Verify dependencies
    for tool in ("pdfimages", "convert"):
        if shutil.which(tool) is None:
            print(f"FATAL: '{tool}' not found in PATH", file=sys.stderr)
            print("  macOS:  brew install poppler imagemagick", file=sys.stderr)
            return 2

    issues: list[str] = []
    if not args.options_only:
        issues += build_tanks(pdf_dir)
    if not args.tanks_only:
        issues += build_options(pdf_dir)

    print()
    if issues:
        print("Issues:")
        for s in issues:
            print(s)
        return 1
    print(f"✓ Done. {len(list(TANK_OUT.glob('*.webp')))} tank images, "
          f"{len(list(OPT_OUT.glob('*.webp')))} option images.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
