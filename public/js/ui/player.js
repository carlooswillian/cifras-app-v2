// "Tocar junto": percorre o mapa no andamento (BPM), acendendo o acorde e o tempo atuais,
// com clique de metrônomo opcional. Serve para treinar quantos tempos dura cada acorde.

import { timeline } from '../music/chart.js';

export class Player {
  /**
   * @param {object} o
   * @param {object} o.chart       mapa (buildChart)
   * @param {() => HTMLElement} o.root  função que devolve o elemento .chart atual
   * @param {number} o.bpm
   * @param {boolean} o.click
   * @param {(info:{beat:number, countIn:boolean, playing:boolean}) => void} [o.onTick]
   * @param {() => void} [o.onEnd]
   */
  constructor(o) {
    this.o = o;
    this.steps = timeline(o.chart);
    this.bpm = o.bpm || 80;
    this.playing = false;
    this.timer = null;
    this.ctx = null;
  }

  start() {
    if (!this.steps.length) return;
    this.stop(false);
    this.playing = true;
    if (this.o.click) {
      try {
        this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
        this.ctx.resume();
      } catch { this.ctx = null; }
    }
    this.halfTick = 0;              // contador de meios-tempos
    this.countIn = this.o.chart.beatsPerBar * 2; // 1 compasso de contagem (em meios-tempos)
    this.stepIdx = 0;
    this.inStep = 0;                // meios-tempos já tocados no passo atual
    this.t0 = performance.now();
    this.tick();
  }

  setBpm(bpm) {
    this.bpm = Math.max(30, Math.min(260, bpm));
    if (this.playing) { this.t0 = performance.now() - this.halfTick * this.halfMs(); }
  }

  halfMs() { return 30000 / this.bpm; }

  tick() {
    if (!this.playing) return;
    const isBeat = this.halfTick % 2 === 0;
    if (this.countIn > 0) {
      if (isBeat) {
        const beatNo = this.o.chart.beatsPerBar - Math.ceil(this.countIn / 2) + 1;
        this.click(beatNo === 1);
        this.o.onTick && this.o.onTick({ beat: beatNo, countIn: true, playing: true });
      }
      this.countIn--;
    } else {
      const step = this.steps[this.stepIdx];
      if (!step) { this.stop(); this.o.onEnd && this.o.onEnd(); return; }
      const halves = Math.max(1, Math.round(step.beats * 2));
      if (this.inStep === 0) this.highlight(step);
      if (isBeat) {
        const beatInStep = Math.floor(this.inStep / 2);
        this.lightDot(step, beatInStep);
        this.click(step.ii === 0 && this.inStep === 0); // acento no 1º tempo do compasso
        this.o.onTick && this.o.onTick({ beat: beatInStep + 1, countIn: false, playing: true });
      }
      this.inStep++;
      if (this.inStep >= halves) { this.stepIdx++; this.inStep = 0; }
    }
    this.halfTick++;
    const next = this.t0 + this.halfTick * this.halfMs();
    this.timer = setTimeout(() => this.tick(), Math.max(0, next - performance.now()));
  }

  el(sel) {
    const root = this.o.root();
    return root ? root.querySelector(sel) : null;
  }

  clearMarks() {
    const root = this.o.root();
    if (!root) return;
    root.querySelectorAll('.it.now').forEach((e) => e.classList.remove('now'));
    root.querySelectorAll('.bt i.on').forEach((e) => e.classList.remove('on'));
    root.querySelectorAll('.fc.now').forEach((e) => e.classList.remove('now'));
  }

  highlight(step) {
    this.clearMarks();
    const it = this.el(`.it[data-pos="${step.blockId}.${step.gi}.${step.ri}.${step.bi}.${step.ii}"]`);
    if (it) {
      it.classList.add('now');
      const root = this.o.root();
      if (root && root.classList.contains('scroll')) it.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
    const fc = this.el(`.fc[data-fi="${step.fi}"]`);
    if (fc) fc.classList.add('now');
  }

  lightDot(step, beatIdx) {
    const it = this.el(`.it[data-pos="${step.blockId}.${step.gi}.${step.ri}.${step.bi}.${step.ii}"]`);
    if (!it) return;
    const dots = it.querySelectorAll('.bt i');
    dots.forEach((d, k) => d.classList.toggle('on', k === beatIdx));
  }

  click(accent) {
    if (!this.o.click || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1560 : 1040;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  stop(notify = true) {
    this.playing = false;
    clearTimeout(this.timer);
    this.clearMarks();
    if (notify && this.o.onTick) this.o.onTick({ beat: 0, countIn: false, playing: false });
  }
}

/** Marca o andamento tocando na tela (tap tempo). */
export function tapTempo() {
  const taps = [];
  return () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 6) taps.shift();
    if (taps.length < 2) return 0;
    const intervals = taps.slice(1).map((t, i) => t - taps[i]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return Math.round(60000 / avg);
  };
}
