// Leitura de acordes na notação usada no Brasil (Cifra Club etc.)
// e simplificação para o acorde básico (maior, menor ou diminuto).

import { parseNote, mod12, spellWithLetter, LETTERS } from './notes.js';

/**
 * @typedef {Object} Chord
 * @property {string} raw        acorde como escrito (normalizado)
 * @property {{letter:string,acc:number,pc:number,name:string}} root
 * @property {string} suffix     tudo entre a fundamental e o baixo (ex.: "m7(9)")
 * @property {'maj'|'min'|'dim'} triad   acorde básico
 * @property {boolean} sus
 * @property {boolean} aug
 * @property {boolean} power
 * @property {boolean} seventh
 * @property {{letter:string,acc:number,pc:number,name:string}|null} bass
 */

/** Normaliza variações tipográficas comuns. */
export function normalizeChordText(s) {
  return String(s)
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/[º˚ᵒ]/g, '°')
    .replace(/Ø/g, 'ø')
    .replace(/[Δ△]/g, 'maj')
    .replace(/[–—−]/g, '-');
}

// Extensões numéricas aceitas fora de parênteses
const VALID_NUMBERS = new Set(['2', '4', '5', '6', '7', '9', '11', '13', '69']);

/**
 * Lê o sufixo do acorde (sem fundamental e sem baixo).
 * @returns {null | {minor:boolean, dim:boolean, aug:boolean, sus:boolean, power:boolean, seventh:boolean}}
 */
function parseSuffix(suf) {
  const q = { minor: false, dim: false, aug: false, sus: false, power: false, seventh: false, flat5: false };
  let i = 0;
  let atoms = 0;
  let lastWasNumber = false;
  const n = suf.length;
  const startsWith = (str) => suf.startsWith(str, i);

  while (i < n) {
    const isFirst = atoms === 0;
    let m;
    if (suf[i] === '(') {
      const close = suf.indexOf(')', i);
      if (close < 0) return null;
      const inner = suf.slice(i + 1, close);
      if (!parseParenGroup(inner, q)) return null;
      i = close + 1; lastWasNumber = false;
    } else if (startsWith('maj') || startsWith('Maj') || startsWith('MAJ')) {
      i += 3; q.seventh = true; lastWasNumber = false;
      m = /^\d{1,2}/.exec(suf.slice(i)); if (m) { i += m[0].length; lastWasNumber = true; }
    } else if (startsWith('min')) {
      if (!isFirst) return null;
      i += 3; q.minor = true; lastWasNumber = false;
    } else if (isFirst && startsWith('mi') && !/[a-z]/i.test(suf[i + 2] || '')) {
      i += 2; q.minor = true; lastWasNumber = false;
    } else if (suf[i] === 'm') {
      // "m" só como qualidade (início) ou em "7M"/"m(7M)"; "m" no meio é inválido
      if (!isFirst) return null;
      i += 1; q.minor = true; lastWasNumber = false;
    } else if (suf[i] === 'M') {
      i += 1; q.seventh = true; lastWasNumber = false;
    } else if (startsWith('dim')) {
      i += 3; q.dim = true; lastWasNumber = false;
    } else if (suf[i] === '°') {
      i += 1; q.dim = true; lastWasNumber = false;
    } else if (suf[i] === 'ø') {
      i += 1; q.dim = true; q.seventh = true; lastWasNumber = false;
    } else if (startsWith('aug')) {
      i += 3; q.aug = true; lastWasNumber = false;
    } else if (startsWith('sus')) {
      i += 3; q.sus = true; lastWasNumber = false;
      m = /^(2|4|9)/.exec(suf.slice(i)); if (m) { i += m[0].length; lastWasNumber = true; }
    } else if (startsWith('add')) {
      i += 3;
      m = /^(2|4|9|11|13)/.exec(suf.slice(i)); if (!m) return null;
      i += m[0].length; lastWasNumber = true;
    } else if (suf[i] === '+') {
      // "7+" = sétima maior (uso brasileiro); "5+" ou "+" = aumentado
      const prev = suf.slice(0, i);
      if (lastWasNumber && /7$/.test(prev)) q.seventh = true; else q.aug = true;
      i += 1; lastWasNumber = false;
    } else if (suf[i] === '-') {
      const prev = suf.slice(0, i);
      if (lastWasNumber && /5$/.test(prev)) q.flat5 = true;
      else if (isFirst) q.minor = true;
      else return null;
      i += 1; lastWasNumber = false;
    } else if ((suf[i] === '#' || suf[i] === 'b') && /\d/.test(suf[i + 1] || '')) {
      m = /^[#b](\d{1,2})/.exec(suf.slice(i));
      if (suf[i] === 'b' && m[1] === '5') q.flat5 = true;
      if (suf[i] === '#' && m[1] === '5') q.aug = true;
      i += m[0].length; lastWasNumber = true;
    } else if (/\d/.test(suf[i])) {
      m = /^\d{1,2}/.exec(suf.slice(i));
      const num = m[0];
      if (!VALID_NUMBERS.has(num)) return null;
      if (isFirst && (num === '4' || num === '2')) q.sus = true;
      if (isFirst && num === '5' && i + 1 === n) q.power = true;
      if (num === '7' || num === '9' || num === '11' || num === '13') q.seventh = q.seventh || num === '7';
      i += num.length; lastWasNumber = true;
    } else if (suf[i] === '/' && /\d/.test(suf[i + 1] || '')) {
      // 6/9, 7/9 (extensões, não baixo)
      i += 1; lastWasNumber = false;
      continue; // não conta como átomo novo
    } else {
      return null;
    }
    atoms++;
  }
  return q;
}

function parseParenGroup(inner, q) {
  const parts = inner.split(/[\/,]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return false;
  for (const p of parts) {
    if (/^(maj7?|7M|M7|7\+|M)$/.test(p)) { q.seventh = true; continue; }
    if (/^add(2|4|9|11|13)$/.test(p)) continue;
    if (/^sus(2|4)?$/.test(p)) { q.sus = true; continue; }
    if (/^no\d$/.test(p)) continue;
    if (p === '°' || p === 'dim') { q.dim = true; continue; }
    const m = /^([#b+\-]?)(\d{1,2})([+\-]?)$/.exec(p);
    if (!m) return false;
    const [, pre, num, post] = m;
    if (!['2', '4', '5', '6', '7', '9', '11', '13'].includes(num)) return false;
    if (num === '5' && (pre === 'b' || pre === '-' || post === '-')) q.flat5 = true;
    if (num === '5' && (pre === '#' || pre === '+' || post === '+')) q.aug = true;
  }
  return true;
}

const cache = new Map();

/**
 * Lê um acorde. Retorna null se o texto não for um acorde.
 * @param {string} token
 * @returns {Chord|null}
 */
export function parseChord(token) {
  if (token == null) return null;
  const key = String(token);
  if (cache.has(key)) return cache.get(key);
  const res = parseChordUncached(key);
  if (cache.size > 5000) cache.clear();
  cache.set(key, res);
  return res;
}

function parseChordUncached(token) {
  const raw = normalizeChordText(token.trim());
  const m = /^([A-G])(#|b)?(.*)$/.exec(raw);
  if (!m) return null;
  const root = parseNote(m[1] + (m[2] || ''));
  let rest = m[3];

  // separa o baixo: "/" fora de parênteses seguido de nota
  let bass = null;
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '/' && depth === 0 && /[A-G]/.test(rest[i + 1] || '')) {
      const bm = /^([A-G])(#|b)?$/.exec(rest.slice(i + 1));
      if (!bm) return null;
      bass = parseNote(bm[1] + (bm[2] || ''));
      rest = rest.slice(0, i);
      break;
    }
  }
  const q = parseSuffix(rest);
  if (!q) return null;

  let triad = 'maj';
  if (q.dim) triad = 'dim';
  else if (q.minor && q.flat5) triad = 'dim'; // m7(b5) = meio-diminuto
  else if (q.minor) triad = 'min';

  return {
    raw,
    root,
    suffix: rest,
    triad,
    sus: q.sus,
    aug: q.aug && triad === 'maj',
    power: q.power,
    seventh: q.seventh,
    bass: bass && bass.pc !== root.pc ? bass : null,
  };
}

export const isChord = (token) => parseChord(token) !== null;

/** Sufixo do acorde básico: "" (maior), "m" (menor), "°" (diminuto). */
export function triadSuffix(triad) {
  return triad === 'min' ? 'm' : triad === 'dim' ? '°' : '';
}

/** Nome do acorde básico (ex.: "G7M(9)" -> "G", "F#m7(b5)" -> "F#°"). */
export function simpleName(chord, { showBass = false } = {}) {
  let s = chord.root.name + triadSuffix(chord.triad);
  if (showBass && chord.bass) s += '/' + chord.bass.name;
  return s;
}

/**
 * Grafia do baixo a partir da fundamental (terça, quinta, sétima...).
 * Usado quando o acorde é transposto/re-escrito.
 */
export function spellBass(rootNote, bassPc, triad) {
  const iv = mod12(bassPc - rootNote.pc);
  const steps = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: triad === 'dim' ? 4 : 3, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6 }[iv];
  const letter = LETTERS[(LETTERS.indexOf(rootNote.letter) + steps) % 7];
  const note = spellWithLetter(bassPc, letter);
  if (Math.abs(note.acc) > 1) return spellWithLetter(bassPc, LETTERS[(LETTERS.indexOf(letter) + (note.acc > 0 ? 1 : 6)) % 7]);
  return note;
}
