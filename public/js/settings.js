// Preferências de exibição (ficam só neste aparelho).

const KEY = 'cifras.settings.v1';

export const DEFAULTS = {
  degreeStyle: 'numbers', // 'numbers' (1 4 5 6m) | 'roman' (I IV V VIm)
  primary: 'degrees',     // o que aparece em destaque no mapa: 'degrees' | 'names'
  chordStyle: 'simple',   // 'simple' (G, Em, F#°) | 'original' (como escrito)
  showBass: false,        // mostrar baixo invertido (D/F#)
  minorMode: 'relative',  // tom menor: graus pelo relativo maior (Em = 6m) | 'tonic' (Em = 1m)
  showCues: true,         // início da letra em cima de cada linha do mapa
  density: 'normal',      // mapa da música: 'normal' (detalhado) | 'compact'
  medleyDensity: 'compact', // mapa no medley: compacto por padrão (cabe mais, letra maior)
  showField: true,        // faixa do campo harmônico
  colorDegrees: true,     // cores por grau
  lyricChords: 'both',    // na letra: 'names' | 'degrees' | 'both'
  showTabs: false,        // tablaturas na letra
  theme: 'dark',
  wakeLock: true,
  clickSound: true,
};

let current = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function settings() { return current; }

export function setSetting(name, value) {
  current = { ...current, [name]: value };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* modo privado */ }
  applyTheme();
  listeners.forEach((fn) => fn(current, name));
}

export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function applyTheme() {
  document.documentElement.dataset.theme = current.theme === 'light' ? 'light' : 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = current.theme === 'light' ? '#ffffff' : '#0b0d12';
}

/** Estado de visualização por música (transposição/capo/visão) — também local. */
const VIEW_KEY = 'cifras.view.v1';
let views = {};
try { views = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); } catch { views = {}; }

export function songView(id) { return { mode: 'chart', transpose: 0, capo: null, ...(views[id] || {}) }; }
export function setSongView(id, patch) {
  views[id] = { ...songView(id), ...patch };
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(views)); } catch { /* */ }
}
