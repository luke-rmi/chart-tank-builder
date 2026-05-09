# Session Notes — read this first

You're picking up a project Luke (webtech@rmimfg.com) has been building with Claude in Cowork mode. This file is the handoff brief. Read it, then read `DEPLOYMENT.md` and `v2-brief.md`, and you'll be caught up in ~5 minutes.

## What this project is

A web-based configurator that walks Ratermann Manufacturing customers through building a Chart microbulk tank order. The user picks a **gas type** (Step 1 — new), then size, then pressure/fill type, then runs through tank-specific config questions, then opts into add-on accessories. They get a downloadable PDF with all part numbers and a "Contact Sales" button that fires a mailto to sales@rmimfg.com.

It's deployed as a static site on **GitHub Pages** (`luke-rmi/chart-tank-builder` repo) and embedded in **Webflow** via an iframe on a standalone page off the RMI domain. Source PDFs are Chart's catalog spreads from `source-pdfs/` (gitignored — not deployed).

## Current state — what's shipped

Four rounds in, last session added v2.2 changes (not yet committed):

```
[pending]  v2.2: gas type step, GSK auto-filter, contact sales, opt-04 fix, scroll/nowrap fixes
46814aa    v2.1: replace opt-04 (SS plumbing) image with cleaner source
5d41e79    v2.1: hero in summary, sticky-scroll, larger option cards
4ec4b07    v2: add product images (31 tank heroes + 18 option photos)
a51a0e0    v2: image support, Step 3 cleanup, mobile polish
79c91e0    Initial chart tank builder
```

Luke's day-to-day workflow is: edit `Chart Tank Data.xlsx` → run `./regenerate.sh` → commit + push → live in ~60s.

**Important after v2.2:** `chart-data.json` was hand-edited to fix opt-04's empty image path. If Luke runs `./regenerate.sh`, it will regenerate from the xlsx — make sure the xlsx also has `images/options/opt-04.webp` in the image column for Option 4, or the fix will be lost.

## Folder orientation

```
index.html, chart-builder.css, chart-builder.js, chart-data.json   ← runtime
images/tanks/*.webp + .jpg                                         ← 31 hero photos
images/options/opt-NN.webp + .jpg                                  ← 18 option photos
Chart Tank Data.xlsx                                               ← source of truth (Luke edits this)
xlsx_to_json.py                                                    ← spreadsheet → JSON
build_xlsx.py                                                      ← (rare) JSON → spreadsheet, after schema changes
build_images.py + make-images.sh                                   ← (rare) PDFs → web images
regenerate.sh                                                      ← runs xlsx_to_json.py
DEPLOYMENT.md                                                      ← end-user setup + ongoing edit guide
v2-brief.md                                                        ← the v2 plan we executed
SESSION-NOTES.md                                                   ← this file
_legacy/                                                           ← historical, not deployed
source-pdfs/                                                       ← gitignored, local only
```

## Architecture decisions already made (don't re-litigate)

- **Static site, no backend.** GitHub Pages serves four files + images. Fetch loads `chart-data.json` at runtime so data updates only need a JSON push, not a redeploy.
- **Spreadsheet is the source of truth for content.** Luke edits XLSX → script regenerates JSON. Don't introduce a database.
- **Embedded in Webflow via iframe.** Not a Webflow component. Keeps styling isolated.
- **Single-option steps auto-skip.** When `step.options.length === 1`, the JS auto-selects and hides the panel so the user never sees it.
- **VJ valve on Option #12, not in Tank Model.** Five tanks (1000/1500/2000/3000 HP TopFill, 5500L MP) have VJ-L/VJ-R variants. They live in `tank.vjvLeft.partNumber` / `tank.vjvRight.partNumber`; Option #12 dynamically pulls the right part # for the selected tank.
- **Sticky summary with internal scroll.** When the summary panel is taller than viewport, it scrolls internally.
- **Add-on options as a card grid** (image on top, content below). Auto-fill columns; mobile collapses to 2-up then 1-up.

## Conventions worth knowing

- **Tank IDs:** kebab-case `<size>-<class>-<fill>`, e.g. `5500L-MP-FF`, `2000L-HP-TF`, `permamax-2200lb-HP-CO2`.
- **Part numbers** are case-sensitive `PERMA-...` or `PERMAM-...`. Real customer-facing data — never guess one. If you don't know it, ask or check the spreadsheet.
- **Image paths** in JSON are relative to repo root: `images/tanks/<tank-id>.webp` and `images/options/opt-NN.webp`. WebP primary, JPEG fallback (the JS auto-falls-back).
- **Commit messages:** descriptive, multi-line. Group related changes. Luke pushes manually from Cursor since git auth isn't available in the sandbox.

## Local dev workflow

- Test live: `cd ~/Desktop/CHARTBUILDER/chart-tank-builder && python3 -m http.server 8000` → open `http://localhost:8000/`.
- Lint JS: `node --check chart-builder.js`.
- Spreadsheet roundtrip: `python3 xlsx_to_json.py` — should produce equivalent JSON.
- Image rebuild (only if source PDFs change): drop PDFs into `source-pdfs/`, run `./make-images.sh`. Requires `brew install poppler imagemagick webp` on macOS.

## v2.2 architecture — decisions made this session

- **Gas type is Step 1.** Choices: Oxygen (O₂), Argon (Ar), Nitrogen (N₂), CO₂. Stored as `state.gasType`. Selecting CO₂ filters the tank list to permamax tanks only; others filter to non-permamax.
- **GSK auto-filter.** `getEffectiveOptions()` strips Gas Service Label Kit options to only those matching the selected gas (detected from hyphen-separated part-number segments: `-AR-`, `-NI-`, `-OX-`, `-CO2-`, with label-name fallback). Permamax GSK options (service types: Beverage/Bulk Fill/Vapor Balance) have no gas codes — they're kept as-is. Single-option GSK steps auto-select and hide.
- **Option #8 suppressed when Dual Relief Kit configStep exists.** `hasDualReliefKitStep()` checks configSteps for a step whose name contains "dual relief". If found, Option #8 (Dual Safeties & Rupture Discs) is skipped in the add-ons grid — they're the same concept, confirmed by Luke.
- **Contact Sales replaces Copy button.** Opens a full-screen overlay modal. Left col = live config summary. Right col = form (name, company, email, phone — all required). Submit fires a `mailto:sales@rmimfg.com` link with all details pre-filled in the body, and simultaneously downloads the PDF. No backend or third-party service needed.
- **Part numbers never wrap.** `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` on all `.pn` elements.
- **Summary scroll bug fixed.** `overscroll-behavior: contain` on `.summary-scroll` prevents the sticky panel's internal scroll from hijacking page scroll when the cursor is over it.
- **opt-04 image fixed.** The `chart-data.json` had `"image": ""` for Option 4. Fixed to `"images/options/opt-04.webp"`. The source PNG was also re-processed from `source-pdfs/option-source-images/opt-04-source.png` into fresh webp + jpg files.

## Gotchas the previous session learned the hard way

- **CMYK-inverted JPEG trick.** Chart catalog PDFs store images as CMYK. Straight CMYK→sRGB conversion comes out near-black. The fix is `convert -channel cmyk -negate -colorspace sRGB`. Encoded in `build_images.py`.
- **Option image mapping.** Initially I assumed pdfimages extracts in catalog reading order *and* skips option #4 (no photo). Both wrong: order is identity (#1 → idx-01, #2 → idx-02, etc.) for #1–#12, with #13–#18 sharing one bayonet photo at idx-13. Fixed in `OPTION_IMAGE_MAP`. Re-verify visually if you ever change the source PDF.
- **The opt-04 photo got swapped.** Auto-extraction worked but Luke supplied a cleaner full-tank shot. If you regenerate option images via `make-images.sh`, that swap will be lost — re-run the manual swap from `source-pdfs/option-source-images/opt-04-source.png`.
- **Sandbox can't push to GitHub.** Git auth lives on Luke's Mac. I commit locally; he pushes from Cursor or terminal. Don't try to set up auth in the sandbox.
- **Source PDFs aren't always mounted.** They live outside the workspace folder some sessions. If you need to re-extract images and don't see `source-pdfs/`, ask Luke to copy them in.
- **Don't commit `source-pdfs/` or `_img_preview_*` files.** Both are gitignored. Don't fight the gitignore.

## Open items / what Luke might bring up next

**Rex agent integration (next major thread).** Luke has an existing AI chat support agent named Rex (running on Claude). He wants Rex to drive this configurator conversationally — customer never leaves the chat, Rex provides a PDF at the end. We've discussed the architecture but not built it. Three open decisions before implementation:

- Where Rex runs (claude.ai project, custom React widget, third-party support tool?).
- Whether Rex can call backend tools (function calling enabled?).
- Whether to deliver the PDF in-chat (needs a small PDF backend) or via deep-link to the existing tool (needs the tool to accept `?config=BASE64JSON`).

My recommended approach when we get there: give Rex a single `lookup_tank_config(tank_id, selections)` tool that wraps the same logic as the JS, plus a `generate_pdf(config)` tool. Rex handles all the conversation; the tools handle the data. See the chat transcript for full design discussion if available.

**Other potential work** Luke has hinted at: matching the Webflow site's exact branding (currently uses RMI blue but generic styling), adding a custom subdomain (`tools.rmimfg.com`), and possibly server-side email submission of completed configurations to RMI sales. None of these are scheduled.

## Working with Luke

Luke is technical-adjacent (uses Cursor + GitHub, runs his own deploys) but isn't a full-time developer. He prefers honest tradeoffs over confident certainty, asks "if it's not a big deal" before requesting changes, and appreciates being told upfront when something's worth doing vs. when to defer. He'll push back on anything that adds complexity without clear value.

He maintains the Excel spreadsheet himself and may make data edits between sessions. Don't assume `chart-data.json` is unchanged from when you last saw it — re-read the file.

When in doubt, do the smaller version of the change first, show him, then expand if he wants more.
