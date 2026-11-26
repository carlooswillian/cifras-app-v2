// Graus do campo harmônico, detecção de tom e nomes de acordes por tom.

import {
  mod12, accString, spellDegree, relativeMajor, makeKey, parseKey, keyFromPc,
  degreeOfSpelledNote, LETTERS, pcName,
} from './notes.js';
import { triadSuffix, spellBass } from './chords.js';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/**
 * Grau (número + alteração) da fundamental em relação à tônica de referência.
 * Diminutos cromáticos são escritos como sustenido (#4°, #5°) — são acordes
 * de passagem que sobem; os demais como bemol (b3, b6, b7).
 */
export function degreeSpec(offset, triad) {
  switch (mod12(offset)) {
    case 0: return { num: 1, acc: 0 };
    case 1: return triad === 'dim' ? { num: 1, acc: 1 } : { num: 2, acc: -1 };
    case 2: return { num: 2, acc: 0 };
    case 3: return triad === 'dim' ? { num: 2, acc: 1 } : { num: 3, acc: -1 };
    case 4: return { num: 3, acc: 0 };
    case 5: return { num: 4, acc: 0 };
    case 6: return { num: 4, acc: 1 };
    case 7: return { num: 5, acc: 0 };
    case 8: return triad === 'dim' ? { num: 5, acc: 1 } : { num: 6, acc: -1 };
    case 9: return { num: 6, acc: 0 };
    case 10: return triad === 'dim' ? { num: 6, acc: 1 } : { num: 7, acc: -1 };
    default: return { num: 7, acc: 0 };
  }
}

/**
 * Tônica usada para calcular graus.
 * minorMode 'relative' (padrão): tom menor usa o relativo maior (Em -> graus de G: Em = 6m).
 * minorMode 'tonic': tom menor usa a própria tônica (Em = 1m, C = b6, D = b7).
 */
export function referenceTonic(key, minorMode = 'relative') {
  if (key.minor && minorMode === 'relative') return relativeMajor(key).tonic;
  return key.tonic;
}

/** Texto do grau: estilo 'numbers' (6m, b7, #4°) ou 'roman' (VIm, bVII, #IV°). */
export function degreeText(spec, triad, style = 'numbers') {
  const n = style === 'roman' ? ROMAN[spec.num] : String(spec.num);
  return accString(spec.acc) + n + triadSuffix(triad);
}

/**
 * Informações de grau de um acorde num tom.
 * @param {import('./chords.js').Chord} chord
 * @param {import('./notes.js').Key} key
 */
export function chordDegree(chord, key, minorMode = 'relative') {
  const ref = referenceTonic(key, minorMode);
  const spec = degreeSpec(chord.root.pc - ref.pc, chord.triad);
  let bassSpec = null;
  if (chord.bass) {
    const rootNote = spellDegree(ref, spec.num, spec.acc);
    const bassNote = spellBass(rootNote, chord.bass.pc, chord.triad);
    bassSpec = degreeOfSpelledNote(ref, bassNote);
  }
  return { spec, bassSpec, triad: chord.triad };
}

export function degreeLabel(deg, { style = 'numbers', showBass = false } = {}) {
  let s = degreeText(deg.spec, deg.triad, style);
  if (showBass && deg.bassSpec) {
    const b = deg.bassSpec;
    s += '/' + accString(b.acc) + (style === 'roman' ? ROMAN[b.num] : String(b.num));
  }
  return s;
}

const WEIRD = new Set(['B#', 'E#', 'Cb', 'Fb']);

/** Prefere bemóis? (tons com bemol na armadura, como F, Bb, Eb...) */
export function keyPrefersFlats(key) {
  const ref = key.minor ? relativeMajor(key).tonic : key.tonic;
  return ref.acc < 0 || ref.name === 'F';
}

function niceNote(note, preferFlats) {
  if (Math.abs(note.acc) > 1 || WEIRD.has(note.name)) return pcName(note.pc, preferFlats);
  return note.name;
}

/**
 * Nome do acorde para exibição.
 * - sem transposição: mantém a grafia original da cifra
 * - com transposição: reescreve a partir do grau, no tom de destino
 * @param {object} p
 * @param {import('./chords.js').Chord} p.chord
 * @param {{spec:{num:number,acc:number}, bassSpec:any, triad:string}} p.deg  grau no tom de origem
 * @param {import('./notes.js').Key} p.toKey  tom de destino (formas a tocar)
 * @param {boolean} p.transposed
 * @param {'simple'|'original'} p.chordStyle
 * @param {boolean} p.showBass
 * @param {string} p.minorMode
 */
export function chordLabel({ chord, deg, toKey, transposed, chordStyle = 'simple', showBass = false, minorMode = 'relative' }) {
  let rootName, bassName = null;
  if (!transposed) {
    rootName = chord.root.name;
    bassName = chord.bass ? chord.bass.name : null;
  } else {
    const ref = referenceTonic(toKey, minorMode);
    const flats = keyPrefersFlats(toKey);
    const rootNote = spellDegree(ref, deg.spec.num, deg.spec.acc);
    rootName = niceNote(rootNote, flats);
    if (chord.bass) {
      const bassNote = deg.bassSpec ? spellDegree(ref, deg.bassSpec.num, deg.bassSpec.acc) : spellBass(rootNote, chord.bass.pc, chord.triad);
      bassName = niceNote(bassNote, flats);
    }
  }
  if (chordStyle === 'original') {
    return rootName + chord.suffix + (bassName ? '/' + bassName : '');
  }
  return rootName + triadSuffix(chord.triad) + (showBass && bassName ? '/' + bassName : '');
}

/** Campo harmônico do tom (para a faixa de referência na tela). */
export function harmonicField(key, { style = 'numbers', minorMode = 'relative' } = {}) {
  const useMinorTonic = key.minor && minorMode === 'tonic';
  const ref = referenceTonic(key, minorMode);
  const flats = keyPrefersFlats(key);
  // maior: 1 2m 3m 4 5 6m 7° | menor (pela tônica): 1m 2° b3 4m 5m b6 b7
  const degrees = useMinorTonic
    ? [[1, 0, 'min'], [2, 0, 'dim'], [3, -1, 'maj'], [4, 0, 'min'], [5, 0, 'min'], [6, -1, 'maj'], [7, -1, 'maj']]
    : [[1, 0, 'maj'], [2, 0, 'min'], [3, 0, 'min'], [4, 0, 'maj'], [5, 0, 'maj'], [6, 0, 'min'], [7, 0, 'dim']];
  return degrees.map(([num, acc, triad]) => {
    const note = spellDegree(ref, num, acc);
    return {
      degree: degreeText({ num, acc }, triad, style),
      chord: niceNote(note, flats) + triadSuffix(triad),
      tonic: key.minor ? (useMinorTonic ? num === 1 : num === 6) : num === 1,
    };
  });
}

// ---------------------------------------------------------------------------
// Detecção de tom

// Quanto cada acorde "combina" com um campo harmônico maior, por distância da tônica.
const FIT = [
  { maj: 1, min: 0.3, dim: 0 },       // 0  I
  { maj: 0.05, min: 0, dim: 0.25 },   // 1  bII / #I°
  { maj: 0.35, min: 1, dim: 0.1 },    // 2  II (V/V) / IIm
  { maj: 0.25, min: 0.05, dim: 0.25 },// 3  bIII / #II°
  { maj: 0.35, min: 1, dim: 0 },      // 4  III (V/VIm) / IIIm
  { maj: 1, min: 0.35, dim: 0.1 },    // 5  IV / IVm
  { maj: 0.05, min: 0.05, dim: 0.3 }, // 6  #IV°
  { maj: 1, min: 0.25, dim: 0 },      // 7  V / Vm
  { maj: 0.25, min: 0, dim: 0.25 },   // 8  bVI / #V°
  { maj: 0.3, min: 1, dim: 0 },       // 9  VI (V/IIm) / VIm
  { maj: 0.35, min: 0.05, dim: 0 },   // 10 bVII
  { maj: 0.05, min: 0.15, dim: 1 },   // 11 VII°
];

/**
 * Pontua quanto uma lista de acordes combina com o campo maior de `tonicPc` (0..1).
 * @param {Array<{root:number, triad:string, weight:number}>} items
 */
export function fieldFit(items, tonicPc) {
  let total = 0, sum = 0;
  for (const it of items) {
    total += it.weight;
    sum += it.weight * FIT[mod12(it.root - tonicPc)][it.triad];
  }
  return total ? sum / total : 0;
}

function tonicEvidence(items, pc, triad) {
  if (!items.length) return 0;
  const total = items.reduce((a, it) => a + it.weight, 0) || 1;
  let ev = 0;
  for (const it of items) if (it.root === pc && it.triad === triad) ev += it.weight;
  ev /= total;
  const first = items[0], last = items[items.length - 1];
  if (first.root === pc && first.triad === triad) ev += 0.15;
  if (last.root === pc && last.triad === triad) ev += 0.3;
  return ev;
}

/**
 * Detecta o tom dos acordes escritos.
 * @param {Array<{root:number, triad:'maj'|'min'|'dim', weight:number}>} items  em ordem
 * @param {{keyHint?:string, writtenKeyHint?:string, capo?:number}} hints
 * @returns {{key: import('./notes.js').Key, confidence:number, source:string}}
 */
export function detectKey(items, hints = {}) {
  const hint = parseKey(hints.keyHint);
  const written = parseKey(hints.writtenKeyHint);
  const capo = Number(hints.capo) || 0;
  if (!items.length) {
    if (written) return { key: written, confidence: 0, source: 'hint' };
    if (hint) return { key: capo ? keyFromPc(hint.tonic.pc - capo, hint.minor) : hint, confidence: 0, source: 'hint' };
    return { key: parseKey('C'), confidence: 0, source: 'default' };
  }

  // 1) melhor campo harmônico (com pequeno bônus de tônica para desempatar)
  const scores = [];
  for (let t = 0; t < 12; t++) {
    const fit = fieldFit(items, t);
    const ev = Math.max(tonicEvidence(items, t, 'maj'), tonicEvidence(items, mod12(t + 9), 'min'));
    scores.push({ t, fit, total: fit + 0.12 * ev });
  }
  scores.sort((a, b) => b.total - a.total);
  const best = scores[0];
  const fitOf = (pc) => scores.find((s) => s.t === mod12(pc)).fit;

  // 2) dicas do texto ("forma dos acordes no tom de G", "Tom: A" + capo)
  const tolerance = 0.12;
  if (written) {
    const fieldPc = written.minor ? written.tonic.pc + 3 : written.tonic.pc;
    if (fitOf(fieldPc) >= best.fit - tolerance) return { key: written, confidence: fitOf(fieldPc), source: 'hint' };
  }
  if (hint) {
    const candidates = [hint];
    if (capo) candidates.push(keyFromPc(hint.tonic.pc - capo, hint.minor));
    let chosen = null, chosenFit = -1;
    for (const c of candidates) {
      const f = fitOf(c.minor ? c.tonic.pc + 3 : c.tonic.pc);
      if (f > chosenFit + 1e-9) { chosen = c; chosenFit = f; }
    }
    if (chosen && chosenFit >= best.fit - tolerance) return { key: chosen, confidence: chosenFit, source: 'hint' };
  }

  // 3) maior ou relativo menor?
  const majPc = best.t;
  const minPc = mod12(best.t + 9);
  const evMaj = tonicEvidence(items, majPc, 'maj');
  let evMin = tonicEvidence(items, minPc, 'min');
  // presença do V maior do relativo menor (ex.: B em Em) indica tom menor
  const total = items.reduce((a, it) => a + it.weight, 0) || 1;
  const vOfMinor = items.filter((it) => it.root === mod12(minPc + 7) && it.triad === 'maj').reduce((a, it) => a + it.weight, 0) / total;
  evMin += 0.5 * vOfMinor;
  const minor = evMin > evMaj + 0.02;
  return { key: keyFromPc(minor ? minPc : majPc, minor), confidence: best.fit, source: 'auto' };
}

/** Converte nome de tom vindo do usuário, aceitando vazio. */
export function keyOrNull(str) {
  return str ? parseKey(str) : null;
}

export { makeKey, parseKey, keyFromPc, LETTERS };
