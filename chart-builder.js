// Chart Microbulk Tank Builder · application logic (v2.2)
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
// Web3Forms — handles email delivery to sales@rmimfg.com
// =============================================================
const W3F_KEY = '99dce9ea-074e-4e7e-a56e-eab17923e07d';

// =============================================================
// Constants
// =============================================================
const GAS_TYPES = [
  { id: 'Oxygen',   symbol: 'O₂',  label: 'OXYGEN',   desc: 'LOX · Critical & Medical'      },
  { id: 'Argon',    symbol: 'Ar',        label: 'ARGON',    desc: 'LAR · Welding & Specialty'     },
  { id: 'Nitrogen', symbol: 'N₂',  label: 'NITROGEN', desc: 'LIN · Industrial & Food'        },
  { id: 'CO2',      symbol: 'CO₂', label: 'CO₂',  desc: 'LCO₂ · Beverage & Industrial' },
];

// =============================================================
// State
// =============================================================
const state = {
  gasType: null,         // new — chosen before size
  size: null,
  pressureClass: null,
  tank: null,
  stepSelections: {},    // {stepIndex: option}
  addOns: {},            // {optionNumber: {checked, variant}}
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

// Filter tanks by selected gas type:
//   CO2 → show only permamax tanks; others → show non-permamax.
function tanksBySize() {
  const groups = {};
  for (const t of CHART_DATA.tanks) {
    if (state.gasType) {
      const isCO2 = t.id.startsWith('permamax');
      if (state.gasType === 'CO2' && !isCO2) continue;
      if (state.gasType !== 'CO2' && isCO2) continue;
    }
    (groups[t.size] ??= []).push(t);
  }
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

// =============================================================
// Gas-type filtering helpers
// =============================================================

// Detect gas service type from a GSK option's part number or label.
// Returns 'Oxygen'|'Argon'|'Nitrogen'|'CO2'|null.
// null means the option has no gas coding (generic/keep-always).
function gskOptionGas(option) {
  const segs = option.partNumber.toUpperCase().split('-');
  if (segs.includes('AR'))  return 'Argon';
  if (segs.includes('NI'))  return 'Nitrogen';
  if (segs.includes('OX'))  return 'Oxygen';
  if (segs.includes('CO2')) return 'CO2';
  // Label fallback (e.g. "Argon* KIT/SRV/LBL..." or plain "Argon")
  const lb = option.label.toLowerCase().trimStart();
  if (lb === 'argon'    || lb.startsWith('argon ')    || lb.startsWith('argon*'))    return 'Argon';
  if (lb === 'nitrogen' || lb.startsWith('nitrogen ')  || lb.startsWith('nitrogen*')) return 'Nitrogen';
  if (lb === 'oxygen'   || lb.startsWith('oxygen ')    || lb.startsWith('oxygen*'))   return 'Oxygen';
  return null; // no gas code — keep regardless
}

// Return the effective (gas-filtered) options for a step.
// Only Gas Service Label Kit steps are filtered; all others are unchanged.
function getEffectiveOptions(step, idx) {
  if (!state.gasType) return step.options;
  if (!step.stepName.toLowerCase().includes('gas service')) return step.options;
  // Check if any option carries a gas code; if none do (e.g. permamax service types), return all.
  const hasCoded = step.options.some(o => gskOptionGas(o) !== null);
  if (!hasCoded) return step.options;
  return step.options.filter(o => {
    const g = gskOptionGas(o);
    return g === null || g === state.gasType;
  });
}

// Does this tank have a "Dual Relief Kit" configStep?
// If so, Option #8 (Dual Safeties & Rupture Discs) is the same concept — suppress it from add-ons.
function hasDualReliefKitStep(tank) {
  return tank.configSteps.some(s => s.stepName.toLowerCase().includes('dual relief'));
}

// Auto-select single-option steps so user doesn't see them at all.
// Returns array of [originalIndex, step] that should be SHOWN to the user.
function visibleStepsFor(tank) {
  return tank.configSteps
    .map((step, idx) => [idx, step])
    .filter(([idx, step]) => getEffectiveOptions(step, idx).length > 1);
}

// Auto-select single-option steps in state (including gas-filtered single options).
// Also clears any selections that no longer match the effective options (e.g. after gas change).
function autoSelectSingleSteps() {
  if (!state.tank) return;
  state.tank.configSteps.forEach((step, idx) => {
    const opts = getEffectiveOptions(step, idx);
    // Clear stale selection if it's no longer in the effective set
    if (state.stepSelections[idx] && !opts.find(o => o.partNumber === state.stepSelections[idx].partNumber)) {
      delete state.stepSelections[idx];
    }
    // Auto-select if only one option remains
    if (opts.length === 1 && !state.stepSelections[idx]) {
      state.stepSelections[idx] = opts[0];
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
      if (!this.dataset.fallback) {
        this.dataset.fallback = '1';
        this.src = src.replace(/\.webp(\?.*)?$/, '.jpg$1');
      } else {
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

  // Step 1 — Gas Type (always visible)
  area.appendChild(renderGasTypePanel());

  // Step 2 — Size (only after gas type chosen)
  if (state.gasType) area.appendChild(renderSizePanel());

  // Step 3 — Pressure & Fill (only after size chosen)
  if (state.size) area.appendChild(renderPressurePanel());

  if (state.tank) {
    autoSelectSingleSteps();

    // Hero image panel
    if (state.tank.heroImage) area.appendChild(renderHeroPanel());

    // Visible config steps (single-option steps are auto-selected & hidden)
    const visible = visibleStepsFor(state.tank);
    let visibleIdx = 0;
    visible.forEach(([originalIdx, step]) => {
      area.appendChild(renderStepPanel(step, originalIdx, visibleIdx + 4)); // steps 1-3 are gas/size/pressure
      visibleIdx++;
    });

    // Add-ons
    area.appendChild(renderAddOnsPanel());
  }

  renderSummary();
}

// =============================================================
// Gas Type Panel (Step 1)
// =============================================================
function renderGasTypePanel() {
  const isDone = !!state.gasType;
  const panel = el('section', {class: 'panel gas-type-panel' + (isDone ? ' done' : '')});

  panel.appendChild(el('span', {class: 'step-tag gas-step-tag'}, 'Step 1'));
  panel.appendChild(el('h2', {class: 'step-title gas-step-title'}, 'Select Gas Type'));
  panel.appendChild(el('p', {class: 'step-help gas-step-help'}, 'Pick your gas. Everything downstream follows.'));

  const body = el('div', {class: 'step-body'});
  const grid = el('div', {class: 'gas-type-grid'});

  for (const g of GAS_TYPES) {
    const isSel = state.gasType === g.id;
    const card = el('div', {
      class: 'gas-card' + (isSel ? ' selected' : ''),
      'data-gas': g.id,
      role: 'button',
      tabindex: '0',
      onclick: () => selectGasType(g.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') selectGasType(g.id); },
    });
    card.appendChild(el('span', {class: 'gas-symbol'}, g.symbol));
    card.appendChild(el('span', {class: 'gas-name'}, g.label));
    card.appendChild(el('span', {class: 'gas-desc'}, g.desc));
    grid.appendChild(card);
  }

  body.appendChild(grid);
  panel.appendChild(body);

  if (isDone) {
    const gasInfo = GAS_TYPES.find(g => g.id === state.gasType);
    panel.appendChild(el('p', {class: 'step-confirm gas-confirm'},
      '✓ ' + (gasInfo ? gasInfo.label : state.gasType)));
  }

  return panel;
}

// =============================================================
// Size Panel (Step 2)
// =============================================================
function renderSizePanel() {
  const groups = tanksBySize();
  const panel = el('section', {class: 'panel' + (state.size ? ' done' : '')});
  panel.appendChild(el('span', {class: 'step-tag'}, 'Step 2'));
  panel.appendChild(el('h2', {class: 'step-title'}, 'Choose a Tank Size'));
  panel.appendChild(el('p', {class: 'step-help'}, 'Available sizes for ' + state.gasType + ' service.'));

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

// =============================================================
// Pressure & Fill Panel (Step 3)
// =============================================================
function renderPressurePanel() {
  const groups = tanksBySize();
  const tanks = groups[state.size] || [];
  const variants = [];
  for (const t of tanks) {
    const key = `${t.pressureClass}|${t.fillType}`;
    if (!variants.find(v => v.key === key)) variants.push({key, tank: t});
  }

  const panel = el('section', {class: 'panel' + (state.tank ? ' done' : '')});
  panel.appendChild(el('span', {class: 'step-tag'}, 'Step 3'));
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

// =============================================================
// Hero Panel
// =============================================================
function renderHeroPanel() {
  const t = state.tank;
  const panel = el('section', {class: 'hero-panel'});
  const img = tankImg(t.heroImage, t.displayName, '');
  if (img) panel.appendChild(img);
  return panel;
}

// =============================================================
// Config Step Panel (Step 4+)
// =============================================================
function renderStepPanel(step, originalIdx, displayedStepNum) {
  const effectiveOptions = getEffectiveOptions(step, originalIdx);
  const isAnswered = !!state.stepSelections[originalIdx];
  const useList = effectiveOptions.length > 5 || effectiveOptions.some(o => (o.label || '').length > 40);
  const panel = el('section', {class: 'panel' + (isAnswered ? ' done' : '')});
  panel.appendChild(el('span', {class: 'step-tag'}, 'Step ' + displayedStepNum));
  panel.appendChild(el('h2', {class: 'step-title'}, step.stepName));

  const body = el('div', {class: 'step-body'});
  const container = el('div', {class: useList ? 'opt-list' : 'button-grid'});
  for (const o of effectiveOptions) {
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

// =============================================================
// Resolve add-on variants
// =============================================================
function resolveVariants(opt, tank) {
  if (opt.number === 12) {
    const out = [];
    if (tank.vjvRight?.partNumber) out.push({label: 'Right-hand', partNumber: tank.vjvRight.partNumber});
    if (tank.vjvLeft?.partNumber)  out.push({label: 'Left-hand',  partNumber: tank.vjvLeft.partNumber});
    return out;
  }
  if (opt.number === 2) {
    if (tank.fillType === 'TopFill')  return opt.variants.filter(v => v.label === 'Top Fill');
    if (tank.fillType === 'FlexFill') return opt.variants.filter(v => v.label === 'FlexFill');
  }
  if (opt.number === 5) {
    if (tank.pressureClass === 'VHP' && (tank.size === '5500L' || tank.size === '7000L')) {
      return opt.variants.filter(v => v.label.includes('VHP'));
    }
    return opt.variants.filter(v => v.label.includes('5500L MP') || v.label.includes('450L'));
  }
  return opt.variants;
}

// =============================================================
// Add-ons Panel
// =============================================================
function renderAddOnsPanel() {
  const tank = state.tank;
  const visibleConfigSteps = visibleStepsFor(tank).length;
  const addOnStepNum = 3 + visibleConfigSteps + 1; // steps 1(gas)+2(size)+3(pressure)+config+this

  const panel = el('section', {class: 'panel'});
  panel.appendChild(el('span', {class: 'step-tag'}, 'Step ' + addOnStepNum));
  panel.appendChild(el('h2', {class: 'step-title'}, 'Optional Accessories'));
  panel.appendChild(el('p', {class: 'step-help'},
    'Items shown apply to the ' + tank.displayName + '. Standard items are auto-included.'));

  const body = el('div', {class: 'step-body'});

  const applicableMap = {};
  for (const ap of tank.applicableOptions) applicableMap[ap.optionNumber] = ap;

  const standardCount = tank.applicableOptions.filter(a => a.standard).length;
  if (standardCount > 0) {
    const note = el('div', {class: 'standard-banner'});
    note.appendChild(el('span', {class: 'standard-check'}, '✓'));
    note.appendChild(el('div', {},
      el('p', {class: 'standard-title'}, standardCount + ' standard items already included'),
      el('p', {class: 'standard-desc'}, 'See the configuration summary on the right.')));
    body.appendChild(note);
  }

  const grid = el('div', {class: 'addon-grid'});
  const hasDRK = hasDualReliefKitStep(tank);

  for (const opt of CHART_DATA.addOnOptions) {
    const ap = applicableMap[opt.number];
    if (!ap || !ap.applies || ap.standard) continue;

    // Option #8 (Dual Safeties & Rupture Discs) is the same concept as the
    // "Dual Relief Kit" configStep — hide it when that step exists on this tank.
    if (opt.number === 8 && hasDRK) continue;

    if (opt.number === 12) {
      const vrs = resolveVariants(opt, tank);
      if (vrs.length === 0) continue;
    }

    const stateKey = String(opt.number);
    const cur = state.addOns[stateKey] || {checked: false, variant: null};

    const card = el('div', {class: 'addon' + (cur.checked ? ' checked' : '')});

    const thumb = el('label', {class: 'addon-thumb', for: 'addon-' + opt.number});
    if (opt.image) {
      const img = tankImg(opt.image, opt.name, '');
      if (img) thumb.appendChild(img);
    }
    card.appendChild(thumb);

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
  if (opt.selectionType === 'side-choice')          return 'Tank side:';
  if (opt.selectionType === 'gas-specific')         return 'Gas:';
  if (opt.selectionType === 'fill-type-variant')    return 'Variant:';
  if (opt.number === 12)                            return 'Tank side:';
  return 'Variant:';
}

// =============================================================
// Summary Panel
// =============================================================
function renderSummary() {
  const sub      = $('#sum-sub');
  const body     = $('#sum-body');
  const actions  = $('#actions');
  const heroSlot = $('#sum-hero');

  if (!state.tank) {
    sub.textContent = state.gasType
      ? 'Choose a size to continue.'
      : 'Select a gas type to begin.';
    body.innerHTML = '<div class="empty">No selections yet</div>';
    actions.style.display = 'none';
    if (heroSlot) heroSlot.innerHTML = '';
    return;
  }

  body.innerHTML = '';
  sub.textContent = state.tank.displayName + ' · ' + state.tank.psiRating;

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

  // Configuration (gas type first, then step selections)
  const sec2 = el('div', {class: 'sum-section'});
  sec2.appendChild(el('p', {class: 'sum-h'}, 'Configuration'));

  if (state.gasType) {
    const gasInfo = GAS_TYPES.find(g => g.id === state.gasType);
    const gasItem = makeSumItem('Gas Service: ' + (gasInfo ? gasInfo.label : state.gasType), '');
    sec2.appendChild(gasItem);
  }

  let any = !!state.gasType;
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
      const label = opt.name + (v ? ' (' + v.label + ')' : '');
      let part = v ? v.partNumber : '';
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
function selectGasType(gas) {
  if (state.gasType === gas) return;
  state.gasType = gas;
  state.size = null;
  state.pressureClass = null;
  state.tank = null;
  state.stepSelections = {};
  state.addOns = {};
  render();
  scrollToNext();
}

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
  scrollToNext({target: 'hero'}); // land on the hero image, not the first config step
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
  setTimeout(() => {
    let next = null;
    if (opts.target === 'hero') next = document.querySelector('.hero-panel');
    if (!next) next = document.querySelector('.panel:not(.done)');
    if (!next) return;
    const rect = next.getBoundingClientRect();
    const targetY = window.scrollY + rect.top - 24;
    window.scrollTo({top: targetY, behavior: 'smooth'});
  }, 180);
}

// =============================================================
// Plain-text summary (for PDF + email)
// =============================================================
function buildPlainSummary() {
  if (!state.tank) return '';
  const lines = [];
  lines.push('CHART MICROBULK TANK CONFIGURATION');
  lines.push('Ratermann Manufacturing, Inc.');
  lines.push('');
  if (state.gasType) {
    const gasInfo = GAS_TYPES.find(g => g.id === state.gasType);
    lines.push('Gas Service: ' + (gasInfo ? gasInfo.label : state.gasType));
  }
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

// =============================================================
// PDF generation
// =============================================================
function loadImageForPdf(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const tryLoad = (url, fallback) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          resolve({ data: c.toDataURL('image/jpeg', 0.85), w: img.naturalWidth, h: img.naturalHeight });
        } catch (e) { resolve(null); }
      };
      img.onerror = () => fallback ? tryLoad(fallback, null) : resolve(null);
      img.src = url;
    };
    tryLoad(src, src.replace(/\.webp(\?.*)?$/, '.jpg$1'));
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

  // Gas type badge line
  if (state.gasType) {
    const gasInfo = GAS_TYPES.find(g => g.id === state.gasType);
    pdf.setFontSize(10); pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(7, 57, 104);
    pdf.text('Gas Service: ' + (gasInfo ? gasInfo.label : state.gasType), M, y + 14);
    y += 22;
  }

  pdf.setFontSize(15); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(20, 30, 40);
  pdf.text(state.tank.displayName, M, y + 18, {maxWidth: leftWidth}); y += 36;
  pdf.setFontSize(10); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(80, 90, 110);
  pdf.text('Pressure: ' + state.tank.psiRating + '  ·  ID: ' + state.tank.id, M, y); y += 22;
  pdf.setTextColor(20, 30, 40);

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
    const LH = 14; // line height in pt
    const labelMaxW = W - 2*M - (partNumber ? 155 : 10);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
    if (isStd) pdf.setTextColor(26, 127, 60);
    const lines = pdf.splitTextToSize(label, labelMaxW);
    lines.forEach((line, i) => pdf.text(line, M + 6, y + i * LH));
    if (partNumber) {
      pdf.setFont('courier', 'normal');
      const tw = pdf.getTextWidth(partNumber);
      pdf.text(partNumber, W - M - tw, y);
    }
    pdf.setTextColor(20, 30, 40);
    y += lines.length * LH;
    if (y > H - 60) { pdf.addPage(); y = M; }
  }

  sectionTitle('Configuration');
  state.tank.configSteps.forEach((step, idx) => {
    const sel = state.stepSelections[idx];
    if (sel) lineRow(step.stepName + ': ' + sel.label, sel.partNumber);
    else     lineRow(step.stepName + ': (not selected)', '');
  });

  if (state.tank.standardIncludes?.length) {
    y += 8; sectionTitle('Standard (Included)');
    for (const s of state.tank.standardIncludes) lineRow('• ' + s.label, s.partNumber, true);
  }

  const addons = Object.entries(state.addOns).filter(([_,v]) => v.checked);
  if (addons.length) {
    y += 8; sectionTitle('Selected Add-Ons');
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
  return fname;
}

// =============================================================
// Contact Sales
// =============================================================
function openContactModal() {
  // Rebuild fresh each time so the summary reflects current state
  const old = document.getElementById('contact-modal');
  if (old) old.remove();
  const modal = buildContactModal();
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
  document.body.style.overflow = 'hidden';
}

function closeContactModal() {
  const modal = document.getElementById('contact-modal');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
  // Remove after transition
  setTimeout(() => { if (modal.parentNode) modal.remove(); }, 300);
}

function buildContactModal() {
  const overlay = el('div', {
    class: 'contact-overlay',
    id: 'contact-modal',
    onclick: (e) => { if (e.target === overlay) closeContactModal(); },
  });

  const dialog = el('div', {class: 'contact-dialog'});

  // Close button
  dialog.appendChild(el('button', {
    class: 'contact-close', type: 'button', onclick: closeContactModal,
  }, '×'));

  // Header
  const head = el('div', {class: 'contact-head'});
  head.appendChild(el('h2', {class: 'contact-title'}, 'Request a Quote'));
  head.appendChild(el('p', {class: 'contact-subtitle'},
    "You've built a solid configuration. Fill in your details below and our sales team will get back to you with pricing."));
  dialog.appendChild(head);

  // Body — two columns
  const body = el('div', {class: 'contact-body'});

  // Left: config summary
  const summaryCol = el('div', {class: 'contact-summary-col'});
  summaryCol.appendChild(el('p', {class: 'contact-col-head'}, 'Your Configuration'));
  summaryCol.appendChild(buildContactSummary());
  body.appendChild(summaryCol);

  // Right: form
  const formCol = el('div', {class: 'contact-form-col'});
  formCol.appendChild(el('p', {class: 'contact-col-head'}, 'Your Information'));

  const form = el('form', {
    class: 'contact-form',
    id: 'contact-form',
    onsubmit: (e) => { e.preventDefault(); submitContact(); },
  });

  const fields = [
    {id: 'cf-name',    label: 'Full Name',  type: 'text',  placeholder: 'Jane Smith'},
    {id: 'cf-company', label: 'Company',    type: 'text',  placeholder: 'ACME Industrial'},
    {id: 'cf-email',   label: 'Email',      type: 'email', placeholder: 'jane@company.com'},
    {id: 'cf-phone',   label: 'Phone',      type: 'tel',   placeholder: '(555) 555-5555'},
  ];
  for (const f of fields) {
    const grp = el('div', {class: 'contact-field'});
    grp.appendChild(el('label', {for: f.id, class: 'contact-label'}, f.label + ' *'));
    grp.appendChild(el('input', {
      type: f.type, id: f.id, name: f.id,
      placeholder: f.placeholder, required: true,
      class: 'contact-input', autocomplete: 'on',
    }));
    form.appendChild(grp);
  }

  form.appendChild(el('button', {type: 'submit', class: 'btn contact-submit'},
    'Send to Sales Team →'));
  formCol.appendChild(form);
  body.appendChild(formCol);
  dialog.appendChild(body);
  overlay.appendChild(dialog);
  return overlay;
}

function buildContactSummary() {
  const wrap = el('div', {class: 'contact-config-summary'});

  const row = (label, value) => {
    const r = el('div', {class: 'contact-sum-row'});
    r.appendChild(el('span', {class: 'contact-sum-label'}, label));
    r.appendChild(el('span', {class: 'contact-sum-value'}, value));
    return r;
  };

  if (state.gasType) {
    const g = GAS_TYPES.find(x => x.id === state.gasType);
    wrap.appendChild(row('Gas', g ? g.label : state.gasType));
  }

  if (state.tank) {
    wrap.appendChild(row('Tank', state.tank.displayName));
    wrap.appendChild(row('Pressure', state.tank.psiRating));

    state.tank.configSteps.forEach((step, idx) => {
      const sel = state.stepSelections[idx];
      if (sel) wrap.appendChild(row(step.stepName, sel.label));
    });

    const addons = Object.entries(state.addOns).filter(([_, v]) => v.checked);
    if (addons.length) {
      const div = el('div', {class: 'contact-sum-addons'});
      div.appendChild(el('p', {class: 'contact-sum-addons-head'},
        addons.length + ' add-on' + (addons.length > 1 ? 's' : '') + ' selected'));
      for (const [num, val] of addons) {
        const opt = CHART_DATA.addOnOptions.find(o => String(o.number) === num);
        if (!opt) continue;
        const v = val.variant;
        div.appendChild(el('p', {class: 'contact-sum-addon-item'},
          '• ' + opt.name + (v ? ' – ' + v.label : '')));
      }
      wrap.appendChild(div);
    }
  }

  return wrap;
}

async function submitContact() {
  const name    = document.getElementById('cf-name')?.value.trim();
  const company = document.getElementById('cf-company')?.value.trim();
  const email   = document.getElementById('cf-email')?.value.trim();
  const phone   = document.getElementById('cf-phone')?.value.trim();

  if (!name || !company || !email || !phone) {
    showToast('Please fill in all required fields.');
    return;
  }

  const submitBtn = document.querySelector('.contact-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

  const configText = buildPlainSummary();

  const payload = {
    access_key: W3F_KEY,
    subject:    'Quote Request — Chart Microbulk Tank Builder — ' + name + ' / ' + company,
    from_name:  name,
    email:      email,
    Name:        name,
    Company:     company,
    Phone:       phone,
    Configuration: configText,
    botcheck: '',
  };

  try {
    const res = await fetch('https://api.web3forms.com/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.success) {
      showContactSuccess();
    } else {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send to Sales Team →'; }
      showToast('Something went wrong — please try again.');
      console.error('Web3Forms error:', data);
    }
  } catch (err) {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send to Sales Team →'; }
    showToast('Network error — check your connection and try again.');
    console.error('Submit error:', err);
  }
}

function showContactSuccess() {
  const dialog = document.querySelector('.contact-dialog');
  if (!dialog) return;

  // Wipe the dialog content and show success state
  dialog.innerHTML = '';
  dialog.appendChild(el('button', {
    class: 'contact-close', type: 'button', onclick: closeContactModal,
  }, '×'));

  const win = el('div', {class: 'contact-success'});
  win.appendChild(el('div', {class: 'contact-success-icon'}, '✓'));
  win.appendChild(el('h2', {class: 'contact-success-title'}, "Request sent!"));
  win.appendChild(el('p', {class: 'contact-success-msg'},
    'Your quote request is on its way to the RMI sales team. ' +
    "We'll be in touch shortly."));
  win.appendChild(el('p', {class: 'contact-success-msg', style: 'font-weight:600;margin-top:10px'},
    'Need it faster? Call us at 1-800-264-7793'));
  win.appendChild(el('button', {
    class: 'btn', type: 'button', style: 'margin-top:20px; min-width:140px',
    onclick: closeContactModal,
  }, 'Done'));

  dialog.appendChild(win);
}

// =============================================================
// Reset
// =============================================================
function confirmRestart(onConfirm) {
  const overlay = el('div', {class: 'confirm-overlay', id: 'confirm-overlay'});
  const box = el('div', {class: 'confirm-box'});
  const title = el('div', {class: 'confirm-title'}, 'Ratermann Chart Tool');
  const msg   = el('p',   {class: 'confirm-msg'},   'Clear current configuration?');
  const btns  = el('div', {class: 'confirm-btns'});
  const cancel = el('button', {class: 'btn secondary confirm-cancel', type: 'button'}, 'Cancel');
  const ok     = el('button', {class: 'btn confirm-ok',     type: 'button'}, 'Clear');
  cancel.addEventListener('click', () => overlay.remove());
  ok.addEventListener('click', () => { overlay.remove(); onConfirm(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  btns.append(cancel, ok);
  box.append(title, msg, btns);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  cancel.focus();
}

function handleRestart() {
  if (state.tank) {
    confirmRestart(() => {
      state.gasType = state.size = state.pressureClass = state.tank = null;
      state.stepSelections = {};
      state.addOns = {};
      render();
      window.scrollTo({top: 0, behavior: 'smooth'});
    });
    return;
  }
  state.gasType = state.size = state.pressureClass = state.tank = null;
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

// Keep the summary max-height in sync with the viewport so the internal
// scroll always works correctly, and enforce align-self:start for grids
// that may have been overridden by a parent stylesheet (Webflow, etc.).
function initSummarySticky() {
  const summary = document.getElementById('summary');
  if (!summary) return;

  function refresh() {
    const wide = window.innerWidth >= 900;
    if (wide) {
      summary.style.maxHeight = (window.innerHeight - 32) + 'px';
      summary.style.alignSelf = 'start';
    } else {
      summary.style.maxHeight = '';
      summary.style.alignSelf = '';
    }
  }

  window.addEventListener('scroll', refresh, { passive: true });
  window.addEventListener('resize', refresh, { passive: true });
  refresh();
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
  $('#contact-btn').addEventListener('click', openContactModal);
  $('#pdf-btn').addEventListener('click', handlePdf);

  initSummarySticky();
  render();
}

document.addEventListener('DOMContentLoaded', init);
