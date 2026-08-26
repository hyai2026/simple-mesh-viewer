import type { MeshStats } from '../core/MeshData';
import type { LayerKey, LayerVisibility } from '../render/MeshView';
import { DEFAULT_COLORS } from '../render/MeshView';
import type { EventBus } from './EventBus';

interface RowRefs {
  root: HTMLElement;
  detail: HTMLElement;
  caret: HTMLButtonElement;
  toggles: Record<LayerKey, HTMLButtonElement>;
  alpha: HTMLInputElement;
  alphaVal: HTMLElement;
  colors: Record<LayerKey, HTMLInputElement>;
}

const LAYERS: LayerKey[] = ['points', 'edges', 'surface'];

const EMPTY_HINT =
  '<div class="hint">尚未加载模型 — 点击「打开…」或拖入文件</div>';

export class ModelList {
  private bus: EventBus;
  private listEl: HTMLElement;
  private rows = new Map<string, RowRefs>();

  constructor(el: HTMLElement, bus: EventBus) {
    this.bus = bus;
    el.innerHTML = `
      <div class="panel-section">
        <h3>模型</h3>
        <div id="model-list">${EMPTY_HINT}</div>
      </div>`;
    this.listEl = el.querySelector('#model-list') as HTMLElement;

    bus.on('model-added', ({ id, name, stats }) => this.addRow(id, name, stats));
    bus.on('model-removed', ({ id }) => this.removeRow(id));
    bus.on('model-layer-changed', ({ id, vis }) => {
      const row = this.rows.get(id);
      if (!row) return;
      for (const key of LAYERS) row.toggles[key].classList.toggle('off', !vis[key]);
    });
    bus.on('model-opacity-changed', ({ id, opacity }) => {
      const row = this.rows.get(id);
      if (!row) return;
      const pct = Math.round(opacity * 100);
      if (Number(row.alpha.value) !== pct) {
        row.alpha.value = String(pct);
        row.alphaVal.textContent = `${pct}%`;
      }
    });
  }

  private addRow(id: string, name: string, stats: MeshStats): void {
    if (this.rows.size === 0) this.listEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'model-item';
    wrap.dataset.id = id;
    wrap.innerHTML = `
      <div class="model-head">
        <button class="caret" title="详细信息">▸</button>
        <span class="model-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
        <button class="icon-btn remove" title="移除模型">✕</button>
      </div>
      <div class="model-controls">
        <button class="mini-toggle" data-layer="points">●点</button>
        <button class="mini-toggle" data-layer="edges">●边</button>
        <button class="mini-toggle" data-layer="surface">●面</button>
        <input class="alpha" type="range" min="5" max="100" step="1" value="100" title="不透明度" />
        <span class="alpha-val">100%</span>
      </div>
      <div class="model-detail hidden">
        <div class="kv-list">
          <div class="kv"><dt>顶点</dt><dd>${stats.vertices.toLocaleString()}</dd></div>
          <div class="kv"><dt>面</dt><dd>${
            stats.faces > 0 ? stats.faces.toLocaleString() : '—'
          }</dd></div>
          <div class="kv"><dt>三角形</dt><dd>${
            stats.triangles > 0 ? stats.triangles.toLocaleString() : '—'
          }</dd></div>
          <div class="kv"><dt>边</dt><dd>${
            stats.edges > 0
              ? `${stats.edges.toLocaleString()}<span class="badge accent">${
                  stats.edgeSource === 'explicit' ? '显式' : '派生'
                }</span>`
              : '—'
          }</dd></div>
        </div>
        <div class="color-row"><span>面颜色</span><input type="color" data-layer="surface" value="${toHex(
          DEFAULT_COLORS.surface,
        )}" /></div>
        <div class="color-row"><span>边颜色</span><input type="color" data-layer="edges" value="${toHex(
          DEFAULT_COLORS.edges,
        )}" /></div>
        <div class="color-row"><span>点颜色</span><input type="color" data-layer="points" value="${toHex(
          DEFAULT_COLORS.points,
        )}" /></div>
      </div>`;
    this.listEl.appendChild(wrap);

    const q = <T extends HTMLElement>(sel: string): T => wrap.querySelector(sel) as T;
    const row: RowRefs = {
      root: wrap,
      detail: q('.model-detail'),
      caret: q('.caret'),
      alpha: q<HTMLInputElement>('.alpha'),
      alphaVal: q('.alpha-val'),
      toggles: {
        points: q<HTMLButtonElement>('button.mini-toggle[data-layer="points"]'),
        edges: q<HTMLButtonElement>('button.mini-toggle[data-layer="edges"]'),
        surface: q<HTMLButtonElement>('button.mini-toggle[data-layer="surface"]'),
      },
      colors: {
        points: q<HTMLInputElement>('input[type="color"][data-layer="points"]'),
        edges: q<HTMLInputElement>('input[type="color"][data-layer="edges"]'),
        surface: q<HTMLInputElement>('input[type="color"][data-layer="surface"]'),
      },
    };
    this.rows.set(id, row);

    row.caret.addEventListener('click', () => {
      const open = row.detail.classList.toggle('hidden') === false;
      row.caret.textContent = open ? '▾' : '▸';
    });
    wrap
      .querySelector('.icon-btn.remove')!
      .addEventListener('click', () => this.bus.emit('remove-model', { id }));

    const currentVis = (): Partial<LayerVisibility> => ({
      points: !row.toggles.points.classList.contains('off'),
      edges: !row.toggles.edges.classList.contains('off'),
      surface: !row.toggles.surface.classList.contains('off'),
    });

    for (const key of LAYERS) {
      row.toggles[key].addEventListener('click', () => {
        row.toggles[key].classList.toggle('off');
        this.bus.emit('set-model-layers', { id, partial: currentVis() });
      });
    }

    row.alpha.addEventListener('input', () => {
      const pct = Number(row.alpha.value);
      row.alphaVal.textContent = `${pct}%`;
      this.bus.emit('set-model-opacity', { id, opacity: pct / 100 });
    });

    for (const key of LAYERS) {
      row.colors[key].addEventListener('input', () => {
        this.bus.emit('set-model-color', { id, layer: key, color: parseInt(row.colors[key].value.slice(1), 16) });
      });
    }
  }

  private removeRow(id: string): void {
    const row = this.rows.get(id);
    if (!row) return;
    row.root.remove();
    this.rows.delete(id);
    if (this.rows.size === 0) this.listEl.innerHTML = EMPTY_HINT;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function toHex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}
