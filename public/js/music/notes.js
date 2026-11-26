// Notas, tons e grafia (C, C#, Db...). Sem dependências de DOM.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// Escala maior a partir da tônica, em semitons, para os graus 1..7
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

export const mod12 = (n) => ((n % 12) + 12) % 12;

/**
 * Lê uma nota: "C", "c#", "Db", "E#", "Cb", "F♯", "B♭".
 * @returns {{letter:string, acc:number, pc:number, name:string}|null}
 */
export function parseNote(str) {
  const m = /^([A-Ga-g])(##|bb|#|b|♯|♭)?$/.exec(String(str || '').trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const acc = accValue(m[2] || '');
  return makeNote(letter, acc);
}

function accValue(a) {
  switch (a) {
    case '#': case '♯': return 1;
    case '##': return 2;
    case 'b': case '♭': return -1;
    case 'bb': return -2;
    default: return 0;
  }
}

export function accString(acc) {
  if (acc > 0) return '#'.repeat(acc);
  if (acc < 0) return 'b'.repeat(-acc);
  return '';
}

export function makeNote(letter, acc) {
  return { letter, acc, pc: mod12(LETTER_PC[letter] + acc), name: letter + accString(acc) };
}

/** Escreve a altura `pc` usando a letra dada (ajusta o acidente). */
export function spellWithLetter(pc, letter) {
  let acc = mod12(pc - LETTER_PC[letter]);
  if (acc > 6) acc -= 12; // -5..6
  return makeNote(letter, acc);
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Nome simples de uma altura (sem contexto de tom). */
export function pcName(pc, preferFlats = false) {
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

// Nomes preferidos para tons (o que um músico espera ver)
const MAJOR_KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_KEY_NAMES = ['Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

/**
 * Um tom: tônica (com grafia) + modo.
 * @typedef {{tonic:{letter:string,acc:number,pc:number,name:string}, minor:boolean, name:string}} Key
 */

/** Lê um tom: "G", "Em", "Bb", "F#m", "C#m", "Ebm", "A menor", "Lá"... */
export function parseKey(str) {
  if (!str) return null;
  let s = String(str).trim()
    .replace(/♯/g, '#').replace(/♭/g, 'b')
    .replace(/\s+/g, ' ');
  // nomes em português (Dó, Ré, Mi...) — aceitos de forma tolerante
  const solfege = { 'do': 'C', 'dó': 'C', 're': 'D', 'ré': 'D', 'mi': 'E', 'fa': 'F', 'fá': 'F', 'sol': 'G', 'la': 'A', 'lá': 'A', 'si': 'B' };
  const sm = /^(dó|do|ré|re|mi|fá|fa|sol|lá|la|si)(#|b|\s?sustenido|\s?bemol)?\s*(m|menor|maior)?$/i.exec(s);
  if (sm) {
    const letter = solfege[sm[1].toLowerCase()];
    const acc = !sm[2] ? '' : (/#|sust/i.test(sm[2]) ? '#' : 'b');
    s = letter + acc + (sm[3] && /^m(enor)?$/i.test(sm[3]) ? 'm' : '');
  }
  const m = /^([A-Ga-g])(#|b)?(.*)$/.exec(s);
  if (!m) return null;
  const tonic = parseNote(m[1].toUpperCase() + (m[2] || ''));
  if (!tonic) return null;
  const rest = m[3].trim();
  const minor = /^(m(?!aj)|min|-)/.test(rest) || /^menor/i.test(rest);
  return makeKey(tonic, minor);
}

export function makeKey(tonic, minor) {
  return { tonic, minor, name: tonic.name + (minor ? 'm' : '') };
}

/** Tom com a grafia preferida para uma altura. */
export function keyFromPc(pc, minor) {
  const name = (minor ? MINOR_KEY_NAMES : MAJOR_KEY_NAMES)[mod12(pc)];
  return parseKey(name);
}

/** Transpõe um tom em semitons, usando a grafia preferida. */
export function transposeKey(key, semitones) {
  if (!key) return null;
  if (!semitones) return key;
  return keyFromPc(key.tonic.pc + semitones, key.minor);
}

/** Relativo maior de um tom menor (Em -> G). */
export function relativeMajor(key) {
  if (!key.minor) return key;
  const pc = mod12(key.tonic.pc + 3);
  // grafia: letra 2 posições acima (E -> G, F# -> A, Bb -> Db)
  const letter = LETTERS[(LETTERS.indexOf(key.tonic.letter) + 2) % 7];
  const tonic = spellWithLetter(pc, letter);
  // Evita grafias estranhas (ex.: A# maior); usa a preferida nesse caso
  if (Math.abs(tonic.acc) > 1 || tonic.name === 'A#' || tonic.name === 'D#' || tonic.name === 'G#' || tonic.name === 'E#' || tonic.name === 'B#') {
    return keyFromPc(pc, false);
  }
  return makeKey(tonic, false);
}

/** Relativo menor de um tom maior (G -> Em). */
export function relativeMinor(key) {
  if (key.minor) return key;
  const pc = mod12(key.tonic.pc + 9);
  const letter = LETTERS[(LETTERS.indexOf(key.tonic.letter) + 5) % 7];
  const tonic = spellWithLetter(pc, letter);
  if (Math.abs(tonic.acc) > 1) return keyFromPc(pc, true);
  return makeKey(tonic, true);
}

/**
 * Nome da nota do grau `num` (1..7) com alteração `acc` (-1, 0, +1),
 * a partir da tônica `tonic` (escala maior como referência).
 * Ex.: tônica Bb, grau b7 -> Ab ; tônica G, grau #4 -> C#
 */
export function spellDegree(tonic, num, acc = 0) {
  const letter = LETTERS[(LETTERS.indexOf(tonic.letter) + num - 1) % 7];
  const pc = mod12(tonic.pc + MAJOR_STEPS[num - 1] + acc);
  return spellWithLetter(pc, letter);
}

/** Altura do grau num/acc a partir da tônica. */
export function degreePc(tonicPc, num, acc = 0) {
  return mod12(tonicPc + MAJOR_STEPS[num - 1] + acc);
}

/** Grau (num/acc) correspondente a uma letra de nota em relação a uma tônica. */
export function degreeOfSpelledNote(tonic, note) {
  const num = (((LETTERS.indexOf(note.letter) - LETTERS.indexOf(tonic.letter)) % 7) + 7) % 7 + 1;
  let acc = mod12(note.pc - degreePc(tonic.pc, num));
  if (acc > 6) acc -= 12;
  return { num, acc };
}

/** Diferença de semitons descrita em linguagem de músico (½ tom, 1 tom...). */
export function describeInterval(semitones) {
  const s = ((semitones % 12) + 12) % 12;
  const up = s <= 6 ? s : s - 12; // -5..6
  if (up === 0) return 'mesmo tom';
  const abs = Math.abs(up);
  const tons = abs / 2;
  const txt = tons === 0.5 ? '½ tom' : (Number.isInteger(tons) ? `${tons} ${tons === 1 ? 'tom' : 'tons'}` : `${Math.floor(tons)} ${Math.floor(tons) > 1 ? 'tons' : 'tom'} e ½`);
  return (up > 0 ? 'sobe ' : 'desce ') + txt;
}
