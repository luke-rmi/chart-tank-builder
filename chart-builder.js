// Chart Microbulk Tank Builder · application logic
// Loads chart-data.json at runtime so data updates don't require redeploying the JS.

// =============================================================
// Data loading
// =============================================================
let CHART_DATA = null;

// Cache-busting query string — bump version after editing chart-data.json,
// or comment this out and rely on GitHub Pages' default 10-minute cache.
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
  stepSelections: {},
  addOns: {},
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
  for (const t of CHART_DATA.tanks) {
    (groups[t.size] ??= []).push(t);
  }
  return groups;
}

// Display order for size buttons
const SIZE_ORDER = ['230L','450L','700L','1000L','1500L','2000L','3000L','5500L','7000L','Perma-Max'];

// Pretty pressure-class label
const PRESSURE_LABELS = {
  'MP': 'MP · 250 PSI',
  'HP': 'HP · 350 PSI',
  'VHP': 'VHP · 500 PSI',
  'ZX-VHP': 'ZX-VHP · 500 PSI Skid',
  'HP-CO2': 'HP CO₂ · 350 PSI',
  'VHP-CO2': 'VHP CO₂ · 500 PSI',
};

// =============================================================
// Render
// =============================================================
function render() {
  const area = $('#steps-area');
  area.innerHTML = '';

  area.appendChild(renderSizePanel());

  if (state.size) {
    area.appendChild(renderPressurePanel());
  }

  if (state.tank) {
    state.tank.configSteps.forEach((step, i) => {
      area.appendChild(renderStepPanel(step, i));
    });

    area.appendChild(renderAddOnsPanel());
  }

  renderSummary();
}

function renderSizePanel() {
  const groups = tanksBySize();
  const panel = el('section', {class: 'panel' + (state.size ? ' done' : '')});
  panel.appendChild(el('span', {class: 'step-tag'}, 'Step 1 of 2'));
  panel.appendChild(el('h2', {class: 'step-title'}, 'Choose a Tank Size'));
  panel.appendChild(el('p', {class: 'step-help'}, 'All Chart microbulk sizes available from RMI.'));

  const body = el('div', {class: 'step-body'});
  const grid = el('div', {class: 'button-grid'});
  for (const sz of SIZE_ORDER) {
    if (!groups[sz]) continue;
    const btn = el('button', {
      class: 'opt-btn' + (state.size === sz ? ' selected' : ''),
      type: 'button',
      onclick: () => selectSize(sz),
    }, sz);
    const variants = [...new Set(groups[sz].map(t => t.pressureClass))];
    btn.appendChild(el('span', {class: 'pn'}, variants.join(' · ')));
    grid.appendChild(btn);
  }
  body.appendChild(grid);
  panel.appendChild(body);

  if (state.size) {
    const sel = el('p', {class: 'step-help', style: 'margin-top:6px;color:var(--rmi-blue-dark);font-weight:600'}, '✓ ' + state.size);
    panel.appendChild(sel);
  }
  return panel;
}

function renderPressurePanel() {
  const groups = tanksBySize();
  const tanks = groups[state.size] || [];
  const variants = [];
  for (const t of tanks) {
    const key = `${t.pressureClass}|${t.fillType}`;
    if (!variants.find(v => v.key === key)) {
      variants.push({key, tank: t});
    }
  }

  const panel = el('section', {class: 'panel' + (state.tank ? ' done' : '')});
  panel.appendChild(el('span', {class: 'step-tag'}, 'Step 2 of 2'));
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
    const sel = el('p', {class: 'step-help', style: 'margin-top:6px;color:var(--rmi-blue-dark);font-weight:600'}, '✓ ' + state.tank.displayName);
    panel.appendChild(sel);
  }
  return panel;
}

function renderStepPanel(step, idx) {
  const isAnswered = !!state.stepSelections[idx];
  const useList = step.options.length > 5 || step.options.some(o => (o.label || '').length > 40);
  const panel = el('section', {class: 'panel' + (isAnswered ? ' done' : '')});
  panel.appendChild(el('span', {class: 'step-tag'}, 'Step ' + (idx + 3)));
  panel.appendChild(el('h2', {class: 'step-title'}, step.stepName));

  const body = el('div', {class: 'step-body'});
  const container = el('div', {class: useList ? 'opt-list' : 'button-grid'});
  for (const o of step.options) {
    const isSel = state.stepSelections[idx] && state.stepSelections[idx].partNumber === o.partNumber;
    const btn = el('button', {
      class: 'opt-btn' + (isSel ? ' selected' : ''),
      type: 'button',
      onclick: () => selectStep(idx, o),
    });
    btn.appendChild(el('span', {}, o.label));
    btn.appendChild(el('span', {class: 'pn'}, o.partNumber));
    container.appendChild(btn);
  }
  body.appendChild(container);
  panel.appendChild(body);

  if (isAnswered) {
    const sel = state.stepSelections[idx];
    panel.appendChild(el('p', {class: 'step-help', style: 'margin-top:6px;color:var(--rmi-blue-dark);font-weight:600'}, '✓ ' + sel.label));
  }
  return panel;
}

function renderAddOnsPanel() {
  const tank = state.tank;
  const panel = el('section', {class: 'panel'});
  panel.appendChild(el('span', {class: 'step-tag'}, 'Add-On Options'));
  panel.appendChild(el('h2', {class: 'step-title'}, 'Optional Accessories'));
  panel.appendChild(el('p', {class: 'step-help'},
    'Items shown apply to the ' + tank.displayName + '. Standard items are auto-included.'));

  const body = el('div', {class: 'step-body'});

  const applicableMap = {};
  for (const ap of tank.applicableOptions) applicableMap[ap.optionNumber] = ap;

  const standardCount = tank.applicableOptions.filter(a => a.standard).length;
  if (standardCount > 0) {
    const note = el('div', {class: 'addon standard'});
    note.appendChild(el('div', {class: 'addon-body'},
      el('p', {class: 'addon-title'}, '✓ ' + standardCount + ' standard items already included'),
      el('p', {class: 'addon-desc'}, 'See the configuration summary on the right.')));
    body.appendChild(note);
  }

  for (const opt of CHART_DATA.addOnOptions) {
    const ap = applicableMap[opt.number];
    if (!ap || !ap.applies || ap.standard) continue;

    const state_key = String(opt.number);
    const cur = state.addOns[state_key] || {checked: false, variant: null};

    const wrap = el('div', {class: 'addon' + (cur.checked ? ' checked' : '')});
    const cb = el('input', {
      type: 'checkbox',
      id: 'addon-' + opt.number,
      onchange: (e) => toggleAddOn(opt, e.target.checked),
    });
    if (cur.checked) cb.checked = true;
    wrap.appendChild(cb);

    const inner = el('div', {class: 'addon-body'});
    const titleRow = el('p', {class: 'addon-title'},
      '#' + opt.number + ' · ' + opt.name);
    if (ap.notes) {
      titleRow.appendChild(el('span', {class: 'addon-pill'}, shortenNote(ap.notes)));
    }
    inner.appendChild(titleRow);
    inner.appendChild(el('p', {class: 'addon-desc'}, opt.shortDescription));

    if (opt.variants && opt.variants.length > 0) {
      const sub = el('div', {class: 'addon-sub'});
      sub.appendChild(el('span', {class: 'sub-label'}, variantLabel(opt)));
      const visibleVariants = filterVariantsForTank(opt, tank);
      for (const v of visibleVariants) {
        const isSel = cur.variant && cur.variant.partNumber === v.partNumber;
        const sb = el('button', {
          class: 'sub-btn' + (isSel ? ' selected' : ''),
          type: 'button',
          onclick: () => selectVariant(opt, v),
        }, v.label);
        sub.appendChild(sb);
      }
      inner.appendChild(sub);
    }
    wrap.appendChild(inner);
    body.appendChild(wrap);
  }

  if (body.children.length === 0) {
    body.appendChild(el('p', {class: 'empty'}, 'No additional add-ons available for this tank.'));
  }

  panel.appendChild(body);
  return panel;
}

function variantLabel(opt) {
  if (opt.selectionType === 'with-or-without-vent') return 'Choose:';
  if (opt.selectionType === 'side-choice') return 'Tank side:';
  if (opt.selectionType === 'gas-specific') return 'Gas:';
  if (opt.selectionType === 'fill-type-variant') return 'Variant:';
  return 'Variant:';
}

function filterVariantsForTank(opt, tank) {
  if (opt.number === 2) {
    if (tank.fillType === 'TopFill') return opt.variants.filter(v => v.label === 'Top Fill');
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

function shortenNote(notes) {
  if (!notes) return '';
  if (notes.length > 32) return notes.substring(0, 30) + '…';
  return notes;
}

function renderSummary() {
  const sub = $('#sum-sub');
  const body = $('#sum-body');
  const actions = $('#actions');

  if (!state.tank) {
    sub.textContent = 'Select a tank size to begin.';
    body.innerHTML = '<div class="empty">No selections yet</div>';
    actions.style.display = 'none';
    return;
  }

  body.innerHTML = '';
  sub.textContent = state.tank.displayName + ' · ' + state.tank.psiRating;

  const sec1 = el('div', {class: 'sum-section'});
  sec1.appendChild(el('p', {class: 'sum-h'}, 'Tank'));
  sec1.appendChild(makeSumItem(state.tank.displayName, ''));
  body.appendChild(sec1);

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

  const addons = Object.entries(state.addOns).filter(([_,v]) => v.checked);
  if (addons.length) {
    const sec4 = el('div', {class: 'sum-section'});
    sec4.appendChild(el('p', {class: 'sum-h'}, 'Selected Add-Ons'));
    for (const [num, val] of addons) {
      const opt = CHART_DATA.addOnOptions.find(o => String(o.number) === num);
      if (!opt) continue;
      const v = val.variant;
      const label = '#' + opt.number + ' · ' + opt.name + (v ? ' (' + v.label + ')' : '');
      const part = v ? v.partNumber : (opt.variants[0]?.partNumber || '');
      const item = makeSumItem(label, part);

      if (opt.number === 5 && state.tank.pressureClass !== 'VHP') {
        item.querySelector('.lbl').appendChild(el('span', {style: 'color:var(--warn);font-weight:600;font-size:11px'}, ' (Qty 2)'));
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
  if (checked && opt.variants && opt.variants.length > 0 && !state.addOns[key].variant) {
    const visible = filterVariantsForTank(opt, state.tank);
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

function scrollToNext() {
  setTimeout(() => {
    const panels = $$('.panel:not(.done)');
    const next = panels.find(p => !p.classList.contains('done'));
    if (next) next.scrollIntoView({behavior: 'smooth', block: 'start'});
  }, 60);
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
      let line = '#' + opt.number + ' ' + opt.name;
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

function handlePdf() {
  if (!state.tank) return;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({unit: 'pt', format: 'letter'});
  const W = pdf.internal.pageSize.getWidth();
  const M = 50;
  let y = M;

  pdf.setFillColor(10, 77, 140);
  pdf.rect(0, 0, W, 70, 'F');
  pdf.setTextColor(255,255,255);
  pdf.setFontSize(18); pdf.setFont('helvetica', 'bold');
  pdf.text('Chart Microbulk Tank Configuration', M, 35);
  pdf.setFontSize(11); pdf.setFont('helvetica', 'normal');
  pdf.text('Ratermann Manufacturing, Inc.  ·  1-800-264-7793  ·  rmiorder.com', M, 55);
  y = 100;
  pdf.setTextColor(20, 30, 40);

  pdf.setFontSize(15); pdf.setFont('helvetica', 'bold');
  pdf.text(state.tank.displayName, M, y); y += 18;
  pdf.setFontSize(10); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(80, 90, 110);
  pdf.text('Pressure: ' + state.tank.psiRating + '  ·  ID: ' + state.tank.id, M, y); y += 22;
  pdf.setTextColor(20, 30, 40);

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
    pdf.text(label, M + 6, y);
    if (partNumber) {
      pdf.setFont('courier', 'normal');
      const tw = pdf.getTextWidth(partNumber);
      pdf.text(partNumber, W - M - tw, y);
    }
    pdf.setTextColor(20, 30, 40);
    y += 14;
    if (y > pdf.internal.pageSize.getHeight() - 60) { pdf.addPage(); y = M; }
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
      let label = '#' + opt.number + ' ' + opt.name;
      if (v) label += ' (' + v.label + ')';
      let pn = v ? v.partNumber : (opt.variants[0]?.partNumber || '');
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
