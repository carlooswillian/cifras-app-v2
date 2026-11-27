// Desenha o mapa (graus + compassos) e a letra com acordes, como HTML.

import { esc } from './dom.js';
import { degreeLabel, harmonicField, chordDegree, chordLabel } from '../music/keys.js';
import { evLabel } from '../music/transition.js';
import { transposeKey, describeInterval } from '../music/notes.js';
import { shortSectionName, sectionKind } from '../music/parser.js';

const MAJOR_FIELD = { 1: 'maj', 2: 'min', 3: 'min', 4: 'maj', 5: 'maj', 6: 'min', 7: 'dim' };
const MINOR_FIELD = { '1,0': 'min', '2,0': 'dim', '3,-1': 'maj', '4,0': 'min', '5,0': 'min', '6,-1': 'maj', '7,-1': 'maj' };

/** Classe de cor do grau: g1..g7, ou gx para acordes de fora do campo. */
export function degClass(deg, key, minorMode) {
  const { num, acc } = deg.spec;
  const tonicMinor = key && key.minor && minorMode === 'tonic';
  const inField = tonicMinor
    ? MINOR_FIELD[`${num},${acc}`] === deg.triad || (num === 5 && acc === 0 && deg.triad === 'maj')
    : acc === 0 && MAJOR_FIELD[num] === deg.triad;
  return inField ? 'g' + num : 'gx';
}

function dots(beats) {
  const full = Math.floor(beats + 1e-9);
  const half = beats - full >= 0.49 ? 1 : 0;
  return '<i></i>'.repeat(Math.min(full, 16)) + (half ? '<i class="h"></i>' : '');
}

/** O mapa deve ser desenhado no modo compacto? */
export function isDense(st, { compact = false, density = null } = {}) {
  return (density || (compact ? st.medleyDensity : st.density)) === 'compact';
}

/** Índices válidos da forma escolhidos para o medley (null = todas as partes). */
export function validParts(chart, parts) {
  if (!Array.isArray(parts) || !parts.length) return null;
  const ok = parts.filter((i) => Number.isInteger(i) && i >= 0 && i < chart.form.length);
  return ok.length && ok.length < chart.form.length ? ok : null;
}

/**
 * Mapa da música.
 * - compact/density: modo compacto (linhas da mesma parte seguem juntas, sem o início da letra)
 * - parts: só algumas partes da forma (medley); partsEdit: chips da forma viram botões de escolha
 * @returns {string} HTML
 */
export function renderChart(chart, frame, st, { editing = false, compact = false, density = null, showField = st.showField, parts = null, partsEdit = false } = {}) {
  const dense = isDense(st, { compact, density });
  const cls = ['chart'];
  if (editing) cls.push('editing');
  if (dense) cls.push('dense');
  if (partsEdit) cls.push('parts-edit');
  if (st.primary === 'names') cls.push('names-first');
  if (!st.colorDegrees) cls.push('mono');
  if (!chart.blocks.length) {
    return `<div class="${cls.join(' ')}"><div class="nochords">Nenhum acorde encontrado nesta cifra.<br>Confira se os acordes estão em linhas separadas, acima da letra.</div></div>`;
  }
  const shapesKey = transposeKey(chart.key, frame.offset) || chart.key;
  const incl = validParts(chart, parts);
  const inclSet = incl ? new Set(incl) : null;
  const shownBlocks = inclSet ? new Set(chart.form.filter((f, i) => inclSet.has(i)).map((f) => f.blockId)) : null;
  const out = [];

  // topo: campo harmônico + forma
  const top = [];
  if (showField) {
    const field = harmonicField(shapesKey, { style: st.degreeStyle, minorMode: st.minorMode });
    top.push(`<div class="fieldstrip" title="Campo harmônico de ${esc(shapesKey.name)}">${field.map((f, i) => `<span class="${f.tonic ? 'tonic' : ''} ${st.colorDegrees ? 'g' + (i + 1) : ''}"><b style="color:var(--dc)">${esc(f.degree)}</b><i>${esc(f.chord)}</i></span>`).join('')}</div>`);
  }
  // fora do modo de escolha, partes que não entram no medley nem aparecem
  const chips = chart.form.map((f, i) => ({ f, i })).filter(({ i }) => partsEdit || !inclSet || inclSet.has(i));
  top.push(`<div class="formstrip">${chips.map(({ f, i }, k) => {
    const mod = f.modulation ? ` <span title="mudança de tom">↑${esc(transposeKey(f.key, frame.offset).name)}</span>` : '';
    const off = inclSet && !inclSet.has(i) ? ' off' : '';
    const tag = partsEdit ? 'button' : 'span';
    const vr = f.variant ? '<span class="vr" title="Desta vez tem pequenas diferenças (veja na Letra)">≈</span>' : '';
    return `${k ? '<span class="arr">›</span>' : ''}<${tag} class="fc k-${f.kind}${off}" data-fi="${i}">${partsEdit ? `<span class="ck">${off ? '' : '✓'}</span>` : ''}${esc(f.short)}${vr}${f.repeat > 1 ? `<sup>×${f.repeat}</sup>` : ''}${mod}</${tag}>`;
  }).join('')}</div>`);
  out.push(`<div class="chart-top">${top.join('')}</div>`);

  // blocos
  const blocks = chart.blocks.filter((b) => !shownBlocks || shownBlocks.has(b.id)).map((b) => {
    const kind = b.kind || sectionKind(b.names[0]);
    const bKey = transposeKey(b.key, frame.offset) || b.key;
    const keyBadge = b.key.name !== chart.key.name
      ? `<span class="kb">Tom ${esc(bKey.name)} (${describeInterval((b.key.minor ? b.key.tonic.pc + 3 : b.key.tonic.pc) - (chart.key.minor ? chart.key.tonic.pc + 3 : chart.key.tonic.pc))})</span>`
      : '';
    const groups = b.groups.map((g, gi) => {
      const rows = g.rows.map((r, ri) => renderRow(b, r, gi, ri, frame, st, chart.beatsPerBar, g.repeat > 1 && ri === g.rows.length - 1 ? g.repeat : 0, dense)).join('');
      return g.repeat > 1 ? `<div class="group rep" title="Repetir este trecho ${g.repeat} vezes">${rows}</div>` : `<div class="group">${rows}</div>`;
    }).join('');
    return `<section class="block k-${kind}" data-block="${b.id}"><header>${esc(b.names.join(' · '))}${keyBadge}</header>${groups}</section>`;
  }).join('');
  out.push(`<div class="blocks">${blocks}</div>`);
  return `<div class="${cls.join(' ')}${compact ? ' compact' : ''}">${out.join('')}</div>`;
}

function renderRow(block, row, gi, ri, frame, st, bpb, groupRepeat = 0, dense = false) {
  // no modo compacto as linhas seguem uma ao lado da outra, sem o início da letra
  const cue = dense
    ? (row.label ? `<span class="cue lbl">${esc(row.label)}</span>` : '')
    : (st.showCues && row.cue ? `<div class="cue">${esc(row.cue)}</div>` : (row.label ? `<div class="cue lbl">${esc(row.label)}</div>` : ''));
  const bars = row.bars.map((bar, bi) => {
    const frac = bar.partial ? Math.max(0.25, bar.beats / bpb) : 1;
    const items = bar.items.map((it, ii) => {
      const ev = it.ev;
      const dc = degClass(ev.deg, block.key, st.minorMode);
      const pos = `${block.id}.${gi}.${ri}.${bi}.${ii}`;
      if (it.cont) {
        return `<div class="it cont ${dc}" style="--b:${it.beats}" data-pos="${pos}" data-ev="${ev.id}"><span class="dg">—</span><span class="cn">&nbsp;</span><span class="bt">${dots(it.beats)}</span></div>`;
      }
      const deg = degreeLabel(ev.deg, { style: st.degreeStyle, showBass: st.showBass });
      const name = evLabel(ev, block.key, frame, st);
      return `<div class="it ${dc}${ev.explicit ? ' explicit' : ''}" style="--b:${it.beats}" data-pos="${pos}" data-ev="${ev.id}"><span class="dg">${esc(deg)}</span><span class="cn">${esc(name)}</span><span class="bt">${dots(it.beats)}</span></div>`;
    }).join('');
    const last = bi === row.bars.length - 1;
    return `<div class="bar${last ? ' last' : ''}${bar.partial ? ' partial' : ''}" style="--frac:${frac}">${items}</div>`;
  }).join('');
  const rpt = (row.repeat > 1 ? `<span class="rpt">×${row.repeat}</span>` : '') + (groupRepeat ? `<span class="rpt grp" title="repete o trecho todo">:‖ ×${groupRepeat}</span>` : '');
  return `<div class="row">${cue}<div class="line">${bars}${rpt}</div></div>`;
}

/** Largura mínima (em "em") de uma coluna do mapa para não quebrar linhas de até 4 compassos. */
export function chartMinColEm(chart, dense = false) {
  let maxBars = 1;
  let hasRpt = false;
  for (const b of chart.blocks) {
    for (const g of b.groups) {
      if (g.repeat > 1) hasRpt = true;
      for (const r of g.rows) {
        const bars = r.bars.reduce((a, bar) => a + (bar.partial ? Math.max(0.25, bar.beats / chart.beatsPerBar) : 1), 0);
        maxBars = Math.max(maxBars, Math.min(4, bars));
        if (r.repeat > 1) hasRpt = true;
      }
    }
  }
  return maxBars * (dense ? 3 : 3.8) + 1.3 + (hasRpt ? 2.2 : 0);
}

/** Índice de eventos por id (para editar tempos ao tocar no acorde). */
export function eventIndex(chart) {
  const map = new Map();
  for (const b of chart.blocks) for (const g of b.groups) for (const r of g.rows) for (const ev of r.events) map.set(String(ev.id), { ev, block: b });
  // eventos de continuação aparecem nas barras mas pertencem ao mesmo evento
  for (const b of chart.blocks) for (const g of b.groups) for (const r of g.rows) for (const bar of r.bars) for (const it of bar.items) if (!map.has(String(it.ev.id))) map.set(String(it.ev.id), { ev: it.ev, block: b });
  return map;
}

// ---------------------------------------------------------------------------
// Letra + acordes

function segments(lyric, toks) {
  const chords = toks.filter((t) => t.kind === 'chord').sort((a, b) => a.col - b.col);
  if (!chords.length) return [{ tok: null, text: lyric }];
  // acordes depois do fim da letra mantêm a distância entre si
  lyric = lyric.padEnd(chords[chords.length - 1].col, ' ');
  const segs = [];
  if (chords[0].col > 0) segs.push({ tok: null, text: lyric.slice(0, chords[0].col) });
  chords.forEach((t, i) => {
    const end = i + 1 < chords.length ? chords[i + 1].col : Math.max(lyric.length, t.col);
    segs.push({ tok: t, text: lyric.slice(t.col, end) });
  });
  return segs;
}

export function renderLyrics(chart, frame, st, { parts = null } = {}) {
  const parsed = chart.parsed;
  const incl = validParts(chart, parts);
  const inclSet = incl ? new Set(incl) : null;
  const mode = st.lyricChords || 'both';
  const cls = ['lyrics'];
  if (mode === 'degrees') cls.push('deg-only');
  if (!st.colorDegrees) cls.push('mono');
  const chordHtml = (tok, key) => {
    const deg = chordDegree(tok.chord, key, st.minorMode);
    const toKey = transposeKey(key, frame.offset) || key;
    const name = chordLabel({ chord: tok.chord, deg, toKey, transposed: frame.transposed, chordStyle: st.chordStyle, showBass: st.showBass, minorMode: st.minorMode });
    const dl = degreeLabel(deg, { style: st.degreeStyle, showBass: st.showBass });
    const dc = degClass(deg, key, st.minorMode);
    const sub = mode === 'names' ? '' : `<sub class="${dc}">${esc(dl)}</sub>`;
    return `<span class="nm">${esc(name)}</span>${sub}`;
  };
  const html = parsed.sections.map((s, si) => {
    if (s.kind === 'tab' && !st.showTabs) return '';
    if (inclSet && !(chart.sections[si] && inclSet.has(chart.sections[si].formIdx))) return '';
    const key = (chart.sections[si] && chart.sections[si].key) || chart.key;
    const lines = s.lines.map((ln) => {
      switch (ln.kind) {
        case 'pair': {
          const segs = segments(ln.lyric, ln.chords.tokens);
          return `<div class="lline">${segs.map((sg) => `<span class="seg"><span class="ch">${sg.tok ? chordHtml(sg.tok, key) : ''}</span><span class="ly">${sg.text ? esc(sg.text) : '&nbsp;'}</span></span>`).join('')}</div>`;
        }
        case 'chords': {
          const chips = ln.chords.tokens.filter((t) => t.kind === 'chord').map((t) => `<span class="ich">${chordHtml(t, key)}</span>`).join('');
          const rp = ln.repeat > 1 ? `<span class="cmt">×${ln.repeat}</span>` : '';
          const lbl = ln.chords.label ? `<span class="cmt">${esc(ln.chords.label)}:</span>` : '';
          return `<div class="lline inst">${lbl}${chips}${rp}</div>`;
        }
        case 'lyric': return `<div class="lline lyr">${esc(ln.lyric)}</div>`;
        case 'comment': return `<div class="lline cmt">(${esc(ln.text)})</div>`;
        case 'repeat': return `<div class="lline cmt">×${ln.n}</div>`;
        case 'tab': return `<pre class="tabtxt">${esc(ln.text)}</pre>`;
        default: return '';
      }
    }).join('');
    if (!lines.trim()) return '';
    const rp = s.repeat > 1 ? `<span class="rp">×${s.repeat}</span>` : '';
    const kb = s.keyChange ? `<span class="rp">Tom ${esc(transposeKey(key, frame.offset).name)}</span>` : '';
    return `<section class="lsec k-${s.kind}"><h3>${esc(s.name)}${rp}${kb}</h3>${lines}</section>`;
  }).join('');
  return `<div class="${cls.join(' ')}">${html || '<div class="nochords">Sem letra.</div>'}</div>`;
}

export { shortSectionName };
