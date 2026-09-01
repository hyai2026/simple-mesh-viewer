import type { EventBus } from './EventBus';

const TEMPLATE = `
<button id="btn-export" class="btn">导出图像</button>
<div id="export-pop" class="popover hidden">
  <div class="kv"><dt>分辨率</dt><dd>
    <div class="seg" id="seg-export-scale">
      <button data-scale="1" class="seg-btn">1×</button>
      <button data-scale="2" class="seg-btn active">2×</button>
      <button data-scale="4" class="seg-btn">4×</button>
    </div>
  </dd></div>
  <label class="chip"><input type="checkbox" id="chk-export-alpha" /><span>透明背景</span></label>
  <button id="btn-do-export" class="btn primary">导出 PNG</button>
</div>
`;

export class ExportDialog {
  private pop: HTMLElement;
  private scale = 2;
  private transparent = false;

  constructor(el: HTMLElement, bus: EventBus) {
    const wrap = document.createElement('div');
    wrap.className = 'export-wrap';
    wrap.innerHTML = TEMPLATE;
    el.appendChild(wrap);

    const btn = wrap.querySelector('#btn-export') as HTMLButtonElement;
    this.pop = wrap.querySelector('#export-pop') as HTMLElement;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.pop.classList.contains('hidden')) {
        const r = btn.getBoundingClientRect();
        this.pop.style.top = `${r.bottom + 6}px`;
        this.pop.style.right = `${window.innerWidth - r.right}px`;
      }
      this.pop.classList.toggle('hidden');
    });
    this.pop.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.pop.classList.add('hidden'));

    for (const b of Array.from(this.pop.querySelectorAll('#seg-export-scale .seg-btn'))) {
      b.addEventListener('click', () => {
        for (const x of Array.from(this.pop.querySelectorAll('#seg-export-scale .seg-btn')))
          x.classList.remove('active');
        b.classList.add('active');
        this.scale = Number((b as HTMLElement).dataset.scale);
      });
    }
    (wrap.querySelector('#chk-export-alpha') as HTMLInputElement).addEventListener(
      'change',
      (e) => {
        this.transparent = (e.target as HTMLInputElement).checked;
      },
    );
    (wrap.querySelector('#btn-do-export') as HTMLButtonElement).addEventListener('click', () => {
      bus.emit('export-image', { scale: this.scale, transparent: this.transparent });
      this.pop.classList.add('hidden');
    });
  }
}
