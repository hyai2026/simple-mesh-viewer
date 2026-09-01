import type { EventBus } from './EventBus';
import type { PickHit } from '../render/PickingEngine';

const TEMPLATE = `
<span id="status-left">就绪 — 打开或拖入模型文件</span>
<span id="status-right">
  <span id="queue" class="hidden">队列 <span id="queue-n">0</span>
    <button id="queue-cancel" class="icon-btn" title="取消排队中的文件">✕</button>
  </span>
  <span id="busy-label"></span>
  <div id="progress"><div id="progress-fill"></div></div>
</span>
`;

export class StatusBar {
  private left: HTMLElement;
  private busyLabel: HTMLElement;
  private progress: HTMLElement;
  private fill: HTMLElement;
  private modelNames = new Map<string, string>();
  private busyCount = 0;
  private busyText = '';
  private errorActive = false;

  constructor(el: HTMLElement, bus: EventBus) {
    el.innerHTML = TEMPLATE;
    this.left = el.querySelector('#status-left') as HTMLElement;
    this.busyLabel = el.querySelector('#busy-label') as HTMLElement;
    this.progress = el.querySelector('#progress') as HTMLElement;
    this.fill = el.querySelector('#progress-fill') as HTMLElement;
    const queue = el.querySelector('#queue') as HTMLElement;
    const queueN = el.querySelector('#queue-n') as HTMLElement;
    (el.querySelector('#queue-cancel') as HTMLButtonElement).addEventListener('click', () =>
      bus.emit('cancel-load-queue', {}),
    );
    bus.on('load-queue-changed', ({ pending }) => {
      queue.classList.toggle('hidden', pending === 0);
      queueN.textContent = String(pending);
    });

    bus.on('model-added', ({ id, name }) => {
      this.modelNames.set(id, name);
    });
    bus.on('model-removed', ({ id }) => {
      this.modelNames.delete(id);
    });

    bus.on('hover-changed', (hit) => {
      if (this.errorActive) return;
      if (!hit) {
        if (!this.busyLabel.textContent && !this.progressPending()) {
          this.left.textContent = '就绪';
        }
        return;
      }
      this.left.textContent = this.formatHover(hit);
    });
    bus.on('file-loading', ({ name }) => {
      this.clearError();
      this.setProgress(0);
      this.left.textContent = `正在解析 ${name} …`;
    });
    bus.on('progress', ({ fraction }) => {
      this.setProgress(fraction);
    });
    bus.on('model-added', ({ name, ms }) => {
      this.clearError();
      this.hideProgress();
      this.left.textContent = `${name} 加载完成 · ${(ms / 1000).toFixed(2)} s`;
    });
    bus.on('file-error', ({ message }) => {
      this.errorActive = true;
      this.left.classList.add('error');
      this.hideProgress();
      this.left.textContent = `错误：${message}`;
    });
    bus.on('busy', ({ active, label }) => {
      if (active) {
        this.busyCount++;
        this.busyText = label ?? '处理中…';
      } else {
        this.busyCount = Math.max(0, this.busyCount - 1);
      }
      this.busyLabel.textContent = this.busyCount > 0 ? this.busyText : '';
    });
  }

  private progressPending(): boolean {
    return this.progress.style.display !== 'none';
  }

  private clearError(): void {
    this.errorActive = false;
    this.left.classList.remove('error');
  }

  private setProgress(fraction: number): void {
    this.progress.style.display = 'block';
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  }

  private hideProgress(): void {
    this.progress.style.display = 'none';
  }

  private formatHover(hit: PickHit): string {
    const name = this.modelNames.get(hit.modelId);
    const prefix = name ? `${name} · ` : '';
    if (hit.kind === 'vertex') {
      const p = hit.position;
      return `${prefix}顶点 #${hit.index} · (${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`;
    }
    if (hit.kind === 'edge') {
      return `${prefix}边 #${hit.index} · V${hit.v0} ↔ V${hit.v1}`;
    }
    return `${prefix}面 #${hit.index} · ${hit.corners.length} 边形 [${hit.corners.join(', ')}]`;
  }
}
