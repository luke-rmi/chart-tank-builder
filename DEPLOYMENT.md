# Chart Microbulk Tank Builder · Deployment & Update Guide

This folder contains a small static web app — four files (`index.html`,
`chart-builder.css`, `chart-builder.js`, `chart-data.json`) — plus the
spreadsheet and Python scripts that drive the data.

You will host the four web files on **GitHub Pages** (free, instant, served
over HTTPS) and embed the live page into your Webflow site via an iframe.
Editing data is then a four-step loop in Cursor: edit XLSX → run script →
commit → push.

---

## Folder contents

```
chart-tank-builder/
├── index.html              ← The page. Loads CSS + JS + JSON.
├── chart-builder.css       ← Styles.
├── chart-builder.js        ← Logic. Fetches chart-data.json at runtime.
├── chart-data.json         ← Tank + option data (the only file that changes day-to-day).
├── images/
│   ├── tanks/<tank-id>.webp + .jpg      ← Hero image per tank.
│   └── options/opt-NN.webp + .jpg       ← Add-on option photos.
├── source-pdfs/            ← Source Chart catalog PDFs (used by build_images.py).
├── Chart Tank Data.xlsx    ← Editable spreadsheet (source of truth for content).
├── xlsx_to_json.py         ← Converts the spreadsheet to chart-data.json.
├── build_xlsx.py           ← (Rare) Rebuilds the spreadsheet from JSON after schema changes.
├── build_images.py         ← Extracts product photos from PDFs.
├── make-images.sh          ← Wrapper for build_images.py.
├── regenerate.sh           ← Runs xlsx_to_json.py.
├── DEPLOYMENT.md           ← This file.
├── v2-brief.md             ← Record of v2 changes.
└── _legacy/                ← Earlier prototype backups. Not deployed.
```

Files served on the live site: **index.html, chart-builder.css, chart-builder.js,
chart-data.json, images/**. Everything else is local tooling.

---

## Part 1 · One-time setup: GitHub repo + GitHub Pages

You only do this once.

### 1.1 Create a new GitHub repo

1. Go to <https://github.com/new>.
2. Repo name: `chart-tank-builder` (or anything you prefer).
3. Visibility: **Public** (required for free GitHub Pages — fine since this
   contains no secrets, only catalog data).
4. Tick **"Add a README file"** (gives the repo an initial commit so Cursor
   can clone it cleanly).
5. Click **Create repository**.

### 1.2 Clone the repo into Cursor

Two equivalent paths — pick whichever feels natural:

**Cursor command palette path**

1. In Cursor, hit `⌘⇧P` and type **"Git: Clone"** → enter the repo URL
   (`https://github.com/<your-username>/chart-tank-builder.git`).
2. Pick a folder on your Mac to clone into. I'd suggest something like
   `~/Sites/chart-tank-builder`.
3. When Cursor asks "Open the cloned repository?" — click **Open**.

**Terminal path** (if you prefer)

```bash
cd ~/Sites
git clone https://github.com/<your-username>/chart-tank-builder.git
cd chart-tank-builder
cursor .
```

### 1.3 Copy the project files into the repo

Open Finder side-by-side with the cloned repo folder.

From this folder (`Chart Microbulk Builder/`), copy these files into the
repo root (top level):

- `index.html`
- `chart-builder.css`
- `chart-builder.js`
- `chart-data.json`
- `Chart Tank Data.xlsx`
- `xlsx_to_json.py`
- `regenerate.sh`
- `DEPLOYMENT.md`

You do **not** need to copy `_legacy/` — leave that here as a backup.

### 1.4 First commit + push

In Cursor's Source Control panel (the branch icon on the left rail):

1. You'll see all the files listed under "Changes".
2. Click the `+` next to "Changes" to **stage all**.
3. Type a commit message: `Initial chart tank builder`.
4. Click **Commit**.
5. Click **Sync** (or **Push**) — Cursor will push to GitHub.

(Or via terminal: `git add . && git commit -m "Initial chart tank builder" && git push`.)

### 1.5 Enable GitHub Pages

1. On GitHub.com, open your repo → **Settings** (top tab).
2. Left sidebar → **Pages**.
3. Under "Build and deployment":
   - Source: **Deploy from a branch**
   - Branch: **main** / Folder: **/ (root)**
4. Click **Save**.
5. Wait ~30–60 seconds. Refresh the page; you should see a green box:
   > **Your site is live at `https://<your-username>.github.io/chart-tank-builder/`**

That URL is your live page. Open it in a browser and confirm the tank
builder loads, you can pick a size, and selections show up in the
summary panel. (If you see "Failed to load tank data," wait another
30 seconds — GitHub Pages can take a moment on first deploy.)

### 1.6 (Optional) Custom subdomain

If you want the tool at `tools.rmimfg.com` instead of the github.io URL:

1. In your domain DNS (whoever you use — GoDaddy, Cloudflare, etc.), add a
   **CNAME** record:
   - Host: `tools`
   - Points to: `<your-username>.github.io`
2. In the GitHub repo → **Settings → Pages → Custom domain**, type
   `tools.rmimfg.com` → Save.
3. Tick **Enforce HTTPS** once it's available (~1–24 hours later).

You can skip this if you just want to launch the prototype quickly — the
github.io URL works fine inside an iframe.

---

## Part 2 · Embedding in Webflow

You'll add an iframe to a standalone page on your Webflow site.

### 2.1 Create a new page in Webflow

1. In the Webflow Designer → **Pages** panel → **+** to add a new page.
2. Slug: `tank-builder` (or whatever — this becomes
   `rmimfg.com/tank-builder`).
3. Set the page layout however you want — header/footer or blank.

### 2.2 Drop in an Embed component

1. From the **Add Elements** panel, find **Embed** (under the Components
   group). Drag it onto the page where you want the configurator.
2. The embed editor opens. Paste this HTML, replacing the `src` URL with
   your actual GitHub Pages URL:

```html
<iframe
  src="https://luke-rmi.github.io/chart-tank-builder/"
  title="Chart Microbulk Tank Builder"
  loading="lazy"
  style="width:100%; min-height:1600px; border:0; display:block;"
  allow="clipboard-write"
></iframe>
```

3. Click **Save & Close**. You should see the live tank builder rendering
   inside the embed in the Designer preview.

### 2.3 Publish

Webflow → **Publish** → choose your domain. The page is live.

### Notes on iframe sizing

- The `min-height: 1600px` works well for the longest tank (5500L MP) on
  desktop. On mobile the iframe will scroll internally; that's expected.
- If the empty space below the configurator looks awkward, lower it to
  `1200px`. If selections get cut off at the bottom, raise to `1800px`.
- A future improvement is auto-resize via `postMessage`. For the prototype,
  fixed min-height is fine.

---

## Part 2.5 · Building product images (one-time + when PDFs change)

The configurator shows a hero photo per tank and a thumbnail per add-on option, all extracted from the original Chart catalog PDFs.

### One-time install (macOS)

```bash
brew install poppler imagemagick webp
```

### Generating the images

1. Drop the original Chart PDFs (`5500L-MP.pdf`, `1000L.pdf`, `options-1-18.pdf`, etc.) into a folder named `source-pdfs/` in the repo.
2. Run:

```bash
./make-images.sh
```

This produces:

- `images/tanks/<tank-id>.webp` and `.jpg` — one hero photo per tank.
- `images/options/opt-NN.webp` and `.jpg` — one photo per add-on option (where the catalog has one).

3. Commit `images/` along with your other changes. Don't commit `source-pdfs/` — those are large and not used at runtime; add `source-pdfs/` to `.gitignore`.

If a PDF is ever revised, replace the file in `source-pdfs/` and re-run `./make-images.sh`. The script overwrites prior outputs.

---

## Part 3 · Day-to-day update workflow

When you need to change something — add a new tank, fix a part number,
update an option — you'll touch the spreadsheet, regenerate the JSON,
and push.

### 3.1 Open the project in Cursor

Open the cloned repo folder in Cursor (`File → Open Folder` if it's not
already in your recents).

### 3.2 Edit the spreadsheet

1. Double-click `Chart Tank Data.xlsx` in Finder (Cursor itself can't
   edit XLSX). It opens in Excel / Numbers.
2. Edit the relevant sheet:
   - **Tanks** — to add a brand-new tank or change a display name.
   - **Config Steps** — to add/edit the per-tank step options (the bulk
     of the data).
   - **Add-On Options / Add-On Variants** — the catalog options 1–18.
   - **Applicability** — for any tank, toggle which of options 1–18 apply
     and which are auto-included as Standard.
   - **Standard Includes** — items shown in the summary's "Standard
     (Included)" section.
3. **Save** (`⌘S`). Important: keep it as `.xlsx`, not `.xlsm` or `.csv`.

### 3.3 Regenerate the JSON

In Cursor's terminal (`⌃` + ` `):

```bash
./regenerate.sh
```

You should see:

```
Wrote chart-data.json
  tanks: 31  add-ons: 18

✓ chart-data.json updated.
```

If you get `python3: command not found`, install Python from
<https://python.org>. If you get `ModuleNotFoundError: openpyxl`, run:

```bash
pip3 install openpyxl
```

### 3.4 Test locally (optional but recommended)

In the same terminal:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000/> in a browser. The configurator should load
with your changes. `Ctrl+C` in the terminal to stop the server.

### 3.5 Commit and push from Cursor

In the Source Control panel:

1. You'll see `chart-data.json` (and `Chart Tank Data.xlsx` if you
   re-saved it) listed under "Changes".
2. Stage them (the `+` icon).
3. Commit message: e.g. `Update part numbers for 5500L MP` or
   `Add new 1500L HP FlexFill variant`.
4. **Commit**, then **Sync** / **Push**.

### 3.6 Wait for deploy

GitHub Pages redeploys automatically — usually **30–60 seconds**. The
public URL will pick up the new `chart-data.json` on the next page load.
The JS already cache-busts the JSON file, so users see fresh data right
away.

### 3.7 Verify on live

Open the Webflow page (or the GitHub Pages URL directly) and confirm the
change. If you see stale data, hard-refresh: **`⌘⇧R`** on Mac.

---

## Part 4 · Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Live page shows "Failed to load tank data" | `chart-data.json` missing or wrong filename | Confirm the file is at the repo root and named exactly `chart-data.json` (hyphen, lowercase). |
| Old data still showing after push | Browser cache, or GitHub Pages still building | Hard refresh (`⌘⇧R`). Check the repo's **Actions** tab — there's a "pages build and deployment" run that should be green. |
| `regenerate.sh: command not found` | Script isn't executable | Run `chmod +x regenerate.sh` once, or just invoke it as `bash regenerate.sh`. |
| `ModuleNotFoundError: openpyxl` | Python deps not installed | `pip3 install openpyxl` |
| Iframe in Webflow is mostly empty space below the tool | `min-height` too tall | Lower the iframe's `min-height` value in the embed. |
| Spreadsheet edit didn't show up after regenerate | Edited the wrong sheet, or didn't save | Re-open the XLSX, save, re-run `./regenerate.sh`. Check `chart-data.json` actually changed (`git diff chart-data.json`). |

---

## Part 5 · Adding a brand-new tank (advanced)

If RMI starts carrying a tank that isn't in the spreadsheet today:

1. **Tanks** sheet — add a new row. Pick a unique `Tank ID` (kebab-case,
   e.g. `9000L-VHP-FF`). Fill in display name, size, pressure class,
   fill type, PSI rating, standard, source PDF.
2. **Config Steps** sheet — add one row for every selectable option,
   in display order. Use the new Tank ID. Each row needs Step Order,
   Step Name, Option Order, Option Label, Part Number.
3. **Applicability** sheet — add 18 rows (one per add-on option 1–18)
   indicating whether each applies and whether it's Standard.
4. **Standard Includes** — add rows for any items that should be
   auto-included in the summary.
5. Save → `./regenerate.sh` → commit → push.

The `Size` value drives the Step 1 button group. If you use a brand-new
size that isn't in `SIZE_ORDER` (in `chart-builder.js`), you'll need to
add it to that array — that's the only JS edit required.

---

Questions, weirdness, or breakage: ping `webtech@rmimfg.com` or open
an issue in the GitHub repo.
