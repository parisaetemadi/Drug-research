/* The Medicine Market.
   Plain DOM and hand-drawn SVG — no framework, no build step, no chart library.
   Every section reads a JSON file out of data/ and draws one picture from it. */

const SVG_NS = 'http://www.w3.org/2000/svg';

/* =========================================================
   small helpers
   ========================================================= */

const $ = id => document.getElementById(id);

function el(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(width, height, box) {
  const node = el('svg', {
    // A crop is given as [x, y, w, h] in the drawing's own coordinates: the map
    // is generated for the whole globe and then shown without the empty ocean.
    viewBox: box ? box.join(' ') : `0 0 ${width} ${height}`,
    preserveAspectRatio: 'xMidYMin meet',
    role: 'img'
  });
  return node;
}

function money(n) {
  if (!isFinite(n) || n <= 0) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(n >= 1e11 ? 0 : 1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// money() is for magnitudes and floors at zero. Net income is routinely
// negative in the biotech layer, so losses get their own formatter.
function signedMoney(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  if (n === 0) return '$0';
  return (n < 0 ? '\u2212' : '') + money(Math.abs(n));
}

function priceLabel(n) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  return `$${n.toLocaleString('en-US')}`;
}

// Filled boxes carry white labels, which need roughly 4.5:1 behind them. The
// layer hues are chosen against a near-black ground, so on the light palette
// the lighter ones are darkened at the point of use rather than forked.
// A half-opaque hue over near-black reads darker; over cream it reads paler,
// and the white label on top of it stops carrying. So the boxes go solid on the
// light palette, where the hue itself has to do the work.
const isLight = () => document.documentElement.dataset.theme === 'light';
const cellOpacity = () => (isLight() ? 0.92 : 0.5);
const groupOpacity = () => (isLight() ? 0.16 : 0.11);

function inkable(hex) {
  if (!isLight()) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum <= 0.48) return hex;
  const k = 0.48 / lum;
  const to = v => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// SVG has no text metrics until a node is in the document, and no way to wrap.
// Inter's average advance is close enough to 0.56em for laying out box labels,
// which only ever need to answer "does this fit".
const WIDTH_PER_EM = 0.56;
const textWidth = (text, size) => text.length * size * WIDTH_PER_EM;
const sizeToFit = (text, width) => width / (text.length * WIDTH_PER_EM);

function fill(node, ...children) {
  node.replaceChildren(...children.flat().filter(Boolean));
  return node;
}

function legendInto(target, entries) {
  target.replaceChildren(...entries.map(([label, color]) => {
    const span = document.createElement('span');
    span.style.color = color;
    const dot = document.createElement('i');
    const text = document.createElement('span');
    text.textContent = label;
    text.style.color = 'var(--body)';
    span.append(dot, text);
    return span;
  }));
}

// Renders a set of mutually exclusive buttons and calls back with the chosen id.
function toggles(target, options, onPick) {
  let active = options[0].id;
  const buttons = options.map(opt => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toggle';
    b.textContent = opt.label;
    b.setAttribute('aria-pressed', String(opt.id === active));
    b.addEventListener('click', () => {
      if (opt.id === active) return;
      active = opt.id;
      buttons.forEach((other, i) => other.setAttribute('aria-pressed', String(options[i].id === active)));
      onPick(active);
    });
    return b;
  });
  target.replaceChildren(...buttons);
  onPick(active);
}

/* =========================================================
   squarified treemap

   Standard squarify: consume items in the order given, growing a row until
   adding the next item would make the row's worst aspect ratio worse, then
   commit it. `forceRows` pins the rows horizontally so a caller that cares
   about vertical order (inputs at the bottom, drug owners at the top) gets it,
   at the cost of slightly worse-shaped boxes.
   ========================================================= */

function squarify(items, rect, forceRows = false, key = 'value') {
  const out = [];
  const queue = items.filter(d => d[key] > 0);
  if (!queue.length) return out;

  let free = { ...rect };
  let remaining = queue.slice();
  let remainingValue = remaining.reduce((s, d) => s + d[key], 0);

  while (remaining.length) {
    const along = forceRows ? free.w : Math.min(free.w, free.h);
    const scale = (free.w * free.h) / remainingValue;

    const row = [];
    let rowValue = 0;
    let bestWorst = Infinity;

    while (remaining.length) {
      const candidateValue = rowValue + remaining[0][key];
      const thickness = (candidateValue * scale) / along;
      const worst = Math.max(...[...row, remaining[0]].map(d => {
        const len = (d[key] * scale) / thickness;
        return Math.max(thickness / len, len / thickness);
      }));
      if (row.length && worst > bestWorst) break;
      row.push(remaining.shift());
      rowValue = candidateValue;
      bestWorst = worst;
    }

    const thickness = (rowValue * scale) / along;
    const horizontal = forceRows || free.w <= free.h;
    let offset = 0;

    for (const d of row) {
      const len = (d[key] * scale) / thickness;
      out.push(horizontal
        ? { ...d, x: free.x + offset, y: free.y, w: len, h: thickness }
        : { ...d, x: free.x, y: free.y + offset, w: thickness, h: len });
      offset += len;
    }

    if (horizontal) { free.y += thickness; free.h -= thickness; }
    else            { free.x += thickness; free.w -= thickness; }
    remainingValue -= rowValue;
  }

  return out;
}

/* =========================================================
   hover card

   One card, reused by every box, rather than one node per company: with 86
   cells the difference is noticeable on a phone. It reports what the company
   earns and keeps, which the box area alone cannot show — a huge box on thin
   margins and a small one on fat margins look identical otherwise.
   ========================================================= */

const card = (() => {
  const node = document.createElement('div');
  node.className = 'card';
  node.hidden = true;
  document.body.append(node);
  return node;
})();

function pct(v) {
  return v === null || v === undefined || !isFinite(v) ? null : `${(v * 100).toFixed(1)}%`;
}

function cardRows(company, quote, mode) {
  const rows = [];
  const q = quote || {};
  const counted = company.share < 1
    ? ` <em>${Math.round(company.share * 100)}% counted</em>`
    : '';

  rows.push(['Market value', q.marketCap ? money(q.marketCap) : '—', counted]);
  rows.push(['Revenue (TTM)', q.revenue ? money(q.revenue) : '—', '']);
  rows.push(['Net income (TTM)', signedMoney(q.netIncome), '']);

  const margins = [
    ['Gross margin', pct(q.grossMargin)],
    ['Operating margin', pct(q.operatingMargin)],
    ['Net margin', pct(q.profitMargin)]
  ].filter(([, v]) => v !== null);

  return { rows, margins, counted, mode };
}

function renderCard(company, quote, color, mode) {
  const { rows, margins } = cardRows(company, quote, mode);
  const loss = quote && quote.netIncome != null && quote.netIncome < 0;

  card.innerHTML = `
    <div class="card-head" style="border-color:${color}">
      <span class="card-name">${company.name}</span>
      <span class="card-ticker">${company.ticker}</span>
    </div>
    <p class="card-what">${company.what}</p>
    <dl class="card-figures">
      ${rows.map(([k, v, extra]) => `<div><dt>${k}</dt><dd${k.startsWith('Net income') && loss ? ' class="neg"' : ''}>${v}${extra}</dd></div>`).join('')}
    </dl>
    ${margins.length ? `<dl class="card-figures card-margins">
      ${margins.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
    </dl>` : ''}
    ${!quote || quote.revenue == null ? '<p class="card-gap">Revenue and margins were not returned for this listing.</p>' : ''}
  `;
}

function placeCard(clientX, clientY) {
  card.hidden = false;
  const box = card.getBoundingClientRect();
  const pad = 14;
  let x = clientX + pad;
  let y = clientY + pad;
  if (x + box.width > window.innerWidth - 8) x = clientX - box.width - pad;
  if (y + box.height > window.innerHeight - 8) y = clientY - box.height - pad;
  card.style.left = `${Math.max(8, x)}px`;
  card.style.top = `${Math.max(8, y)}px`;
}

function attachCard(node, company, quote, color, mode) {
  const show = e => {
    renderCard(company, quote, color, mode);
    const p = e.touches ? e.touches[0] : e;
    placeCard(p.clientX ?? 0, p.clientY ?? 0);
  };
  node.addEventListener('pointerenter', show);
  node.addEventListener('pointermove', e => { if (!card.hidden) placeCard(e.clientX, e.clientY); });
  node.addEventListener('pointerleave', () => { card.hidden = true; });
  // Keyboard users get the same card, anchored to the box itself.
  node.addEventListener('focus', () => {
    renderCard(company, quote, color, mode);
    const r = node.getBoundingClientRect();
    placeCard(r.left + r.width / 2, r.top + r.height / 2);
  });
  node.addEventListener('blur', () => { card.hidden = true; });
}

/* =========================================================
   01 · the chain, end to end
   ========================================================= */

function renderChain(layers, companies, caps) {
  const host = $('chain-vis');
  const bands = layers.map(layer => {
    const firms = companies.filter(c => c.layer === layer.id);
    const value = firms.reduce((s, c) => s + (caps.quotes[c.ticker]?.marketCap || 0) * c.share, 0);
    return { layer, firms, value };
  });

  const nodes = [];
  const tierNames = { delivery: 'Gets it to patients', owners: 'Owns the drug', services: 'Runs the work', inputs: 'Supplies the inputs' };
  let lastTier = null;

  // Drawn top-down in reverse stack order, so the companies whose names are on
  // the box come first and the raw inputs sit at the bottom.
  for (const band of [...bands].reverse()) {
    if (band.layer.tier !== lastTier) {
      lastTier = band.layer.tier;
      const t = document.createElement('div');
      t.className = 'chain-tier';
      t.textContent = tierNames[lastTier] || '';
      nodes.push(t);
    }

    const wrap = document.createElement('div');
    wrap.className = 'chain-band';

    const rail = document.createElement('div');
    rail.className = 'chain-rail';
    rail.style.background = band.layer.color;

    const body = document.createElement('div');

    const head = document.createElement('div');
    head.className = 'chain-head';
    const name = document.createElement('div');
    name.className = 'chain-name';
    name.textContent = band.layer.name;
    name.style.color = band.layer.color;
    const value = document.createElement('div');
    value.className = 'chain-value';
    value.textContent = band.value > 0 ? money(band.value) : `${band.firms.length} companies`;
    head.append(name, value);

    const what = document.createElement('div');
    what.className = 'chain-what';
    what.textContent = band.layer.what;

    const role = document.createElement('div');
    role.className = 'chain-role';
    role.textContent = band.layer.role;

    const firms = document.createElement('div');
    firms.className = 'chain-firms';
    const top = [...band.firms]
      .sort((a, b) => (caps.quotes[b.ticker]?.marketCap || 0) - (caps.quotes[a.ticker]?.marketCap || 0))
      .slice(0, 4)
      .map(c => c.name);
    firms.innerHTML = `<b>${top.join(' · ')}</b>${band.firms.length > top.length ? ` and ${band.firms.length - top.length} more` : ''}`;

    body.append(head, what, role, firms);
    wrap.append(rail, body);
    nodes.push(wrap);
  }

  host.replaceChildren(...nodes);

  const total = bands.reduce((s, b) => s + b.value, 0);
  $('chain-stat').innerHTML = total > 0
    ? `<strong>${companies.length} companies</strong> across nine layers, worth <strong>${money(total)}</strong> between them.`
    : `<strong>${companies.length} companies</strong> across nine layers.`;
}

/* =========================================================
   02 · what each layer is worth
   ========================================================= */

function renderValue(layers, companies, caps) {
  const host = $('value-vis');

  if (!caps.quotes || Object.keys(caps.quotes).length === 0) {
    host.innerHTML = '<p class="loading">Market values have not been fetched yet — the daily job in this repository writes them into <code>data/marketcaps.json</code>.</p>';
    $('value-stat').textContent = '';
    $('value-asof').textContent = '';
    return;
  }

  const W = 1000, H = 1180, GAP = 5, HEAD = 22;

  // True area makes the tail unreadable: the smallest company here is about
  // a twenty-thousandth of the largest, which is a box a couple of pixels wide.
  // Raising every value to a power below 1 pulls the small boxes up while
  // leaving the order and the rough sense of scale intact. The number printed
  // in each box is always the real one, and the toggle shows the honest areas.
  const COMPRESS = 0.52;
  let scaleMode = 'readable';
  let mode = 'marketCap';

  const layoutValue = v => scaleMode === 'readable' ? Math.pow(v, COMPRESS) : v;

  const draw = () => {
    const valueOf = c => {
      const q = caps.quotes[c.ticker];
      if (!q) return 0;
      const base = mode === 'revenue' ? q.revenue : q.marketCap;
      return (base || 0) * c.share;
    };

    // Layers in display order: the top of the stack is drawn first, so squarify's
    // rows run from the drug owners down to the raw inputs.
    const groups = [...layers].reverse().map(layer => {
      const firms = companies
        .map(c => ({ ...c, value: valueOf(c) }))
        .filter(c => c.layer === layer.id && c.value > 0)
        .sort((a, b) => b.value - a.value)
        .map(c => ({ ...c, layoutV: layoutValue(c.value) }));
      const value = firms.reduce((s, c) => s + c.value, 0);
      // Layers are compressed on their own totals, not on the sum of their
      // already-compressed members, so the layer proportions stay comparable.
      return { layer, firms, value, layoutV: layoutValue(value) };
    }).filter(g => g.value > 0);

    const total = groups.reduce((s, g) => s + g.value, 0);
    const chart = svg(W, H);

    // One squarify pass over all nine layers, rows pinned horizontal so the
    // reading order survives: the companies that own the drug at the top, the
    // raw inputs at the bottom. Laying each tier out in its own band instead
    // looks tidier on paper but is worse here — big pharma is four fifths of
    // the total, so every other tier is squeezed into a strip and the biotech
    // layer collapses into slivers too thin to label.
    const placed = squarify(groups, { x: 0, y: 0, w: W, h: H }, true, 'layoutV');

    for (const g of placed) {
      const color = inkable(g.layer.color);
      const gx = g.x + GAP / 2, gy = g.y + GAP / 2;
      const gw = Math.max(0, g.w - GAP), gh = Math.max(0, g.h - GAP);
      const group = el('g');

      group.append(el('rect', {
        x: gx, y: gy, width: gw, height: gh, rx: 3,
        fill: color, 'fill-opacity': groupOpacity(),
        stroke: color, 'stroke-opacity': 0.34
      }));

      // A wide group gets a header strip across the top. A narrow one has no room
      // for horizontal text, so its name is set on its side down the left edge —
      // otherwise neighbouring labels overlap into an unreadable pile.
      const wide = gw > 190;
      let inner;

      if (wide) {
        group.append(el('rect', { x: gx + 9, y: gy + 8, width: 9, height: 9, rx: 2, fill: color }));
        group.append(el('text', { x: gx + 25, y: gy + 17, class: 'tm-group-label' }, g.layer.name));
        if (gw > 300) {
          group.append(el('text', {
            x: gx + gw - 9, y: gy + 17, 'text-anchor': 'end', class: 'tm-group-total'
          }, money(g.value)));
        }
        inner = { x: gx + 4, y: gy + HEAD, w: Math.max(0, gw - 8), h: Math.max(0, gh - HEAD - 4) };
      } else {
        const cy = gy + gh / 2;
        group.append(el('text', {
          x: gx + 14, y: cy, class: 'tm-group-label', 'text-anchor': 'middle',
          transform: `rotate(-90 ${gx + 14} ${cy})`
        }, gh > 260 ? `${g.layer.name} · ${money(g.value)}` : g.layer.name));
        inner = { x: gx + 22, y: gy + 4, w: Math.max(0, gw - 26), h: Math.max(0, gh - 8) };
      }
      for (const c of squarify(g.firms, inner, false, 'layoutV')) {
        const cw = Math.max(0, c.w - 2), ch = Math.max(0, c.h - 2);
        if (cw < 4 || ch < 4) continue;

        const cell = el('g', { class: 'tm-cell', tabindex: 0 });
        cell.append(el('rect', {
          class: 'tm-fill',
          x: c.x + 1, y: c.y + 1, width: cw, height: ch, rx: 2,
          fill: color, 'fill-opacity': cellOpacity(),
          stroke: color, 'stroke-opacity': 0.7
        }));
        attachCard(cell, c, caps.quotes[c.ticker], color, mode);

        // Type only goes in where it fits. The name is shrunk to fit the box,
        // then swapped for the ticker, then dropped entirely — a sliver stays a
        // plain coloured rectangle rather than spilling text over its neighbour.
        // A small box gets tighter padding, because at that size the inset is
        // the difference between a label and no label.
        const pad = cw < 90 ? 5 : 10;
        const room = cw - pad * 2;
        let label = c.name;
        let size = Math.min(cw / 4.6, ch / 2.6, 40);
        if (textWidth(label, size) > room) size = sizeToFit(label, room);

        if (size < 12) {
          const tickerSize = Math.min(12, sizeToFit(c.ticker, room));
          if (tickerSize > size) { label = c.ticker; size = tickerSize; }
        }

        if (size >= 8.5 && ch > size * 1.6) {
          cell.append(el('text', {
            x: c.x + pad, y: c.y + pad + size * 0.85,
            class: 'tm-name', 'font-size': size
          }, label));

          const sub = Math.max(9, size * 0.62);
          if (ch > size * 1.4 + sub * 2 && textWidth(money(c.value), sub) <= room) {
            cell.append(el('text', {
              x: c.x + pad, y: c.y + pad + size * 1.05 + sub,
              class: 'tm-value', 'font-size': sub
            }, money(c.value)));
          }
          if (ch > size * 3.9 && cw > 190) {
            const max = Math.floor(room / (13 * WIDTH_PER_EM));
            cell.append(el('text', {
              x: c.x + pad, y: c.y + 15 + size * 2.9,
              class: 'tm-what', 'font-size': 13
            }, c.what.length > max ? c.what.slice(0, max - 1) + '…' : c.what));
          }
        }
        group.append(cell);
      }
      chart.append(group);
    }

    // No tier bracket down the side: with rows straddling tiers it could only
    // ever be approximate, and section 01 already lays the tiers out properly.

    fill(host, chart);

    const owners = groups.filter(g => g.layer.tier === 'owners').reduce((s, g) => s + g.value, 0);
    const counted = groups.reduce((s, g) => s + g.firms.length, 0);
    const noun = mode === 'revenue' ? 'of trailing revenue' : 'of market value';
    const ownerPct = Math.round((owners / total) * 100);
    $('value-stat').innerHTML =
      `<strong>${money(total)}</strong> ${noun} across ${counted} companies · the layers that own the drug are `
      + `<strong>${ownerPct}%</strong> of it`
      + (scaleMode === 'readable'
          ? ` — more than the boxes suggest, because small companies are drawn larger than their share.`
          : `, drawn to scale.`);
  };

  const hasRevenue = Object.values(caps.quotes).some(q => q.revenue);
  const options = [{ id: 'marketCap', label: 'Market value' }];
  if (hasRevenue) options.push({ id: 'revenue', label: 'Revenue (TTM)' });
  toggles($('value-toggles'), options, id => { mode = id; draw(); });

  toggles($('value-scale'), [
    { id: 'readable', label: 'Readable areas' },
    { id: 'true', label: 'True areas' }
  ], id => { scaleMode = id; draw(); });

  legendInto($('value-legend'), layers.map(l => [l.name, inkable(l.color)]));

  const when = caps.generatedAt ? new Date(caps.generatedAt) : null;
  const missing = (caps.missing || []).length;
  $('value-asof').textContent = when
    ? `Market values as of ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}, from ${caps.source}`
      + (missing ? `. ${missing} ${missing === 1 ? 'company is' : 'companies are'} missing from this snapshot and left off the chart.` : '.')
    : '';

  // Anything not from the live feed is stated on the chart itself, not just in
  // a footnote — a treemap of placeholder numbers looks exactly like a real one.
  if (!/yahoo/i.test(caps.source || '')) {
    const warn = document.createElement('p');
    warn.className = 'placeholder-warning';
    warn.textContent = 'Provisional figures. These are rounded approximations, not quotes — '
      + 'read the shape, not the numbers. Live market values, revenue and margins load a '
      + 'moment after the page opens, and replace these when the quote endpoint answers.';
    host.prepend(warn);
  }
}

/* =========================================================
   03 · the ten-year gauntlet
   ========================================================= */

function renderGauntlet(data, layerColor) {
  const host = $('gauntlet-vis');
  const W = 1000, ROW = 104, PAD = 26, LABEL = 250;

  const draw = mode => {
    const stages = mode === 'survivors'
      ? data.stages.filter(s => s.survivalPct !== null)
      : data.stages;

    const H = PAD * 2 + stages.length * ROW;
    const chart = svg(W, H);
    const trackX = LABEL;
    const trackW = W - LABEL - 150;

    let carried = 100;

    stages.forEach((stage, i) => {
      const y = PAD + i * ROW;
      const color = inkable(layerColor[stage.layer] || '#8b7ff0');

      chart.append(el('text', { x: 0, y: y + 27, class: 'funnel-stage-name' }, stage.name));

      let frac, figure, carry;
      if (mode === 'survivors') {
        const before = carried;
        carried = carried * (stage.survivalPct / 100);
        frac = carried / 100;
        figure = `${stage.survivalPct}% pass`;
        carry = `${before.toFixed(before < 10 ? 1 : 0)} in → ${carried.toFixed(carried < 10 ? 1 : 0)} out`;
      } else {
        const maxYears = Math.max(...stages.map(s => s.years));
        frac = stage.years / maxYears;
        figure = stage.yearsRange;
        carry = null;
      }

      // The faint full-width track shows what each bar is a fraction of.
      chart.append(el('rect', {
        class: 'row-track', x: trackX, y: y + 8, width: trackW, height: 32, rx: 3
      }));
      chart.append(el('rect', {
        x: trackX, y: y + 8, width: Math.max(2, trackW * frac), height: 32, rx: 3,
        fill: color, 'fill-opacity': isLight() ? 1 : 0.85
      }));
      chart.append(el('text', {
        x: W, y: y + 31, 'text-anchor': 'end', class: 'funnel-figure'
      }, figure));
      // The description sits below the bar, where it has the width to itself.
      chart.append(el('text', { x: trackX, y: y + 62, class: 'funnel-stage-detail' }, stage.detail));
      if (carry) {
        chart.append(el('text', { x: 0, y: y + 50, class: 'funnel-carry' }, carry));
      }
    });

    fill(host, chart);

    $('gauntlet-stat').innerHTML = mode === 'survivors'
      ? `<strong>${data.cumulativeFromPhase1}%</strong> of molecules entering Phase 1 are approved · about <strong>7 in 100</strong>.`
      : `<strong>${data.stages.reduce((s, x) => s + x.years, 0).toFixed(0)} years</strong> from the first screen to a prescription, `
        + `and <strong>${data.totalCost}</strong> — ${data.totalCostNote}.`;
  };

  toggles($('gauntlet-toggles'), [
    { id: 'survivors', label: 'How many survive' },
    { id: 'years', label: 'How long it takes' }
  ], draw);

  $('gauntlet-note').textContent =
    'Phase transition rates are industry-wide averages and vary enormously by disease: '
    + 'haematology runs about four times better than respiratory, and oncology worst of all. '
    + 'Discovery and preclinical attrition is not measured on the same basis, so those two stages '
    + 'appear only in the timeline.';
}

/* =========================================================
   04 · inside a trial

   A dot per participant, at one size throughout, so the jump from Phase 1 to
   Phase 3 is read rather than calculated. The reason cost per participant
   falls as trials grow is that the fixed cost of standing a trial up — the
   protocol, the regulatory work, the data systems — is spread over more people.
   ========================================================= */

function renderTrials(data) {
  const host = $('trials-vis');
  const W = 1000, PITCH = 11, DOT = 3.6, LEFT = 0;
  const perRow = Math.floor(W / PITCH);

  // Space above the dots for the heading block, and below them for the facts
  // line plus a gap wide enough that the next phase reads as a new block.
  const HEAD_H = 80, FOOT_H = 76;

  const blocks = data.phases.map(phase => {
    const rows = Math.ceil(phase.typical / perRow);
    return { phase, rows, height: HEAD_H + rows * PITCH + FOOT_H };
  });

  const H = blocks.reduce((sum, b) => sum + b.height, 0);
  const chart = svg(W, H);
  let y = 0;

  for (const { phase, rows } of blocks) {
    chart.append(el('text', {
      x: LEFT, y: y + 20, class: 'trial-name', fill: phase.color
    }, phase.name));
    chart.append(el('text', {
      x: W, y: y + 20, 'text-anchor': 'end', class: 'trial-count'
    }, `${phase.typical.toLocaleString('en-US')} people · ${phase.range}`));
    chart.append(el('text', { x: LEFT, y: y + 44, class: 'trial-asks' }, phase.asks));
    chart.append(el('text', { x: LEFT, y: y + 64, class: 'trial-who' }, phase.who));

    const top = y + HEAD_H;
    for (let i = 0; i < phase.typical; i++) {
      chart.append(el('circle', {
        cx: LEFT + (i % perRow) * PITCH + DOT,
        cy: top + Math.floor(i / perRow) * PITCH + DOT,
        r: DOT, fill: phase.color, 'fill-opacity': 0.82
      }));
    }

    const footY = top + rows * PITCH + 24;
    const perPatient = Math.round(phase.cost / phase.typical);
    chart.append(el('text', { x: LEFT, y: footY, class: 'trial-facts' },
      `${phase.sites}  ·  ${phase.duration}  ·  ${money(phase.cost)} per trial  ·  about $${(perPatient / 1000).toFixed(0)}k per participant`));

    y += HEAD_H + rows * PITCH + FOOT_H;
  }

  fill(host, chart);

  const p1 = data.phases[0], p3 = data.phases[2];
  const cheaper = Math.round((p1.cost / p1.typical) / (p3.cost / p3.typical));
  $('trials-stat').innerHTML =
    `Phase 3 costs <strong>${(p3.cost / p1.cost).toFixed(1)}×</strong> what Phase 1 costs, `
    + `but takes <strong>${Math.round(p3.typical / p1.typical)}×</strong> the people — so each participant `
    + `costs about <strong>${cheaper}×</strong> less than in Phase 1.`;

  $('trials-phase4').textContent =
    `${data.phase4.name}: ${data.phase4.detail}`;
}

/* =========================================================
   05 · where the supply is thin
   ========================================================= */

function renderChokepoints(data, layerColor, layerName) {
  const host = $('chokepoint-vis');
  const W = 1000, ROW = 86, PAD = 16, LABEL = 260;
  const items = [...data.items].sort((a, b) => b.share - a.share);
  const H = PAD * 2 + items.length * ROW;
  const chart = svg(W, H);
  const trackX = LABEL;
  const trackW = W - LABEL - 70;

  items.forEach((item, i) => {
    const y = PAD + i * ROW;
    const color = inkable(layerColor[item.layer] || '#8b7ff0');

    chart.append(el('text', { x: LABEL - 20, y: y + 22, 'text-anchor': 'end', class: 'row-label' }, item.name));
    chart.append(el('text', { x: LABEL - 20, y: y + 40, 'text-anchor': 'end', class: 'row-sub' }, item.holder));

    chart.append(el('rect', { class: 'row-track', x: trackX, y: y + 6, width: trackW, height: 26, rx: 3 }));
    chart.append(el('rect', {
      x: trackX, y: y + 6, width: trackW * (item.share / 100), height: 26, rx: 3,
      fill: color, 'fill-opacity': isLight() ? 1 : 0.9
    }));
    chart.append(el('text', { x: W, y: y + 25, 'text-anchor': 'end', class: 'row-value' }, `${item.share}%`));
    chart.append(el('text', { x: trackX, y: y + 50, class: 'row-sub' }, item.basis));
  });

  fill(host, chart);
  legendInto($('chokepoint-legend'), [...new Set(items.map(i => i.layer))].map(id => [layerName[id], inkable(layerColor[id])]));
}

/* =========================================================
   05 · made everywhere, invented somewhere
   ========================================================= */

function renderGeography(data) {
  const host = $('geography-vis');
  const W = 1000, H = 720, TOP = 62, BOTTOM = 20;
  const chart = svg(W, H);
  const colH = H - TOP - BOTTOM;
  const colW = 300;
  const gap = 120;
  const startX = (W - (colW * data.columns.length + gap * (data.columns.length - 1))) / 2;

  data.columns.forEach((col, ci) => {
    const x = startX + ci * (colW + gap);
    chart.append(el('text', { x, y: 18, class: 'col-title' }, col.title));
    chart.append(el('text', { x, y: 38, class: 'col-sub' }, col.subtitle));

    let y = TOP;
    for (const seg of col.segments) {
      const h = (seg.pct / 100) * colH;
      const color = inkable(data.colors[seg.name] || '#8b7ff0');
      chart.append(el('rect', { x, y: y + 1, width: colW, height: Math.max(0, h - 2), rx: 2, fill: color, 'fill-opacity': isLight() ? 1 : 0.86 }));

      const text = `${seg.name} ${seg.pct}%`;
      if (h > 30) {
        chart.append(el('text', { x: x + colW / 2, y: y + h / 2 + 5, 'text-anchor': 'middle', class: 'col-seg-label' }, text));
      } else {
        // A thin band gets its label outside, with a leader line back to it.
        chart.append(el('line', { x1: x + colW, x2: x + colW + 14, y1: y + h / 2, y2: y + h / 2, stroke: color, 'stroke-width': 1 }));
        chart.append(el('text', { x: x + colW + 20, y: y + h / 2 + 4, class: 'col-outside' }, text));
      }
      y += h;
    }
  });

  fill(host, chart);
  legendInto($('geography-legend'), Object.entries(data.colors).map(([k, v]) => [k, inkable(v)]));
  $('geography-note').textContent = data.sources[2];
}

/* =========================================================
   06 · what one medicine costs
   ========================================================= */

function renderPrices(data) {
  const host = $('price-vis');
  const W = 1000, ROW = 96, PAD = 16, LABEL = 470;
  const items = [...data.items].sort((a, b) => a.price - b.price);
  const H = PAD * 2 + items.length * ROW;
  const chart = svg(W, H);
  const trackX = LABEL;
  const trackW = W - LABEL - 130;

  // Log scale: the range is a millionfold, so a linear bar would render
  // everything below Keytruda as an invisible line.
  const lo = Math.log10(items[0].price);
  const hi = Math.log10(items[items.length - 1].price);
  const pos = v => (Math.log10(v) - lo) / (hi - lo);

  items.forEach((item, i) => {
    const y = PAD + i * ROW;
    const color = inkable(data.categories[item.category] || '#8b7ff0');

    chart.append(el('rect', { x: 0, y: y + 10, width: 10, height: 10, rx: 2, fill: color }));
    chart.append(el('text', { x: 22, y: y + 20, class: 'row-label', style: 'fill:var(--ink);font-weight:600' }, item.name));
    chart.append(el('text', { x: 22, y: y + 39, class: 'row-sub' }, item.buys));
    chart.append(el('text', { x: 22, y: y + 56, class: 'row-sub' }, item.treats));

    chart.append(el('rect', { class: 'row-track', x: trackX, y: y + 10, width: trackW, height: 24, rx: 3 }));
    chart.append(el('rect', {
      // A floor of 6px keeps the cheapest bar visible rather than zero-width.
      x: trackX, y: y + 10, width: Math.max(6, trackW * pos(item.price)), height: 24, rx: 3,
      fill: color, 'fill-opacity': isLight() ? 1 : 0.9
    }));
    chart.append(el('text', { x: W, y: y + 28, 'text-anchor': 'end', class: 'row-value' }, priceLabel(item.price)));
  });

  fill(host, chart);
  legendInto($('price-legend'), Object.entries(data.categories).map(([k, v]) => [k, inkable(v)]));

  const ratio = Math.round(items[items.length - 1].price / items[0].price);
  $('price-stat').innerHTML =
    `<strong>${priceLabel(items[0].price)}</strong> to <strong>${priceLabel(items[items.length - 1].price)}</strong> — `
    + `a <strong>${ratio.toLocaleString('en-US')}×</strong> range.`;
}


/* =========================================================
   08 · how long the monopoly lasts

   Two clocks on one axis. The patent's starts at filing; regulatory
   exclusivity starts at approval, which is why the biologic bar ends past
   the patent's own expiry -- drawing them on separate axes would hide the
   one thing worth seeing.
   ========================================================= */

function renderExclusivity(data, layerColor) {
  const host = $('exclusivity-vis');
  const W = 1000, PAD = 20, LABEL = 250, ROW = 62;
  const { patent, exclusivities } = data;
  const approval = patent.typicalFilingToApproval;
  const span = Math.max(patent.termYears, approval + Math.max(...exclusivities.map(e => e.years))) + 1;
  const plotX = LABEL, plotW = W - LABEL - 110;
  const at = years => plotX + (years / span) * plotW;

  const H = PAD * 2 + 46 + (1 + exclusivities.length) * ROW + 34;
  const chart = svg(W, H);

  for (let yr = 0; yr <= span; yr += 5) {
    chart.append(el('line', { x1: at(yr), x2: at(yr), y1: 40, y2: H - 34, stroke: '#232326' }));
    chart.append(el('text', { x: at(yr), y: 30, 'text-anchor': 'middle', class: 'axis-tick' }, `year ${yr}`));
  }

  let y = PAD + 46;
  chart.append(el('text', { x: 0, y: y + 24, class: 'row-label', style: 'fill:var(--ink);font-weight:600' }, 'The patent'));
  chart.append(el('text', { x: 0, y: y + 44, class: 'row-sub' }, '20 years from filing'));
  chart.append(el('rect', {
    x: at(0), y: y + 6, width: at(approval) - at(0), height: 30, rx: 3,
    fill: inkable(layerColor.pharma), 'fill-opacity': 0.28
  }));
  chart.append(el('rect', {
    x: at(approval), y: y + 6, width: at(patent.termYears) - at(approval), height: 30, rx: 3,
    fill: inkable(layerColor.pharma)
  }));
  chart.append(el('text', {
    x: (at(0) + at(approval)) / 2, y: y + 26, 'text-anchor': 'middle', class: 'bar-note'
  }, 'spent getting approved'));
  chart.append(el('text', { x: W, y: y + 28, 'text-anchor': 'end', class: 'row-value' },
    `${patent.termYears - approval} yrs left`));

  chart.append(el('line', {
    x1: at(approval), x2: at(approval), y1: y, y2: H - 34,
    stroke: '#ffffff', 'stroke-width': 1.5, 'stroke-dasharray': '3 3', 'stroke-opacity': 0.7
  }));
  chart.append(el('text', { x: at(approval), y: H - 16, 'text-anchor': 'middle', class: 'axis-tick' }, 'APPROVAL'));

  y += ROW + 12;
  for (const ex of exclusivities) {
    const color = inkable(layerColor[ex.colorLayer] || '#8b7ff0');
    chart.append(el('text', { x: 0, y: y + 22, class: 'row-label', style: 'fill:var(--ink);font-weight:600' }, ex.name));
    chart.append(el('rect', {
      x: at(approval), y: y + 4, width: Math.max(3, at(approval + ex.years) - at(approval)), height: 26, rx: 3,
      fill: color
    }));
    chart.append(el('text', { x: W, y: y + 24, 'text-anchor': 'end', class: 'row-value' },
      ex.years < 1 ? `+${ex.years * 12} mo` : `${ex.years} yrs`));
    chart.append(el('text', { x: 0, y: y + 42, class: 'row-sub' }, ex.what));
    y += ROW;
  }

  fill(host, chart);

  $('exclusivity-stat').innerHTML =
    `A patent runs <strong>${patent.termYears} years</strong> from filing, but roughly `
    + `<strong>${approval}</strong> go on getting approved — leaving `
    + `<strong>${patent.effectivePostApproval} years</strong> of selling once restoration and the 14-year cap apply.`;

  const t = data.thicket;
  $('thicket-note').innerHTML = `<strong>${t.drug}:</strong> ${t.note}`;
}

/* =========================================================
   09 · what stops them charging anything
   ========================================================= */

function renderPricing(data, layerColor) {
  const host = $('pricing-vis');
  const W = 1000, PAD = 16, LABEL = 260, ROW = 74;
  const items = data.negotiated;
  const chart = svg(W, PAD * 2 + items.length * ROW);
  const trackX = LABEL, trackW = W - LABEL - 120;

  items.forEach((item, i) => {
    const y = PAD + i * ROW;
    // Scaled to each drug's own list price: the prices span thirtyfold and the
    // comparison is within a drug, not across them.
    const kept = item.price / item.list;
    chart.append(el('text', { x: LABEL - 20, y: y + 22, 'text-anchor': 'end', class: 'row-label', style: 'fill:var(--ink);font-weight:600' }, item.name));
    chart.append(el('text', { x: LABEL - 20, y: y + 42, 'text-anchor': 'end', class: 'row-sub' }, item.treats));
    chart.append(el('rect', { class: 'row-track', x: trackX, y: y + 6, width: trackW, height: 28, rx: 3 }));
    chart.append(el('rect', {
      x: trackX, y: y + 6, width: Math.max(3, trackW * kept), height: 28, rx: 3, fill: inkable(layerColor.pharma)
    }));
    chart.append(el('text', { x: W, y: y + 27, 'text-anchor': 'end', class: 'row-value' }, `\u2212${item.cut}%`));
    chart.append(el('text', { x: trackX, y: y + 52, class: 'row-sub' },
      `$${item.list.toLocaleString('en-US')} list  \u2192  $${item.price.toLocaleString('en-US')} negotiated, per month`));
  });

  fill(host, chart);

  const h = data.headline;
  $('pricing-stat').innerHTML =
    `<strong>${h.drugs} drugs</strong>, cut between <strong>38%</strong> and <strong>79%</strong> from ${h.effective} · `
    + `about <strong>${money(h.firstYearSaving)}</strong> saved in the first year, across `
    + `<strong>${(h.beneficiaries / 1e6).toFixed(1)} million</strong> people.`;

  $('rules-list').replaceChildren(...data.rules.map(rule => {
    const row = document.createElement('div');
    row.className = 'rule';
    row.innerHTML = `
      <div class="rule-where">${rule.where}</div>
      <div>
        ${rule.before ? `<p class="rule-before"><b>Before:</b> ${rule.before}</p>` : ''}
        <p class="rule-now">${rule.now}</p>
        <p class="rule-catch">${rule.catch}</p>
      </div>`;
    return row;
  }));

  $('profit-cap').textContent = data.profitCap;
}


/* =========================================================
   10 · who actually works here

   Bars are headcount, coloured by layer, and the colours are the finding:
   the largest employers are not all drugmakers. Sorting by people rather
   than by value reshuffles the list from section 02 entirely.
   ========================================================= */

function renderEmployers(data, layerColor, layerName) {
  const W = 1000, PAD = 16, LABEL = 250, ROW = 66;
  const items = [...data.employers].sort((a, b) => b.employees - a.employees);
  const most = items[0].employees;
  const chart = svg(W, PAD * 2 + items.length * ROW);
  const trackX = LABEL, trackW = W - LABEL - 160;

  items.forEach((item, i) => {
    const y = PAD + i * ROW;
    const color = inkable(layerColor[item.layer] || '#8b7ff0');
    chart.append(el('text', { x: LABEL - 20, y: y + 24, 'text-anchor': 'end', class: 'row-label', style: 'fill:var(--ink);font-weight:600' }, item.name));
    chart.append(el('text', { x: LABEL - 20, y: y + 44, 'text-anchor': 'end', class: 'row-sub' }, layerName[item.layer]));
    chart.append(el('rect', { class: 'row-track', x: trackX, y: y + 8, width: trackW, height: 28, rx: 3 }));
    chart.append(el('rect', {
      x: trackX, y: y + 8, width: Math.max(3, trackW * (item.employees / most)), height: 28, rx: 3, fill: color
    }));
    chart.append(el('text', { x: W, y: y + 29, 'text-anchor': 'end', class: 'row-value' },
      item.employees.toLocaleString('en-US')));
    chart.append(el('text', { x: trackX, y: y + 54, class: 'row-sub' }, `${item.note} · ${item.asOf}`));
  });

  fill($('employers-vis'), chart);

  const drugOwners = items.filter(i => i.layer === 'pharma').length;
  $('employers-stat').innerHTML =
    `Of the ten largest employers here, <strong>${items.length - drugOwners}</strong> do not own a drug at all — `
    + `they supply, test or manufacture for the ones that do.`;
}

/* =========================================================
   11 · where the jobs are
   ========================================================= */

function renderJobGeography(data) {
  const W = 1000, H = 620, TOP = 66, BOTTOM = 24;
  const chart = svg(W, H);
  const colH = H - TOP - BOTTOM;
  const colW = 260, gap = 150;
  const biggest = Math.max(...data.regions.map(r => r.total));
  const startX = (W - (colW * data.regions.length + gap * (data.regions.length - 1))) / 2;
  // Both columns share one scale, so Europe reading more than twice the US is
  // a fact you can see rather than one you have to read off the labels.
  const palette = ['#3b82f6', '#ea580c', '#10a37f', '#d99a0b', '#ec4899', '#8b7ff0'];

  data.regions.forEach((region, ri) => {
    const x = startX + ri * (colW + gap);
    const scaled = (region.total / biggest) * colH;
    let y = TOP + (colH - scaled);

    chart.append(el('text', { x, y: 22, class: 'row-label', style: 'fill:var(--ink);font-weight:600' }, region.name));
    chart.append(el('text', { x, y: 44, class: 'row-sub' }, region.basis));
    // The total sits on the heading line, right-aligned to the column. Putting
    // it above the bar collided with the subtitle for whichever region is tall
    // enough to start at the top of the plot.
    chart.append(el('text', {
      x: x + colW, y: 22, 'text-anchor': 'end', class: 'row-value'
    }, `${Math.round(region.total / 1000)}k`));

    region.countries.forEach((c, ci) => {
      const h = (c.employees / region.total) * scaled;
      const color = inkable(palette[ci % palette.length]);
      chart.append(el('rect', { x, y: y + 1, width: colW, height: Math.max(0, h - 2), rx: 2, fill: color }));
      const text = `${c.name} ${Math.round(c.employees / 1000)}k`;
      if (h > 30) {
        chart.append(el('text', { x: x + colW / 2, y: y + h / 2 + 6, 'text-anchor': 'middle', class: 'col-seg-label' }, text));
      } else {
        // A thin band gets its label outside — on whichever side has room, so
        // the rightmost column does not run its labels off the canvas.
        const needed = textWidth(text, 17) + 26;
        const right = x + colW + needed <= W;
        const edge = right ? x + colW : x;
        const tip = right ? edge + 14 : edge - 14;
        chart.append(el('line', { x1: edge, x2: tip, y1: y + h / 2, y2: y + h / 2, stroke: color }));
        chart.append(el('text', {
          x: right ? tip + 6 : tip - 6, y: y + h / 2 + 5,
          'text-anchor': right ? 'start' : 'end', class: 'row-sub'
        }, text));
      }
      y += h;
    });
  });

  fill($('jobgeo-vis'), chart);

  const [eu, us] = data.regions;
  const o = data.outlook;
  $('jobgeo-stat').innerHTML =
    `Europe employs <strong>${(eu.total / 1000).toFixed(0)}k</strong> directly, about `
    + `<strong>${(eu.total / us.total).toFixed(1)}×</strong> what US pharmaceutical manufacturing does.`;
  $('outlook-note').textContent = o.note;
}

/* =========================================================
   12 · what the jobs are

   Laid against the same nine layers as section 01, so a role can be read
   back to the part of the chain it belongs to.
   ========================================================= */

function renderRoles(data, layerColor) {
  const host = $('roles-vis');
  // Only some roles map cleanly onto a published occupation. The ones that do
  // carry the median; the rest say nothing rather than borrow a neighbour's.
  const median = Object.fromEntries(data.pay.occupations.map(o => [o.title, o.median]));

  host.replaceChildren(...data.roles.map(group => {
    const block = document.createElement('div');
    block.className = 'role-block';
    // Same darkening as the chart fills: the grey and amber are too light
    // to read as a heading on cream.
    block.style.setProperty('--layer', inkable(layerColor[group.layer] || '#8b7ff0'));
    block.innerHTML = `
      <div class="role-stage">${group.stage}</div>
      <div class="role-list">
        ${group.roles.map(r => `
          <div class="role">
            <div class="role-title">${r.title}</div>
            <div class="role-what">${r.what}</div>
            <div class="role-wants">${r.wants}</div>
            ${r.bls && median[r.bls]
              ? `<div class="role-pay">Median <strong>$${median[r.bls].toLocaleString('en-US')}</strong> · ${r.bls}</div>`
              : ''}
          </div>`).join('')}
      </div>`;
    return block;
  }));

  const total = data.roles.reduce((n, g) => n + g.roles.length, 0);
  $('roles-stat').innerHTML =
    `<strong>${total} roles</strong> across the nine layers — and only a handful of them are the ones people picture.`;
}

/* =========================================================
   13 · what it pays

   One bar per occupation against a shared scale, with the median for every
   US occupation drawn across it — the reference line is the point, because
   every one of these clears it, including the one at the bottom.
   ========================================================= */

// OEWS May 2025 put the median hourly wage for all occupations at $24.51,
// which is this at a 2,080-hour year. Drawn as a line rather than a bar so it
// reads as the ground the others stand on.
const US_MEDIAN_WAGE = 50980;

function renderPay(data, layerColor, layerName) {
  const pay = data.pay;
  const W = 1000, PAD = 18, LABEL = 330, ROW = 74;
  const items = [...pay.occupations].sort((a, b) => b.median - a.median);
  const trackX = LABEL, trackW = W - LABEL - 190;
  const top = Math.max(...items.map(i => i.median));
  const chart = svg(W, PAD * 2 + items.length * ROW + 34);
  const x = v => trackX + (v / top) * trackW;

  items.forEach((item, i) => {
    const y = PAD + i * ROW;
    const color = inkable(layerColor[item.layer] || '#8b7ff0');

    const name = item.title;
    const size = Math.min(19, sizeToFit(name, LABEL - 30));
    chart.append(el('text', {
      x: LABEL - 20, y: y + 24, 'text-anchor': 'end', class: 'row-label',
      style: `fill:var(--ink);font-weight:600;font-size:${size.toFixed(1)}px`
    }, name));
    chart.append(el('text', { x: LABEL - 20, y: y + 46, 'text-anchor': 'end', class: 'row-sub' }, layerName[item.layer]));

    chart.append(el('rect', { class: 'row-track', x: trackX, y: y + 8, width: trackW, height: 30, rx: 3 }));
    chart.append(el('rect', { x: trackX, y: y + 8, width: Math.max(3, x(item.median) - trackX), height: 30, rx: 3, fill: color }));
    chart.append(el('text', { x: W, y: y + 31, 'text-anchor': 'end', class: 'row-value' },
      `$${item.median.toLocaleString('en-US')}`));
    chart.append(el('text', { x: trackX, y: y + 58, class: 'row-sub' },
      `${item.note} · projected ${item.growth >= 0 ? '+' : ''}${item.growth}% to 2034`));
  });

  // Behind the bars it would disappear under the long ones, and drawn straight
  // down the chart it struck through every note. So it runs in segments, one
  // per bar, at the height of the bar it is being compared with.
  const mx = x(US_MEDIAN_WAGE);
  const bottom = PAD + items.length * ROW;
  items.forEach((item, i) => {
    const y = PAD + i * ROW;
    chart.append(el('line', { x1: mx, x2: mx, y1: y + 2, y2: y + 44, class: 'ref-line' }));
  });
  chart.append(el('text', { x: mx + 8, y: bottom + 16, class: 'row-sub' },
    `$${US_MEDIAN_WAGE.toLocaleString('en-US')} — the median for every US occupation`));

  fill($('pay-vis'), chart);

  const lowest = items[items.length - 1];
  $('pay-stat').innerHTML =
    `Every occupation here clears the national median, the lowest of them by `
    + `<strong>${Math.round((lowest.median / US_MEDIAN_WAGE - 1) * 100)}%</strong> — `
    + `but the top of the list still pays <strong>${(items[0].median / lowest.median).toFixed(1)}×</strong> the bottom of it.`;
  $('pay-basis').textContent = `${pay.basis} Figures are ${pay.asOf}; the growth figure is the projected change in US employment in that occupation between 2024 and 2034.`;
}

/* =========================================================
   14 · where the companies are

   Headquarters projected onto an equirectangular world, then merged into
   clusters at a fixed screen distance: at this scale Cambridge, Waltham and
   Billerica are one circle whatever the coordinates say, and drawing them
   apart would claim a precision the map does not have.
   ========================================================= */

// Companies are grouped by the metro their head office sits in, named in the
// data rather than derived from the coordinates. Merging by distance chained
// the American northeast into one circle — Boston reaching New York reaching
// Philadelphia — and naming a cluster after whichever city held the most of
// them called the Bay Area "Pleasanton".
function clusterCompanies(companies) {
  const byHub = new Map();
  for (const c of companies) {
    if (!c.hq) continue;
    if (!byHub.has(c.hq.hub)) byHub.set(c.hq.hub, []);
    byHub.get(c.hq.hub).push(c);
  }

  return [...byHub.entries()].map(([hub, members]) => {
    const layers = {};
    for (const m of members) layers[m.layer] = (layers[m.layer] || 0) + 1;
    return {
      hub,
      members,
      count: members.length,
      country: members[0].hq.country,
      layer: Object.entries(layers).sort((a, b) => b[1] - a[1])[0][0],
      x: members.reduce((t, m) => t + m.hq.x, 0) / members.length,
      y: members.reduce((t, m) => t + m.hq.y, 0) / members.length
    };
  }).sort((a, b) => b.count - a.count || a.hub.localeCompare(b.hub));
}

function renderMap(world, companies, layers, layerColor, layerName) {
  const host = $('map-vis');
  const W = world.width, H = world.height;
  const project = hq => ({
    x: ((hq.lon - world.lon0) / (world.lon1 - world.lon0)) * W,
    y: ((world.lat1 - hq.lat) / (world.lat1 - world.lat0)) * H
  });

  const placed = companies
    .filter(c => c.hq)
    .map(c => ({ ...c, hq: { ...c.hq, ...project(c.hq) } }));

  const clusters = clusterCompanies(placed);
  // Numbered down to the natural break rather than to a round ten: below three
  // companies there are a dozen clusters on the same count and the ordering
  // between them would be invented.
  const ranked = clusters.filter(g => g.count >= 3).length;

  // Cropped to the band the industry actually occupies. The outlines are
  // generated for the whole globe, so this is a viewBox rather than a second
  // dataset — and it buys about a fifth more scale, which the American east
  // coast needs badly.
  const cropX = lon => ((lon - world.lon0) / (world.lon1 - world.lon0)) * W;
  const cropY = lat => ((world.lat1 - lat) / (world.lat1 - world.lat0)) * H;
  const box = [cropX(-132), cropY(74), cropX(152) - cropX(-132), cropY(2) - cropY(74)];

  const chart = svg(W, H, box);
  chart.append(el('path', { d: world.land, class: 'map-land' }));
  const hosts = new Set(placed.map(c => c.hq.country));
  for (const [name, d] of Object.entries(world.countries)) {
    if (hosts.has(name)) chart.append(el('path', { d, class: 'map-country' }));
  }

  // Area, not radius, carries the count — a thirteen-company cluster next to a
  // one-company cluster would otherwise be thirteen times too loud.
  for (const g of clusters) g.r = 3.0 + Math.sqrt(g.count) * 3.9;

  // Boston, New York and Philadelphia are five pixels apart at this scale, so
  // the largest circle swallowed the two behind it and took their numbers with
  // it. Overlaps are pushed apart, largest held still, until every circle is
  // visible — which moves a few of them a degree or so off true, and the
  // footnote says as much.
  const anchored = clusters.map(g => ({ ...g }));
  // Displacement is capped: left to run, the pile on the American east coast
  // pushed New York into Kentucky. Twelve units is roughly three hundred
  // kilometres here, so a circle stays inside the region it belongs to and
  // some overlap survives, which is the better trade.
  const MAX_SHIFT = 12;
  for (let pass = 0; pass < 200; pass++) {
    let moved = false;
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        const p = clusters[a], q = clusters[b];
        const dx = q.x - p.x, dy = q.y - p.y;
        const gap = p.r + q.r + 1.4;
        let d = Math.hypot(dx, dy);
        if (d >= gap) continue;
        // Two head offices in the same city land on the same point; nudge on a
        // fixed diagonal rather than dividing by zero.
        const ux = d < 0.01 ? 0.7 : dx / d;
        const uy = d < 0.01 ? 0.7 : dy / d;
        const push = (gap - (d < 0.01 ? 0 : d)) / 2;
        // Each gives ground in inverse proportion to its size, so the hubs
        // stay put and the singletons move around them.
        const total = p.count + q.count;
        p.x -= ux * push * (q.count / total) * 2;
        p.y -= uy * push * (q.count / total) * 2;
        q.x += ux * push * (p.count / total) * 2;
        q.y += uy * push * (p.count / total) * 2;
        moved = true;
      }
    }
    clusters.forEach((g, i) => {
      const home = anchored[i];
      const dx = g.x - home.x, dy = g.y - home.y;
      const d = Math.hypot(dx, dy);
      if (d > MAX_SHIFT) {
        g.x = home.x + (dx / d) * MAX_SHIFT;
        g.y = home.y + (dy / d) * MAX_SHIFT;
      }
    });
    if (!moved) break;
  }

  // Drawn smallest first so the numbered hubs sit on top of whatever is left
  // touching them.
  [...clusters].reverse().forEach(g => {
    const i = clusters.indexOf(g);
    const r = g.r;
    const home = anchored[i];
    if (Math.hypot(g.x - home.x, g.y - home.y) > r * 0.5) {
      chart.append(el('line', {
        x1: home.x, y1: home.y, x2: g.x, y2: g.y, class: 'map-tether'
      }));
    }
    const color = inkable(layerColor[g.layer] || '#8b7ff0');
    const dot = el('circle', {
      cx: g.x, cy: g.y, r, fill: color, class: 'map-dot',
      'fill-opacity': isLight() ? 0.85 : 0.72
    });
    dot.append(el('title', {}, `${g.hub} — ${g.count} ${g.count === 1 ? 'company' : 'companies'}: ${g.members.map(m => m.name).join(', ')}`));
    chart.append(dot);
    if (i < ranked) {
      chart.append(el('text', { x: g.x, y: g.y + 3.6, 'text-anchor': 'middle', class: 'map-rank' }, String(i + 1)));
    }
  });

  // A share bar rather than a second ranking: the finding is the proportion of
  // one list held by one country, and that is a thing to see rather than read.
  const byCountry = {};
  for (const c of placed) byCountry[c.hq.country] = (byCountry[c.hq.country] || 0) + 1;
  const countries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]);
  const palette = ['#3b82f6', '#8b7ff0', '#10a37f', '#ea580c', '#d99a0b', '#ec4899',
                   '#0ea5e9', '#84cc16', '#f43f5e', '#a855f7', '#14b8a6', '#f59e0b', '#6366f1', '#e11d48'];
  const colorOf = i => inkable(palette[i % palette.length]);

  const bar = svg(W, 78);
  bar.append(el('text', { x: 0, y: 20, class: 'row-sub' }, `All ${placed.length} headquarters, by country`));

  let cx = 0;
  countries.forEach(([name, n], i) => {
    const w = (n / placed.length) * W;
    const seg = el('rect', { x: cx, y: 34, width: Math.max(1, w - 2), height: 44, rx: 2, fill: colorOf(i) });
    seg.append(el('title', {}, `${name} — ${n}`));
    bar.append(seg);
    // Ten of the fourteen countries hold one or two companies each, so their
    // segments are a few pixels wide. Stalk labels collided into an unreadable
    // stack; the key underneath carries them instead.
    const label = `${name} ${n}`;
    if (w > textWidth(label, 19) + 18) {
      bar.append(el('text', { x: cx + w / 2, y: 63, 'text-anchor': 'middle', class: 'col-seg-label' }, label));
    }
    cx += w;
  });

  fill(host, chart, bar);

  const key = document.createElement('div');
  key.className = 'legend country-key';
  host.append(key);
  legendInto(key, countries.map(([name, n], i) => [`${name} ${n}`, colorOf(i)]));

  // The ranked clusters get named in a list under the map rather than on it:
  // at this scale the New Jersey and Basel labels would sit on top of each
  // other, and the numbers in the circles do the pointing.
  const list = document.createElement('ol');
  list.className = 'hub-list';
  list.replaceChildren(...clusters.slice(0, ranked).map(g => {
    const li = document.createElement('li');
    li.style.setProperty('--layer', inkable(layerColor[g.layer] || '#8b7ff0'));
    const names = g.members.map(m => m.name);
    const shown = names.slice(0, 4).join(', ');
    li.innerHTML = `
      <div class="hub-place">${g.hub}<span class="hub-country">${g.country}</span></div>
      <div class="hub-count"><strong>${g.count}</strong> ${g.count === 1 ? 'company' : 'companies'} · mostly ${layerName[g.layer].toLowerCase()}</div>
      <div class="hub-names">${shown}${names.length > 4 ? ` <em>+${names.length - 4} more</em>` : ''}</div>`;
    return li;
  }));
  host.append(list);

  legendInto($('map-legend'), layers.map(l => [l.name, inkable(l.color)]));

  const topFive = clusters.slice(0, 5).reduce((n, g) => n + g.count, 0);
  const us = byCountry['United States'] || 0;
  $('map-stat').innerHTML =
    `<strong>${us}</strong> of the ${placed.length} are American — and <strong>${topFive}</strong> of the `
    + `whole list, ${Math.round((topFive / placed.length) * 100)}% of it, sit in five city-regions.`;
}

/* =========================================================
   theme

   The page is dark on its own. Framed in the dashboard, it follows that
   dashboard's day/night toggle: the initial choice arrives in the URL and is
   applied before first paint, and later changes arrive as a message so the
   frame restyles in place — reloading a long page to restyle it would cost the
   reader their position in it.
   ========================================================= */

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

window.addEventListener('message', event => {
  // The message can only pick one of two palettes, so its shape is the whole
  // check — anything else is ignored rather than acted on.
  const wanted = event.data && event.data.type === 'theme' ? event.data.theme : null;
  if (wanted !== 'light' && wanted !== 'dark') return;
  if (wanted === currentTheme()) return;
  document.documentElement.dataset.theme = wanted;
  redraw();
});

/* =========================================================
   nav underline follows the section under the reader
   ========================================================= */

function scrollspy() {
  const links = [...document.querySelectorAll('.nav a[href^="#"]')];
  const sections = links.map(a => $(a.getAttribute('href').slice(1))).filter(Boolean);
  if (!sections.length) return;

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      links.forEach(a => a.classList.toggle('current', a.getAttribute('href') === `#${entry.target.id}`));
    }
  }, { rootMargin: '-45% 0px -50% 0px' });

  sections.forEach(s => observer.observe(s));
}

/* =========================================================
   boot
   ========================================================= */

// Market value and the income statement come from Yahoo's quoteSummary
// endpoint, which answers 429 to GitHub's runners — so no scheduled job in
// this repository can write them into a file, and marketcaps.json holds
// nothing but rounded placeholder market values.
//
// Yahoo does answer Cloudflare, so the live figures come from a function on
// the site that links to this page, called from the browser and merged over
// the placeholders. When it cannot be reached the placeholders stand and
// renderValue puts a warning across the chart, because a treemap of
// provisional numbers looks exactly like a real one.
async function load(name) {
  const res = await fetch(`data/${name}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${name}: http ${res.status}`);
  return res.json();
}

// Live quotes, fetched cross-origin from the personal site's own endpoint.
//
// One invocation there is capped at Cloudflare's 50 subrequests, and each
// symbol costs one, so the list goes over in batches. A batch that fails is
// simply absent from the merge: those companies keep their placeholder.
const LIVE_ENDPOINT = 'https://personal-b8d.pages.dev/api/fundamentals';
const LIVE_BATCH = 36;

async function fetchLive(tickers) {
  const batches = [];
  for (let i = 0; i < tickers.length; i += LIVE_BATCH) {
    batches.push(tickers.slice(i, i + LIVE_BATCH));
  }

  const settled = await Promise.allSettled(batches.map(async batch => {
    const res = await fetch(`${LIVE_ENDPOINT}?symbols=${encodeURIComponent(batch.join(','))}`, {
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return res.json();
  }));

  const quotes = {};
  const fx = {};
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    Object.assign(quotes, outcome.value.quotes || {});
    Object.assign(fx, outcome.value.fx || {});
  }
  return { quotes, fx };
}

// Overwrites whole quotes rather than filling gaps in them: a placeholder
// market value next to a live margin would be a figure no source ever
// reported.
function mergeLive(caps, live) {
  const tickers = Object.keys(live.quotes);
  if (tickers.length === 0) return false;

  for (const ticker of tickers) caps.quotes[ticker] = live.quotes[ticker];
  caps.fx = live.fx;
  caps.generatedAt = new Date().toISOString();
  caps.missing = Object.keys(caps.quotes).filter(t => !live.quotes[t]);
  caps.source = tickers.length === Object.keys(caps.quotes).length
    ? 'Yahoo Finance, read when this page was opened'
    : `Yahoo Finance, read when this page was opened — ${caps.missing.length} still on placeholder values`;
  return true;
}

// Kept so a theme change can redraw without refetching: the fills are chosen
// per theme, so every chart has to be laid out again, but none of the data has.
let loaded = null;

function redraw() {
  if (!loaded) return;
  const { layers, companies, caps, layerColor, layerName, world,
          gauntlet, trials, chokepoints, geography, prices, exclusivity, pricing, jobs } = loaded;
  renderGauntlet(gauntlet, layerColor);
  renderTrials(trials);
  renderChokepoints(chokepoints, layerColor, layerName);
  renderGeography(geography);
  renderPrices(prices);
  renderExclusivity(exclusivity, layerColor);
  renderPricing(pricing, layerColor);
  renderEmployers(jobs, layerColor, layerName);
  renderJobGeography(jobs);
  renderRoles(jobs, layerColor);
  renderPay(jobs, layerColor, layerName);
  renderMap(world, companies, layers, layerColor, layerName);
  if (caps) {
    renderChain(layers, companies, caps);
    renderValue(layers, companies, caps);
  }
}

(async function main() {
  try {
    const [layersFile, companiesFile, gauntlet, trials, chokepoints, geography, prices, exclusivity, pricing, jobs, world] = await Promise.all(
      ['layers', 'companies', 'gauntlet', 'trials', 'chokepoints', 'geography', 'prices', 'exclusivity', 'pricing', 'jobs', 'world'].map(load)
    );

    const layers = layersFile.layers;
    const companies = companiesFile.companies;
    const layerColor = Object.fromEntries(layers.map(l => [l.id, l.color]));
    const layerName = Object.fromEntries(layers.map(l => [l.id, l.name]));

    loaded = { layers, companies, caps: null, layerColor, layerName, world,
               gauntlet, trials, chokepoints, geography, prices, exclusivity, pricing, jobs };

    // Twelve of the fourteen sections need no market data, so they are drawn before
    // the file is read at all.
    redraw();

    loaded.caps = await load('marketcaps');
    const caps = loaded.caps;
    renderChain(layers, companies, caps);
    renderValue(layers, companies, caps);

    // Drawn once from the file so the treemap is there immediately, then again
    // if the live read lands — which takes a few seconds for eighty-six
    // symbols and can fail outright.
    try {
      if (mergeLive(caps, await fetchLive(companies.map(c => c.ticker)))) {
        renderChain(layers, companies, caps);
        renderValue(layers, companies, caps);
      }
    } catch (err) {
      console.warn('live quotes unavailable', err);
    }

    const list = $('sources');
    list.replaceChildren(...[
      ...gauntlet.sources, ...trials.sources, ...chokepoints.sources, ...geography.sources, ...prices.sources,
      ...exclusivity.sources, ...pricing.sources, ...jobs.sources,
      'Headquarters locations are each company\'s registered head office, placed at the city it '
      + 'sits in. Country outlines are Natural Earth 1:110m (public domain), simplified by '
      + 'tools/build-world.py; this dataset carries the United Kingdom as Great Britain only.',
      'The national wage line is the US median hourly wage across all occupations in the OEWS '
      + 'May 2025 estimates, $24.51, at a 2,080-hour year.',
      'Market value, revenue and margins: Yahoo Finance, read live when the page is opened, by way '
      + 'of a function on parisaetemadi.dev that Yahoo will answer. Yahoo returns 429 to automated '
      + 'callers, so nothing here is written by a scheduled job; if that read fails the chart falls '
      + 'back to rounded placeholder market values and says so on the chart itself.'
    ].map(text => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }));

    scrollspy();
  } catch (err) {
    console.error(err);
    document.querySelectorAll('.loading').forEach(node => {
      node.textContent = `Could not load the data files (${err.message}). Serve this page over HTTP rather than opening the file directly.`;
    });
  }
})();
