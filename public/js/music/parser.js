// Leitura do texto da cifra (formato Cifra Club: acordes em cima da letra,
// seções entre colchetes) + suporte básico a ChordPro ([G]letra, {title: ...}).

import { parseChord, normalizeChordText } from './chords.js';

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060\u00AD]/g;

/** Limpa o texto colado: quebras de linha, tabs, espaços invisíveis. */
export function normalizeText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(ZERO_WIDTH, '')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/\t/g, '    ')
    .replace(/[ ]+$/gm, '');
}

const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const normName = (s) => stripAccents(String(s).toLowerCase()).replace(/[^a-z0-9ªº ]+/g, ' ').replace(/\s+/g, ' ').trim();

const SECTION_WORDS = [
  'intro', 'introducao', 'inicio', 'primeira parte', 'segunda parte', 'terceira parte', 'quarta parte', 'quinta parte',
  'parte', 'verso', 'estrofe', 'pre refrao', 'prerefrao', 'prerrefrao', 'pre', 'pre coro', 'refrao', 'coro', 'ponte',
  'bridge', 'solo', 'interludio', 'instrumental', 'final', 'fim', 'outro', 'chorus', 'verse', 'pre chorus', 'riff',
  'base', 'dedilhado', 'ministracao', 'vamp', 'tag', 'coda', 'passagem', 'virada', 'encerramento', 'tab', 'mantra',
];

/**
 * O texto é um nome de seção conhecido? (Refrão, Primeira Parte, Intro 2, Refrão final...)
 * Sem colchetes, exige o nome exato (mais um número/letra/"final"), para não confundir
 * com letra que começa com "Ponte...", "Final...", "Solo...".
 */
export function isSectionName(s) {
  const n0 = normName(s);
  if (/^parte \d+ de \d+$/.test(n0)) return false; // divisão de tablatura do Cifra Club
  const n = n0
    .replace(/^(\d+)\s*(ª|º|a|o)?\s+/, '')
    .replace(/\s+(final|inicial|\d+|[ivx]+|[ab]|\d+\s*(ª|º))$/i, '')
    .trim();
  if (!n) return false;
  if (SECTION_WORDS.includes(n)) return true;
  if (/^tab\b/.test(n)) return true;
  return /^parte \d{1,2}$|^parte [a-d]$/.test(n);
}

/** Nome curto para os chips da forma. */
export function shortSectionName(name) {
  const n = normName(name);
  const num = (/(\d+)\s*$/.exec(n) || [])[1] || '';
  const rules = [
    [/^primeira parte/, '1ª Parte'], [/^segunda parte/, '2ª Parte'], [/^terceira parte/, '3ª Parte'],
    [/^quarta parte/, '4ª Parte'], [/^quinta parte/, '5ª Parte'],
    [/^(pre refrao|prerefrao|prerrefrao|pre coro|pre chorus|pre)\b/, 'Pré'], [/^(refrao|coro|chorus)/, 'Refrão'],
    [/^(introducao|intro)/, 'Intro'], [/^interludio/, 'Inter'], [/^instrumental/, 'Instr.'],
    [/^ponte|^bridge/, 'Ponte'], [/^solo/, 'Solo'], [/^(final|fim|outro|encerramento|coda)/, 'Final'],
    [/^(verso|verse|estrofe)/, 'Verso'],
  ];
  for (const [re, label] of rules) {
    // "Refrão Final" continua dizendo que é o final
    if (re.test(n)) return label + (num && !/ª/.test(label) ? ' ' + num : '') + (/\sfinal$/.test(n) && label !== 'Final' ? ' final' : '');
  }
  return name.length > 12 ? name.slice(0, 11) + '…' : name;
}

/** Tipo de seção (para cores e ícones). */
export function sectionKind(name) {
  const n = normName(name);
  if (/^tab/.test(n)) return 'tab';
  if (/^(pre refrao|prerefrao|prerrefrao|pre coro|pre chorus|pre)\b/.test(n)) return 'pre';
  if (/^(refrao|coro|chorus)/.test(n)) return 'chorus';
  if (/^(intro|introducao|inicio)/.test(n)) return 'intro';
  if (/^(ponte|bridge)/.test(n)) return 'bridge';
  if (/^(solo|interludio|instrumental|riff|base|dedilhado|passagem|virada)/.test(n)) return 'inst';
  if (/^(final|fim|outro|encerramento|coda|tag)/.test(n)) return 'outro';
  return 'verse';
}

// ---------------------------------------------------------------------------
// Tokens de linha de acordes

const REPEAT_RE = /^\(?\s*(?:[xX×]\s*(\d{1,2})|(\d{1,2})\s*[xX×])\s*\)?[.:;,]?$/;
const BIS_RE = /^\(?bis\)?$/i;
const IGNORE_RE = /^(\.{2,}|…|[-–—~>→=*_]+|\(|\)|\[|\]|N\.?C\.?|n\.c\.?|\(N\.?C\.?\))$/;

/**
 * Classifica um token de uma linha de acordes.
 * @returns {{kind:'chord', chord:any, text:string, beats:number|null}|{kind:'bar'}|{kind:'repeat', n:number}|{kind:'dot'}|{kind:'slash'}|{kind:'same'}|{kind:'ignore'}|{kind:'word'}}
 */
export function classifyToken(text) {
  if (/^:?\|+:?$/.test(text)) return { kind: 'bar' };
  let m = REPEAT_RE.exec(text);
  if (m) return { kind: 'repeat', n: Number(m[1] || m[2]) };
  if (BIS_RE.test(text)) return { kind: 'repeat', n: 2 };
  if (text === '.' || text === '·') return { kind: 'dot' };
  if (text === '/') return { kind: 'slash' };
  if (text === '%') return { kind: 'same' };
  if (IGNORE_RE.test(text)) return { kind: 'ignore' };
  const c = chordToken(text);
  if (c) return c;
  return { kind: 'word' };
}

/** Acorde com duração opcional "G:2" e parênteses opcionais "(G", "D)". */
function chordToken(text) {
  const tryParse = (t) => {
    let beats = null;
    const dm = /^(.+?):(\d{1,2}(?:[.,]5)?)$/.exec(t);
    if (dm) { t = dm[1]; beats = Number(dm[2].replace(',', '.')); if (!(beats > 0 && beats <= 64)) return null; }
    const chord = parseChord(t);
    return chord ? { kind: 'chord', chord, text: t, beats } : null;
  };
  let r = tryParse(text);
  if (r) return r;
  // tira um nível de parênteses/colchetes nas pontas: "(G", "D)", "(Em)"
  let t = text;
  let lead = 0;
  while (/^[([]/.test(t)) { t = t.slice(1); lead++; }
  while (/[)\]]$/.test(t) && !/\([^)]*\)$/.test(t)) t = t.slice(0, -1);
  if (t && t !== text) {
    r = tryParse(t);
    if (r) { r.lead = lead; return r; }
  }
  return null;
}

const TOKEN_RE = /:?\|+:?|[^\s|]+/g;

/**
 * Analisa uma linha. Se for linha de acordes, retorna os tokens com coluna.
 * @returns {null | {tokens:Array, hasBars:boolean, repeat:number, label:string, comment:string}}
 */
export function analyzeChordLine(line) {
  let work = line;
  let comment = '';
  let repeat = 1;
  // comentário entre parênteses no fim: "(repete 2x)", "(base)"
  const cm = /\s\(([^()]*[a-zA-Zà-ú]{3,}[^()]*)\)\s*$/.exec(work);
  if (cm && !parseChord(cm[1].trim())) {
    comment = cm[1].trim();
    const rn = /(\d{1,2})\s*[xX×]|[xX×]\s*(\d{1,2})/.exec(comment);
    if (rn) repeat = Number(rn[1] || rn[2]);
    work = work.slice(0, cm.index) + ' '.repeat(work.length - cm.index);
  }
  const tokens = [];
  let chords = 0, words = 0, label = '';
  let first = true;
  for (const m of work.matchAll(TOKEN_RE)) {
    const text = m[0];
    const col = m.index;
    // rótulo no início: "Riff:", "Base:", "Solo:" seguido de acordes
    if (first && /^[A-Za-zÀ-ÿ][\wÀ-ÿ\- ]{1,20}:$/.test(text) && !parseChord(text.slice(0, -1))) {
      label = text.slice(0, -1);
      first = false;
      continue;
    }
    first = false;
    const tk = classifyToken(text);
    if (tk.kind === 'word') { words++; if (words > 0) break; }
    if (tk.kind === 'chord') chords++;
    if (tk.kind === 'repeat') { repeat = tk.n; continue; }
    tokens.push({ ...tk, col: col + (tk.lead || 0), len: text.length - (tk.lead || 0), raw: text });
  }
  if (words > 0 || chords === 0) return null;
  // ajusta comprimento do token de acorde (sem parênteses finais) para edição de tempos
  for (const t of tokens) {
    if (t.kind === 'chord') t.len = t.text.length + (t.beats != null ? (':' + fmtBeats(t.beats)).length : 0);
  }
  return { tokens, hasBars: tokens.some((t) => t.kind === 'bar'), repeat, label, comment };
}

export const fmtBeats = (b) => (Number.isInteger(b) ? String(b) : String(b).replace('.', ','));

/** Linha de tablatura? (E|---0---, B|--3--, |--5--|) */
export function isTabLine(line) {
  const s = line.trim();
  if (s.length < 5) return false;
  const dashes = (s.match(/-/g) || []).length;
  if (/^[EADGBe][#b]?\s*[|:]/.test(s) && dashes >= 2) return true;
  const body = s.replace(/^[EADGBe][#b]?/, '');
  return dashes >= 6 && /^[\s\-|0-9hpbrsx\/\\~().*<>=^v]+$/.test(body);
}

// ---------------------------------------------------------------------------
// Metadados

const NOISE_RE = /^(essa informa[çc][ãa]o est[áa] errada|nos avise|cifra club|cifraclub|exibir cifra|imprimir|ver v[íi]deo|aprenda a tocar|simplificar cifra|auto rolagem|tutorial|vídeo aula|enviar cifra|corrigir|adicionar [àa] lista|baixar cifra|^\d+ exibi[çc][õo]es)/i;

/**
 * Tenta ler uma linha de metadados. Retorna true se a linha foi consumida.
 */
function readMeta(t, meta) {
  let m;
  if ((m = /^t[íi]tulo\s*:\s*(.+)$/i.exec(t))) { meta.title = m[1].trim(); return true; }
  if ((m = /^(artista|cantor|banda|int[ée]rprete)\s*:\s*(.+)$/i.exec(t))) { meta.artist = m[2].trim(); return true; }
  if ((m = /^tom\s*:\s*(.+)$/i.exec(t)) || (m = /^tom\s+([A-G][#b]?m?)\s*$/i.exec(t))) {
    const v = m[1].trim();
    const km = /^([A-G][#b♯♭]?(?:m(?!aj))?)/.exec(normalizeChordText(v));
    if (km) meta.keyHint = km[1];
    const fm = /forma dos acordes no tom de\s+([A-G][#b♯♭]?m?)/i.exec(v);
    if (fm) meta.writtenKeyHint = normalizeChordText(fm[1]);
    return 'key';
  }
  if ((m = /forma dos acordes no tom de\s+([A-G][#b♯♭]?m?)/i.exec(t))) { meta.writtenKeyHint = normalizeChordText(m[1]); return true; }
  if ((m = /^(capo|capotraste)\b[^\d\n]{0,25}(\d{1,2})/i.exec(t))) { meta.capo = Number(m[2]); return true; }
  if (/^(capo|capotraste)\b/i.test(t) && /sem capo/i.test(t)) return true;
  if (/^afina[çc][ãa]o\s*:/i.test(t)) { meta.tuning = t.replace(/^afina[çc][ãa]o\s*:\s*/i, ''); return true; }
  if (/^composi[çc][ãa]o( de)?\s*:?/i.test(t)) { meta.composer = t.replace(/^composi[çc][ãa]o( de)?\s*:?\s*/i, '').replace(/\.?\s*essa informa.*$/i, '').trim(); return true; }
  if ((m = /^(bpm|andamento)\s*[:=]?\s*(\d{2,3})\b/i.exec(t)) || (m = /^(tempo)\s*[:=]\s*(\d{2,3})\b/i.exec(t))) { meta.bpm = Number(m[2]); return true; }
  if ((m = /^(compasso|f[óo]rmula de compasso)\s*[:=]?\s*(\d{1,2}\/\d{1,2})/i.exec(t))) { meta.timeSig = m[2]; return true; }
  if ((m = /^(ritmo|batida|levada)\s*:\s*(.+)$/i.exec(t))) { meta.strum = m[2].trim(); return true; }
  if (NOISE_RE.test(t)) return true;
  return false;
}

/** Separa "TítuloArtista" grudados (comum ao copiar do celular). */
function splitGlued(s) {
  const m = /([a-záéíóúâêôãõçàü0-9!?"'”)\]])([A-ZÁÉÍÓÚÂÊÔÃÕÇ])/.exec(s);
  if (!m) return null;
  const idx = m.index + 1;
  const a = s.slice(0, idx).trim(), b = s.slice(idx).trim();
  if (a.length < 2 || b.length < 2) return null;
  return [a, b];
}

// ---------------------------------------------------------------------------
// ChordPro

const CHORDPRO_INLINE = /\[([^\]\s]{1,16})\]/g;

function hasChordPro(lines) {
  return lines.some((l) => /^\s*\{[a-z_]+\s*(:.*)?\}\s*$/i.test(l)) ||
    lines.some((l) => [...l.matchAll(CHORDPRO_INLINE)].some((m) => parseChord(m[1])) && /\]\S|\S\[/.test(l));
}

function convertChordPro(lines) {
  const out = [];
  for (const line of lines) {
    const d = /^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i.exec(line);
    if (d) {
      const name = d[1].toLowerCase();
      const val = (d[2] || '').trim();
      if (name === 'title' || name === 't') out.push('Título: ' + val);
      else if (['artist', 'subtitle', 'st', 'a'].includes(name)) out.push('Artista: ' + val);
      else if (name === 'key' || name === 'k') out.push('Tom: ' + val);
      else if (name === 'capo') out.push('Capo: ' + val);
      else if (name === 'tempo') out.push('BPM: ' + val);
      else if (name === 'time') out.push('Compasso: ' + val);
      else if (['soc', 'start_of_chorus'].includes(name)) out.push('', '[' + (val || 'Refrão') + ']');
      else if (['sov', 'start_of_verse'].includes(name)) out.push('', '[' + (val || 'Verso') + ']');
      else if (['sob', 'start_of_bridge'].includes(name)) out.push('', '[' + (val || 'Ponte') + ']');
      else if (['c', 'comment', 'ci', 'comment_italic'].includes(name)) out.push(isSectionName(val) ? '[' + val + ']' : '(' + val + ')');
      else if (/^(eoc|eov|eob|end_of_)/.test(name)) out.push('');
      continue;
    }
    const matches = [...line.matchAll(CHORDPRO_INLINE)].filter((m) => parseChord(m[1]));
    if (!matches.length) { out.push(line); continue; }
    let lyric = '';
    let chordLine = '';
    let last = 0;
    for (const m of matches) {
      lyric += line.slice(last, m.index);
      let pos = lyric.length;
      if (chordLine.length > pos) pos = chordLine.length + (chordLine.length ? 1 : 0);
      chordLine = chordLine.padEnd(pos, ' ') + m[1];
      if (pos > lyric.length) lyric = lyric.padEnd(pos, ' ');
      last = m.index + m[0].length;
    }
    lyric += line.slice(last);
    out.push(chordLine);
    if (lyric.trim()) out.push(lyric.replace(/\s+$/, ''));
  }
  return out;
}

/** Nota antiga "Bm(4)" (= 4 tempos) -> nova "Bm:4", mantendo o alinhamento. */
export function convertLegacyBeats(text) {
  return normalizeText(text).split('\n').map((line) => {
    if (!analyzeChordLineLegacy(line)) return line;
    return line.replace(/(\S+?)\((0\.5|1|1\.5|2|2\.5|3|4|5|6|7|8|12|16)\)(?=\s|$)/g, (all, base, n) => {
      if (!parseChord(base.replace(/^\(/, ''))) return all;
      const rep = base + ':' + n.replace('.', ',');
      return rep + ' '.repeat(Math.max(0, all.length - rep.length));
    });
  }).join('\n');
}

function analyzeChordLineLegacy(line) {
  const t = line.trim();
  if (!t) return false;
  return t.split(/\s+/).every((tok) => {
    const s = tok.replace(/\((0\.5|1|1\.5|2|2\.5|3|4|5|6|7|8|12|16)\)$/, '');
    return classifyToken(s).kind !== 'word';
  });
}

/** Prepara o texto para salvar: limpa e converte ChordPro em acordes-sobre-letra. */
export function prepareSource(text) {
  const lines = normalizeText(text).split('\n');
  const out = hasChordPro(lines) ? convertChordPro(lines) : lines;
  // remove linhas vazias em excesso no começo/fim
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Cabeçalhos de seção

function stripRepeatFromName(s) {
  let repeat = 1;
  const re = /[\s\-–(]*(?:(\d{1,2})\s*[xX×]|[xX×]\s*(\d{1,2})|bis)[)\s]*$/i;
  const m = re.exec(s);
  if (m) { repeat = Number(m[1] || m[2] || 2); s = s.slice(0, m.index); }
  return { name: s.replace(/[\s:\-–]+$/, '').trim(), repeat };
}

/** Linha de cabeçalho de seção? Retorna {name, repeat, rest}. */
export function parseHeader(line) {
  const t = line.trim();
  let m = /^\[([^\]]{1,48})\]\s*(.*)$/.exec(t);
  if (m && !parseChord(m[1].trim())) {
    const { name, repeat } = stripRepeatFromName(m[1].trim());
    let rest = m[2] || '';
    let rep = repeat;
    const rm = /^\(?\s*(\d{1,2})\s*[xX×]\s*\)?$|^\(?\s*[xX×]\s*(\d{1,2})\s*\)?$/.exec(rest.trim());
    if (rm) { rep = Number(rm[1] || rm[2]); rest = ''; }
    const restCol = rest ? line.indexOf(rest) : -1;
    return { name: name || 'Parte', repeat: rep, rest, restCol };
  }
  // "Refrão:" / "Intro: G D Em C" / "REFRÃO (2x)"
  m = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9ºª°\s\-–]{1,30}?)\s*(\(?\s*(?:\d{1,2}\s*[xX×]|[xX×]\s*\d{1,2})\s*\)?)?\s*:\s*(.*)$/.exec(t);
  if (m && isSectionName(m[1])) {
    const { name, repeat } = stripRepeatFromName(m[1] + (m[2] ? ' ' + m[2] : ''));
    const rest = m[3] || '';
    return { name, repeat, rest, restCol: rest ? line.lastIndexOf(rest) : -1 };
  }
  if (t.length <= 40) {
    const { name, repeat } = stripRepeatFromName(t.replace(/:$/, ''));
    // sem colchetes e sem ":", só vale com inicial maiúscula ("Refrão", "REFRÃO"): "ponte" minúsculo é letra
    if (name && /^[A-ZÀ-Ý]/.test(name) && isSectionName(name) && name.split(/\s+/).length <= 4 && !analyzeChordLine(t)) {
      return { name, repeat, rest: '', restCol: -1 };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parser principal

/**
 * @typedef {Object} ParsedLine
 * @property {'pair'|'chords'|'lyric'|'tab'|'blank'|'comment'} kind
 * @property {number} lineNo          linha (0-based) no texto normalizado
 * @property {ReturnType<typeof analyzeChordLine>} [chords]
 * @property {string} [chordText]
 * @property {string} [lyric]
 * @property {number} [lyricLineNo]
 * @property {number} [repeat]
 * @property {string} [text]
 */

/**
 * Lê a cifra.
 * @param {string} input
 * @returns {{meta:object, sections:Array<{name:string, repeat:number, kind:string, lines:ParsedLine[], keyChange:string|null, headerLineNo:number}>, lines:string[]}}
 */
export function parseCifra(input) {
  const text = normalizeText(input);
  let lines = text.split('\n');
  if (hasChordPro(lines)) lines = convertChordPro(lines);
  const meta = { title: '', artist: '', keyHint: '', writtenKeyHint: '', capo: 0, bpm: 0, timeSig: '', strum: '', composer: '', tuning: '' };
  const sections = [];
  const preamble = [];
  let current = null;
  let started = false;
  let pendingKey = null;

  const newSection = (name, repeat, lineNo) => {
    const s = { name, repeat: repeat || 1, kind: sectionKind(name), lines: [], keyChange: null, headerLineNo: lineNo };
    if (pendingKey) { s.keyChange = pendingKey; pendingKey = null; }
    sections.push(s);
    current = s;
    return s;
  };
  const ensureSection = (lineNo) => { if (!current) newSection('Início', 1, lineNo); return current; };

  const isLyricAt = (j) => {
    const l = lines[j];
    if (l == null || !l.trim()) return false;
    const t = l.trim();
    if (parseHeader(l) || isTabLine(l) || analyzeChordLine(l)) return false;
    const probe = { ...meta };
    if (readMeta(t, probe)) return false;
    return true;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { if (current) current.lines.push({ kind: 'blank', lineNo: i }); continue; }

    const metaRes = readMeta(t, meta);
    if (metaRes) {
      if (metaRes === 'key' && started) {
        // mudança de tom no meio da música ("Tom: A")
        pendingKey = meta.keyHint;
        meta.keyHint = meta.firstKeyHint || '';
        if (current && !current.lines.some((l) => l.kind === 'pair' || l.kind === 'chords')) { current.keyChange = pendingKey; pendingKey = null; }
      } else if (metaRes === 'key') {
        meta.firstKeyHint = meta.keyHint;
      }
      continue;
    }

    const hdr = parseHeader(line);
    if (hdr) {
      started = true;
      newSection(hdr.name, hdr.repeat, i);
      if (hdr.rest && hdr.rest.trim()) {
        // acordes na mesma linha do cabeçalho: "[Intro] G D Em C"
        const padded = ' '.repeat(Math.max(0, hdr.restCol)) + hdr.rest;
        const cl = analyzeChordLine(padded);
        if (cl) current.lines.push({ kind: 'chords', lineNo: i, chords: cl, chordText: padded, repeat: cl.repeat });
        else current.lines.push({ kind: 'lyric', lineNo: i, lyric: hdr.rest.trim(), repeat: 1 });
      }
      continue;
    }

    if (isTabLine(line)) {
      started = true;
      ensureSection(i).lines.push({ kind: 'tab', lineNo: i, text: line });
      continue;
    }

    const cl = analyzeChordLine(line);
    if (cl) {
      started = true;
      ensureSection(i);
      if (isLyricAt(i + 1)) {
        const lyricRaw = lines[i + 1];
        const { text: lyric, repeat: lrep } = lyricRepeat(lyricRaw);
        current.lines.push({ kind: 'pair', lineNo: i, lyricLineNo: i + 1, chords: cl, chordText: line, lyric, repeat: Math.max(cl.repeat, lrep) });
        i++;
      } else {
        current.lines.push({ kind: 'chords', lineNo: i, chords: cl, chordText: line, repeat: cl.repeat });
      }
      continue;
    }

    if (!started) { preamble.push({ text: t, lineNo: i }); continue; }
    const rep = /^\(?\s*(?:(\d{1,2})\s*[xX×]|[xX×]\s*(\d{1,2})|(bis))\s*\)?[.:]?$/i.exec(t);
    if (rep) {
      ensureSection(i).lines.push({ kind: 'repeat', lineNo: i, n: Number(rep[1] || rep[2] || 2) });
      continue;
    }
    if (/^\(.*\)$/.test(t) && !/[a-zà-ú]{3,}.*[a-zà-ú]{3,}.*[a-zà-ú]{3,}/i.test(t.slice(1, -1).replace(/\b(repete|repetir|vezes|todos|homens|mulheres|ministra[çc][ãa]o)\b/gi, ''))) {
      ensureSection(i).lines.push({ kind: 'comment', lineNo: i, text: t.slice(1, -1) });
      continue;
    }
    const { text: lyric, repeat } = lyricRepeat(line);
    ensureSection(i).lines.push({ kind: 'lyric', lineNo: i, lyric, repeat });
  }

  // título / artista a partir do preâmbulo
  const pre = preamble.filter((p) => p.text.length <= 70);
  if (pre.length) {
    if (!meta.title) {
      const first = pre[0].text;
      if (/\s[-–—|]\s/.test(first)) {
        const [a, ...b] = first.split(/\s[-–—|]\s/);
        meta.title = a.trim();
        if (!meta.artist) meta.artist = b.join(' - ').trim();
      } else if (pre.length >= 2) {
        meta.title = first;
        if (!meta.artist) meta.artist = pre[1].text;
      } else {
        const g = splitGlued(first);
        if (g) { meta.title = g[0]; if (!meta.artist) meta.artist = g[1]; } else meta.title = first;
      }
    } else if (!meta.artist && pre.length) {
      meta.artist = pre[0].text;
    }
  }
  // linhas longas do preâmbulo (letra antes do 1º acorde) entram numa seção "Início"
  const leftover = preamble.slice(meta.title ? (meta.artist && pre.length >= 2 ? 2 : 1) : 0).filter((p) => p.text.split(/\s+/).length >= 4);
  if (leftover.length) {
    const s = { name: 'Início', repeat: 1, kind: 'verse', lines: leftover.map((p) => ({ kind: 'lyric', lineNo: p.lineNo, lyric: p.text, repeat: 1 })), keyChange: null, headerLineNo: leftover[0].lineNo };
    sections.unshift(s);
  }
  meta.title = cleanTitle(meta.title);
  meta.artist = cleanTitle(meta.artist);
  delete meta.firstKeyHint;

  // seções de tablatura
  for (const s of sections) {
    if (s.kind !== 'tab') {
      const content = s.lines.filter((l) => l.kind !== 'blank');
      // só vira "tablatura" se não tiver nenhuma linha de acordes (ex.: [Intro] G D + tab embaixo continua sendo Intro)
      const hasChords = content.some((l) => l.kind === 'pair' || l.kind === 'chords');
      if (!hasChords && content.length && content.filter((l) => l.kind === 'tab').length >= content.length * 0.6) s.kind = 'tab';
    }
  }
  return { meta, sections, lines };
}

function cleanTitle(s) {
  return String(s || '').replace(/^cifra\s*(de|:)?\s*/i, '').replace(/\s*-\s*cifra club\s*$/i, '').replace(/\s+/g, ' ').trim();
}

function lyricRepeat(line) {
  const m = /\s*\(?\s*(?:(\d{1,2})\s*[xX×]|[xX×]\s*(\d{1,2})|(bis))\s*\)?\s*$/i.exec(line);
  if (m && m.index > 0 && /\S/.test(line.slice(0, m.index)) && (/\(/.test(m[0]) || /\s\d{1,2}\s*[xX]\s*$/.test(line) || m[3])) {
    return { text: line.replace(/\s+$/, ''), repeat: Number(m[1] || m[2] || 2) };
  }
  return { text: line.replace(/\s+$/, ''), repeat: 1 };
}

/**
 * Altera a duração de acordes no texto, mantendo o alinhamento com a letra.
 * @param {string} source  texto (já normalizado)
 * @param {Array<{lineNo:number, col:number, len:number}>} locs
 * @param {number|null} beats  null = remover marcação (volta ao padrão)
 */
export function setBeatsInSource(source, locs, beats) {
  const lines = normalizeText(source).split('\n');
  const byLine = new Map();
  for (const l of locs) {
    if (!byLine.has(l.lineNo)) byLine.set(l.lineNo, []);
    if (!byLine.get(l.lineNo).some((x) => x.col === l.col)) byLine.get(l.lineNo).push(l);
  }
  for (const [lineNo, arr] of byLine) {
    let line = lines[lineNo];
    if (line == null) continue;
    arr.sort((a, b) => b.col - a.col);
    for (const loc of arr) {
      const tok = line.slice(loc.col, loc.col + loc.len);
      const base = tok.replace(/:(\d{1,2}(?:[.,]5)?)$/, '');
      const next = beats == null ? base : base + ':' + fmtBeats(beats);
      let after = line.slice(loc.col + loc.len);
      const diff = next.length - tok.length;
      if (diff > 0) {
        // consome espaços seguintes (mantém pelo menos 1) para não empurrar os próximos acordes
        const spaces = (/^ */.exec(after) || [''])[0].length;
        const hasMore = after.trim().length > 0;
        const canEat = hasMore ? Math.max(0, spaces - 1) : spaces;
        after = after.slice(Math.min(diff, canEat));
      } else if (diff < 0 && after.trim().length > 0) {
        after = ' '.repeat(-diff) + after;
      }
      line = line.slice(0, loc.col) + next + after;
    }
    lines[lineNo] = line.replace(/\s+$/, '');
  }
  return lines.join('\n');
}
