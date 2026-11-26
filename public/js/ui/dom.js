// Pequenos utilitários de interface.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 5000 : 2600);
}

/**
 * Abre um modal. `body` é HTML; `buttons` = [{label, cls, value}].
 * Retorna uma Promise com o value do botão clicado (ou null ao fechar).
 */
export function modal({ title, body, buttons = [{ label: 'Fechar', value: null }], onOpen, wide = false }) {
  const dlg = document.getElementById('modal');
  dlg.style.width = wide ? 'min(820px, 96vw)' : '';
  dlg.innerHTML = `
    <div class="modal-head"><h3>${esc(title)}</h3><button class="btn icon ghost" data-close aria-label="Fechar">✕</button></div>
    <div class="modal-body">${body}</div>
    ${buttons.length ? `<div class="modal-foot">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-btn="${i}">${esc(b.label)}</button>`).join('')}</div>` : ''}`;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; if (dlg.open) dlg.close(); resolve(v); };
    dlg.querySelector('[data-close]').onclick = () => finish(null);
    dlg.querySelectorAll('[data-btn]').forEach((b) => {
      b.onclick = async () => {
        const btn = buttons[Number(b.dataset.btn)];
        if (btn.handler) {
          const r = await btn.handler(dlg);
          if (r === false) return;
          finish(r === undefined ? btn.value : r);
        } else finish(btn.value);
      };
    });
    dlg.onclose = () => finish(null);
    dlg.onclick = (e) => { if (e.target === dlg) finish(null); };
    if (!dlg.open) dlg.showModal();
    if (onOpen) onOpen(dlg, finish);
  });
}

export function closeModal() {
  const dlg = document.getElementById('modal');
  if (dlg.open) dlg.close();
}

export async function confirmBox(title, text, okLabel = 'Confirmar', danger = false) {
  const v = await modal({ title, body: `<p>${esc(text)}</p>`, buttons: [{ label: 'Cancelar', value: false }, { label: okLabel, cls: danger ? 'danger' : 'primary', value: true }] });
  return v === true;
}

/** Popover ancorado num elemento. Retorna função para fechar. */
export function popover(anchor, html, onMount) {
  const pop = document.getElementById('popover');
  pop.innerHTML = html;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pw = Math.min(300, window.innerWidth * 0.94);
  let left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2));
  pop.style.left = left + 'px';
  pop.style.top = '0px';
  const ph = pop.offsetHeight;
  let top = r.bottom + 8;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 8);
  pop.style.top = top + 'px';
  const close = () => { pop.hidden = true; pop.innerHTML = ''; document.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  if (onMount) onMount(pop, close);
  return close;
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
