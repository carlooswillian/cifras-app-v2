// Transposição/capotraste por música e dicas de virada entre músicas de um medley.

import { chordLabel, keyPrefersFlats } from './keys.js';
import { transposeKey, describeInterval, mod12, keyFromPc, relativeMajor, pcName } from './notes.js';

/**
 * Estado de exibição de uma música.
 * - writtenKey: tom dos acordes escritos na cifra
 * - songCapo: capo escrito na cifra
 * - transpose: semitons a mais no tom que SOA (escolha do usuário)
 * - capo: capo que o usuário vai usar agora
 */
export function viewFrame(chart, { transpose = 0, capo = null } = {}) {
  const songCapo = chart.capo || 0;
  const useCapo = capo == null ? songCapo : capo;
  const offset = mod12(songCapo + transpose - useCapo);
  const shapesKey = transposeKey(chart.key, offset) || chart.key;
  const soundingKey = transposeKey(chart.key, songCapo + transpose) || chart.key;
  return { offset, transposed: offset !== 0, capo: useCapo, songCapo, transpose, shapesKey, soundingKey };
}

/** Nome do acorde de um evento do mapa no quadro de exibição. */
export function evLabel(ev, sectionKey, frame, opts = {}) {
  const toKey = transposeKey(sectionKey, frame.offset) || sectionKey;
  return chordLabel({ chord: ev.chord, deg: ev.deg, toKey, transposed: frame.transposed, chordStyle: opts.chordStyle, showBass: opts.showBass, minorMode: opts.minorMode });
}

function fieldPc(key) { return key.minor ? mod12(key.tonic.pc + 3) : key.tonic.pc; }

/**
 * Dica de virada entre a música A (terminando) e a música B (começando).
 * @returns {null | {same:boolean, title:string, detail:string, chain:string[], capoNote:string}}
 */
export function transitionHint(chartA, frameA, chartB, frameB, opts = {}) {
  if (!chartA.last || !chartB.first) return null;
  // tons que SOAM no fim de A e no começo de B
  const endKey = transposeKey(chartA.last.key, (frameA.songCapo || 0) + frameA.transpose);
  const startKey = transposeKey(chartB.first.key, (frameB.songCapo || 0) + frameB.transpose);
  // Com capos diferentes, as formas não se comparam: mostra os nomes reais (o que soa)
  const capoDiff = (frameA.capo || 0) !== (frameB.capo || 0);
  const fa = capoDiff ? { ...frameA, capo: 0, offset: mod12((frameA.songCapo || 0) + frameA.transpose), transposed: mod12((frameA.songCapo || 0) + frameA.transpose) !== 0 } : frameA;
  const fb = capoDiff ? { ...frameB, capo: 0, offset: mod12((frameB.songCapo || 0) + frameB.transpose), transposed: mod12((frameB.songCapo || 0) + frameB.transpose) !== 0 } : frameB;
  const lastA = evLabel(chartA.last.ev, chartA.last.key, fa, opts);
  const firstB = evLabel(chartB.first.ev, chartB.first.key, fb, opts);
  const capoNote = capoDiff ? `Capo: ${frameA.capo ? frameA.capo + 'ª' : 'sem'} → ${frameB.capo ? frameB.capo + 'ª' : 'sem'} (acordes da virada com o nome real, sem capo)` : '';

  if (fieldPc(endKey) === fieldPc(startKey)) {
    return {
      same: true,
      title: `Mesmo campo harmônico (${relativeMajor(endKey).name})`,
      detail: 'Pode emendar direto.',
      chain: [lastA, firstB],
      capoNote,
    };
  }
  // dominante (5) do novo tom, escrito nas formas da música A
  const startTonic = startKey.tonic.pc;
  const dominantSounding = mod12(startTonic + 7);
  const dominantShape = mod12(dominantSounding - (fa.capo || 0));
  const flats = keyPrefersFlats(keyFromPc(mod12(startTonic - (fa.capo || 0)), startKey.minor));
  const dom = pcName(dominantShape, flats);
  const lastSounding = mod12(chartA.last.ev.chord.root.pc + (frameA.songCapo || 0) + frameA.transpose);
  const lastIsDominant = lastSounding === dominantSounding && chartA.last.ev.chord.triad === 'maj';
  return {
    same: false,
    title: `Muda de tom: ${endKey.name} → ${startKey.name} (${describeInterval(fieldPc(startKey) - fieldPc(endKey))})`,
    detail: lastIsDominant ? 'O último acorde já é o 5 do novo tom: entre direto.' : `Use ${dom} (5 do novo tom) como ponte.`,
    chain: lastIsDominant ? [lastA, firstB] : [lastA, dom, firstB],
    capoNote,
  };
}

/** Transposição (em semitons) para levar o tom que soa de B ao mesmo campo de A. */
export function matchKeyTranspose(targetSoundingKey, chartB, frameB) {
  const current = transposeKey(chartB.key, (frameB.songCapo || 0));
  let d = mod12(fieldPc(targetSoundingKey) - fieldPc(current));
  if (d > 6) d -= 12;
  return d;
}
