import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { parseCifra, prepareSource, convertLegacyBeats, setBeatsInSource, analyzeChordLine, isTabLine, parseHeader, isSectionName, shortSectionName } from '../public/js/music/parser.js';
import { buildChart, timeline } from '../public/js/music/chart.js';
import { degreeLabel } from '../public/js/music/keys.js';

const fx = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** Resumo legível de um bloco: "1 | 5 | 6m 4 ..." */
const rowText = (row) => row.bars.map((b) => b.items.map((it) => (it.cont ? '~' : '') + degreeLabel(it.ev.deg) + (it.beats !== 4 ? ':' + it.beats : '')).join(' ')).join(' | ') + (row.repeat > 1 ? ` x${row.repeat}` : '');

test('metadados do Cifra Club: título/artista grudados, tom com forma, capotraste, composição', () => {
  const p = parseCifra(fx('cifra-club.txt'));
  assert.equal(p.meta.title, 'Canção do Teste');
  assert.equal(p.meta.artist, 'Banda Exemplo');
  assert.equal(p.meta.keyHint, 'A');
  assert.equal(p.meta.writtenKeyHint, 'G');
  assert.equal(p.meta.capo, 2);
  assert.equal(p.meta.composer, 'Fulano de Tal');
});

test('variações de capotraste e tom', () => {
  const m = (t) => parseCifra(t + '\n[Intro] G D').meta;
  assert.equal(m('Capotraste na 3ª casa').capo, 3);
  assert.equal(m('Capo: 5').capo, 5);
  assert.equal(m('capo 1').capo, 1);
  assert.equal(m('Tom: Bbm').keyHint, 'Bbm');
  assert.equal(m('tom: F#').keyHint, 'F#');
  assert.equal(m('Título: Minha Música\nArtista: Eu').title, 'Minha Música');
  assert.equal(m('Minha Música - Eu Mesmo').artist, 'Eu Mesmo');
  assert.equal(m('BPM: 120').bpm, 120);
  assert.equal(m('Compasso: 3/4').timeSig, '3/4');
});

test('seções, tablatura e pares acorde/letra', () => {
  const p = parseCifra(fx('cifra-club.txt'));
  const names = p.sections.map((s) => s.name);
  assert.deepEqual(names, ['Intro', 'Tab - Intro', 'Primeira Parte', 'Refrão', 'Segunda Parte', 'Refrão', 'Final']);
  assert.equal(p.sections[1].kind, 'tab');
  const verse = p.sections[2];
  assert.equal(verse.lines.filter((l) => l.kind === 'pair').length, 4);
  assert.equal(verse.lines.find((l) => l.kind === 'pair').lyric.trim(), 'Hoje eu acordei cantando');
});

test('cabeçalhos de seção e o que NÃO é cabeçalho', () => {
  assert.equal(parseHeader('[Refrão]').name, 'Refrão');
  assert.equal(parseHeader('[Refrão] (2x)').repeat, 2);
  assert.equal(parseHeader('[Refrão 2x]').repeat, 2);
  assert.equal(parseHeader('Refrão:').name, 'Refrão');
  assert.equal(parseHeader('REFRÃO').name, 'REFRÃO');
  assert.equal(parseHeader('Intro: G D Em C').rest, 'G D Em C');
  assert.equal(parseHeader('Ponte com você eu vou'), null);
  assert.equal(parseHeader('Final de tarde no quintal'), null);
  assert.equal(parseHeader('[G]'), null);
  assert.ok(isSectionName('Pré-Refrão'));
  assert.ok(isSectionName('Refrão Final'));
  assert.ok(!isSectionName('Parte 1 de 4'));
  assert.equal(shortSectionName('Primeira Parte'), '1ª Parte');
  assert.equal(shortSectionName('Pré-Refrão'), 'Pré');
});

test('linhas de acordes x letra', () => {
  assert.ok(analyzeChordLine('G       D/F#    Em7   C7M(9)'));
  assert.ok(analyzeChordLine('C#°   D   E°  F#m'));
  assert.ok(analyzeChordLine('( A9  E  F#m7  D9 )'));
  assert.ok(analyzeChordLine('G  D  Em  C  (2x)'));
  assert.ok(analyzeChordLine('G - D - Em - C'));
  assert.ok(analyzeChordLine('| G | D Em | C . . D | % |'));
  assert.ok(analyzeChordLine('Riff: G D'));
  assert.ok(analyzeChordLine('G D Em C (repete 2x)'));
  assert.equal(analyzeChordLine('G D Em C (repete 2x)').repeat, 2);
  assert.equal(analyzeChordLine('E eu sei que vou'), null);
  assert.equal(analyzeChordLine('Em teu nome eu venci'), null);
  assert.equal(analyzeChordLine('A paz do Senhor'), null);
  assert.ok(isTabLine('E|-------3---2---|'));
  assert.ok(isTabLine('B|---3---3---2---1---|'));
  assert.ok(!isTabLine('G - D - Em - C'));
});

test('ChordPro vira acordes sobre a letra', () => {
  const src = prepareSource(fx('chordpro.txt'));
  const p = parseCifra(src);
  assert.equal(p.meta.title, 'Teste Pro');
  assert.equal(p.meta.artist, 'Alguém Pro');
  assert.equal(p.meta.bpm, 90);
  const pair = p.sections[0].lines.find((l) => l.kind === 'pair');
  assert.equal(pair.lyric, 'Linha um de teste agora');
  const cols = pair.chords.tokens.filter((t) => t.kind === 'chord').map((t) => [t.text, t.col]);
  assert.deepEqual(cols, [['D', 0], ['A', 6], ['Bm', 12], ['G', 19]]);
});

test('converte a marcação antiga de tempos Bm(4) -> Bm:4 sem desalinhar', () => {
  const old = 'G(2)  D(2)    Em(4)   C(9)\nLetra embaixo';
  const conv = convertLegacyBeats(old).split('\n')[0];
  assert.equal(conv, 'G:2   D:2     Em:4    C(9)');
  assert.equal(conv.indexOf('C(9)'), old.indexOf('C(9)'));
});

test('editar tempos no texto mantém a letra alinhada', () => {
  const src = 'G       D       Em\nLetra de teste aqui';
  const p = parseCifra(src);
  const tokens = p.sections[0].lines[0].chords.tokens.filter((t) => t.kind === 'chord');
  const d = tokens[1];
  let out = setBeatsInSource(src, [{ lineNo: 0, col: d.col, len: d.len }], 2);
  assert.equal(out.split('\n')[0], 'G       D:2     Em');
  // remove de novo
  const p2 = parseCifra(out);
  const d2 = p2.sections[0].lines[0].chords.tokens.filter((t) => t.kind === 'chord')[1];
  assert.equal(d2.beats, 2);
  out = setBeatsInSource(out, [{ lineNo: 0, col: d2.col, len: d2.len }], null);
  assert.equal(out.split('\n')[0], 'G       D       Em');
});

test('mapa: blocos únicos, forma e tom com capotraste', () => {
  const c = buildChart(fx('cifra-club.txt'));
  assert.equal(c.key.name, 'G');
  assert.equal(c.capo, 2);
  assert.deepEqual(c.form.map((f) => f.short), ['Intro', '1ª Parte', 'Refrão', '2ª Parte', 'Refrão', 'Final']);
  // 1ª e 2ª parte têm os mesmos acordes -> mesmo bloco
  assert.equal(c.form[1].blockId, c.form[3].blockId);
  assert.deepEqual(c.blocks[c.form[1].blockId].names, ['Primeira Parte', 'Segunda Parte']);
  const verse = c.blocks[c.form[1].blockId];
  assert.equal(verse.groups.length, 1);
  assert.equal(verse.groups[0].repeat, 2);
  assert.deepEqual(verse.groups[0].rows.map(rowText), ['1 | 5', '6m | 4']);
  assert.equal(c.blocks[0].groups[0].rows.map(rowText)[0], '1 | 5 | 6m | 4');
});

test('mapa: barras, pontos, tempos explícitos e repetições', () => {
  const c = buildChart(fx('bars.txt'));
  assert.equal(c.beatsPerBar, 4);
  assert.equal(c.meta.bpm, 72);
  const intro = c.blocks[0].groups[0].rows[0];
  assert.equal(rowText(intro), '1 | 5:2 6m:2 | 4:3 5:1 | 4:3 5:1');
  const verso = c.blocks[1].groups[0].rows.map(rowText);
  assert.deepEqual(verso, ['1:2 5:2 | 6m | 4', '1 | 5 | 4:2 5:2']);
  assert.equal(c.form.find((f) => f.short === 'Refrão').repeat, 2);
  const ponte = c.blocks[c.form.find((f) => f.short === 'Ponte').blockId];
  assert.equal(ponte.groups[0].rows[0].repeat, 2);
});

test('mapa: tom menor e modulação no último refrão', () => {
  const c = buildChart(fx('minor-mod.txt'));
  assert.equal(c.key.name, 'Am');
  const last = c.form[c.form.length - 1];
  assert.equal(last.key.name, 'Bm');
  assert.equal(last.modulation, 2);
  const block = c.blocks[last.blockId];
  assert.equal(rowText(block.groups[0].rows[0]), '4 | 5 | 6m x2');
});

test('tom informado pelo usuário tem prioridade', () => {
  const c = buildChart(fx('minor-mod.txt'), { key: 'C' });
  assert.equal(c.key.name, 'C');
  assert.equal(c.keyInfo.source, 'user');
});

test('compasso 3/4 e 6/8', () => {
  const c = buildChart('[Intro] G  D  Em  C', { timeSig: '3/4' });
  assert.equal(c.beatsPerBar, 3);
  assert.equal(c.blocks[0].groups[0].rows[0].bars.length, 4);
  assert.equal(buildChart('[Intro] G D', { timeSig: '6/8' }).beatsPerBar, 2);
});

test('acordes longos atravessam compassos', () => {
  const c = buildChart('[Intro] G:8 D:2 C:2');
  const row = c.blocks[0].groups[0].rows[0];
  assert.equal(rowText(row), '1 | ~1 | 5:2 4:2');
});

test('linha repetida (2x) e repetição isolada', () => {
  const c = buildChart('[Refrão]\nC   G\nlinha a (2x)\nD   Em\nlinha b');
  const rows = c.blocks[0].groups.flatMap((g) => g.rows);
  assert.equal(rows[0].repeat, 2);
  const c2 = buildChart('[Refrão]\nC   G\nlinha a\nD   Em\nlinha b (2x)');
  assert.equal(c2.blocks[0].groups[0].repeat, 2);
  assert.equal(c2.blocks[0].groups[0].rows.length, 2);
});

test('linha do tempo para tocar junto', () => {
  const c = buildChart('[Intro] G D\n[Refrão] (2x)\nC   G\nletra');
  const steps = timeline(c);
  assert.equal(steps.length, 2 + 2 * 2);
  assert.equal(steps.reduce((a, s) => a + s.beats, 0), 24);
});

test('texto vazio ou sem acordes não quebra', () => {
  const c = buildChart('');
  assert.equal(c.blocks.length, 0);
  const c2 = buildChart('Só uma letra\nsem nenhum acorde aqui\nnem aqui');
  assert.equal(c2.blocks.length, 0);
});

import { viewFrame, transitionHint, matchKeyTranspose, evLabel } from '../public/js/music/transition.js';

test('transposição e capotraste no quadro de exibição', () => {
  const c = buildChart(fx('cifra-club.txt')); // formas de G, capo 2 (soa A)
  const f0 = viewFrame(c);
  assert.equal(f0.soundingKey.name, 'A');
  assert.equal(f0.shapesKey.name, 'G');
  assert.equal(f0.transposed, false);
  const f1 = viewFrame(c, { capo: 0 }); // sem capo: tocar em A
  assert.equal(f1.shapesKey.name, 'A');
  const intro = c.blocks[0];
  assert.equal(evLabel(intro.groups[0].rows[0].events[0], intro.key, f1), 'A');
  const f2 = viewFrame(c, { transpose: 1, capo: 3 }); // soa Bb, capo 3, formas de G
  assert.equal(f2.soundingKey.name, 'Bb');
  assert.equal(f2.shapesKey.name, 'G');
});

test('dicas de virada no medley', () => {
  const a = buildChart('[Intro] G D Em C\n[Final] C D G');
  const b = buildChart('[Intro] Em C G D');
  const same = transitionHint(a, viewFrame(a), b, viewFrame(b));
  assert.equal(same.same, true);
  const c = buildChart('[Intro] A E F#m D');
  const up = transitionHint(a, viewFrame(a), c, viewFrame(c));
  assert.equal(up.same, false);
  assert.match(up.title, /G → A \(sobe 1 tom\)/);
  assert.deepEqual(up.chain, ['G', 'E', 'A']);
  // G -> C: G já é o 5 de C
  const d = buildChart('[Intro] C F G');
  const toC = transitionHint(a, viewFrame(a), d, viewFrame(d));
  assert.deepEqual(toC.chain, ['G', 'C']);
  assert.match(toC.detail, /já é o 5/);
  // igualar tons
  assert.equal(matchKeyTranspose(viewFrame(a).soundingKey, c, viewFrame(c)), -2);
});

test('seção com acordes e tablatura continua no mapa', () => {
  const c = buildChart('[Intro] G D Em C\n\nE|-------3---|\nB|---3-------|\nG|-----------|\n\n[Refrão]\nC   D\nletra');
  assert.deepEqual(c.form.map((f) => f.short), ['Intro', 'Refrão']);
});

import { partsEdges } from '../public/js/music/chart.js';

test('medley com partes escolhidas: virada usa a última parte escolhida', () => {
  const c = buildChart('[Intro] G D\n[Refrão]\nC   D\nletra\n[Final] Em C');
  assert.deepEqual(c.form.map((f) => f.short), ['Intro', 'Refrão', 'Final']);
  const all = partsEdges(c, null);
  assert.equal(all.first.ev.chord.raw, 'G');
  assert.equal(all.last.ev.chord.raw, 'C');
  const onlyChorus = partsEdges(c, [1]);
  assert.equal(onlyChorus.first.ev.chord.raw, 'C');
  assert.equal(onlyChorus.last.ev.chord.raw, 'D');
  // índices inválidos são ignorados
  assert.equal(partsEdges(c, [99]).last.ev.chord.raw, 'C');
});

test('partes com o mesmo nome aparecem uma vez só (mesmo com pequenas diferenças)', () => {
  const c = buildChart(fx('uma-por-linha.txt'));
  const names = c.blocks.map((b) => b.names.join(' · '));
  // cada nome aparece em um único bloco
  for (const n of ['Primeira Parte', 'Segunda Parte', 'Refrão', 'Terceira Parte']) {
    assert.equal(names.filter((x) => x.split(' · ').includes(n)).length, 1, n);
  }
  // a ordem da música continua completa
  assert.deepEqual(c.form.map((f) => f.short), ['Intro', '1ª Parte', '2ª Parte', 'Refrão', '1ª Parte', '2ª Parte', 'Refrão', '3ª Parte', 'Solo', '3ª Parte']);
  // a 1ª "Primeira Parte" é a mesma parte tocada 2 vezes; a 2ª, uma vez só: vira ×2 no chip
  assert.equal(c.form[1].repeat, 2);
  assert.equal(c.form[4].repeat, 1);
  assert.equal(c.form[4].variant, false);
  // desligando, volta a separar as versões diferentes
  const sep = buildChart(fx('uma-por-linha.txt'), { mergeByName: false });
  assert.ok(sep.blocks.length > c.blocks.length);
});

test('mesmo nome com acorde diferente: um bloco só, e "≈" na vez diferente', () => {
  const src = '[Refrão]\nC   D\nlinha a\nEm  C\nlinha b\n\n[Ponte]\nAm  D\nponte\n\n[Refrão]\nC   D\nlinha a\nEm  Bm\nlinha b';
  const c = buildChart(src);
  assert.equal(c.blocks.filter((b) => b.names.includes('Refrão')).length, 1);
  assert.deepEqual(c.form.map((f) => [f.short, f.variant]), [['Refrão', false], ['Ponte', false], ['Refrão', true]]);
});

test('mesma parte escrita com (2x) vira ×2 na forma, sem duplicar o bloco', () => {
  const src = '[Refrão]\nC   G\nlinha a\nD   Em\nlinha b\n\n[Ponte]\nAm  D\nponte\n\n[Refrão]\nC   G\nlinha a\nD   Em\nlinha b (2x)';
  const c = buildChart(src);
  assert.equal(c.blocks.filter((b) => b.names.includes('Refrão')).length, 1);
  const last = c.form[c.form.length - 1];
  assert.equal(last.short, 'Refrão');
  assert.equal(last.repeat, 2);
  assert.equal(last.variant, false);
});

test('mesmos acordes com nomes diferentes e repetições diferentes: um bloco, ×n em cada chip', () => {
  const c = buildChart(fx('cristo-like.txt'));
  const refrao = c.blocks.filter((b) => b.names.includes('Refrão'));
  assert.equal(refrao.length, 1);
  assert.deepEqual(refrao[0].names, ['Refrão', 'Refrão Final']);
  const chips = c.form.filter((f) => f.blockId === refrao[0].id).map((f) => `${f.short} x${f.repeat}`);
  assert.deepEqual(chips, ['Refrão x8', 'Refrão final x4']);
  // o bloco mostra a parte uma vez (as vezes ficam nos chips)
  assert.equal(refrao[0].groups[0].rows[0].repeat, 1);
});

import { renderChart } from '../public/js/ui/render.js';
import { viewFrame as vf } from '../public/js/music/transition.js';

test('compacto: cada estrofe (separada por linha em branco) começa numa linha nova', () => {
  const src = '[Refrão]\nC   D\nlinha a\nEm\nlinha b\n\nC   D\nlinha c\nG\nlinha d';
  const c = buildChart(src);
  const st = { density: 'compact', medleyDensity: 'compact', showForm: true, showField: false, degreeStyle: 'numbers', minorMode: 'relative', chordStyle: 'simple' };
  const html = renderChart(c, vf(c), st, { compact: true });
  assert.equal((html.match(/class="dline"/g) || []).length, 2);
  // sem a ordem da música quando escondida
  const clean = renderChart(c, vf(c), { ...st, showForm: false }, { compact: true });
  assert.ok(!clean.includes('formstrip'));
  assert.ok(html.includes('formstrip'));
});
