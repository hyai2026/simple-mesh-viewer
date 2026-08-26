import type { Colormap, CurvatureType } from '../core/Curvature';
import { ZEBRA_DEFAULT_STRIPE_COUNT } from '../render/MeshView';
import type { EventBus } from './EventBus';

const TEMPLATE = `
<div class="panel-section">
  <h3>诊断</h3>
  <div class="light-row"><span>条纹密度</span><input id="in-stripe" type="range" min="2" max="120" step="1" /><span class="light-val" id="v-stripe"></span></div>
  <div class="kv"><dt>曲率类型</dt><dd>
    <select id="sel-curv-type" class="sel">
      <option value="mean">平均曲率</option>
      <option value="gauss">高斯曲率</option>
      <option value="min">最小主曲率</option>
      <option value="max">最大主曲率</option>
    </select>
  </dd></div>
  <div class="kv"><dt>色图</dt><dd>
    <select id="sel-colormap" class="sel">
      <option value="jet">彩虹</option>
      <option value="bwr">蓝白红</option>
    </select>
  </dd></div>
  <canvas id="legend-bar" width="240" height="12"></canvas>
  <div class="legend-range"><span id="legend-min">—</span><span id="legend-max">—</span></div>
  <div class="hint">启用工具栏"斑马纹/曲率"后生效</div>
</div>
`;

function jetCss(t: number): string {
  const f = (x: number): number => Math.round(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - x))));
  return `rgb(${f(3)},${f(2)},${f(1)})`;
}

function bwrCss(t: number): string {
  if (t < 0.5) {
    const k = t * 2;
    return `rgb(${Math.round(13 + 242 * k)},${Math.round(13 + 242 * k)},255)`;
  }
  const k = (t - 0.5) * 2;
  return `rgb(255,${Math.round(13 + 242 * (1 - k))},${Math.round(13 + 242 * (1 - k))})`;
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e4 || a < 1e-2)) return v.toExponential(2);
  return v.toPrecision(3);
}

export class DiagnosticsPanel {
  private selType!: HTMLSelectElement;
  private selColormap!: HTMLSelectElement;
  private legendBar!: HTMLCanvasElement;
  private legendMin!: HTMLElement;
  private legendMax!: HTMLElement;
  private type: CurvatureType = 'mean';
  private colormap: Colormap = 'jet';
  private range = { min: NaN, max: NaN };

  constructor(el: HTMLElement, bus: EventBus) {
    el.innerHTML = TEMPLATE;
    this.selType = el.querySelector('#sel-curv-type') as HTMLSelectElement;
    this.selColormap = el.querySelector('#sel-colormap') as HTMLSelectElement;
    this.legendBar = el.querySelector('#legend-bar') as HTMLCanvasElement;
    this.legendMin = el.querySelector('#legend-min') as HTMLElement;
    this.legendMax = el.querySelector('#legend-max') as HTMLElement;

    const stripeInput = el.querySelector('#in-stripe') as HTMLInputElement;
    const stripeVal = el.querySelector('#v-stripe') as HTMLElement;
    stripeInput.value = String(ZEBRA_DEFAULT_STRIPE_COUNT);
    stripeVal.textContent = String(ZEBRA_DEFAULT_STRIPE_COUNT);
    stripeInput.addEventListener('input', () => {
      const count = Number(stripeInput.value);
      stripeVal.textContent = String(count);
      bus.emit('set-zebra-density', { count });
    });

    const emitOptions = (): void => {
      this.type = this.selType.value as CurvatureType;
      this.colormap = this.selColormap.value as Colormap;
      bus.emit('set-curvature-options', { type: this.type, colormap: this.colormap });
      this.drawLegend();
    };
    this.selType.addEventListener('change', emitOptions);
    this.selColormap.addEventListener('change', emitOptions);

    bus.on('curvature-range', ({ min, max }) => {
      this.range = { min, max };
      this.legendMin.textContent = formatValue(min);
      this.legendMax.textContent = formatValue(max);
    });
    bus.on('curvature-options-changed', ({ colormap }) => {
      this.colormap = colormap;
      this.drawLegend();
    });
    this.drawLegend();
  }

  private drawLegend(): void {
    const ctx = this.legendBar.getContext('2d');
    if (!ctx) return;
    const w = this.legendBar.width;
    const h = this.legendBar.height;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      grad.addColorStop(t, this.colormap === 'bwr' ? bwrCss(t) : jetCss(t));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    if (!Number.isFinite(this.range.min)) {
      this.legendMin.textContent = '—';
      this.legendMax.textContent = '—';
    }
  }
}
