import type { MeshStats } from '../core/MeshData';
import type { ModelRegistry } from '../render/ModelRegistry';
import type { PickHit } from '../render/PickingEngine';
import type { EventBus } from './EventBus';

const TEMPLATE = `
<div class="panel-section">
  <h3>选中</h3>
  <div id="sel-detail"><div class="hint">点击视口中的顶点 / 边 / 面<br/>查看其在源文件中的索引</div></div>
</div>
`;

export class SelectionPanel {
  private detailEl: HTMLElement;
  private statsByName = new Map<string, { name: string; stats: MeshStats }>();

  constructor(el: HTMLElement, bus: EventBus, models: ModelRegistry) {
    el.innerHTML = TEMPLATE;
    this.detailEl = el.querySelector('#sel-detail') as HTMLElement;

    bus.on('file-loading', () => this.clearDetail('加载中…'));
    bus.on('model-added', ({ id, name, stats }) => {
      this.statsByName.set(id, { name, stats });
    });
    bus.on('model-removed', ({ id }) => {
      this.statsByName.delete(id);
    });
    bus.on('selection-changed', (hit) => {
      if (!hit) {
        this.clearDetail();
        return;
      }
      const view = models.get(hit.modelId);
      const entry = this.statsByName.get(hit.modelId);
      this.detailEl.innerHTML = this.formatHit(hit, view?.label ?? '?', entry?.stats);
    });
  }

  private clearDetail(msg = '点击视口中的顶点 / 边 / 面<br/>查看其在源文件中的索引'): void {
    this.detailEl.innerHTML = `<div class="hint">${msg}</div>`;
  }

  private formatHit(
    hit: PickHit,
    modelName: string,
    stats?: MeshStats,
  ): string {
    if (hit.kind === 'vertex') {
      const p = hit.position;
      return `
        <span class="tag vertex">Vertex #${hit.index}${
          stats ? ` / ${stats.vertices - 1}` : ''
        }</span>
        <div class="detail-line model-line">${escapeHtml(modelName)}</div>
        <div class="detail-line">x ${p.x.toFixed(4)}<br/>y ${p.y.toFixed(4)}<br/>z ${p.z.toFixed(4)}</div>`;
    }
    if (hit.kind === 'edge') {
      const src = stats?.edgeSource === 'explicit' ? '（显式）' : '（派生）';
      return `
        <span class="tag edge">Edge #${hit.index}${src}</span>
        <div class="detail-line model-line">${escapeHtml(modelName)}</div>
        <div class="detail-line">V ${hit.v0} ↔ V ${hit.v1}<br/>length ${hit.length.toFixed(4)}</div>`;
    }
    return `
      <span class="tag face">Face #${hit.index}（${hit.corners.length} 边形）</span>
      <div class="detail-line model-line">${escapeHtml(modelName)}</div>
      <div class="detail-line">[ ${hit.corners.join(', ')} ]</div>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
