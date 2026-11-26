// Armazenamento local (IndexedDB) + sincronização com o servidor (Cloudflare D1).
// O app funciona offline: tudo é salvo no aparelho primeiro e enviado quando houver internet.

import { buildChart } from './music/chart.js';
import { viewFrame } from './music/transition.js';
import { degreeLabel } from './music/keys.js';
import { prepareSource } from './music/parser.js';

const DB_NAME = 'cifras';
const DB_VERSION = 1;
const PASS_KEY = 'cifras.pass';
const SYNC_KEY = 'cifras.lastSync';

let db = null;
const mem = { songs: new Map(), medleys: new Map() };
const listeners = new Set();
let syncState = { status: 'idle', message: '', at: 0 };

function idb() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('medleys')) d.createObjectStore('medleys', { keyPath: 'id' });
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return idb().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export async function init() {
  try {
    for (const store of ['songs', 'medleys']) {
      const all = await tx(store, 'readonly', (s) => s.getAll());
      for (const r of all || []) mem[store].set(r.id, r);
    }
  } catch (e) {
    console.warn('IndexedDB indisponível, usando só memória', e);
  }
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (what) => listeners.forEach((fn) => fn(what));

// ---------------------------------------------------------------------------
// Músicas

/** Campos derivados usados na lista (tom, primeiros graus). */
export function songInfo(song) {
  try {
    const chart = buildChart(song.source || '', { key: song.key, timeSig: song.timeSig, capo: song.capo });
    const frame = viewFrame(chart);
    const first = chart.blocks.slice(0, 2).flatMap((b) => b.groups[0].rows[0].events.slice(0, 4).map((e) => degreeLabel(e.deg))).slice(0, 6);
    return {
      writtenKey: chart.key.name,
      soundingKey: frame.soundingKey.name,
      prog: first.join(' '),
      bars: chart.totalBars,
      sections: chart.form.length,
    };
  } catch (e) {
    console.warn('songInfo', e);
    return { writtenKey: '', soundingKey: '', prog: '', bars: 0, sections: 0 };
  }
}

export function listSongs() {
  return [...mem.songs.values()].filter((s) => !s.deleted);
}

export function getSong(id) {
  const s = mem.songs.get(id);
  return s && !s.deleted ? s : null;
}

export async function saveSong(song) {
  const now = Date.now();
  const rec = {
    id: song.id,
    title: (song.title || '').trim() || 'Sem título',
    artist: (song.artist || '').trim(),
    source: prepareSource(song.source || ''),
    key: (song.key || '').trim(),
    capo: Number(song.capo) || 0,
    timeSig: song.timeSig || '4/4',
    bpm: Number(song.bpm) || 0,
    strum: (song.strum || '').trim(),
    notes: (song.notes || '').trim(),
    createdAt: song.createdAt || now,
    updatedAt: now,
    deleted: false,
  };
  rec.info = songInfo(rec);
  await put('songs', rec);
  return rec;
}

export async function deleteSong(id) {
  const s = mem.songs.get(id);
  if (!s) return;
  await put('songs', { id, deleted: true, updatedAt: Date.now(), title: s.title });
  // tira de medleys
  for (const m of listMedleys()) {
    if (m.items.some((it) => it.songId === id)) await saveMedley({ ...m, items: m.items.filter((it) => it.songId !== id) });
  }
}

// ---------------------------------------------------------------------------
// Medleys

export function listMedleys() {
  return [...mem.medleys.values()].filter((m) => !m.deleted);
}

export function getMedley(id) {
  const m = mem.medleys.get(id);
  return m && !m.deleted ? m : null;
}

export async function saveMedley(m) {
  const now = Date.now();
  const rec = {
    id: m.id,
    name: (m.name || '').trim() || 'Medley',
    items: (m.items || []).map((it) => ({ songId: it.songId, transpose: Number(it.transpose) || 0, capo: it.capo == null ? null : Number(it.capo) })),
    notes: m.notes || '',
    createdAt: m.createdAt || now,
    updatedAt: now,
    deleted: false,
  };
  await put('medleys', rec);
  return rec;
}

export async function deleteMedley(id) {
  await put('medleys', { id, deleted: true, updatedAt: Date.now() });
}

async function put(store, rec, { dirty = true, silent = false } = {}) {
  const r = { ...rec, _dirty: dirty ? 1 : 0 };
  mem[store].set(r.id, r);
  try { await tx(store, 'readwrite', (s) => s.put(r)); } catch (e) { console.warn('falha ao gravar no aparelho', e); }
  if (!silent) emit(store);
  if (dirty) scheduleSync();
}

// ---------------------------------------------------------------------------
// Backup (arquivo JSON)

export function exportAll() {
  const clean = (r) => { const { _dirty, ...rest } = r; return rest; };
  return JSON.stringify({ app: 'cifras', version: 1, exportedAt: new Date().toISOString(), songs: listSongs().map(clean), medleys: listMedleys().map(clean) }, null, 2);
}

export async function importAll(json, { replace = false } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || !Array.isArray(data.songs)) throw new Error('Arquivo de backup inválido.');
  let n = 0;
  for (const s of data.songs) {
    if (!s.id || s.deleted) continue;
    const existing = mem.songs.get(s.id);
    if (existing && !replace && existing.updatedAt >= (s.updatedAt || 0)) continue;
    const rec = { ...s, info: songInfo(s), updatedAt: Math.max(Date.now(), s.updatedAt || 0) };
    await put('songs', rec, { silent: true });
    n++;
  }
  for (const m of data.medleys || []) {
    if (!m.id || m.deleted) continue;
    await put('medleys', { ...m, updatedAt: Math.max(Date.now(), m.updatedAt || 0) }, { silent: true });
  }
  emit('songs'); emit('medleys');
  return n;
}

// ---------------------------------------------------------------------------
// Sincronização

export function getPassword() { try { return localStorage.getItem(PASS_KEY) || ''; } catch { return ''; } }
export function setPassword(p) {
  try {
    if (p) localStorage.setItem(PASS_KEY, p); else localStorage.removeItem(PASS_KEY);
    localStorage.removeItem(SYNC_KEY);
  } catch { /* */ }
  // ao trocar de conta/senha, reenviar tudo
  for (const store of ['songs', 'medleys']) for (const r of mem[store].values()) r._dirty = 1;
  scheduleSync(50);
}
export function syncStatus() { return syncState; }
function setSync(status, message = '') { syncState = { status, message, at: Date.now() }; emit('sync'); }

let syncTimer = null;
let syncing = null;
export function scheduleSync(ms = 1200) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { sync().catch(() => {}); }, ms);
}

/** Envia alterações locais e recebe as do servidor (um único pedido). */
export async function sync({ force = false } = {}) {
  const pass = getPassword();
  if (!pass) { setSync('off', 'Sem senha: dados só neste aparelho'); return { skipped: true }; }
  if (!navigator.onLine) { setSync('offline', 'Sem internet: alterações guardadas no aparelho'); return { skipped: true }; }
  if (syncing) return syncing;
  syncing = (async () => {
    setSync('busy', 'Sincronizando…');
    const since = force ? 0 : Number(localStorage.getItem(SYNC_KEY) || 0);
    const strip = (r) => { const { _dirty, ...rest } = r; return rest; };
    const dirtySongs = [...mem.songs.values()].filter((r) => r._dirty).map(strip);
    const dirtyMedleys = [...mem.medleys.values()].filter((r) => r._dirty).map(strip);
    const sentAt = new Map([...dirtySongs, ...dirtyMedleys].map((r) => [r.id, r.updatedAt]));
    let res;
    try {
      const r = await fetch('api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pass },
        body: JSON.stringify({ since, songs: dirtySongs, medleys: dirtyMedleys }),
      });
      if (r.status === 401) throw Object.assign(new Error('Senha incorreta'), { auth: true });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Erro ${r.status}`);
      res = await r.json();
    } catch (e) {
      setSync('err', e.auth ? 'Senha incorreta — confira em Ajustes' : 'Não foi possível sincronizar (' + e.message + ')');
      throw e;
    }
    let changed = false;
    for (const store of ['songs', 'medleys']) {
      for (const remote of res[store] || []) {
        const local = mem[store].get(remote.id);
        if (local && local._dirty && local.updatedAt > remote.updatedAt) continue; // local é mais novo
        const rec = { ...remote, _dirty: 0 };
        if (store === 'songs' && !rec.deleted && !rec.info) rec.info = songInfo(rec);
        mem[store].set(rec.id, rec);
        try { await tx(store, 'readwrite', (s) => s.put(rec)); } catch { /* */ }
        changed = true;
      }
      // marca como enviados (se não mudaram durante o envio)
      for (const r of mem[store].values()) {
        if (r._dirty && sentAt.get(r.id) === r.updatedAt) {
          r._dirty = 0;
          try { await tx(store, 'readwrite', (s) => s.put(r)); } catch { /* */ }
        }
      }
    }
    localStorage.setItem(SYNC_KEY, String(res.now || Date.now()));
    setSync('ok', 'Sincronizado');
    if (changed) { emit('songs'); emit('medleys'); }
    return { ok: true, received: (res.songs || []).length + (res.medleys || []).length };
  })();
  try { return await syncing; } finally { syncing = null; }
}

/** Testa a senha no servidor. */
export async function checkServer(pass) {
  const r = await fetch('api/health', { headers: pass ? { Authorization: 'Bearer ' + pass } : {} });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}

window.addEventListener('online', () => scheduleSync(300));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(500); });
