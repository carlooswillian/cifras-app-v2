// Importa as músicas da versão antiga (Google Apps Script + Planilha).
// Roda no navegador do usuário: o Apps Script aceita chamadas diretas do navegador.

import { convertLegacyBeats } from './music/parser.js';

export const OLD_API_URL = 'https://script.google.com/macros/s/AKfycbzcvekR4cwaP3FsqkTA3RGguWlZ_Ks8fECJZfT7-XNgDv-kCW4Hallb9IuJiAwZOSgx/exec';

async function call(url, action, data = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, ...data }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Erro na API antiga');
  return j.data;
}

/** Converte um registro antigo para o formato novo (tom antigo = tom que soa). */
export function convertOldSong(old) {
  const capo = parseInt(old.capotrasteSugerido, 10) || 0;
  let source = convertLegacyBeats(String(old.cifraOriginal || ''));
  const header = [];
  if (old.tomOriginal) header.push('Tom: ' + String(old.tomOriginal).trim());
  if (capo) header.push('Capo: ' + capo);
  if (header.length) source = header.join('\n') + '\n\n' + source;
  return {
    title: old.titulo || '',
    artist: old.artista || '',
    source,
    key: '',
    capo,
    timeSig: /^\d{1,2}\/\d{1,2}$/.test(String(old.compasso || '').trim()) ? String(old.compasso).trim() : '4/4',
    bpm: parseInt(old.bpm, 10) || 0,
    notes: old.observacoes || '',
    legacyId: old.id,
  };
}

/**
 * Busca todas as músicas antigas.
 * @param {(done:number,total:number)=>void} onProgress
 */
export async function fetchOldSongs(url = OLD_API_URL, onProgress = () => {}) {
  const list = await call(url, 'listSongs', { query: '' });
  const out = [];
  let done = 0;
  const queue = [...list];
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        const full = item.cifraOriginal ? item : await call(url, 'getSong', { id: item.id });
        out.push(full);
      } catch (e) {
        console.warn('falha ao buscar', item, e);
      }
      onProgress(++done, list.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}
