// Chart Microbulk Tank Builder · application logic (v2)
// Loads chart-data.json at runtime so data updates don't require redeploying the JS.

// =============================================================
// Data loading
// =============================================================
let CHART_DATA = null;

const DATA_URL = "chart-data.json?v=" + (new Date().getTime() % 100000);

async function loadData() {
  const res = await fetch(DATA_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching chart-data.json`);
  CHART_DATA = await res.json();
  if (!CHART_DATA.tanks?.length) throw new Error("chart-data.json has no tanks");
}

// =============================================================
// State
// =============================================================
const state = {
  size: null,
  pressureClass: null,
  tank: null,
  stepSelections: {},   // {stepIndex: option}
  addOns: {},           // {optionNumber: {checked, variant}}
};

// =============================================================
// Utilities
// =============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v != null) e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function tanksBySize() {
  const groups = {};
  for (const t of CHART_DATA.tanks) (groups[t.size] ??= []).push(t);
  return groups;
}

const SIZE_ORDER = ['230L','450L','700L','1000L','1500L','2000L','3000L','5500L','7000L','Perma-Max'];

const PRESSURE_LABELS = {
  'MP': 'MP · 250 PSI',
  'HP': 'HP · 350 PSI',
  'VHP': 'VHP · 500 PSI',
  'ZX-VHP': 'ZX-VHP · 500 PSI Skid',
  'HP-CO2': 'HP CO₂ · 350 PSI',
  'VHP-CO2': 'VHP CO₂ · 500 PSI',
};

// Auto-select single-option steps so user doesn't see them at all.
// Returns array of [originalIndex, step] that should be SHOWN to the user.
function visibleStepsFor(tank) {
  return tank.configSteps
    .map((step, idx) => [idx, step])
    .filter(([, step]) => step.options.length > 1);
}

// Make sure all single-option steps are auto-selected in state.
function autoSelectSingleSteps() {
  if (!state.tank) return;
  state.tank.configSteps.forEach((step, idx) => {
    if (step.options.length === 1 && !state.stepSelections[idx]) {
      state.stepSelections[idx] = step.options[0];
    }
  });
}

// Image fallback that swaps to .jpg if .webp fails.
function tankImg(src, tankName, sizing) {
  if (!src) return null;
  const img = el('img', {
    src,
    alt: tankName || '',
    loading: 'lazy',
    style: sizing || '',
    onerror: function() {
      // Try jpg fallback once
      if (!this.dataset.fallback) {
        this.dataset.fallback = '1';
        this.src = src.replace(/\.webp(\?.*)?$/, '.jpg$1');
      } else {
        // Hide quietly if both fail
        this.style.display = 'none';
      }
    },
  });
  return img;
}

// =============================================================
// Render
// =============================================================
function render() {
  const area = $('#steps-area');
  area.innerHTML = '';

  // Step 1 — Size
  area.appendChild(renderSizePanel());

  // Step 2 — Pressure & Fill
  if (state.size) area.appendChild(renderPressurePanel());

  if (state.tank) {
    autoSelectSingleSteps();

    // Hero image panel
    if (state.tank.heroImage) area.appendChild(renderHeroPanel());

    // Visible config steps (single-option steps are auto-selected & hidden)
    const visible = visibleStepsFor(state.tank);
    let visibleIdx = 0;
    visible.forEach(([originalIdx, step]) => {
      area.appendChild(renderStepPanel(step, originalIdx, visibleIdx + 3));
      visibleIdx++;
    });

    // Add-ons
    area.appendChild(renderAddOnsPanel());
  }

  renderSummary();
}

function renderSizePanel() {
  const groups = tanksBySize();
  const panel = el('section', {class: 'panel' + (state.size ? ' done' : '')});
  panel.appendChild(el('span', {class: 'step-tag'}, 'Step 1'));
  panel.appendChild(el('h2', {class: 'step-title'}, 'Choose a Tank Size'));
  panel.appendChild(el('p', {class: 'step-help'}, 'All Chart microbulk sizes available from RMI.'));

  const body = el('div', {class: 'step-body'});
  const grid = el('div', {class: 'button-grid'});
  for (const sz of SIZE_ORDER) {
    if (!groups[sz]) continue;
    const variants = [...new Set(groups[sz].map(t => t.pressureClass))];
    const btn = el('button', {
      class: 'opt-btn' + (state.size === sz ? ' selected' : ''),
      type: 'button',
      onclick: () => selectSize(sz),
    }, sz);
    btn.appendChild(el('span', {class: 'pn'}, variants.join(' · ')));
    grid.appendChild(btn);
  }
  body.appendChild(grid);
  panel.appendChild(body);

  if (state.size) {
    panel.appendChild(el('p', {class: 'step-confirm'}, '✓ ' + state.size));
  }
  return panel;
}

function renderPressurePanel() {
  const groups = tanksBySize();
  const tanks = groups[state.size] || [];
  const variants = [];
  for (const t of tanks) {
    const key = `${t.pressureClass}|${t.fillType}`;
    if (!variants.find(v => v.key === key)) variants.push({key, tank: t});
  }

  const panel = el('section', {class: 'panel' + (state.tank ? ' done' : '')});
  panel.appendChild(el('span', {class: 'step-tag'}, 'Step 2'));
  panel.appendChild(el('h2', {class: 'step-title'}, 'Choose Pressure & Fill Type'));
  panel.appendChild(el('p', {class: 'step-help'}, 'Available variants for the ' + state.size + '.'));

  const body = el('div', {class: 'step-body'});
  const grid = el('div', {class: 'button-grid'});
  for (const v of variants) {
    const t = v.tank;
    const fillBit = t.fillType === 'N/A' ? '' : ' · ' + (t.fillType === 'TopFill' ? 'Top Fill' : 'FlexFill');
    const label = (PRESSURE_LABELS[t.pressureClass] || t.pressureClass) + fillBit;
    const standardBit = t.standard && t.size === '450L' ? ' · ' + t.standard : '';
    const isSelected = state.tank && state.tank.id === t.id;
    const btn = el('button', {
      class: 'opt-btn' + (isSelected ? ' selected' : ''),
      type: 'button',
      onclick: () => selectTank(t),
    }, label + standardBit);
    btn.appendChild(el('span', {class: 'pn'}, t.displayName));
    grid.appendChild(btn);
  }
  body.appendChild(grid);
  panel.appendChild(body);

  if (state.tank) {
    panel.appendChild(el('p', {class: 'step-confirm'}, '✓ ' + state.tank.displayName));
  }
  return panel;
}

function renderHeroPanel() {
  const t = state.tank;
  const panel = el('section', {class: 'hero-panel'});
  const img = tankImg(t.heroImage, t.displayName, '');
  if (img) panel.appendChild(img);
  return panel;
}

function renderStepPanel(step, originalIdx, displayedStepNum) {
  const isAnswered = !!state.stepSelections[originalIdx];
  const useList = step.options.length > 5 || step.options.some(o => (o.label || '').length > 40);
  const panel = el('section', {class: 'panel' + (isAnswered ? ' done' : '')});
  panel.appendChild(el('span', {class: 'step-tag'}, 'Step ' + displayedStepNum));
  panel.appendChild(el('h2', {class: 'step-title'}, step.stepName));

  const body = el('div', {class: 'step-body'});
  const container = el('div', {class: useList ? 'opt-list' : 'button-grid'});
  for (const o of step.options) {
    const isSel = state.stepSelections[originalIdx] && state.stepSelections[originalIdx].partNumber === o.partNumber;
    const btn = el('button', {
      class: 'opt-btn' + (isSel ? ' selected' : ''),
      type: 'button',
      onclick: () => selectStep(originalIdx, o),
    });
    btn.appendChild(el('span', {}, o.label));
    btn.appendChild(el('span', {class: 'pn'}, o.partNumber));
    container.appendChild(btn);
  }
  body.appendChild(container);
  panel.appendChild(body);

  if (isAnswered) {
    panel.appendChild(el('p', {class: 'step-confirm'}, '✓ ' + state.stepSelections[originalIdx].label));
  }
  return panel;
}

// Determine the variants to show for an add-on, including dynamic
// per-tank values (e.g. Option #12 pulls VJ-L/VJ-R from tank data).
function resolveVariants(opt, tank) {
  // Option #12: build dynamically from tank's vjvLeft/vjvRight
  if (opt.number === 12) {
    const out = [];
    if (tank.vjvRight?.partNumber) out.push({label: 'Right-hand', partNumber: tank.vjvRight.partNumber});
    if (tank.vjvLeft?.partNumber) out.push({label: 'Left-hand', partNumber: tank.vjvLeft.partNumber});
    return out;
  }
  // Option 2: only show variant matching tank fill type
  if (opt.number === 2) {
    if (tank.fillType === 'TopFill') return opt.variants.filter(v => v.label === 'Top Fill');
    if (tank.fillType === 'FlexFill') return opt.variants.filter(v => v.label === 'FlexFill');
  }
  // Option 5: only show variant matching tank size/pressure family
  if (opt.number === 5) {
    if (tank.pressureClass === 'VHP' && (tank.size === '5500L' || tank.size === '7000L')) {
      return opt.variants.filter(v => v.label.includes('VHP'));
    }
    return opt.variants.filter(v => v.label.includes('5500L MP') || v.label.includes('450L'));
  }
  return opt.variants;
}

function renderAddOnsPanel() {
  const tank = state.tank;
  // Compute the displayed step number for the add-ons panel:
  // Step 1 + Step 2 + visible per-tank steps + 1.
  const visibleConfigSteps = visibleStepsFor(tank).length;
  const addOnStepNum = 2 + visibleConfigSteps + 1;

  const panel = el('section', {class: 'panel'});
  panel.appendChild(el('span', {class: 'step-tag'}, 'Step ' + addOnStepNum));
  panel.appendChild(el('h2', {class: 'step-title'}, 'Optional Accessories'));
  panel.appendChild(el('p', {class: 'step-help'},
    'Items shown apply to the ' + tank.displayName + '. Standard items are auto-included.'));

  const body = el('div', {class: 'step-body'});

  const applicableMap = {};
  for (const ap of tank.applicableOptions) applicableMap[ap.optionNumber] = ap;

  // Standard-included summary banner (full width)
  const standardCount = tank.applicableOptions.filter(a => a.standard).length;
  if (standardCount > 0) {
    const note = el('div', {class: 'standard-banner'});
    note.appendChild(el('span', {class: 'standard-check'}, '✓'));
    note.appendChild(el('div', {},
      el('p', {class: 'standard-title'}, standardCount + ' standard items already included'),
      el('p', {class: 'standard-desc'}, 'See the configuration summary on the right.')));
    body.appendChild(note);
  }

  // Grid of option cards
  const grid = el('div', {class: 'addon-grid'});

  for (const opt of CHART_DATA.addOnOptions) {
    const ap = applicableMap[opt.number];
    if (!ap || !ap.applies || ap.standard) continue;

    if (opt.number === 12) {
      const vrs = resolveVariants(opt, tank);
      if (vrs.length === 0) continue;
    }

    const stateKey = String(opt.number);
    const cur = state.addOns[stateKey] || {checked: false, variant: null};

    const card = el('div', {class: 'addon' + (cur.checked ? ' checked' : '')});

    // Image area (top of card)
    const thumb = el('label', {class: 'addon-thumb', for: 'addon-' + opt.number});
    if (opt.image) {
      const img = tankImg(opt.image, opt.name, '');
      if (img) thumb.appendChild(img);
    }
    card.appendChild(thumb);

    // Body (below image)
    const cardBody = el('div', {class: 'addon-card-body'});

    const head = el('div', {class: 'addon-card-head'});
    const cb = el('input', {
      type: 'checkbox',
      id: 'addon-' + opt.number,
      onchange: (e) => toggleAddOn(opt, e.target.checked),
    });
    if (cur.checked) cb.checked = true;
    head.appendChild(cb);
    head.appendChild(el('p', {class: 'addon-title'}, opt.name));
    cardBody.appendChild(head);

    cardBody.appendChild(el('p', {class: 'addon-desc'}, opt.shortDescription));
    if (ap.notes) {
      cardBody.appendChild(el('p', {class: 'addon-note'}, ap.notes));
    }

    if ((opt.variants && opt.variants.length > 0) || opt.number === 12) {
      const sub = el('div', {class: 'addon-sub'});
      sub.appendChild(el('span', {class: 'sub-label'}, variantLabel(opt)));
      const visibleVariants = resolveVariants(opt, tank);
      for (const v of visibleVariants) {
        const isSel = cur.variant && cur.variant.partNumber === v.partNumber;
        const sb = el('button', {
          class: 'sub-btn' + (isSel ? ' selected' : ''),
          type: 'button',
          onclick: () => selectVariant(opt, v),
        }, v.label);
        sub.appendChild(sb);
      }
      cardBody.appendChild(sub);
    }

    card.appendChild(cardBody);
    grid.appendChild(card);
  }

  if (grid.children.length === 0) {
    body.appendChild(el('p', {class: 'empty'}, 'No additional add-ons available for this tank.'));
  } else {
    body.appendChild(grid);
  }

  panel.appendChild(body);
  return panel;
}

function variantLabel(opt) {
  if (opt.selectionType === 'with-or-without-vent') return 'Choose:';
  if (opt.selectionType === 'side-choice') return 'Tank side:';
  if (opt.selectionType === 'gas-specific') return 'Gas:';
  if (opt.selectionType === 'fill-type-variant') return 'Variant:';
  if (opt.number === 12) return 'Tank side:';
  return 'Variant:';
}

function renderSummary() {
  const sub = $('#sum-sub');
  const body = $('#sum-body');
  const actions = $('#actions');
  const heroSlot = $('#sum-hero');

  if (!state.tank) {
    sub.textContent = 'Select a tank size to begin.';
    body.innerHTML = '<div class="empty">No selections yet</div>';
    actions.style.display = 'none';
    if (heroSlot) heroSlot.innerHTML = '';
    return;
  }

  body.innerHTML = '';
  sub.textContent = state.tank.displayName + ' · ' + state.tank.psiRating;

  // Small tank hero in the summary header
  if (heroSlot) {
    heroSlot.innerHTML = '';
    if (state.tank.heroImage) {
      const img = tankImg(state.tank.heroImage, state.tank.displayName);
      if (img) heroSlot.appendChild(img);
    }
  }

  // Tank
  const sec1 = el('div', {class: 'sum-section'});
  sec1.appendChild(el('p', {class: 'sum-h'}, 'Tank'));
  sec1.appendChild(makeSumItem(state.tank.displayName, ''));
  body.appendChild(sec1);

  // Configuration
  const sec2 = el('div', {class: 'sum-section'});
  sec2.appendChild(el('p', {class: 'sum-h'}, 'Configuration'));
  let any = false;
  state.tank.configSteps.forEach((step, idx) => {
    const sel = state.stepSelections[idx];
    if (!sel) return;
    any = true;
    sec2.appendChild(makeSumItem(step.stepName + ': ' + sel.label, sel.partNumber));
  });
  if (!any) sec2.appendChild(el('div', {class: 'empty', style: 'padding:6px 0'}, 'No choices made yet'));
  body.appendChild(sec2);

  // Standard Includes
  if (state.tank.standardIncludes && state.tank.standardIncludes.length) {
    const sec3 = el('div', {class: 'sum-section'});
    sec3.appendChild(el('p', {class: 'sum-h'}, 'Standard (Included)'));
    for (const s of state.tank.standardIncludes) {
      const it = makeSumItem(s.label, s.partNumber);
      it.classList.add('std');
      sec3.appendChild(it);
    }
    body.appendChild(sec3);
  }

  // Add-Ons
  const addons = Object.entries(state.addOns).filter(([_, v]) => v.checked);
  if (addons.length) {
    const sec4 = el('div', {class: 'sum-section'});
    sec4.appendChild(el('p', {class: 'sum-h'}, 'Selected Add-Ons'));
    for (const [num, val] of addons) {
      const opt = CHART_DATA.addOnOptions.find(o => String(o.number) === num);
      if (!opt) continue;
      const v = val.variant;
      // No "#N" in summary either — just option name
      const label = opt.name + (v ? ' (' + v.label + ')' : '');
      let part = v ? v.partNumber : '';
      // For Option 12 with no variant chosen yet, leave blank
      if (!part && opt.variants?.[0]?.partNumber && opt.number !== 12) {
        part = opt.variants[0].partNumber;
      }
      const item = makeSumItem(label, part);
      if (opt.number === 5 && state.tank.pressureClass !== 'VHP') {
        item.querySelector('.lbl').appendChild(el('span', {class: 'qty-flag'}, ' (Qty 2)'));
      }
      sec4.appendChild(item);
    }
    body.appendChild(sec4);
  }

  actions.style.display = 'flex';
}

function makeSumItem(label, partNumber) {
  const div = el('div', {class: 'sum-item'});
  div.appendChild(el('span', {class: 'lbl'}, label));
  if (partNumber) div.appendChild(el('span', {class: 'pn'}, partNumber));
  return div;
}

// =============================================================
// Selections
// =============================================================
function selectSize(size) {
  if (state.size === size) return;
  state.size = size;
  state.pressureClass = null;
  state.tank = null;
  state.stepSelections = {};
  state.addOns = {};
  render();
  scrollToNext();
}

function selectTank(tank) {
  state.tank = tank;
  state.pressureClass = tank.pressureClass;
  state.stepSelections = {};
  state.addOns = {};
  render();
  scrollToNext();
}

function selectStep(idx, option) {
  state.stepSelections[idx] = option;
  render();
  scrollToNext();
}

function toggleAddOn(opt, checked) {
  const key = String(opt.number);
  if (!state.addOns[key]) state.addOns[key] = {checked: false, variant: null};
  state.addOns[key].checked = checked;
  // Auto-select first variant if only one is visible
  if (checked && !state.addOns[key].variant) {
    const visible = resolveVariants(opt, state.tank);
    if (visible.length === 1) state.addOns[key].variant = visible[0];
  }
  render();
}

function selectVariant(opt, variant) {
  const key = String(opt.number);
  if (!state.addOns[key]) state.addOns[key] = {checked: true, variant: null};
  state.addOns[key].variant = variant;
  state.addOns[key].checked = true;
  render();
}

function scrollToNext(opts = {}) {
  // Wait long enough for layout (hero/option images) to settle before scrolling.
  // Caller can pass {target: 'hero'} to scroll to the hero panel instead of the
  // first non-done step (used right after a tank is picked).
  setTimeout(() => {
    let next = null;
    if (opts.target === 'hero') {
      next = document.querySelector('.hero-panel');
    }
    if (!next) {
      next = document.querySelector('.panel:not(.done)');
    }
    if (!next) return;
    // Scroll with a small offset so a sliver of the previous panel still shows
    // (gives visual continuity), and the *next* panel below is also visible.
    const rect = next.getBoundingClientRect();
    const targetY = window.scrollY + rect.top - 24;
    window.scrollTo({top: targetY, behavior: 'smooth'});
  }, 180);
}

// =============================================================
// Reset / Copy / PDF
// =============================================================
function buildPlainSummary() {
  if (!state.tank) return '';
  const lines = [];
  lines.push('CHART MICROBULK TANK CONFIGURATION');
  lines.push('Ratermann Manufacturing, Inc.');
  lines.push('');
  lines.push('Tank: ' + state.tank.displayName);
  lines.push('Pressure: ' + state.tank.psiRating);
  lines.push('');
  lines.push('— CONFIGURATION —');
  state.tank.configSteps.forEach((step, idx) => {
    const sel = state.stepSelections[idx];
    if (!sel) lines.push(step.stepName + ': (not selected)');
    else lines.push(step.stepName + ': ' + sel.label + '  [' + sel.partNumber + ']');
  });

  if (state.tank.standardIncludes && state.tank.standardIncludes.length) {
    lines.push('');
    lines.push('— STANDARD (INCLUDED) —');
    for (const s of state.tank.standardIncludes) {
      lines.push('• ' + s.label + (s.partNumber ? '  [' + s.partNumber + ']' : ''));
    }
  }

  const addons = Object.entries(state.addOns).filter(([_, v]) => v.checked);
  if (addons.length) {
    lines.push('');
    lines.push('— SELECTED ADD-ONS —');
    for (const [num, val] of addons) {
      const opt = CHART_DATA.addOnOptions.find(o => String(o.number) === num);
      const v = val.variant;
      let line = opt.name;
      if (v) line += ' (' + v.label + ')';
      if (v && v.partNumber) line += '  [' + v.partNumber + ']';
      if (opt.number === 5 && state.tank.pressureClass !== 'VHP') line += '  (Qty 2 required)';
      lines.push('• ' + line);
    }
  }

  lines.push('');
  lines.push('Generated: ' + new Date().toLocaleString());
  return lines.join('\n');
}

async function handleCopy() {
  const txt = buildPlainSummary();
  if (!txt) return;
  try {
    await navigator.clipboard.writeText(txt);
    showToast('Configuration copied to clipboard');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Copied');
  }
}

// Load image and convert to data URL for PDF embed.
function loadImageForPdf(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const tryLoad = (url, fallback) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          resolve({ data: c.toDataURL('image/jpeg', 0.85), w: img.naturalWidth, h: img.naturalHeight });
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => fallback ? tryLoad(fallback, null) : resolve(null);
      img.src = url;
    };
    const jpgFallback = src.replace(/\.webp(\?.*)?$/, '.jpg$1');
    tryLoad(src, jpgFallback);
  });
}

async function handlePdf() {
  if (!state.tank) return;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({unit: 'pt', format: 'letter'});
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 50;

  // Header band
  pdf.setFillColor(10, 77, 140);
  pdf.rect(0, 0, W, 70, 'F');
  pdf.setTextColor(255,255,255);
  pdf.setFontSize(18); pdf.setFont('helvetica', 'bold');
  pdf.text('Chart Microbulk Tank Configuration', M, 35);
  pdf.setFontSize(11); pdf.setFont('helvetica', 'normal');
  pdf.text('Ratermann Manufacturing, Inc.  ·  1-800-264-7793  ·  rmiorder.com', M, 55);

  // Tank header + hero image (top right)
  let y = 100;
  let leftWidth = W - 2 * M;
  pdf.setTextColor(20, 30, 40);

  let heroData = null;
  try { heroData = await loadImageForPdf(state.tank.heroImage); } catch (e) {}

  if (heroData) {
    const targetH = 140;
    const targetW = (heroData.w / heroData.h) * targetH;
    const imgX = W - M - targetW;
    pdf.addImage(heroData.data, 'JPEG', imgX, y, targetW, targetH);
    leftWidth = imgX - M - 20;
  }

  pdf.setFontSize(15); pdf.setFont('helvetica', 'bold');
  pdf.text(state.tank.displayName, M, y + 18, {maxWidth: leftWidth}); y += 36;
  pdf.setFontSize(10); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(80, 90, 110);
  pdf.text('Pressure: ' + state.tank.psiRating + '  ·  ID: ' + state.tank.id, M, y); y += 22;
  pdf.setTextColor(20, 30, 40);

  // Make sure body content starts below the hero
  if (heroData) y = Math.max(y, 100 + 140 + 20);

  function sectionTitle(t) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
    pdf.setTextColor(7, 57, 104);
    pdf.text(t.toUpperCase(), M, y); y += 6;
    pdf.setDrawColor(7, 57, 104); pdf.setLineWidth(1);
    pdf.line(M, y, W - M, y); y += 14;
    pdf.setTextColor(20, 30, 40);
  }
  function lineRow(label, partNumber, isStd) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
    if (isStd) pdf.setTextColor(26, 127, 60);
    pdf.text(label, M + 6, y, {maxWidth: W - 2*M - 160});
    if (partNumber) {
      pdf.setFont('courier', 'normal');
      const tw = pdf.getTextWidth(partNumber);
      pdf.text(partNumber, W - M - tw, y);
    }
    pdf.setTextColor(20, 30, 40);
    y += 14;
    if (y > H - 60) { pdf.addPage(); y = M; }
  }

  sectionTitle('Configuration');
  state.tank.configSteps.forEach((step, idx) => {
    const sel = state.stepSelections[idx];
    if (sel) lineRow(step.stepName + ': ' + sel.label, sel.partNumber);
    else lineRow(step.stepName + ': (not selected)', '');
  });

  if (state.tank.standardIncludes?.length) {
    y += 8;
    sectionTitle('Standard (Included)');
    for (const s of state.tank.standardIncludes) lineRow('• ' + s.label, s.partNumber, true);
  }

  const addons = Object.entries(state.addOns).filter(([_,v]) => v.checked);
  if (addons.length) {
    y += 8;
    sectionTitle('Selected Add-Ons');
    for (const [num, val] of addons) {
      const opt = CHART_DATA.addOnOptions.find(o => String(o.number) === num);
      const v = val.variant;
      let label = opt.name;
      if (v) label += ' (' + v.label + ')';
      let pn = v ? v.partNumber : '';
      if (opt.number === 5 && state.tank.pressureClass !== 'VHP') pn += '  (Qty 2)';
      lineRow('• ' + label, pn);
    }
  }

  y += 22;
  pdf.setFont('helvetica', 'italic'); pdf.setFontSize(9); pdf.setTextColor(120, 130, 145);
  pdf.text('Generated ' + new Date().toLocaleString() + ' — please verify all selections with your RMI sales contact prior to ordering.', M, y, {maxWidth: W - 2 * M});

  const fname = 'chart-config-' + state.tank.id + '-' + new Date().toISOString().split('T')[0] + '.pdf';
  pdf.save(fname);
}

function handleRestart() {
  if (state.tank && !confirm('Clear current configuration?')) return;
  state.size = state.pressureClass = state.tank = null;
  state.stepSelections = {};
  state.addOns = {};
  render();
  window.scrollTo({top: 0, behavior: 'smooth'});
}

// =============================================================
// Init
// =============================================================
function showError(msg) {
  const area = $('#steps-area');
  area.innerHTML = '';
  const box = el('div', {class: 'error-box'});
  box.appendChild(el('strong', {}, 'Failed to load tank data.'));
  box.appendChild(el('p', {style: 'margin:6px 0 0'}, msg));
  box.appendChild(el('p', {style: 'margin:8px 0 0;font-size:12px'},
    'Verify that ', el('code', {}, 'chart-data.json'), ' is in the same folder as this page.'));
  area.appendChild(box);
}

async function init() {
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    showError(err.message);
    return;
  }

  $('#meta-line').textContent = 'Tank Builder v' + (CHART_DATA._meta?.version || 'dev') +
    ' · ' + (CHART_DATA._meta?.tankCount || CHART_DATA.tanks.length) + ' tanks · ' +
    CHART_DATA.addOnOptions.length + ' add-on options';

  $('#restart-btn').addEventListener('click', handleRestart);
  $('#copy-btn').addEventListener('click', handleCopy);
  $('#pdf-btn').addEventListener('click', handlePdf);

  render();
}

document.addEventListener('DOMContentLoaded', init);
