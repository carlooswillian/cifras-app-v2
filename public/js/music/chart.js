// Mapa da música: seções -> linhas -> compassos -> acordes (com tempos),
// blocos únicos (seções iguais aparecem uma vez) e a forma (ordem das seções).

import { parseCifra, normName, shortSectionName, sectionKind } from './parser.js';
import { detectKey, chordDegree, fieldFit } from './keys.js';
import { parseKey, keyFromPc, mod12 } from './notes.js';

/** Tempos por compasso a partir da fórmula: 4/4 -> 4, 3/4 -> 3, 6/8 -> 2, 12/8 -> 4. */
export function beatsPerBarOf(timeSig) {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(timeSig || '').trim());
  if (!m) return 4;
  const num = Number(m[1]), den = Number(m[2]);
  if (den === 8 && num % 3 === 0 && num >= 6) return num / 3;
  return Math.max(1, Math.min(12, num));
}

let evSeq = 0;
function mkEvent(tok, beats, explicit, lineNo) {
  return {
    id: ++evSeq,
    chord: tok.chord,
    beats,
    explicit,
    srcs: [{ lineNo, col: tok.col, len: tok.len }],
  };
}

function addSrcs(ev, srcs) {
  for (const s of srcs) if (!ev.srcs.some((x) => x.lineNo === s.lineNo && x.col === s.col)) ev.srcs.push(s);
}

function distribute(total, n) {
  if (n <= 0) return [];
  if (total <= 0) return Array(n).fill(1);
  const base = Math.floor(total / n);
  if (base === 0) return Array(n).fill(total / n);
  const out = Array(n).fill(base);
  let rem = total - base * n;
  for (let i = 0; rem > 0; i++, rem--) out[i % n]++;
  return out;
}

/** Eventos (acorde + duração em tempos) de uma linha de acordes. */
export function lineEvents(cl, bpb, lineNo) {
  const evs = [];
  if (!cl.hasBars) {
    for (const t of cl.tokens) if (t.kind === 'chord') evs.push(mkEvent(t, t.beats ?? bpb, t.beats != null, lineNo));
    return evs;
  }
  const segs = [];
  let cur = [];
  for (const t of cl.tokens) {
    if (t.kind === 'bar') { segs.push(cur); cur = []; } else if (t.kind !== 'ignore') cur.push(t);
  }
  segs.push(cur);
  while (segs.length && !segs[0].length) segs.shift();
  while (segs.length && !segs[segs.length - 1].length) segs.pop();
  let prevBar = null;
  for (const seg of segs) {
    const chords = seg.filter((t) => t.kind === 'chord');
    const marks = seg.filter((t) => t.kind === 'dot' || t.kind === 'slash').length;
    if (!chords.length) {
      if (seg.some((t) => t.kind === 'same') && prevBar) {
        const copies = prevBar.map((e) => ({ ...e, id: ++evSeq, srcs: [...e.srcs] }));
        evs.push(...copies);
        continue;
      }
      const last = evs[evs.length - 1];
      if (last) last.beats += marks || bpb;
      continue;
    }
    const barEvs = [];
    if (marks) {
      for (const t of seg) {
        if (t.kind === 'chord') barEvs.push(mkEvent(t, t.beats ?? 1, t.beats != null, lineNo));
        else if ((t.kind === 'dot' || t.kind === 'slash') && barEvs.length && !barEvs[barEvs.length - 1].explicit) barEvs[barEvs.length - 1].beats += 1;
      }
    } else {
      const explicitSum = chords.reduce((a, t) => a + (t.beats ?? 0), 0);
      const shares = distribute(Math.max(0, bpb - explicitSum), chords.filter((t) => t.beats == null).length);
      let k = 0;
      for (const t of chords) barEvs.push(mkEvent(t, t.beats ?? shares[k++], t.beats != null, lineNo));
    }
    evs.push(...barEvs);
    prevBar = barEvs;
  }
  return evs;
}

/** Distribui eventos em compassos. Acordes longos atravessam compassos (cont = continuação). */
export function layoutBars(events, bpb) {
  const bars = [];
  let cur = { items: [], beats: 0 };
  for (const ev of events) {
    let remaining = ev.beats;
    let first = true;
    while (remaining > 1e-9) {
      const take = Math.min(bpb - cur.beats, remaining);
      cur.items.push({ ev, beats: take, cont: !first });
      cur.beats += take;
      remaining -= take;
      first = false;
      if (cur.beats >= bpb - 1e-9) { bars.push(cur); cur = { items: [], beats: 0 }; }
    }
  }
  if (cur.items.length) { cur.partial = true; bars.push(cur); }
  return bars;
}

function cueOf(ln) {
  if (ln.kind === 'pair') {
    const txt = ln.lyric.replace(/\s*\(?\s*(?:\d{1,2}\s*[xX×]|[xX×]\s*\d{1,2}|bis)\s*\)?\s*$/i, '').trim();
    const words = txt.split(/\s+/).filter(Boolean);
    return words.slice(0, 5).join(' ') + (words.length > 5 ? '…' : '');
  }
  return ln.chords && ln.chords.label ? ln.chords.label : '';
}

/** Procura repetições consecutivas numa lista de assinaturas (guloso, maior cobertura). */
export function segmentRepeats(sigs) {
  const out = [];
  const n = sigs.length;
  let i = 0;
  const same = (a, b, len) => { for (let k = 0; k < len; k++) if (sigs[a + k] !== sigs[b + k]) return false; return true; };
  while (i < n) {
    let best = { len: 1, count: 1 };
    for (let len = 1; len <= Math.floor((n - i) / 2); len++) {
      let count = 1;
      while (i + (count + 1) * len <= n && same(i, i + count * len, len)) count++;
      const cov = len * count, bestCov = best.len * best.count;
      if (count > 1 && (cov > bestCov || (cov === bestCov && len < best.len))) best = { len, count };
    }
    out.push({ start: i, len: best.len, count: best.count });
    i += best.len * best.count;
  }
  return out;
}

function evSig(ev, showBass) {
  const d = ev.deg;
  let s = `${d.spec.num}${d.spec.acc}${d.triad}`;
  if (showBass && d.bassSpec) s += `/${d.bassSpec.num}${d.bassSpec.acc}`;
  return s;
}

function rowSig(row, showBass) {
  return row.bars.map((b) => (b.partial ? 'p' : '') + b.items.map((it) => (it.cont ? '~' : '') + evSig(it.ev, showBass) + '@' + it.beats).join(',')).join('|') + 'x' + row.repeat;
}

function mergeRowSrcs(target, other) {
  for (let k = 0; k < target.events.length && k < other.events.length; k++) addSrcs(target.events[k], other.events[k].srcs);
}

/** Linha com padrão interno repetido (8 compassos = 2 compassos × 4) vira padrão + repetição. */
function compressRowInside(row, bpb, showBass) {
  if (row.events.length < 2) return;
  const sigs = row.events.map((e) => evSig(e, showBass) + '@' + e.beats);
  const seg = segmentRepeats(sigs);
  if (seg.length !== 1 || seg[0].count < 2) return;
  const len = seg[0].len;
  const patBeats = row.events.slice(0, len).reduce((a, e) => a + e.beats, 0);
  if (Math.abs(patBeats / bpb - Math.round(patBeats / bpb)) > 1e-9) return;
  const pattern = row.events.slice(0, len);
  for (let c = 1; c < seg[0].count; c++) {
    for (let k = 0; k < len; k++) addSrcs(pattern[k], row.events[c * len + k].srcs);
  }
  row.events = pattern;
  row.repeat *= seg[0].count;
  row.bars = layoutBars(pattern, bpb);
}

/** Agrupa linhas de uma seção em grupos com repetição. */
function groupRows(rows, paraRepeat, showBass) {
  const groups = [];
  let open = [];
  const flushOpen = () => {
    if (!open.length) return;
    const sigs = open.map((r) => rowSig(r, showBass));
    for (const seg of segmentRepeats(sigs)) {
      const base = open.slice(seg.start, seg.start + seg.len);
      for (let c = 1; c < seg.count; c++) {
        for (let k = 0; k < seg.len; k++) mergeRowSrcs(base[k], open[seg.start + c * seg.len + k]);
      }
      if (seg.count > 1 && seg.len === 1) {
        base[0].repeat *= seg.count;
        pushSingles(base);
      } else if (seg.count > 1) {
        groups.push({ rows: base, repeat: seg.count });
      } else {
        pushSingles(base);
      }
    }
    open = [];
  };
  const pushSingles = (rs) => {
    const last = groups[groups.length - 1];
    if (last && last.repeat === 1 && !last.explicit) last.rows.push(...rs);
    else groups.push({ rows: [...rs], repeat: 1 });
  };

  let i = 0;
  while (i < rows.length) {
    const para = rows[i].para;
    let j = i;
    while (j < rows.length && rows[j].para === para) j++;
    const paraRows = rows.slice(i, j);
    const rep = paraRepeat.get(para) || 1;
    if (rep > 1) {
      flushOpen();
      // dentro do parágrafo também junta linhas iguais seguidas
      const inner = [];
      for (const r of paraRows) {
        const prev = inner[inner.length - 1];
        if (prev && rowSig(prev, showBass) === rowSig(r, showBass)) { mergeRowSrcs(prev, r); prev.repeat += r.repeat; } else inner.push(r);
      }
      if (inner.length === 1) { inner[0].repeat *= rep; pushSingles(inner); } else groups.push({ rows: inner, repeat: rep, explicit: true });
    } else {
      open.push(...paraRows);
    }
    i = j;
  }
  flushOpen();
  return groups;
}

function groupsSig(groups, showBass) {
  return groups.map((g) => g.rows.map((r) => rowSig(r, showBass)).join(';') + 'x' + g.repeat).join('/');
}

function mergeGroupsSrcs(target, other) {
  for (let g = 0; g < target.length && g < other.length; g++) {
    for (let r = 0; r < target[g].rows.length && r < other[g].rows.length; r++) mergeRowSrcs(target[g].rows[r], other[g].rows[r]);
  }
}

function sameShape(a, b) {
  return a.length === b.length && a.every((ev, i) => ev.chord.triad === b[i].chord.triad && ev.beats === b[i].beats);
}

/**
 * Monta o mapa da música.
 * @param {string|ReturnType<typeof parseCifra>} source  texto da cifra (ou já lido)
 * @param {object} opts
 * @param {string} [opts.timeSig]   '4/4'
 * @param {string} [opts.key]       tom dos acordes escritos (vazio = automático)
 * @param {number} [opts.capo]
 * @param {'relative'|'tonic'} [opts.minorMode]
 * @param {boolean} [opts.showBass]
 */
export function buildChart(source, opts = {}) {
  const parsed = typeof source === 'string' ? parseCifra(source) : source;
  const showBass = !!opts.showBass;
  const minorMode = opts.minorMode || 'relative';
  const bpb = beatsPerBarOf(opts.timeSig || parsed.meta.timeSig || '4/4');

  // 1) linhas -> eventos
  const secs = parsed.sections.map((s, idx) => {
    const rows = [];
    const paraRepeat = new Map();
    let para = 0;
    if (s.kind !== 'tab') {
      for (const ln of s.lines) {
        if (ln.kind === 'blank') { if (rows.length && rows[rows.length - 1].para === para) para++; continue; }
        if (ln.kind === 'repeat') { if (rows.length) paraRepeat.set(rows[rows.length - 1].para, ln.n); continue; }
        if (ln.kind !== 'pair' && ln.kind !== 'chords') continue;
        const events = lineEvents(ln.chords, bpb, ln.lineNo);
        if (!events.length) continue;
        rows.push({ events, repeat: ln.repeat || 1, cue: cueOf(ln), para, lineNo: ln.lineNo, label: ln.chords.label || '' });
      }
      // "(2x)" na última linha de um parágrafo com 2+ linhas = repete o parágrafo
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const isLastOfPara = r === rows.length - 1 || rows[r + 1].para !== row.para;
        const paraSize = rows.filter((x) => x.para === row.para).length;
        if (row.repeat > 1 && isLastOfPara && paraSize >= 2 && !paraRepeat.has(row.para)) {
          paraRepeat.set(row.para, row.repeat);
          row.repeat = 1;
        }
      }
    }
    const events = rows.flatMap((r) => Array.from({ length: Math.min(r.repeat, 4) }, () => r.events).flat());
    return { idx, section: s, name: s.name, rows, paraRepeat, events, repeat: s.repeat || 1, kind: s.kind };
  });

  // 2) tom geral
  const items = [];
  for (const s of secs) {
    for (const r of s.rows) {
      for (const ev of r.events) items.push({ root: ev.chord.root.pc, triad: ev.chord.triad, weight: Math.min(ev.beats / bpb, 2) * Math.min(r.repeat, 4) * Math.min(s.repeat, 4) });
    }
  }
  const capo = Number(opts.capo ?? parsed.meta.capo) || 0;
  let keyInfo;
  const forced = opts.key ? parseKey(opts.key) : null;
  if (forced) keyInfo = { key: forced, confidence: items.length ? fieldFit(items, forced.minor ? forced.tonic.pc + 3 : forced.tonic.pc) : 0, source: 'user' };
  else keyInfo = detectKey(items, { keyHint: parsed.meta.keyHint, writtenKeyHint: parsed.meta.writtenKeyHint, capo });
  const globalKey = keyInfo.key;

  // 3) tom de cada seção (modulação explícita "Tom: A" ou refrão repetido mais alto)
  const fieldPc = (k) => (k.minor ? k.tonic.pc + 3 : k.tonic.pc);
  const itemsOf = (s) => s.rows.flatMap((r) => r.events.map((ev) => ({ root: ev.chord.root.pc, triad: ev.chord.triad, weight: Math.min(ev.beats / bpb, 2) })));
  let running = globalKey;
  for (const s of secs) {
    s.key = running;
    s.modulation = 0;
    if (!s.events.length) continue;
    const explicit = s.section.keyChange ? parseKey(s.section.keyChange) : null;
    if (explicit) {
      s.modulation = mod12(fieldPc(explicit) - fieldPc(running));
      running = explicit; s.key = explicit;
      continue;
    }
    let found = false;
    const myItems = itemsOf(s);
    const fitRunning = fieldFit(myItems, fieldPc(running));
    for (const p of secs) {
      if (p === s) break;
      if (!p.events.length || p.events.length < 3) continue;
      const a = p.events, b = s.events;
      const n = Math.min(a.length, b.length);
      if (n < 3 || n < 0.8 * Math.max(a.length, b.length)) continue;
      const k = mod12(b[0].chord.root.pc - a[0].chord.root.pc);
      if (k === 0) continue;
      let ok = true;
      for (let i = 0; i < n && ok; i++) ok = b[i].chord.triad === a[i].chord.triad && mod12(b[i].chord.root.pc - a[i].chord.root.pc) === k;
      if (!ok) continue;
      const sameName = normName(p.name) === normName(s.name);
      if (!sameName && fitRunning >= 0.8) continue;
      const newKey = keyFromPc(p.key.tonic.pc + k, p.key.minor);
      s.modulation = mod12(fieldPc(newKey) - fieldPc(running));
      running = newKey; s.key = newKey; found = true;
      break;
    }
    if (!found && running !== globalKey) {
      const fitGlobal = fieldFit(myItems, fieldPc(globalKey));
      if (fitGlobal > fitRunning + 0.05) { running = globalKey; s.key = globalKey; s.modulation = 0; }
    }
  }

  // 4) graus, compassos e grupos
  for (const s of secs) {
    for (const r of s.rows) {
      for (const ev of r.events) ev.deg = chordDegree(ev.chord, s.key, minorMode);
      r.bars = layoutBars(r.events, bpb);
    }
    // linhas muito longas são quebradas de 4 em 4 compassos
    const split = [];
    for (const r of s.rows) {
      compressRowInside(r, bpb, showBass);
      if (r.bars.length > 8) {
        let evIdx = 0;
        for (let b = 0; b < r.bars.length; b += 4) {
          const chunkBars = r.bars.slice(b, b + 4);
          const evs = [];
          for (const bar of chunkBars) for (const it of bar.items) if (!it.cont && !evs.includes(it.ev)) evs.push(it.ev);
          split.push({ ...r, events: evs.length ? evs : r.events.slice(evIdx, evIdx + 1), bars: chunkBars, cue: b === 0 ? r.cue : '', repeat: 1, chunk: true });
          evIdx += evs.length;
        }
        if (r.repeat > 1) split[split.length - 1].repeat = r.repeat;
      } else split.push(r);
    }
    s.rows = split;
    s.groups = groupRows(s.rows, s.paraRepeat, showBass);
  }

  // 5) blocos únicos e forma
  const blocks = [];
  const bySig = new Map();
  const form = [];
  for (const s of secs) {
    let block = null;
    if (s.events.length) {
      const sig = s.key.name + '|' + groupsSig(s.groups, showBass);
      block = bySig.get(sig);
      if (!block) {
        block = { id: blocks.length, names: [s.name], key: s.key, groups: s.groups, kind: s.kind, modulation: s.modulation, sectionIdx: [s.idx] };
        blocks.push(block);
        bySig.set(sig, block);
      } else {
        if (!block.names.includes(s.name)) block.names.push(s.name);
        block.sectionIdx.push(s.idx);
        mergeGroupsSrcs(block.groups, s.groups);
      }
    } else if (s.kind !== 'tab') {
      // seção sem acordes com nome de uma anterior (ex.: refrão repetido só com letra)
      const prev = secs.find((p) => p !== s && p.idx < s.idx && p.blockId != null && normName(p.name) === normName(s.name));
      if (prev) block = blocks[prev.blockId];
    }
    if (!block) continue;
    s.blockId = block.id;
    const last = form[form.length - 1];
    if (last && last.blockId === block.id && last.name === s.name) last.repeat += s.repeat;
    else form.push({ blockId: block.id, name: s.name, short: shortSectionName(s.name), kind: s.kind || sectionKind(s.name), repeat: s.repeat, key: s.key, modulation: s.modulation });
    s.formIdx = form.length - 1;
  }

  // primeiro e último acorde tocados (para viradas de medley)
  const { first, last } = edges(blocks, form);

  return {
    parsed,
    meta: parsed.meta,
    beatsPerBar: bpb,
    key: globalKey,
    keyInfo,
    capo,
    blocks,
    form,
    sections: secs.map((s) => ({ name: s.name, key: s.key, blockId: s.blockId ?? null, formIdx: s.formIdx ?? null, kind: s.kind, modulation: s.modulation })),
    first,
    last,
    totalBars: blocks.reduce((a, b) => a + b.groups.reduce((x, g) => x + g.rows.reduce((y, r) => y + r.bars.length, 0), 0), 0),
  };
}

/** Primeiro e último acorde de uma sequência de partes da forma. */
function edges(blocks, form) {
  if (!form.length) return { first: null, last: null };
  const fb = blocks[form[0].blockId];
  const lb = blocks[form[form.length - 1].blockId];
  const firstEv = fb.groups[0].rows[0].events[0];
  const lg = lb.groups[lb.groups.length - 1];
  const lr = lg.rows[lg.rows.length - 1];
  const lastEv = lr.events[lr.events.length - 1];
  return { first: firstEv ? { ev: firstEv, key: fb.key } : null, last: lastEv ? { ev: lastEv, key: lb.key } : null };
}

/**
 * Primeiro e último acorde considerando só as partes escolhidas no medley.
 * @param {object} chart
 * @param {number[]|null} parts  índices da forma (null = música inteira)
 */
export function partsEdges(chart, parts) {
  const ok = Array.isArray(parts) ? parts.filter((i) => Number.isInteger(i) && i >= 0 && i < chart.form.length) : [];
  if (!ok.length) return { first: chart.first, last: chart.last };
  const set = new Set(ok);
  return edges(chart.blocks, chart.form.filter((f, i) => set.has(i)));
}

/** Sequência completa (para tocar junto): forma -> grupos -> linhas -> compassos. */
export function timeline(chart, maxRepeat = 8) {
  const steps = [];
  chart.form.forEach((f, fi) => {
    const block = chart.blocks[f.blockId];
    for (let fr = 0; fr < Math.min(f.repeat, maxRepeat); fr++) {
      block.groups.forEach((g, gi) => {
        for (let gr = 0; gr < Math.min(g.repeat, maxRepeat); gr++) {
          g.rows.forEach((r, ri) => {
            for (let rr = 0; rr < Math.min(r.repeat, maxRepeat); rr++) {
              r.bars.forEach((bar, bi) => {
                bar.items.forEach((it, ii) => steps.push({ fi, blockId: f.blockId, gi, ri, bi, ii, beats: it.beats, item: it }));
              });
            }
          });
        }
      });
    }
  });
  return steps;
}

export { sameShape };
