// Ajusta o tamanho da fonte (e o número de colunas) para a música caber inteira
// na área visível — uma página só, sem rolar.

function searchSize(el, fits, min, max) {
  el.style.fontSize = max + 'px';
  if (fits()) return max;
  let lo = min, hi = max, best = null;
  for (let i = 0; i < 9 && hi - lo > 0.3; i++) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = mid.toFixed(2) + 'px';
    if (fits()) { best = mid; lo = mid; } else hi = mid;
  }
  return best;
}

/**
 * @param {HTMLElement} el   área com altura fixa e overflow escondido (.chart ou .lyrics)
 * @param {object} opts
 * @param {number} [opts.min]       menor fonte aceitável (px)
 * @param {number} [opts.max]       maior fonte (px)
 * @param {string} [opts.colSel]    seletor do elemento com colunas (padrão: o próprio el)
 * @param {number} [opts.minColPx]  largura mínima de uma coluna, para decidir quantas tentar
 * @returns {{size:number, cols:number, fits:boolean}}
 */
export function fitToBox(el, { min = 11, max = 44, colSel = null, minColPx = 300, maxCols = 4, minColEm = 0, gapEm = 1.1, padEm = 1.4, scrollClass = 'scroll' } = {}) {
  if (!el || !el.isConnected) return { size: 0, cols: 0, fits: false };
  el.classList.remove(scrollClass);
  const colEl = colSel ? el.querySelector(colSel) : el;
  const fits = () => el.scrollHeight <= el.clientHeight + 2 && el.scrollWidth <= el.clientWidth + 2;
  const width = el.clientWidth || 1;
  const nMax = Math.max(1, Math.min(maxCols, Math.floor(width / minColPx)));
  let best = { size: -1, cols: 1 };
  for (let n = 1; n <= nMax; n++) {
    // com n colunas, cada coluna precisa ter pelo menos minColEm de largura
    // (ex.: 4 compassos lado a lado, sem quebrar a linha)
    const cap = minColEm ? width / (n * minColEm + (n - 1) * gapEm + padEm) : max;
    const top = Math.min(max, cap);
    if (top < min && n > 1) continue;
    if (colEl) { colEl.style.columnCount = String(n); colEl.style.columnWidth = 'auto'; }
    const size = searchSize(el, fits, min, Math.max(min, top));
    if (size != null && size > best.size + 0.4) best = { size, cols: n };
  }
  if (best.size < 0) {
    if (colEl) { colEl.style.columnCount = String(nMax); colEl.style.columnWidth = 'auto'; }
    el.style.fontSize = min + 'px';
    el.classList.add(scrollClass);
    return { size: min, cols: nMax, fits: false };
  }
  if (colEl) colEl.style.columnCount = String(best.cols);
  el.style.fontSize = best.size.toFixed(2) + 'px';
  return { size: best.size, cols: best.cols, fits: true };
}
