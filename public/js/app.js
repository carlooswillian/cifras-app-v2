// Cifras — interface principal (telas e navegação).

import * as store from './store.js';
import { settings, setSetting, onSettings, applyTheme, songView, setSongView, DEFAULTS } from './settings.js';
import { buildChart } from './music/chart.js';
import { parseCifra, setBeatsInSource, fmtBeats } from './music/parser.js';
import { viewFrame, transitionHint, matchKeyTranspose } from './music/transition.js';
import { transposeKey, parseKey } from './music/notes.js';
import { renderChart, renderLyrics, eventIndex, chartMinColEm } from './ui/render.js';
import { fitToBox } from './ui/fit.js';
import { Player, tapTempo } from './ui/player.js';
import { $, $$, esc, toast, modal, confirmBox, popover, uid, debounce, download } from './ui/dom.js';
import { fetchOldSongs, convertOldSong, OLD_API_URL } from './legacy.js';

export const VERSION = '3.0.0';
const main = $('#main');
let cleanups = [];
const onLeave = (fn) => cleanups.push(fn);

// ---------------------------------------------------------------------------
// Topo, navegação e utilidades de tela

function setTop({ left = '', title = '', sub = '', right = '' }) {
  $('#tbLeft').innerHTML = left;
  $('#tbTitle').innerHTML = title ? `<div class="t1">${title}</div>${sub ? `<div class="t2">${sub}</div>` : ''}` : '';
  $('#tbRight').innerHTML = right;
}

const backBtn = (href = '#/') => `<a class="btn icon ghost" href="${href}" aria-label="Voltar">←</a>`;
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

function syncDot() {
  const s = store.syncStatus();
  const cls = { ok: 'ok', busy: 'busy', err: 'err' }[s.status] || '';
  return `<a class="btn icon ghost" href="#/ajustes" title="${esc(s.message || 'Ajustes')}" aria-label="Ajustes"><span class="sync-dot ${cls}"></span></a>`;
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && settings().wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
let wantAwake = false;
document.addEventListener('visibilitychange', () => { if (wantAwake) keepAwake(true); });

function toggleFullscreen() {
  const d = document;
  const el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else if (el.requestFullscreen) el.requestFullscreen().catch(() => toast('Tela cheia não suportada aqui. Dica: adicione o app à tela inicial.'));
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else toast('Dica: use "Adicionar à tela de início" para abrir em tela cheia.');
}

// ---------------------------------------------------------------------------
// Roteador

function route() {
  cleanups.forEach((fn) => { try { fn(); } catch { /* */ } });
  cleanups = [];
  wantAwake = false;
  keepAwake(false);
  main.className = 'main';
  main.scrollTop = 0;
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b, c] = h.split('/').map(decodeURIComponent);
  try {
    if (!a) return libraryView('songs');
    if (a === 'medleys') return libraryView('medleys');
    if (a === 'nova') return editorView(null);
    if (a === 'ajustes') return settingsView();
    if (a === 's' && b && c === 'editar') return editorView(b);
    if (a === 's' && b) return songScreen(b);
    if (a === 'm' && b) return medleyScreen(b);
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="empty"><div class="big">⚠️</div>Algo deu errado: ${esc(e.message)}<br><br><a class="btn" href="#/">Voltar</a></div>`;
    return;
  }
  libraryView('songs');
}

// ---------------------------------------------------------------------------
// Biblioteca

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let libState = { q: '', sort: 'title', select: false, selected: [] };

function libraryView(tab) {
  setTop({
    left: `<div class="brand"><span class="logo">♪</span><span class="hide-sm">Cifras</span></div>`,
    right: `${syncDot()}`,
  });
  let songs = [];
  let medleys = [];

  const draw = () => {
    songs = store.listSongs();
    medleys = store.listMedleys();
    const active = document.activeElement && document.activeElement.id === 'q' ? document.activeElement.selectionStart : null;
    const q = norm(libState.q);
    let html = `<div class="lib">
      <div class="tabs">
        <a class="btn ${tab === 'songs' ? 'on' : ''}" href="#/">Músicas <span class="chip">${songs.length}</span></a>
        <a class="btn ${tab === 'medleys' ? 'on' : ''}" href="#/medleys">Medleys <span class="chip">${medleys.length}</span></a>
      </div>`;
    if (tab === 'songs') {
      let list = songs.filter((s) => !q || norm(`${s.title} ${s.artist} ${s.info?.soundingKey || ''} ${s.info?.writtenKey || ''}`).includes(q));
      list.sort(libState.sort === 'recent' ? (x, y) => y.updatedAt - x.updatedAt : libState.sort === 'artist' ? (x, y) => norm(x.artist).localeCompare(norm(y.artist)) || norm(x.title).localeCompare(norm(y.title)) : (x, y) => norm(x.title).localeCompare(norm(y.title)));
      html += `<div class="lib-tools">
        <div class="search"><input id="q" type="search" placeholder="Buscar música, artista ou tom…" value="${esc(libState.q)}" autocomplete="off"></div>
        <select id="sort" style="width:auto">
          <option value="title" ${libState.sort === 'title' ? 'selected' : ''}>A–Z</option>
          <option value="artist" ${libState.sort === 'artist' ? 'selected' : ''}>Artista</option>
          <option value="recent" ${libState.sort === 'recent' ? 'selected' : ''}>Recentes</option>
        </select>
        <button class="btn ${libState.select ? 'on' : ''}" id="selMode" title="Escolher músicas para ver lado a lado">⧉ Lado a lado</button>
      </div>`;
      if (!songs.length) {
        html += `<div class="empty"><div class="big">🎸</div><b>Seu songbook está vazio.</b><p>Cole uma cifra (do Cifra Club, por exemplo) e o app monta o mapa com graus e tempos.</p>
          <p><a class="btn primary" href="#/nova">＋ Nova cifra</a> <a class="btn" href="#/ajustes">Importar da versão antiga</a></p></div>`;
      } else if (!list.length) {
        html += `<div class="empty">Nada encontrado para "${esc(libState.q)}".</div>`;
      } else {
        html += `<div class="lib-grid">${list.map((s) => {
          const sel = libState.selected.includes(s.id);
          const info = s.info || {};
          const capo = s.capo ? ` · capo ${s.capo}` : '';
          return `<button class="card ${sel ? 'sel' : ''}" data-id="${esc(s.id)}">
            ${libState.select ? `<span class="tick">${sel ? libState.selected.indexOf(s.id) + 1 : ''}</span>` : ''}
            <span class="c-title">${esc(s.title)}</span>
            <span class="c-sub">${esc(s.artist || '—')}</span>
            <span class="c-meta">${info.soundingKey ? `<span class="chip">Tom <b>${esc(info.soundingKey)}</b>${esc(capo)}</span>` : ''}${s.bpm ? `<span class="chip">${s.bpm} bpm</span>` : ''}${s.timeSig && s.timeSig !== '4/4' ? `<span class="chip">${esc(s.timeSig)}</span>` : ''}</span>
            ${info.prog ? `<span class="c-prog">${esc(info.prog)}</span>` : ''}
          </button>`;
        }).join('')}</div>`;
      }
      html += libState.select
        ? `<div class="fab-bar"><button class="btn" id="selCancel">Cancelar</button><button class="btn primary" id="selOpen" ${libState.selected.length < 1 ? 'disabled' : ''}>Abrir ${libState.selected.length || ''} lado a lado</button></div>`
        : `<div class="fab-bar"><a class="btn primary" href="#/nova">＋ Nova cifra</a><a class="btn" href="#/medleys">Medleys</a></div>`;
    } else {
      html += medleys.length
        ? `<div class="lib-grid">${medleys.sort((x, y) => y.updatedAt - x.updatedAt).map((m) => {
          const names = m.items.map((it) => store.getSong(it.songId)?.title).filter(Boolean);
          return `<button class="card" data-mid="${esc(m.id)}"><span class="c-title">${esc(m.name)}</span><span class="c-sub">${names.length} música${names.length === 1 ? '' : 's'}</span><span class="c-prog">${esc(names.join(' → '))}</span></button>`;
        }).join('')}</div>`
        : `<div class="empty"><div class="big">🔗</div><b>Nenhum medley ainda.</b><p>Monte um medley para ver várias cifras lado a lado, com a dica de virada entre elas.</p></div>`;
      html += `<div class="fab-bar"><button class="btn primary" id="newMedley">＋ Novo medley</button><a class="btn" href="#/">Músicas</a></div>`;
    }
    html += '</div>';
    main.innerHTML = html;
    bind();
    if (active != null) { const nq = $('#q'); if (nq) { nq.focus(); nq.setSelectionRange(active, active); } }
  };

  const bind = () => {
    const q = $('#q');
    if (q) {
      q.oninput = debounce(() => { libState.q = q.value; draw(); }, 120);
    }
    const sort = $('#sort');
    if (sort) sort.onchange = () => { libState.sort = sort.value; draw(); };
    const sm = $('#selMode');
    if (sm) sm.onclick = () => { libState.select = !libState.select; libState.selected = []; draw(); };
    $$('[data-id]', main).forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.id;
        if (libState.select) {
          const i = libState.selected.indexOf(id);
          if (i >= 0) libState.selected.splice(i, 1); else libState.selected.push(id);
          draw();
        } else go('#/s/' + encodeURIComponent(id));
      };
    });
    $$('[data-mid]', main).forEach((el) => { el.onclick = () => go('#/m/' + encodeURIComponent(el.dataset.mid)); });
    const sc = $('#selCancel');
    if (sc) sc.onclick = () => { libState.select = false; libState.selected = []; draw(); };
    const so = $('#selOpen');
    if (so) so.onclick = async () => {
      const ids = [...libState.selected];
      libState.select = false; libState.selected = [];
      const m = await store.saveMedley({ id: uid(), name: 'Medley ' + new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), items: ids.map((songId) => ({ songId })) });
      go('#/m/' + encodeURIComponent(m.id));
    };
    const nm = $('#newMedley');
    if (nm) nm.onclick = () => pickSongs({ title: 'Novo medley', onDone: async (ids, name) => {
      const m = await store.saveMedley({ id: uid(), name: name || 'Medley', items: ids.map((songId) => ({ songId })) });
      go('#/m/' + encodeURIComponent(m.id));
    }, askName: true });
  };

  draw();
  // um único "ouvinte" por tela (antes ele se multiplicava a cada atualização)
  onLeave(store.onChange((what) => { if (what === 'sync') { $('#tbRight').innerHTML = syncDot(); return; } draw(); }));
}

/** Modal para escolher músicas (ordem = ordem dos toques). */
function pickSongs({ title, onDone, askName = false, exclude = [] }) {
  const songs = store.listSongs().filter((s) => !exclude.includes(s.id)).sort((a, b) => norm(a.title).localeCompare(norm(b.title)));
  const chosen = [];
  const body = `${askName ? `<div class="field" style="margin-bottom:10px"><label>Nome do medley</label><input type="text" id="mName" placeholder="Ex.: Abertura do culto"></div>` : ''}
    <input type="search" id="pq" placeholder="Buscar…" style="margin-bottom:8px">
    <div class="pick-list" id="plist"></div>`;
  modal({
    title, body, wide: false,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Pronto', cls: 'primary', handler: (dlg) => { if (!chosen.length) { toast('Escolha pelo menos uma música'); return false; } onDone([...chosen], askName ? dlg.querySelector('#mName').value : ''); return true; } }],
    onOpen: (dlg) => {
      const list = dlg.querySelector('#plist');
      const pq = dlg.querySelector('#pq');
      const draw = () => {
        const q = norm(pq.value);
        list.innerHTML = songs.filter((s) => !q || norm(s.title + ' ' + s.artist).includes(q)).map((s) => {
          const n = chosen.indexOf(s.id);
          return `<button class="pick ${n >= 0 ? 'sel' : ''}" data-id="${esc(s.id)}"><span class="pt"><b>${esc(s.title)}</b><small>${esc(s.artist || '')} ${s.info?.soundingKey ? '· ' + esc(s.info.soundingKey) : ''}</small></span><span class="chip">${n >= 0 ? n + 1 : '+'}</span></button>`;
        }).join('') || '<div class="empty">Nenhuma música.</div>';
        list.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => { const i = chosen.indexOf(b.dataset.id); if (i >= 0) chosen.splice(i, 1); else chosen.push(b.dataset.id); draw(); }; });
      };
      pq.oninput = draw;
      draw();
    },
  });
}

// ---------------------------------------------------------------------------
// Tela da música (palco)

function chartFor(song, st = settings()) {
  return buildChart(song.source || '', { key: song.key, timeSig: song.timeSig, capo: song.capo, minorMode: st.minorMode, showBass: st.showBass });
}

function songScreen(id) {
  const song = store.getSong(id);
  if (!song) { main.innerHTML = `<div class="empty"><div class="big">🔍</div>Música não encontrada.<br><br><a class="btn" href="#/">Voltar</a></div>`; setTop({ left: backBtn() }); return; }
  main.className = 'main stage';
  wantAwake = true; keepAwake(true);
  let view = songView(id);
  let st = settings();
  let chart = chartFor(song, st);
  let editing = false;
  let player = null;
  const tap = tapTempo();

  setTop({
    left: backBtn('#/'),
    title: esc(song.title),
    sub: esc([song.artist, song.notes].filter(Boolean).join(' · ')),
    right: `<button class="btn icon ghost" id="addMedley" title="Adicionar a um medley">⧉</button><a class="btn icon ghost" href="#/s/${encodeURIComponent(id)}/editar" title="Editar cifra">✎</a>`,
  });

  const frameNow = () => viewFrame(chart, { transpose: view.transpose, capo: view.capo });

  const draw = () => {
    const frame = frameNow();
    const bpm = player ? player.bpm : (song.bpm || 0);
    const capoTxt = frame.capo ? `${frame.capo}ª` : 'sem';
    main.innerHTML = `<div class="stage-wrap">
      <div class="stagebar">
        <div class="segctl"><button data-mode="chart" class="${view.mode === 'chart' ? 'on' : ''}">Mapa</button><button data-mode="lyrics" class="${view.mode === 'lyrics' ? 'on' : ''}">Letra</button></div>
        <div class="stepper" title="Tom (o que soa)"><button data-t="-1" aria-label="Descer meio tom">−</button><span class="val">${esc(frame.soundingKey.name)}<small>tom</small></span><button data-t="1" aria-label="Subir meio tom">＋</button></div>
        <div class="stepper" title="Capotraste"><button data-c="-1" aria-label="Capo -">−</button><span class="val">${capoTxt}<small>capo${frame.capo ? ' · ' + esc(frame.shapesKey.name) : ''}</small></span><button data-c="1" aria-label="Capo +">＋</button></div>
        ${view.transpose || (view.capo != null && view.capo !== (song.capo || 0)) ? '<button class="btn sm ghost" id="resetT" title="Voltar ao tom original">↺</button>' : ''}
        ${view.mode === 'chart' ? `<button class="btn sm ${editing ? 'on' : ''}" id="rhythm" title="Tocar num acorde para mudar quantos tempos ele dura">⏱ Tempos</button>` : ''}
        <div class="player">
          ${view.mode === 'chart' ? `<button class="btn sm ${player && player.playing ? 'on' : ''}" id="play" title="Tocar junto (percorre o mapa no andamento)">${player && player.playing ? '■' : '▶'}</button>` : ''}
          <button class="btn sm ghost" id="bpm" title="Toque no ritmo para marcar o andamento">${bpm ? bpm + ' bpm' : '♩ bpm'}</button>
          <span class="count" id="count"></span>
        </div>
        <span class="grow"></span>
        <span class="info-strip hide-sm">${chart.beatsPerBar !== 4 || song.timeSig !== '4/4' ? `<span class="chip">${esc(song.timeSig)}</span>` : ''}${song.strum ? `<span class="chip" title="Batida">${esc(song.strum)}</span>` : ''}</span>
        <button class="btn sm icon ghost" id="display" title="Exibição">Aa</button>
        <button class="btn sm icon ghost" id="fs" title="Tela cheia">⛶</button>
      </div>
      <div class="stage-body" id="body">${view.mode === 'chart' ? renderChart(chart, frame, st, { editing }) : renderLyrics(chart, frame, st)}</div>
    </div>`;
    bindStage();
    fitNow();
  };

  const fitNow = () => {
    const el = $('#body > .chart, #body > .lyrics');
    if (el) fitToBox(el, view.mode === 'chart' ? { min: 11, max: 46, colSel: '.blocks', minColPx: 230, minColEm: chartMinColEm(chart) } : { min: 13, max: 34, minColPx: 300, minColEm: 17, gapEm: 2, padEm: 1.8 });
  };

  const rebuild = () => { st = settings(); chart = chartFor(song, st); if (player) { player.stop(false); player = null; } draw(); };

  const bindStage = () => {
    $$('[data-mode]').forEach((b) => { b.onclick = () => { view.mode = b.dataset.mode; setSongView(id, { mode: view.mode }); editing = false; if (player) { player.stop(false); player = null; } draw(); }; });
    $$('[data-t]').forEach((b) => { b.onclick = () => { view.transpose = ((view.transpose + Number(b.dataset.t) + 18) % 12) - 6; setSongView(id, { transpose: view.transpose }); draw(); }; });
    $$('[data-c]').forEach((b) => { b.onclick = () => { const cur = view.capo == null ? (song.capo || 0) : view.capo; view.capo = Math.max(0, Math.min(11, cur + Number(b.dataset.c))); setSongView(id, { capo: view.capo }); draw(); }; });
    const rt = $('#resetT'); if (rt) rt.onclick = () => { view.transpose = 0; view.capo = null; setSongView(id, { transpose: 0, capo: null }); draw(); };
    const rh = $('#rhythm'); if (rh) rh.onclick = () => { editing = !editing; if (editing) toast('Toque num acorde para escolher quantos tempos ele dura'); draw(); };
    const fs = $('#fs'); if (fs) fs.onclick = toggleFullscreen;
    const dp = $('#display'); if (dp) dp.onclick = () => displayOptions(dp, () => rebuild());
    const bp = $('#bpm');
    if (bp) bp.onclick = () => {
      const v = tap();
      if (v >= 30 && v <= 260) {
        bp.textContent = v + ' bpm';
        if (player) player.setBpm(v);
        clearTimeout(bp._t);
        bp._t = setTimeout(async () => { if (v !== song.bpm) { Object.assign(song, await store.saveSong({ ...song, bpm: v })); toast(`Andamento salvo: ${v} bpm`, 'ok'); } }, 1600);
      } else bp.textContent = 'toque…';
    };
    const pl = $('#play');
    if (pl) pl.onclick = () => {
      if (player && player.playing) { player.stop(); player = null; draw(); return; }
      player = new Player({
        chart, bpm: song.bpm || 80, click: settings().clickSound,
        root: () => $('#body > .chart'),
        onTick: ({ beat, countIn, playing }) => { const c = $('#count'); if (c) c.textContent = playing ? (countIn ? `-${beat}` : beat) : ''; },
        onEnd: () => { player = null; draw(); },
      });
      if (!song.bpm) toast('Sem andamento salvo: usando 80 bpm. Toque no botão "bpm" no ritmo da música para ajustar.');
      editing = false;
      draw();
      player.start();
      $('#play').classList.add('on'); $('#play').textContent = '■';
    };
    const body = $('#body');
    if (editing && body) {
      const idx = eventIndex(chart);
      body.onclick = (e) => {
        const it = e.target.closest('.it');
        if (!it) return;
        const hit = idx.get(it.dataset.ev);
        if (!hit) return;
        rhythmPopover(it, hit, song, chart, async (newSource) => {
          Object.assign(song, await store.saveSong({ ...song, source: newSource }));
          chart = chartFor(song, settings());
          draw();
        });
      };
    }
  };

  const ro = new ResizeObserver(debounce(fitNow, 80));
  ro.observe(main);
  onLeave(() => ro.disconnect());
  onLeave(() => { if (player) player.stop(false); });
  onLeave(onSettings(() => rebuild()));
  const addM = $('#addMedley');
  addM.onclick = () => addToMedley(id);
  draw();
}

function durationOptions(bpb) {
  const set = new Set([1, 2, 3, bpb, bpb * 1.5, bpb * 2, bpb * 3, bpb * 4].filter((x) => Number.isInteger(x) && x > 0));
  return [...set].sort((a, b) => a - b).slice(0, 8);
}

function rhythmPopover(anchor, hit, song, chart, apply) {
  const { ev } = hit;
  const bpb = chart.beatsPerBar;
  const opts = durationOptions(bpb);
  const name = anchor.querySelector('.cn')?.textContent || ev.chord.raw;
  const sub = (n) => (n % bpb === 0 ? `${n / bpb} comp.` : n * 2 === bpb ? '½ comp.' : `${n} temp.`);
  const [b, g, r] = (anchor.dataset.pos || '').split('.').map(Number);
  const row = chart.blocks[b]?.groups[g]?.rows[r];
  popover(anchor, `<h4>${esc(name)} — quantos tempos?</h4>
    <div class="dur">${opts.map((n) => `<button class="btn ${Math.abs(ev.beats - n) < 1e-9 ? 'on' : ''}" data-n="${n}">${n}<small>${sub(n)}</small></button>`).join('')}</div>
    <div class="pfoot"><label style="display:flex;gap:6px;align-items:center;font-size:13.5px"><input type="checkbox" id="wholeRow"> linha inteira</label><button class="btn sm" data-n="">Padrão (1 compasso)</button></div>
    <div class="hint" style="font-size:12px;color:var(--muted);margin-top:6px">Na cifra fica anotado como <code>${esc(ev.chord.raw)}:2</code> (= 2 tempos). Vale para todas as vezes em que esse trecho aparece.</div>`,
  (pop, close) => {
    pop.querySelectorAll('[data-n]').forEach((btn) => {
      btn.onclick = () => {
        const n = btn.dataset.n === '' ? null : Number(btn.dataset.n);
        const whole = pop.querySelector('#wholeRow').checked && row;
        const locs = whole ? row.events.flatMap((e) => e.srcs) : ev.srcs;
        close();
        apply(setBeatsInSource(song.source, locs, n));
      };
    });
  });
}

function displayOptions(anchor, onChange) {
  const st = settings();
  const seg = (name, opts) => `<div class="segctl" data-set="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${st[name] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const sw = (name, label) => `<div class="opt"><span>${label}</span><button class="switch ${st[name] ? 'on' : ''}" data-sw="${name}" aria-label="${label}"></button></div>`;
  popover(anchor, `<h4>Exibição</h4>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${seg('primary', [['degrees', 'Graus em destaque'], ['names', 'Acordes em destaque']])}
      ${seg('degreeStyle', [['numbers', '1 4 5 6m'], ['roman', 'I IV V VIm']])}
      ${seg('lyricChords', [['both', 'Letra: ambos'], ['names', 'nomes'], ['degrees', 'graus']])}
      ${seg('chordStyle', [['simple', 'Acorde básico'], ['original', 'Como escrito']])}
    </div>
    ${sw('showBass', 'Mostrar baixo (D/F#)')}${sw('showCues', 'Início da letra no mapa')}${sw('showField', 'Campo harmônico')}${sw('colorDegrees', 'Cores por grau')}${sw('showTabs', 'Tablaturas na letra')}
    <div class="opt"><span>Tom menor</span>${seg('minorMode', [['relative', 'Em = 6m'], ['tonic', 'Em = 1m']])}</div>`,
  (pop) => {
    pop.querySelectorAll('[data-set] button').forEach((b) => { b.onclick = () => { const k = b.closest('[data-set]').dataset.set; setSetting(k, b.dataset.v); b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); onChange(); }; });
    pop.querySelectorAll('[data-sw]').forEach((b) => { b.onclick = () => { const k = b.dataset.sw; setSetting(k, !settings()[k]); b.classList.toggle('on', settings()[k]); onChange(); }; });
  });
}

async function addToMedley(songId) {
  const medleys = store.listMedleys().sort((a, b) => b.updatedAt - a.updatedAt);
  const body = `<div class="pick-list">${medleys.map((m) => `<button class="pick" data-mid="${esc(m.id)}"><span class="pt"><b>${esc(m.name)}</b><small>${m.items.length} música(s)</small></span><span class="chip">＋</span></button>`).join('')}
    <button class="pick" data-new="1"><span class="pt"><b>＋ Novo medley com esta música</b></span></button></div>`;
  modal({
    title: 'Adicionar a um medley', body, buttons: [],
    onOpen: (dlg, finish) => {
      dlg.querySelectorAll('[data-mid]').forEach((b) => { b.onclick = async () => { const m = store.getMedley(b.dataset.mid); await store.saveMedley({ ...m, items: [...m.items, { songId }] }); finish(true); go('#/m/' + encodeURIComponent(m.id)); }; });
      dlg.querySelector('[data-new]').onclick = async () => { const s = store.getSong(songId); const m = await store.saveMedley({ id: uid(), name: 'Medley: ' + (s?.title || ''), items: [{ songId }] }); finish(true); go('#/m/' + encodeURIComponent(m.id)); };
    },
  });
}

// ---------------------------------------------------------------------------
// Editor

const NOTATION_HELP = `<details class="help"><summary>Como escrever tempos e repetições (opcional)</summary>
  <ul>
    <li>Sem marcação, <b>cada acorde vale 1 compasso</b>. Para ajustar, use o botão <b>⏱ Tempos</b> na tela da música (é só tocar no acorde).</li>
    <li><code>Em:2</code> = Em por 2 tempos · <code>G:8</code> = 2 compassos.</li>
    <li>Barras: <code>| G | D Em | C . . D |</code> — acordes no mesmo compasso dividem o compasso; cada <code>.</code> é mais um tempo.</li>
    <li>Seções entre colchetes: <code>[Intro]</code>, <code>[Refrão]</code>, <code>[Refrão] (2x)</code>.</li>
    <li>Repetir uma linha: termine com <code>(2x)</code>. Mudança de tom no meio: linha <code>Tom: A</code> antes da seção.</li>
    <li>Também aceita ChordPro: <code>[G]Toda [D]terra</code>.</li>
  </ul></details>`;

function editorView(id) {
  const existing = id ? store.getSong(id) : null;
  if (id && !existing) { go('#/'); return; }
  const song = existing ? { ...existing } : { id: uid(), title: '', artist: '', source: '', key: '', capo: 0, timeSig: '4/4', bpm: 0, strum: '', notes: '' };
  const touched = new Set(existing ? ['title', 'artist', 'capo', 'bpm', 'timeSig'] : []);
  const tap = tapTempo();
  setTop({
    left: `<a class="btn ghost" href="${existing ? '#/s/' + encodeURIComponent(id) : '#/'}">Cancelar</a>`,
    title: existing ? 'Editar cifra' : 'Nova cifra',
    right: `<button class="btn primary" id="save">Salvar</button>`,
  });
  main.innerHTML = `<div class="editor">
    <div class="src">
      <div class="editor-actions">
        <button class="btn sm" id="paste">📋 Colar</button>
        <span class="detect" id="detect"></span>
      </div>
      <textarea class="cifra" id="src" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="Cole aqui a cifra inteira (com título, tom e seções), por exemplo:

Nome da Música
Artista
Tom: G

[Intro] G  D  Em  C

[Primeira Parte]
G             D
  Primeira linha da letra
Em            C
  Segunda linha da letra">${esc(song.source)}</textarea>
      ${NOTATION_HELP}
    </div>
    <div class="side">
      <div class="form-grid">
        <div class="field span2"><label for="fTitle">Título</label><input type="text" id="fTitle" value="${esc(song.title)}"></div>
        <div class="field span2"><label for="fArtist">Artista</label><input type="text" id="fArtist" value="${esc(song.artist)}"></div>
        <div class="field"><label for="fKey">Tom dos acordes</label><input type="text" id="fKey" value="${esc(song.key)}" placeholder="automático"><span class="hint" id="keyHint"></span></div>
        <div class="field"><label for="fCapo">Capotraste</label><input type="number" id="fCapo" min="0" max="11" value="${song.capo || ''}" placeholder="0"></div>
        <div class="field"><label for="fTime">Compasso</label><select id="fTime">${['4/4', '3/4', '2/4', '6/8', '12/8'].map((t) => `<option ${song.timeSig === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label for="fBpm">Andamento (bpm)</label><div style="display:flex;gap:6px"><input type="number" id="fBpm" min="30" max="260" value="${song.bpm || ''}" placeholder="—"><button class="btn sm" id="tap" title="Toque no ritmo">Tap</button></div></div>
        <div class="field span2"><label for="fStrum">Batida / ritmo (opcional)</label><input type="text" id="fStrum" value="${esc(song.strum)}" placeholder="Ex.: ↓ ↓↑ ↑↓↑">
          <div class="strum-keys">${['↓', '↑', '✕', '·', ' '].map((k) => `<button class="btn sm" data-k="${k}">${k === ' ' ? 'espaço' : k}</button>`).join('')}<button class="btn sm" data-k="⌫">⌫</button></div></div>
        <div class="field span2"><label for="fNotes">Observações</label><input type="text" id="fNotes" value="${esc(song.notes)}" placeholder="Ex.: versão ao vivo, dedilhado no início"></div>
      </div>
      <div class="preview" id="preview"></div>
      ${existing ? '<div class="editor-actions"><button class="btn danger" id="del">Excluir música</button></div>' : ''}
    </div>
  </div>`;

  const src = $('#src');
  const fields = { title: $('#fTitle'), artist: $('#fArtist'), key: $('#fKey'), capo: $('#fCapo'), timeSig: $('#fTime'), bpm: $('#fBpm'), strum: $('#fStrum'), notes: $('#fNotes') };
  Object.entries(fields).forEach(([k, el]) => el.addEventListener('input', () => { touched.add(k); refresh(); }));

  const collect = () => ({
    ...song,
    title: fields.title.value, artist: fields.artist.value, key: fields.key.value.trim(), capo: Number(fields.capo.value) || 0,
    timeSig: fields.timeSig.value, bpm: Number(fields.bpm.value) || 0, strum: fields.strum.value, notes: fields.notes.value, source: src.value,
  });

  const refresh = debounce(() => {
    const p = parseCifra(src.value);
    const m = p.meta;
    if (!touched.has('title') && m.title) fields.title.value = m.title;
    if (!touched.has('artist') && m.artist) fields.artist.value = m.artist;
    if (!touched.has('capo') && m.capo) fields.capo.value = m.capo;
    if (!touched.has('bpm') && m.bpm) fields.bpm.value = m.bpm;
    if (!touched.has('timeSig') && m.timeSig && [...fields.timeSig.options].some((o) => o.value === m.timeSig)) fields.timeSig.value = m.timeSig;
    if (!touched.has('strum') && m.strum) fields.strum.value = m.strum;
    const cur = collect();
    const st = settings();
    let chart;
    try { chart = buildChart(p, { key: cur.key, timeSig: cur.timeSig, capo: cur.capo, minorMode: st.minorMode, showBass: st.showBass }); } catch (e) { console.error(e); return; }
    const frame = viewFrame(chart);
    const k = chart.key.name;
    $('#keyHint').textContent = cur.key ? (parseKey(cur.key) ? '' : 'tom não reconhecido') : `detectado: ${k}${chart.capo ? ` (soa em ${frame.soundingKey.name})` : ''}`;
    const nSec = chart.form.length;
    $('#detect').innerHTML = chart.blocks.length
      ? `Tom <b>${esc(frame.soundingKey.name)}</b>${chart.capo ? ` (capo ${chart.capo}, formas de ${esc(k)})` : ''} · ${nSec} parte${nSec === 1 ? '' : 's'} · ${chart.totalBars} compassos`
      : (src.value.trim() ? 'Nenhum acorde reconhecido ainda.' : '');
    $('#preview').innerHTML = renderChart(chart, frame, st, { showField: false });
    const el = $('#preview .chart');
    if (el) fitToBox(el, { min: 9, max: 22, colSel: '.blocks', minColPx: 200, minColEm: chartMinColEm(chart) });
  }, 250);

  src.addEventListener('input', refresh);
  $('#paste').onclick = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) { toast('A área de transferência está vazia'); return; }
      src.value = t; refresh(); toast('Cifra colada', 'ok');
    } catch { src.focus(); toast('Toque e segure no campo e escolha "Colar"'); }
  };
  $('#tap').onclick = () => { const v = tap(); if (v >= 30 && v <= 260) { fields.bpm.value = v; touched.add('bpm'); } };
  $$('[data-k]').forEach((b) => { b.onclick = () => { const k = b.dataset.k; fields.strum.value = k === '⌫' ? fields.strum.value.slice(0, -1) : fields.strum.value + k; touched.add('strum'); }; });
  $('#save').onclick = async () => {
    const cur = collect();
    if (!cur.source.trim() && !cur.title.trim()) { toast('Cole a cifra antes de salvar', 'err'); return; }
    const saved = await store.saveSong(cur);
    toast('Salvo', 'ok');
    go('#/s/' + encodeURIComponent(saved.id));
  };
  const del = $('#del');
  if (del) del.onclick = async () => {
    if (await confirmBox('Excluir música', `Excluir "${song.title}" da sua biblioteca?`, 'Excluir', true)) {
      await store.deleteSong(song.id);
      toast('Música excluída');
      go('#/');
    }
  };
  refresh();
  if (!existing) setTimeout(() => src.focus(), 50);
}

// ---------------------------------------------------------------------------
// Medley (lado a lado)

function medleyScreen(id) {
  const medley = store.getMedley(id);
  if (!medley) { main.innerHTML = `<div class="empty">Medley não encontrado.<br><br><a class="btn" href="#/medleys">Voltar</a></div>`; setTop({ left: backBtn('#/medleys') }); return; }
  main.className = 'main stage';
  wantAwake = true; keepAwake(true);
  let st = settings();
  let mode = 'chart';
  const chartById = new Map(); // índice do item no medley -> mapa (para o ajuste de colunas)

  const items = () => medley.items.map((it, i) => ({ it, i, song: store.getSong(it.songId) })).filter((x) => x.song);

  const draw = () => {
    st = settings();
    const list = items();
    setTop({
      left: backBtn('#/medleys'),
      title: `<span id="mname">${esc(medley.name)}</span>`,
      sub: `${list.length} música${list.length === 1 ? '' : 's'} · toque no nome para renomear`,
      right: `<button class="btn sm" id="mList">☰ Lista</button><button class="btn sm hide-sm" id="mMatch" title="Leva todas para o tom da primeira">Igualar tons</button><button class="btn sm icon ghost" id="mDisp" title="Exibição">Aa</button><button class="btn sm icon ghost" id="mFs" title="Tela cheia">⛶</button>`,
    });
    const charts = list.map(({ song }) => chartFor(song, st));
    chartById.clear();
    list.forEach(({ i }, k) => chartById.set(String(i), charts[k]));
    const frames = list.map(({ it, song }, k) => viewFrame(charts[k], { transpose: it.transpose || 0, capo: it.capo }));
    const cols = list.map(({ it, i, song }, k) => {
      const chart = charts[k], frame = frames[k];
      const next = k + 1 < list.length ? k + 1 : -1;
      let vir = '';
      if (next >= 0) {
        const h = transitionHint(chart, frame, charts[next], frames[next], st);
        if (h) vir = `<div class="virada"><div class="vt">➜ ${esc(list[next].song.title)}: ${esc(h.title)}</div><div class="chain">${h.chain.map((c, ci) => `${ci ? '<span>→</span>' : ''}<b>${esc(c)}</b>`).join('')}<span class="vd">${esc(h.detail)}</span></div>${h.capoNote ? `<div class="vd">${esc(h.capoNote)}</div>` : ''}</div>`;
      }
      return `<div class="mcol" data-i="${i}">
        <div class="mcol-head">
          <div class="mh1"><span class="num">${k + 1}</span><a class="ttl" href="#/s/${encodeURIComponent(song.id)}" style="color:inherit;text-decoration:none">${esc(song.title)}</a><button class="btn sm icon ghost" data-rm="${i}" title="Tirar do medley">✕</button></div>
          <div class="ctl">
            <div class="stepper"><button data-mt="${i}" data-d="-1">−</button><span class="val">${esc(frame.soundingKey.name)}<small>tom</small></span><button data-mt="${i}" data-d="1">＋</button></div>
            <div class="stepper"><button data-mc="${i}" data-d="-1">−</button><span class="val">${frame.capo ? frame.capo + 'ª' : 'sem'}<small>capo${frame.capo ? ' · ' + esc(frame.shapesKey.name) : ''}</small></span><button data-mc="${i}" data-d="1">＋</button></div>
            ${song.bpm ? `<span class="chip">${song.bpm} bpm</span>` : ''}
          </div>
        </div>
        <div class="mcol-body">${mode === 'chart' ? renderChart(chart, frame, st, { compact: true }) : renderLyrics(chart, frame, st)}</div>
        ${vir}
      </div>`;
    }).join('');
    const n = Math.max(1, list.length);
    main.innerHTML = `<div class="stage-wrap">
      <div class="stagebar"><div class="segctl"><button data-mode="chart" class="${mode === 'chart' ? 'on' : ''}">Mapa</button><button data-mode="lyrics" class="${mode === 'lyrics' ? 'on' : ''}">Letra</button></div>
      <span class="grow"></span><button class="btn sm" id="mAdd">＋ Música</button></div>
      <div class="stage-body"><div class="medley" style="--mcol-w:${Math.max(280, Math.floor((main.clientWidth || window.innerWidth) / Math.min(n, 4)) - 1)}px">${cols || '<div class="empty" style="margin:auto">Medley vazio. Toque em "+ Música".</div>'}</div></div>
    </div>`;
    bind();
    fitAll();
  };

  const fitAll = () => { $$('.mcol-body > .chart, .mcol-body > .lyrics').forEach((el) => fitToBox(el, mode === 'chart' ? { min: 10, max: 30, colSel: '.blocks', maxCols: 2, minColPx: 170, minColEm: chartMinColEm(chartById.get(el.closest('.mcol').dataset.i) || { blocks: [], beatsPerBar: 4 }) } : { min: 11, max: 24, maxCols: 1 })); };

  const save = async () => { Object.assign(medley, await store.saveMedley(medley)); };

  const bind = () => {
    $$('[data-mode]').forEach((b) => { b.onclick = () => { mode = b.dataset.mode; draw(); }; });
    $$('[data-mt]').forEach((b) => { b.onclick = async () => { const it = medley.items[Number(b.dataset.mt)]; it.transpose = (((it.transpose || 0) + Number(b.dataset.d) + 18) % 12) - 6; await save(); draw(); }; });
    $$('[data-mc]').forEach((b) => {
      b.onclick = async () => {
        const it = medley.items[Number(b.dataset.mc)];
        const song = store.getSong(it.songId);
        const cur = it.capo == null ? (song?.capo || 0) : it.capo;
        it.capo = Math.max(0, Math.min(11, cur + Number(b.dataset.d)));
        await save(); draw();
      };
    });
    $$('[data-rm]').forEach((b) => { b.onclick = async () => { medley.items.splice(Number(b.dataset.rm), 1); await save(); draw(); }; });
    $('#mAdd').onclick = () => pickSongs({ title: 'Adicionar músicas', onDone: async (ids) => { medley.items.push(...ids.map((songId) => ({ songId }))); await save(); draw(); } });
    $('#mList').onclick = () => editMedleyList(medley, async () => { await save(); draw(); });
    $('#mMatch').onclick = async () => {
      const list = items();
      if (list.length < 2) return;
      const charts = list.map(({ song }) => chartFor(song, settings()));
      const f0 = viewFrame(charts[0], { transpose: list[0].it.transpose || 0, capo: list[0].it.capo });
      for (let k = 1; k < list.length; k++) {
        const f = viewFrame(charts[k], { transpose: 0, capo: list[k].it.capo });
        list[k].it.transpose = matchKeyTranspose(f0.soundingKey, charts[k], f);
      }
      await save(); draw();
      toast('Todas no campo harmônico de ' + f0.soundingKey.name, 'ok');
    };
    $('#mDisp').onclick = () => displayOptions($('#mDisp'), () => draw());
    $('#mFs').onclick = toggleFullscreen;
    $('#mname').onclick = async () => {
      const v = await modal({ title: 'Nome do medley', body: `<input type="text" id="nm" value="${esc(medley.name)}">`, buttons: [{ label: 'Excluir medley', cls: 'danger', value: 'del' }, { label: 'Cancelar', value: null }, { label: 'Salvar', cls: 'primary', handler: (dlg) => dlg.querySelector('#nm').value }] });
      if (v === 'del') {
        if (await confirmBox('Excluir medley', `Excluir "${medley.name}"? As músicas continuam na biblioteca.`, 'Excluir', true)) { await store.deleteMedley(medley.id); go('#/medleys'); }
      } else if (typeof v === 'string' && v.trim()) { medley.name = v.trim(); await save(); draw(); }
    };
  };

  const ro = new ResizeObserver(debounce(() => draw(), 120));
  ro.observe(main);
  onLeave(() => ro.disconnect());
  onLeave(onSettings(() => draw()));
  draw();
}

function editMedleyList(medley, onSave) {
  const render = (dlg) => {
    const box = dlg.querySelector('#ol');
    box.innerHTML = medley.items.map((it, i) => {
      const s = store.getSong(it.songId);
      return `<div class="pick"><span class="chip">${i + 1}</span><span class="pt"><b>${esc(s ? s.title : '(removida)')}</b><small>${esc(s?.artist || '')}</small></span>
        <button class="btn sm icon" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn sm icon" data-down="${i}" ${i === medley.items.length - 1 ? 'disabled' : ''}>↓</button><button class="btn sm icon danger" data-del="${i}">✕</button></div>`;
    }).join('') || '<div class="empty">Vazio.</div>';
    box.querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => { const i = Number(b.dataset.up); [medley.items[i - 1], medley.items[i]] = [medley.items[i], medley.items[i - 1]]; render(dlg); }; });
    box.querySelectorAll('[data-down]').forEach((b) => { b.onclick = () => { const i = Number(b.dataset.down); [medley.items[i + 1], medley.items[i]] = [medley.items[i], medley.items[i + 1]]; render(dlg); }; });
    box.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { medley.items.splice(Number(b.dataset.del), 1); render(dlg); }; });
  };
  modal({ title: 'Ordem do medley', body: '<div class="pick-list order-list" id="ol"></div>', buttons: [{ label: 'Pronto', cls: 'primary', value: true }], onOpen: (dlg) => render(dlg) }).then(() => onSave());
}

// ---------------------------------------------------------------------------
// Ajustes

function settingsView() {
  setTop({ left: backBtn('#/'), title: 'Ajustes', right: syncDot() });
  const st = settings();
  const s = store.syncStatus();
  const pass = store.getPassword();
  const seg = (name, opts) => `<div class="segctl" data-set="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${st[name] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const sw = (name, label, help = '') => `<div class="opt"><span class="ol">${label}${help ? `<small>${help}</small>` : ''}</span><button class="switch ${st[name] ? 'on' : ''}" data-sw="${name}" aria-label="${label}"></button></div>`;
  main.innerHTML = `<div class="settings">
    <div class="panel"><h2>Sincronização</h2>
      <p style="margin:0 0 8px;color:var(--muted)">Suas cifras ficam salvas neste aparelho e, com a senha, também na nuvem (Cloudflare) — assim aparecem no tablet e no celular.</p>
      <div class="opt"><span class="ol">Status<small id="syncMsg">${esc(s.message || (pass ? 'Aguardando' : 'Sem senha: só neste aparelho'))}</small></span><span class="sync-dot ${{ ok: 'ok', busy: 'busy', err: 'err' }[s.status] || ''}"></span></div>
      <div class="field" style="margin-top:8px"><label for="pass">Senha do seu songbook</label><input type="password" id="pass" value="${esc(pass)}" placeholder="A senha configurada na Cloudflare" autocomplete="current-password"></div>
      <div class="row-actions"><button class="btn primary" id="savePass">Salvar senha e sincronizar</button><button class="btn" id="syncNow">Sincronizar agora</button>${pass ? '<button class="btn ghost" id="forget">Esquecer senha</button>' : ''}</div>
    </div>
    <div class="panel"><h2>Exibição</h2>
      <div class="opt"><span class="ol">Destaque no mapa</span>${seg('primary', [['degrees', 'Graus'], ['names', 'Acordes']])}</div>
      <div class="opt"><span class="ol">Estilo dos graus</span>${seg('degreeStyle', [['numbers', '1 4 5 6m'], ['roman', 'I IV V VIm']])}</div>
      <div class="opt"><span class="ol">Acordes<small>"Básico" mostra só maior/menor/diminuto</small></span>${seg('chordStyle', [['simple', 'Básico'], ['original', 'Como escrito']])}</div>
      <div class="opt"><span class="ol">Tom menor<small>Relativo: Em vira 6m (mesmos números do tom maior)</small></span>${seg('minorMode', [['relative', 'Em = 6m'], ['tonic', 'Em = 1m']])}</div>
      <div class="opt"><span class="ol">Na letra</span>${seg('lyricChords', [['both', 'Acorde + grau'], ['names', 'Só acorde'], ['degrees', 'Só grau']])}</div>
      ${sw('showBass', 'Mostrar baixo invertido', 'Ex.: D/F# em vez de D')}
      ${sw('showCues', 'Início da letra no mapa')}
      ${sw('showField', 'Faixa do campo harmônico')}
      ${sw('colorDegrees', 'Cores por grau')}
      ${sw('showTabs', 'Mostrar tablaturas na letra')}
      <div class="opt"><span class="ol">Tema</span>${seg('theme', [['dark', 'Escuro (palco)'], ['light', 'Claro']])}</div>
      ${sw('wakeLock', 'Manter a tela ligada', 'Enquanto uma música ou medley estiver aberto')}
      ${sw('clickSound', 'Clique de metrônomo no "Tocar junto"')}
      <div class="row-actions"><button class="btn ghost" id="resetDisp">Restaurar padrão</button></div>
    </div>
    <div class="panel"><h2>Dados</h2>
      <p style="margin:0 0 8px;color:var(--muted)">${store.listSongs().length} músicas · ${store.listMedleys().length} medleys.</p>
      <div class="row-actions">
        <button class="btn" id="export">⬇ Baixar backup</button>
        <label class="btn" for="importFile">⬆ Restaurar backup</label><input type="file" id="importFile" accept="application/json,.json" hidden>
      </div>
      <div class="field" style="margin-top:14px"><label for="oldUrl">Importar da versão antiga (Google Planilha)</label><input type="url" id="oldUrl" value="${esc(OLD_API_URL)}"><span class="hint">Copia as músicas do app antigo. Tempos no formato antigo, como Bm(4), viram Bm:4.</span></div>
      <div class="row-actions"><button class="btn" id="importOld">Importar músicas antigas</button><span id="oldProg" class="detect"></span></div>
    </div>
    <div class="panel"><h2>Sobre</h2>
      <p style="margin:0;color:var(--muted)">Cifras v${VERSION}. Funciona sem internet depois de aberto uma vez. No tablet, use "Adicionar à tela de início" para abrir como app em tela cheia.</p>
      ${NOTATION_HELP}
    </div>
  </div>`;

  $$('[data-set] button').forEach((b) => { b.onclick = () => { setSetting(b.closest('[data-set]').dataset.set, b.dataset.v); settingsView(); }; });
  $$('[data-sw]').forEach((b) => { b.onclick = () => { const k = b.dataset.sw; setSetting(k, !settings()[k]); b.classList.toggle('on', settings()[k]); }; });
  $('#resetDisp').onclick = () => { Object.entries(DEFAULTS).forEach(([k, v]) => setSetting(k, v)); settingsView(); };
  $('#savePass').onclick = async () => {
    const p = $('#pass').value.trim();
    if (!p) { toast('Digite a senha', 'err'); return; }
    try {
      const h = await store.checkServer(p);
      if (h.status === 401) { toast('Senha incorreta', 'err'); return; }
      if (h.status === 503 || h.configured === false) { toast('O servidor ainda não tem senha configurada (APP_PASSWORD).', 'err'); return; }
    } catch { toast('Sem conexão com o servidor agora — a senha foi guardada e a sincronização tenta de novo depois.'); }
    store.setPassword(p);
    try { await store.sync({ force: true }); toast('Sincronizado', 'ok'); } catch { /* status mostra o erro */ }
    settingsView();
  };
  $('#syncNow').onclick = async () => { try { await store.sync({ force: true }); toast('Sincronizado', 'ok'); } catch (e) { toast(store.syncStatus().message || e.message, 'err'); } settingsView(); };
  const fg = $('#forget'); if (fg) fg.onclick = () => { store.setPassword(''); settingsView(); };
  $('#export').onclick = () => download(`cifras-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportAll());
  $('#importFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { const n = await store.importAll(await f.text()); toast(`${n} músicas restauradas`, 'ok'); settingsView(); } catch (err) { toast(err.message, 'err'); }
  };
  $('#importOld').onclick = async () => {
    const url = $('#oldUrl').value.trim();
    const prog = $('#oldProg');
    const btn = $('#importOld');
    btn.disabled = true;
    prog.textContent = 'Conectando…';
    try {
      const olds = await fetchOldSongs(url, (d, t) => { prog.textContent = `${d}/${t}`; });
      const existing = store.listSongs();
      let added = 0, skipped = 0;
      for (const o of olds) {
        const conv = convertOldSong(o);
        if (existing.some((s) => norm(s.title) === norm(conv.title) && norm(s.artist) === norm(conv.artist))) { skipped++; continue; }
        await store.saveSong({ id: uid(), ...conv });
        added++;
      }
      prog.innerHTML = `<b>${added}</b> importadas${skipped ? `, ${skipped} já existiam` : ''}.`;
      toast(`${added} músicas importadas`, 'ok');
    } catch (e) {
      prog.textContent = 'Falhou: ' + e.message;
      toast('Não foi possível ler a versão antiga: ' + e.message, 'err');
    } finally { btn.disabled = false; }
  };
  // settingsView() se redesenha várias vezes: mantém um único "ouvinte"
  if (settingsOff) settingsOff();
  settingsOff = store.onChange((what) => { if (what === 'sync') { const m = $('#syncMsg'); if (m) m.textContent = store.syncStatus().message; $('#tbRight').innerHTML = syncDot(); } });
  onLeave(() => { if (settingsOff) { settingsOff(); settingsOff = null; } });
}
let settingsOff = null;

// ---------------------------------------------------------------------------
// Início

async function start() {
  applyTheme();
  await store.init();
  window.addEventListener('hashchange', route);
  route();
  store.scheduleSync(400);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
}

start();
