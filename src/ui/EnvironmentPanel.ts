import type { LightingParams } from './EventBus';
import { DEFAULT_LIGHTING } from './EventBus';
import type { EventBus } from './EventBus';

const TEMPLATE = `
<div class="panel-section">
  <h3>环境与光照</h3>
  <div class="light-row"><span>环境光</span><input id="li-hemi" type="range" min="0" max="3" step="0.05" /><span class="light-val" id="v-hemi"></span></div>
  <div class="light-row"><span>主光源</span><input id="li-key" type="range" min="0" max="6" step="0.1" /><span class="light-val" id="v-key"></span></div>
  <div class="light-row"><span>补光</span><input id="li-fill" type="range" min="0" max="3" step="0.05" /><span class="light-val" id="v-fill"></span></div>
  <div class="light-row"><span>背景</span><input id="li-bg" type="color" /></div>
</div>
`;

export class EnvironmentPanel {
  constructor(el: HTMLElement, bus: EventBus) {
    el.innerHTML = TEMPLATE;
    const q = <T extends HTMLElement>(sel: string): T => el.querySelector(sel) as T;
    const hemi = q<HTMLInputElement>('#li-hemi');
    const key = q<HTMLInputElement>('#li-key');
    const fill = q<HTMLInputElement>('#li-fill');
    const bg = q<HTMLInputElement>('#li-bg');
    const vHemi = q<HTMLElement>('#v-hemi');
    const vKey = q<HTMLElement>('#v-key');
    const vFill = q<HTMLElement>('#v-fill');

    const apply = (p: LightingParams): void => {
      hemi.value = String(p.hemi);
      key.value = String(p.key);
      fill.value = String(p.fill);
      bg.value = p.background;
      vHemi.textContent = p.hemi.toFixed(2);
      vKey.textContent = p.key.toFixed(1);
      vFill.textContent = p.fill.toFixed(2);
    };
    apply(DEFAULT_LIGHTING);

    const emitPartial = (partial: Partial<LightingParams>): void => {
      bus.emit('set-lighting', partial);
    };
    hemi.addEventListener('input', () => emitPartial({ hemi: Number(hemi.value) }));
    key.addEventListener('input', () => emitPartial({ key: Number(key.value) }));
    fill.addEventListener('input', () => emitPartial({ fill: Number(fill.value) }));
    bg.addEventListener('input', () => emitPartial({ background: bg.value }));

    bus.on('lighting-changed', apply);
  }
}
