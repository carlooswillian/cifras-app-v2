// Testes do núcleo musical: rode com `npm test` (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseKey, spellDegree, relativeMajor, relativeMinor, transposeKey, describeInterval, keyFromPc } from '../public/js/music/notes.js';
import { parseChord, simpleName } from '../public/js/music/chords.js';
import { chordDegree, degreeLabel, detectKey, harmonicField, chordLabel } from '../public/js/music/keys.js';

const G = parseKey('G');
const deg = (c, key = G, opts = {}) => degreeLabel(chordDegree(parseChord(c), key, opts.minorMode), opts);

test('lê tons em vários formatos', () => {
  assert.equal(parseKey('G').name, 'G');
  assert.equal(parseKey('Em').name, 'Em');
  assert.equal(parseKey('F#m').name, 'F#m');
  assert.equal(parseKey('Bb').name, 'Bb');
  assert.equal(parseKey('Ebm').name, 'Ebm');
  assert.equal(parseKey('bm').name, 'Bm');
  assert.equal(parseKey('C menor').name, 'Cm');
  assert.equal(parseKey('Lá menor').name, 'Am');
  assert.equal(parseKey('Sol').name, 'G');
  assert.equal(parseKey('Cmaj7').name, 'C');
  assert.equal(parseKey('A (forma dos acordes no tom de G)').name, 'A');
  assert.equal(parseKey(''), null);
  assert.equal(parseKey('xyz'), null);
});

test('grafia de graus e relativos', () => {
  assert.equal(spellDegree(parseKey('Bb').tonic, 7, -1).name, 'Ab');
  assert.equal(spellDegree(parseKey('G').tonic, 4, 1).name, 'C#');
  assert.equal(spellDegree(parseKey('F').tonic, 4, 0).name, 'Bb');
  assert.equal(relativeMajor(parseKey('Em')).name, 'G');
  assert.equal(relativeMajor(parseKey('F#m')).name, 'A');
  assert.equal(relativeMajor(parseKey('Bbm')).name, 'Db');
  assert.equal(relativeMinor(parseKey('Eb')).name, 'Cm');
  assert.equal(transposeKey(parseKey('G'), 2).name, 'A');
  assert.equal(transposeKey(parseKey('G'), 3).name, 'Bb');
  assert.equal(transposeKey(parseKey('Em'), -1).name, 'D#m');
  assert.equal(keyFromPc(1, false).name, 'Db');
  assert.equal(describeInterval(2), 'sobe 1 tom');
  assert.equal(describeInterval(-1), 'desce ½ tom');
  assert.equal(describeInterval(3), 'sobe 1 tom e ½');
  assert.equal(describeInterval(-5), 'desce 2 tons e ½');
  assert.equal(describeInterval(10), 'desce 1 tom');
  assert.equal(describeInterval(0), 'mesmo tom');
});

test('reconhece acordes da notação brasileira (inclusive os que a versão antiga perdia)', () => {
  const ok = ['C#°', 'Bº', 'F#º7', 'E°', 'C7+', 'C6/9', 'G7M', 'A7M(9)', 'Bm7(b5)', 'F#m7(b5)', 'E7(4/9)', 'A7(4)',
    'C(9)', 'Dsus4', 'Cm(7M)', 'Bb', 'Ebm', 'D/F#', 'Am7(11)', 'E7(#9)', 'G5', 'C2', 'A4', 'B7(13)', 'Gm6', 'Cdim',
    'Bm7(5-)', 'Cmi7', 'C-7', 'C+', 'Cadd9', 'C(add9)', 'Eb7M(9)', 'Gmaj7', 'GM7', 'D7(9/13)', 'C6(9)', 'Gº', 'E7(9)/G#',
    'A♭', 'F♯m', 'Cø', 'C13', 'D9'];
  for (const c of ok) assert.ok(parseChord(c), `deveria reconhecer ${c}`);
});

test('não confunde palavras com acordes', () => {
  for (const w of ['Dom', 'Amor', 'Bem', 'Deus', 'Ama', 'Amém', 'Cada', 'Dia', 'Eu', 'Fé', 'Glória', 'N.C.', 'Ai', 'Ao', 'Do', 'Bom', 'Grande', 'Céu', 'Asas', 'Ele', 'Este']) {
    assert.equal(parseChord(w), null, `"${w}" não é acorde`);
  }
});

test('simplifica para o acorde básico', () => {
  const cases = {
    'G7M': 'G', 'A7M(9)': 'A', 'C7+': 'C', 'C6/9': 'C', 'Bm7(b5)': 'B°', 'F#m7(b5)': 'F#°', 'Bm7(5-)': 'B°',
    'E7(4/9)': 'E', 'A7(4)': 'A', 'Dsus4': 'D', 'D4': 'D', 'C2': 'C', 'G5': 'G', 'Cm(7M)': 'Cm', 'Am7(11)': 'Am',
    'C#°': 'C#°', 'Cdim7': 'C°', 'C+': 'C', 'Gm6': 'Gm', 'Cmi7': 'Cm', 'C-7': 'Cm', 'Eb7M(9)': 'Eb', 'Cø': 'C°',
  };
  for (const [c, s] of Object.entries(cases)) assert.equal(simpleName(parseChord(c)), s, c);
  assert.equal(simpleName(parseChord('D/F#')), 'D');
  assert.equal(simpleName(parseChord('D/F#'), { showBass: true }), 'D/F#');
  assert.equal(simpleName(parseChord('D7/F#'), { showBass: true }), 'D/F#');
});

test('graus no campo harmônico (números e romanos)', () => {
  const inG = { G: '1', Am: '2m', Bm: '3m', C: '4', D: '5', Em: '6m', 'F#°': '7°', 'F#m7(b5)': '7°', F: 'b7', Bb: 'b3', Eb: 'b6', A: '2', B: '3', E: '6', 'C#°': '#4°', 'D#°': '#5°', 'G#°': '#1°', 'A#°': '#2°', Cm: '4m', 'G7M': '1', 'D/F#': '5' };
  for (const [c, d] of Object.entries(inG)) assert.equal(deg(c), d, c);
  assert.equal(deg('Em', G, { style: 'roman' }), 'VIm');
  assert.equal(deg('F', G, { style: 'roman' }), 'bVII');
  assert.equal(deg('C#°', G, { style: 'roman' }), '#IV°');
  assert.equal(deg('D/F#', G, { showBass: true }), '5/7');
  assert.equal(deg('C/E', G, { showBass: true }), '4/6');
  assert.equal(deg('Em/D', G, { showBass: true }), '6m/5');
  assert.equal(deg('A/C#', parseKey('C'), { showBass: true }), '6/#1');
  // tom menor: pelo relativo maior (padrão) ou pela tônica menor
  const Em = parseKey('Em');
  assert.equal(deg('Em', Em), '6m');
  assert.equal(deg('B7', Em), '3');
  assert.equal(deg('Em', Em, { minorMode: 'tonic' }), '1m');
  assert.equal(deg('C', Em, { minorMode: 'tonic' }), 'b6');
  assert.equal(deg('D', Em, { minorMode: 'tonic' }), 'b7');
  assert.equal(deg('B', Em, { minorMode: 'tonic' }), '5');
});

const items = (arr) => arr.map((c) => { const ch = parseChord(c); return { root: ch.root.pc, triad: ch.triad, weight: 1 }; });

test('detecta o tom pelos acordes', () => {
  const cases = [
    [['G', 'D', 'Em', 'C'], 'G'], [['C', 'G', 'Am', 'F'], 'C'], [['Em', 'C', 'G', 'D'], 'Em'], [['Am', 'F', 'C', 'G', 'E'], 'Am'],
    [['A', 'E', 'F#m', 'D'], 'A'], [['C', 'F', 'G', 'Bb', 'C'], 'C'], [['Dm', 'Bb', 'F', 'C', 'A7', 'Dm'], 'Dm'],
    [['E', 'B', 'C#m', 'A'], 'E'], [['F', 'C', 'Dm', 'Bb'], 'F'], [['Bb', 'F', 'Gm', 'Eb'], 'Bb'],
    [['Em', 'B7', 'Em', 'Am', 'B', 'Em'], 'Em'], [['D', 'G', 'A', 'D'], 'D'], [['G', 'C', 'D', 'G'], 'G'],
    [['Ab', 'Eb', 'Fm', 'Db'], 'Ab'], [['C#m', 'A', 'E', 'B'], 'C#m'],
  ];
  for (const [prog, k] of cases) assert.equal(detectKey(items(prog)).key.name, k, prog.join(' '));
});

test('usa as dicas do texto: forma dos acordes e capotraste', () => {
  const prog = items(['G', 'D', 'Em', 'C']);
  // "Tom: A" + capo 2 com acordes em formato de G -> tom das formas = G
  assert.equal(detectKey(prog, { keyHint: 'A', capo: 2 }).key.name, 'G');
  assert.equal(detectKey(prog, { keyHint: 'A', writtenKeyHint: 'G', capo: 2 }).key.name, 'G');
  // "Tom: G" + capo 2 (tom já é das formas)
  assert.equal(detectKey(prog, { keyHint: 'G', capo: 2 }).key.name, 'G');
  // respeita menor do texto
  assert.equal(detectKey(prog, { keyHint: 'Em' }).key.name, 'Em');
  // dica errada é ignorada quando não combina com os acordes
  assert.equal(detectKey(prog, { keyHint: 'F#' }).key.name, 'G');
});

test('campo harmônico para a faixa de referência', () => {
  assert.deepEqual(harmonicField(parseKey('G')).map((x) => x.chord), ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#°']);
  assert.deepEqual(harmonicField(parseKey('Bb')).map((x) => x.chord), ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'A°']);
  assert.deepEqual(harmonicField(parseKey('F#m'), { minorMode: 'tonic' }).map((x) => x.degree), ['1m', '2°', 'b3', '4m', '5m', 'b6', 'b7']);
  assert.equal(harmonicField(parseKey('Em')).find((x) => x.tonic).chord, 'Em');
});

test('nomes de acordes ao transpor', () => {
  const label = (c, from, to, extra = {}) => {
    const chord = parseChord(c);
    const d = chordDegree(chord, parseKey(from));
    return chordLabel({ chord, deg: d, toKey: parseKey(to), transposed: from !== to, ...extra });
  };
  assert.equal(label('G7M', 'G', 'G'), 'G');
  assert.equal(label('G7M', 'G', 'G', { chordStyle: 'original' }), 'G7M');
  assert.equal(label('D/F#', 'G', 'A', { showBass: true }), 'E/G#');
  assert.equal(label('Em7', 'G', 'Bb'), 'Gm');
  assert.equal(label('Em7', 'G', 'Bb', { chordStyle: 'original' }), 'Gm7');
  assert.equal(label('F', 'G', 'A'), 'G');
  assert.equal(label('C#°', 'G', 'F'), 'B°');
  assert.equal(label('Bb', 'C', 'D'), 'C');
  assert.equal(label('B7', 'Em', 'Am'), 'E');
  assert.equal(label('F#m7(b5)', 'G', 'Eb'), 'D°');
});
