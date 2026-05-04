# v2 — Visual upgrade + Step 3 cleanup

Two threads to land together: add product imagery, and clean up the redundant "Tank Model" step.

## 1. Imagery: extract product photos from the source PDFs

Build a Python script `build_images.py` that runs once after any PDF update and produces the full set of web-ready assets.

Pipeline per image:

- `pdfimages -j -p <source.pdf> /tmp/imgs/<basename>`
- For each extracted JPEG: ImageMagick `convert -channel cmyk -negate -colorspace sRGB` (this is the trick that gives correct colors — straight CMYK→sRGB comes out near-black)
- Resize and re-encode as WebP quality 80 (fall back to JPEG quality 85 for older browsers via `<picture>` element)

**Tank hero images:**

- One per tank. Source: largest embedded image on page 1 of each tank PDF (always the front-of-tank product shot on white).
- Output: `images/tanks/<tank-id>.webp`, ~600 px wide, ~25 KB each.
- Multi-tank PDFs (top/flex pairs, ZX-VHP 1500/3000, Perma-Max CO2 family): pull the distinct heroes where present; reuse where the catalog only has one shot.

**Add-on option images:**

- 13 photos in `options-1-18.pdf` cover most of options 1–18.
- Output: `images/options/opt-01.webp` through `opt-18.webp`, ~280 px wide, ~10 KB each.
- Options without a dedicated photo (likely #4, #8, #11) get an SVG placeholder icon, no broken images.

**Spreadsheet integration:**

- Add an "Image Path" column to the Tanks sheet and the Add-On Options sheet.
- `xlsx_to_json.py` copies these into `chart-data.json`.
- JS uses them to render thumbnails and gracefully handles missing/empty paths.

## 2. Step 3 cleanup: auto-skip and resolve VJ duplication

Today: 22 of 31 tanks have only 1 option at the "Tank Model" step (Step 3). Forcing a click there is busywork. The 9 multi-option tanks split into two cases:

- **Genuine product variants** (230L, 450L-HP-DOT, Perma-Max 4400/6000): keep the choice — these are real internal-coil-vs-vaporizer or gas-specific picks.
- **Vacuum-Jacketed Valve options** (1000/1500/2000/3000 HP TopFill, 5500L MP FlexFill): these duplicate add-on Option #12. The user could pick "Perma-Cyl 1000 HP Vacuum Jacket Valve Right" at Step 3 *and* tick Option #12.

**Resolution:** remove VJ-L/VJ-R rows from the Tank Model step — keep only the base tank row. Move the VJ part numbers (per tank) into a new tank-level field used by Option #12's variant list, so #12 dynamically shows the right part # for the selected tank. Net effect:

- Step 3 becomes 1-option for those tanks → auto-skip applies.
- Option #12 becomes the single source of truth for VJ choice.

**UI rule:** any time a `configSteps` step has exactly 1 option, auto-select it and don't render the panel. The selection still flows into the summary as before.

## 3. Visual layout (default — proceed unless told otherwise)

**Tank hero image:**

- Appears above the per-tank step panels the moment a tank is selected. Single panel, white background, 1 px hairline border, subtle shadow, 12 px rounded corners.
- Desktop: 240 px tall, image centered, ~30 px breathing room on each side.
- Mobile (<900 px): 160 px tall.
- No caption overlay — the existing panel headers already say the tank name.

**Add-on option thumbnails:**

- 56×56 px image on the far left of each `.addon` row, before the checkbox. 8 px rounded corners, light gray border, white background.
- Mobile: 44×44 px.
- Rows with no image render with the same square footprint but a flat neutral icon, so layout stays even.
- Hover/focus: gentle 1.02 scale + lift the shadow.

**Step 1 (size grid) and Step 2 (pressure/fill cards):**

- Stay text-only. Thumbnails on those small buttons would clutter without adding value.

**Summary panel (right column):**

- Stays text-only. It's a part-number list, not a marketing surface.

**PDF export:**

- Add the tank hero image to the top right of page 1, ~140 px tall.
- Skip option thumbnails in the PDF — keep it scannable.

**Mobile pass:**

- Confirm the layout collapses cleanly at 380 px and 600 px breakpoints. Hero image, add-on thumbs, step buttons all need to feel tight without horizontal scroll.

## 4. Deliverables

- `build_images.py` + a `make-images.sh` wrapper.
- `images/tanks/*.webp` (and .jpg fallbacks).
- `images/options/*.webp` (and .jpg fallbacks).
- Updated `chart-builder.css` with hero-image and thumbnail styles.
- Updated `chart-builder.js` with: (a) auto-skip rule for single-option steps, (b) hero rendering, (c) add-on thumbnail rendering, (d) Option #12 dynamic variant from tank data.
- Updated `chart-data.json` schema: tanks gain `heroImage` and `vjvLeft.partNumber` / `vjvRight.partNumber` fields where applicable; `addOnOptions` gain `image` field.
- Updated `Chart Tank Data.xlsx` with new image-path columns and VJ-part-# columns; `xlsx_to_json.py` reads them.
- Updated `DEPLOYMENT.md` noting the image build step (`./make-images.sh` after PDF updates, then commit the generated images alongside the JSON).

**Acceptance:** every tank in the configurator shows its hero photo; add-on rows show their thumbnails; Step 3 silently disappears for single-option tanks; VJ choice happens only via Option #12; mobile layout passes a manual eyeball test at 380 px width.
