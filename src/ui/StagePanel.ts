import type { LayerKey } from '../render/MeshView';
import type { ModelRegistry } from '../render/ModelRegistry';
import type {
  EventBus,
  StageGizmoMode,
  StageGizmoSpace,
  StageTransformPayload,
} from './EventBus';
import type { StageSelection } from '../stage/StageController';
import type { StageEnvParams } from '../stage/StageScene';
import type { StageGroupInfo, StageTreeSnapshot } from '../stage/StageModel';
import { STUDIO_DARK } from '../stage/StageScene';

const LAYERS: LayerKey[] = ['points', 'edges', 'surface'];

const EYE_SVG_ON =
  '<svg class="icon-on" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_SVG_OFF =
  '<svg class="icon-off" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

const EMPTY_HINT = '<div class="hint">尚未加载模型 — 点击「打开…」或拖入文件</div>';

const TEMPLATE = `
<div class="panel-section">
  <h3>场景单元</h3>
  <div class="stage-actions">
    <button id="stg-group" class="btn small" disabled>成组</button>
    <button id="stg-ungroup" class="btn small" disabled>解组</button>
    <button id="stg-arrange" class="btn small" title="自动网格排布（PCA 摆正 + 统一缩放 + 贴地）">自动排布</button>
    <span class="hint-text">勾选 ≥2 个模型后成组，双击组名重命名</span>
  </div>
  <div id="stg-tree">${EMPTY_HINT}</div>
</div>
<div class="panel-section stage-only">
  <h3>变换</h3>
  <div class="xf-tools">
    <div class="seg" id="seg-gizmo">
      <button id="btn-g-translate" class="seg-btn active" title="移动 (W)">移动</button>
      <button id="btn-g-rotate" class="seg-btn" title="旋转 (E)">旋转</button>
      <button id="btn-g-scale" class="seg-btn" title="缩放 (R)">缩放</button>
    </div>
    <div class="seg" id="seg-space">
      <button id="btn-sp-world" class="seg-btn active">世界</button>
      <button id="btn-sp-local" class="seg-btn">局部</button>
    </div>
  </div>
  <div id="stg-xf">
    <div class="xf-grid">
      <span class="xf-label">位置</span>
      <input id="xf-px" type="number" step="0.01" disabled />
      <input id="xf-py" type="number" step="0.01" disabled />
      <input id="xf-pz" type="number" step="0.01" disabled />
      <span class="xf-label">旋转°</span>
      <input id="xf-rx" type="number" step="1" disabled />
      <input id="xf-ry" type="number" step="1" disabled />
      <input id="xf-rz" type="number" step="1" disabled />
      <span class="xf-label">缩放</span>
      <input id="xf-sx" type="number" step="0.01" disabled />
      <input id="xf-sy" type="number" step="0.01" disabled />
      <input id="xf-sz" type="number" step="0.01" disabled />
    </div>
    <button id="xf-reset" class="btn small" disabled>重置变换</button>
  </div>
</div>
<div class="panel-section stage-only">
  <h3>舞台环境</h3>
  <div class="seg" id="stg-preset">
    <button id="preset-studio" class="seg-btn active">影棚</button>
    <button id="preset-paper" class="seg-btn">论文</button>
  </div>
  <div class="light-row"><span>主光源</span><input id="stg-key" type="range" min="0" max="6" step="0.1" /><span class="light-val" id="stg-key-v"></span></div>
  <div class="light-row"><span>补光</span><input id="stg-fill" type="range" min="0" max="3" step="0.05" /><span class="light-val" id="stg-fill-v"></span></div>
  <div class="light-row"><span>环境光</span><input id="stg-amb" type="range" min="0" max="3" step="0.05" /><span class="light-val" id="stg-amb-v"></span></div>
  <div class="light-row"><span>曝光</span><input id="stg-exp" type="range" min="0.2" max="2.5" step="0.05" /><span class="light-val" id="stg-exp-v"></span></div>
  <div class="light-row"><span>阴影</span><input id="stg-shadow" type="range" min="0" max="0.9" step="0.02" /><span class="light-val" id="stg-shadow-v"></span></div>
  <div class="light-row"><span>背景(上)</span><input id="stg-bgtop" type="color" /></div>
  <div class="light-row"><span>背景(下)</span><input id="stg-bgbottom" type="color" /></div>
  <div class="light-row"><span>地面色</span><input id="stg-gcolor" type="color" /></div>
  <div class="seg" id="stg-ground">
    <button id="g-shadow" class="seg-btn active">承接阴影</button>
    <button id="g-solid" class="seg-btn">实色</button>
    <button id="g-none" class="seg-btn">隐藏</button>
  </div>
  <div class="seg" id="stg-tone">
    <button id="tone-aces" class="seg-btn active">电影</button>
    <button id="tone-neutral" class="seg-btn">中性</button>
    <button id="tone-none" class="seg-btn">线性</button>
  </div>
</div>
`;

interface TreeRow {
  root: HTMLElement;
  eye?: HTMLButtonElement;
  toggles?: Record<LayerKey, HTMLButtonElement>;
  caret?: HTMLButtonElement;
  detail?: HTMLElement;
  alpha?: HTMLInputElement;
  alphaVal?: HTMLElement;
  pickToggle?: HTMLButtonElement;
}

type StageGroup = StageGroupInfo;
type StageTree = StageTreeSnapshot;

export class StagePanel {
  private bus: EventBus;
  private el: HTMLElement;
  private models: ModelRegistry;
  private treeEl: HTMLElement;
  private checked = new Set<string>();
  private detailOpen = new Set<string>();
  private collapsedGroups = new Set<string>();
  private tree: StageTree | null = null;
  private selection: StageSelection = { unitId: null, modelId: null };
  private env: StageEnvParams = { ...STUDIO_DARK };
  private rowRefs = new Map<string, TreeRow>();
  private groupBtn: HTMLButtonElement;
  private ungroupBtn: HTMLButtonElement;
  private xfInputs: Array<HTMLInputElement> = [];
  private xfReset: HTMLButtonElement;
  private xfApplied = [0, 0, 0, 0, 0, 0, 1, 1, 1];

  constructor(el: HTMLElement, bus: EventBus, models: ModelRegistry) {
    this.bus = bus;
    this.el = el;
    this.models = models;
    el.innerHTML = TEMPLATE;
    const q = <T extends HTMLElement>(sel: string): T => el.querySelector(sel) as T;
    this.treeEl = q<HTMLElement>('#stg-tree');
    this.groupBtn = q<HTMLButtonElement>('#stg-group');
    this.ungroupBtn = q<HTMLButtonElement>('#stg-ungroup');
    this.xfReset = q<HTMLButtonElement>('#xf-reset');
    this.xfInputs = [
      q<HTMLInputElement>('#xf-px'), q<HTMLInputElement>('#xf-py'), q<HTMLInputElement>('#xf-pz'),
      q<HTMLInputElement>('#xf-rx'), q<HTMLInputElement>('#xf-ry'), q<HTMLInputElement>('#xf-rz'),
      q<HTMLInputElement>('#xf-sx'), q<HTMLInputElement>('#xf-sy'), q<HTMLInputElement>('#xf-sz'),
    ];

    this.groupBtn.addEventListener('click', () => {
      bus.emit('stage-group', { modelIds: [...this.checked] });
      this.checked.clear();
      this.groupBtn.disabled = true;
    });
    this.ungroupBtn.addEventListener('click', () => {
      if (this.selection.unitId && this.tree?.groups.some((g) => g.id === this.selection.unitId)) {
        bus.emit('stage-ungroup', { groupId: this.selection.unitId });
      }
    });
    q<HTMLButtonElement>('#stg-arrange').addEventListener('click', () =>
      bus.emit('stage-arrange', {}),
    );

    const gizmoButtons: Array<[HTMLButtonElement, StageGizmoMode]> = [
      [q<HTMLButtonElement>('#btn-g-translate'), 'translate'],
      [q<HTMLButtonElement>('#btn-g-rotate'), 'rotate'],
      [q<HTMLButtonElement>('#btn-g-scale'), 'scale'],
    ];
    const spaceButtons: Array<[HTMLButtonElement, StageGizmoSpace]> = [
      [q<HTMLButtonElement>('#btn-sp-world'), 'world'],
      [q<HTMLButtonElement>('#btn-sp-local'), 'local'],
    ];
    let curMode: StageGizmoMode = 'translate';
    let curSpace: StageGizmoSpace = 'world';
    for (const [btn, m] of gizmoButtons) {
      btn.addEventListener('click', () => bus.emit('stage-gizmo', { mode: m, space: curSpace }));
    }
    for (const [btn, m] of spaceButtons) {
      btn.addEventListener('click', () => bus.emit('stage-gizmo', { mode: curMode, space: m }));
    }
    bus.on('stage-gizmo-changed', ({ mode, space }) => {
      curMode = mode;
      curSpace = space;
      for (const [btn, m] of gizmoButtons) btn.classList.toggle('active', m === mode);
      for (const [btn, m] of spaceButtons) btn.classList.toggle('active', m === space);
    });
    this.xfReset.addEventListener('click', () => {
      if (!this.selection.unitId) return;
      bus.emit('stage-set-transform', {
        unitId: this.selection.unitId,
        modelId: this.selection.modelId,
        position: [0, 0, 0],
        rotationDeg: [0, 0, 0],
        scale: [1, 1, 1],
      });
    });

    for (const inp of this.xfInputs) {
      inp.addEventListener('change', () => this.commitXf());
    }

    bus.on('model-removed', ({ id }) => {
      this.checked.delete(id);
      this.detailOpen.delete(id);
    });
    bus.on('model-color-changed', ({ id, layer, color }) => {
      const input = this.rowRefs.get(id)?.root.querySelector<HTMLInputElement>(
        `input[type="color"][data-layer="${layer}"]`,
      );
      if (input) input.value = toHex(color);
    });
    bus.on('model-shown-changed', ({ id }) => this.syncEye(id));
    bus.on('model-layer-changed', ({ id, vis }) => {
      const row = this.rowRefs.get(id);
      if (row?.toggles) {
        for (const key of LAYERS) row.toggles[key].classList.toggle('off', !vis[key]);
      }
    });
    bus.on('model-pickable-changed', ({ id, pickable }) => {
      const row = this.rowRefs.get(id);
      if (row?.pickToggle) {
        row.pickToggle.classList.toggle('on', pickable);
        row.pickToggle.classList.toggle('off', !pickable);
      }
    });
    bus.on('stage-structure-changed', ({ tree }) => {
      this.tree = tree;
      this.renderTree();
    });
    bus.on('stage-selection-changed', (sel) => {
      this.selection = sel;
      this.refreshSelectionUI();
    });
    bus.on('stage-transform-changed', (t) => this.applyXf(t));
    bus.on('stage-env-changed', (env) => this.applyEnvUI(env));
    this.applyEnvUI(this.env);
    this.wireEnv(q);
  }

  private commitXf(): void {
    if (!this.selection.unitId) return;
    const vals = this.xfInputs.map((el) => Number(el.value));
    if (vals.some((v) => !Number.isFinite(v))) {
      for (const [i, v] of this.xfApplied.entries()) {
        this.xfInputs[i].value = String(round3(v));
      }
      return;
    }
    this.xfApplied = vals;
    const [px, py, pz, rx, ry, rz, sx, sy, sz] = vals;
    this.bus.emit('stage-set-transform', {
      unitId: this.selection.unitId,
      modelId: this.selection.modelId,
      position: [px, py, pz],
      rotationDeg: [rx, ry, rz],
      scale: [sx, sy, sz],
    });
  }

  private applyXf(t: StageTransformPayload): void {
    if (
      t.unitId !== this.selection.unitId ||
      (t.modelId ?? null) !== (this.selection.modelId ?? null)
    ) return;
    const vals = [...t.position, ...t.rotationDeg, ...t.scale];
    this.xfApplied = vals;
    const active = document.activeElement;
    if (active && this.xfInputs.includes(active as HTMLInputElement)) return;
    for (const [i, v] of vals.entries()) {
      this.xfInputs[i].value = String(round3(v));
    }
  }

  private refreshSelectionUI(): void {
    const hasSel = !!this.selection.unitId;
    for (const inp of this.xfInputs) inp.disabled = !hasSel;
    this.xfReset.disabled = !hasSel;
    const selIsGroup =
      hasSel && !!this.tree?.groups.some((g) => g.id === this.selection.unitId);
    this.ungroupBtn.disabled = !selIsGroup;
    for (const [id, row] of this.rowRefs) {
      row.root.classList.toggle(
        'selected',
        id === this.selection.unitId || id === this.selection.modelId,
      );
    }
  }

  private syncEye(mid: string): void {
    const row = this.rowRefs.get(mid);
    const shown = this.models.get(mid)?.isShown() ?? true;
    if (row?.eye) {
      row.eye.classList.toggle('on', shown);
      row.eye.classList.toggle('off', !shown);
    }
    row?.root.classList.toggle('model-hidden', !shown);
    const gid = this.tree?.groups.find((g) => g.members.includes(mid))?.id;
    const grow = gid ? this.rowRefs.get(gid) : undefined;
    const members = this.tree?.groups.find((g) => g.id === gid)?.members ?? [];
    if (grow?.eye) {
      const allOff = members.every((m) => this.models.get(m)?.isShown() === false);
      grow.eye.classList.toggle('on', !allOff);
      grow.eye.classList.toggle('off', allOff);
    }
  }

  private renderTree(): void {
    this.rowRefs.clear();
    if (!this.tree) return;
    const t = this.tree;
    const total = t.groups.reduce((n, g) => n + g.members.length, 0) + t.ungrouped.length;
    if (total === 0) {
      this.treeEl.innerHTML = EMPTY_HINT;
      this.groupBtn.disabled = true;
      this.ungroupBtn.disabled = true;
      return;
    }
    this.treeEl.innerHTML = '';
    for (const g of t.groups) {
      const collapsed = this.collapsedGroups.has(g.id);
      const row = this.buildGroupRow(g, !collapsed);
      this.treeEl.appendChild(row.root);
      const children = document.createElement('div');
      children.className = 'stage-children';
      if (collapsed) children.classList.add('hidden');
      for (const mid of g.members) {
        children.appendChild(this.buildModelRow(mid).root);
      }
      this.treeEl.appendChild(children);
    }
    for (const mid of t.ungrouped) {
      this.treeEl.appendChild(this.buildModelRow(mid).root);
    }
    this.groupBtn.disabled = this.checked.size < 2;
    this.ungroupBtn.disabled = !(this.selection.unitId && t.groups.some((g) => g.id === this.selection.unitId));
  }

  private buildGroupRow(g: StageGroup, expanded: boolean): TreeRow {
    const wrap = document.createElement('div');
    wrap.className = 'stage-group-row';
    wrap.dataset.id = g.id;
    const allOff = g.members.every((m) => this.models.get(m)?.isShown() === false);
    wrap.innerHTML = `
      <button class="caret" title="展开/收起">${expanded ? '▾' : '▸'}</button>
      <span class="model-name" title="${escapeAttr(g.name)}">${escapeHtml(g.name)}</span>
      <span class="stage-count">${g.members.length}</span>
      <button class="icon-btn eye ${allOff ? 'off' : 'on'}" title="显示/隐藏整组">${EYE_SVG_ON}${EYE_SVG_OFF}</button>
      <button class="icon-btn ungroup" title="解散该组">⤦</button>
    `;
    const caret = wrap.querySelector('button.caret') as HTMLButtonElement;
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.collapsedGroups.has(g.id)) this.collapsedGroups.delete(g.id);
      else this.collapsedGroups.add(g.id);
      this.renderTree();
    });
    const eye = wrap.querySelector('button.eye') as HTMLButtonElement;
    eye.addEventListener('click', () => {
      const next = !eye.classList.contains('on');
      for (const mid of g.members) this.bus.emit('set-model-shown', { id: mid, shown: next });
    });
    wrap.querySelector('button.ungroup')!.addEventListener('click', () => {
      this.bus.emit('stage-ungroup', { groupId: g.id });
    });
    const nameEl = wrap.querySelector('.model-name') as HTMLElement;
    nameEl.addEventListener('click', () => {
      this.bus.emit('stage-select', { unitId: g.id, modelId: null });
    });
    nameEl.addEventListener('dblclick', () => this.beginRename(g.id, g.name, nameEl));
    const row: TreeRow = { root: wrap, eye, caret };
    this.rowRefs.set(g.id, row);
    return row;
  }

  private beginRename(gid: string, current: string, nameEl: HTMLElement): void {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    input.className = 'stage-rename';
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = (): void => {
      const name = input.value.trim();
      if (name && name !== current) this.bus.emit('stage-rename', { groupId: gid, name });
      else this.renderTree();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') {
        input.value = current;
        input.blur();
      }
    });
    input.addEventListener('blur', commit);
  }

  private buildModelRow(mid: string): TreeRow {
    const view = this.models.get(mid);
    const name = view?.label ?? mid;
    const shown = view?.isShown() ?? true;
    const vis = view?.getVisibility() ?? { points: true, edges: true, surface: true };
    const opacity = view?.getOpacity() ?? 1;
    const pickable = view?.isPickable() ?? true;
    const stats = view?.stats() ?? null;
    const open = this.detailOpen.has(mid);
    const wrap = document.createElement('div');
    wrap.className = 'stage-model-wrap';
    if (!shown) wrap.classList.add('model-hidden');
    wrap.dataset.id = mid;
    wrap.innerHTML = `
      <div class="stage-model-row">
        <button class="caret" title="详细信息">${open ? '▾' : '▸'}</button>
        <input type="checkbox" class="stage-check" title="选中以成组" />
        <span class="model-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
        <button class="icon-btn eye ${shown ? 'on' : 'off'}" title="显示/隐藏模型">${EYE_SVG_ON}${EYE_SVG_OFF}</button>
        <button class="mini-toggle ${vis.points ? '' : 'off'}" data-layer="points" title="显示点">●点</button>
        <button class="mini-toggle ${vis.edges ? '' : 'off'}" data-layer="edges" title="显示线">●边</button>
        <button class="mini-toggle ${vis.surface ? '' : 'off'}" data-layer="surface" title="显示面">●面</button>
        <button class="icon-btn remove" title="移除模型">✕</button>
      </div>
      <div class="stage-colors">
        <label class="color-chip"><input type="color" data-layer="surface" value="${toHex(view?.getColor('surface') ?? 0)}" /><span>面</span></label>
        <label class="color-chip"><input type="color" data-layer="edges" value="${toHex(view?.getColor('edges') ?? 0)}" /><span>线</span></label>
        <label class="color-chip"><input type="color" data-layer="points" value="${toHex(view?.getColor('points') ?? 0)}" /><span>点</span></label>
      </div>
      <div class="model-detail ${open ? '' : 'hidden'}">
        <div class="kv-list">
          <div class="kv"><dt>顶点</dt><dd>${stats ? stats.vertices.toLocaleString() : '—'}</dd></div>
          <div class="kv"><dt>面</dt><dd>${stats && stats.faces > 0 ? stats.faces.toLocaleString() : '—'}</dd></div>
          <div class="kv"><dt>三角形</dt><dd>${stats && stats.triangles > 0 ? stats.triangles.toLocaleString() : '—'}</dd></div>
          <div class="kv"><dt>边</dt><dd>${
            stats && stats.edges > 0
              ? `${stats.edges.toLocaleString()}<span class="badge accent">${stats.edgeSource === 'explicit' ? '显式' : '派生'}</span>`
              : '—'
          }</dd></div>
        </div>
        <div class="light-row"><span>不透明度</span><input class="alpha" type="range" min="5" max="100" step="1" value="${Math.round(opacity * 100)}" /><span class="alpha-val">${Math.round(opacity * 100)}%</span></div>
        <div class="light-row analysis-only"><span>鼠标拾取</span><button class="mini-toggle pick-toggle ${pickable ? 'on' : 'off'}">拾取</button></div>
      </div>
    `;
    const eye = wrap.querySelector('button.eye') as HTMLButtonElement;
    eye.addEventListener('click', () => {
      const next = !(this.models.get(mid)?.isShown() ?? true);
      this.bus.emit('set-model-shown', { id: mid, shown: next });
    });
    const toggles: Record<LayerKey, HTMLButtonElement> = {
      points: wrap.querySelector('button.mini-toggle[data-layer="points"]') as HTMLButtonElement,
      edges: wrap.querySelector('button.mini-toggle[data-layer="edges"]') as HTMLButtonElement,
      surface: wrap.querySelector('button.mini-toggle[data-layer="surface"]') as HTMLButtonElement,
    };
    for (const key of LAYERS) {
      toggles[key].addEventListener('click', () => {
        const cur = this.models.get(mid)?.getVisibility();
        if (!cur) return;
        this.bus.emit('set-model-layers', { id: mid, partial: { [key]: !cur[key] } });
      });
    }
    const chk = wrap.querySelector('input.stage-check') as HTMLInputElement;
    chk.checked = this.checked.has(mid);
    chk.addEventListener('change', () => {
      if (chk.checked) this.checked.add(mid);
      else this.checked.delete(mid);
      this.groupBtn.disabled = this.checked.size < 2;
    });
    wrap.querySelector('button.icon-btn.remove')!.addEventListener('click', () => {
      this.bus.emit('remove-model', { id: mid });
    });
    for (const key of LAYERS) {
      const colorInput = wrap.querySelector<HTMLInputElement>(
        `input[type="color"][data-layer="${key}"]`,
      )!;
      colorInput.addEventListener('input', () => {
        this.bus.emit('set-model-color', {
          id: mid,
          layer: key,
          color: parseInt(colorInput.value.slice(1), 16),
        });
      });
    }
    const caret = wrap.querySelector('button.caret') as HTMLButtonElement;
    const detail = wrap.querySelector('.model-detail') as HTMLElement;
    caret.addEventListener('click', () => {
      const isOpen = !detail.classList.contains('hidden');
      detail.classList.toggle('hidden', isOpen);
      caret.textContent = isOpen ? '▸' : '▾';
      if (isOpen) this.detailOpen.delete(mid);
      else this.detailOpen.add(mid);
    });
    const alpha = wrap.querySelector('input.alpha') as HTMLInputElement;
    const alphaVal = wrap.querySelector('.alpha-val') as HTMLElement;
    alpha.addEventListener('input', () => {
      const pct = Number(alpha.value);
      alphaVal.textContent = `${pct}%`;
      this.bus.emit('set-model-opacity', { id: mid, opacity: pct / 100 });
    });
    const pickToggle = wrap.querySelector('button.pick-toggle') as HTMLButtonElement;
    pickToggle.addEventListener('click', () => {
      const next = !(this.models.get(mid)?.isPickable() ?? true);
      this.bus.emit('set-model-pickable', { id: mid, pickable: next });
    });
    const nameEl = wrap.querySelector('.model-name') as HTMLElement;
    nameEl.addEventListener('click', () => {
      const unit = this.unitOf(mid);
      this.bus.emit('stage-select', { unitId: unit, modelId: mid });
    });
    const row: TreeRow = { root: wrap, eye, toggles, caret, detail, alpha, alphaVal, pickToggle };
    this.rowRefs.set(mid, row);
    return row;
  }

  private unitOf(mid: string): string {
    for (const g of this.tree?.groups ?? []) {
      if (g.members.includes(mid)) return g.id;
    }
    return mid;
  }

  private wireEnv(q: <T extends HTMLElement>(sel: string) => T): void {
    const key = q<HTMLInputElement>('#stg-key');
    const fill = q<HTMLInputElement>('#stg-fill');
    const amb = q<HTMLInputElement>('#stg-amb');
    const exp = q<HTMLInputElement>('#stg-exp');
    const shadow = q<HTMLInputElement>('#stg-shadow');
    const bgTop = q<HTMLInputElement>('#stg-bgtop');
    const bgBottom = q<HTMLInputElement>('#stg-bgbottom');
    const gColor = q<HTMLInputElement>('#stg-gcolor');
    key.addEventListener('input', () => this.bus.emit('stage-env', { key: Number(key.value) }));
    fill.addEventListener('input', () => this.bus.emit('stage-env', { fill: Number(fill.value) }));
    amb.addEventListener('input', () => this.bus.emit('stage-env', { ambient: Number(amb.value) }));
    exp.addEventListener('input', () => this.bus.emit('stage-env', { exposure: Number(exp.value) }));
    shadow.addEventListener('input', () =>
      this.bus.emit('stage-env', { shadowOpacity: Number(shadow.value) }),
    );
    bgTop.addEventListener('input', () => this.bus.emit('stage-env', { bgTop: bgTop.value }));
    bgBottom.addEventListener('input', () =>
      this.bus.emit('stage-env', { bgBottom: bgBottom.value }),
    );
    gColor.addEventListener('input', () => this.bus.emit('stage-env', { groundColor: gColor.value }));

    q<HTMLButtonElement>('#preset-studio').addEventListener('click', () =>
      this.bus.emit('stage-env', { preset: 'studioDark' }),
    );
    q<HTMLButtonElement>('#preset-paper').addEventListener('click', () =>
      this.bus.emit('stage-env', { preset: 'paperLight' }),
    );
    q<HTMLButtonElement>('#g-shadow').addEventListener('click', () =>
      this.bus.emit('stage-env', { ground: 'shadowOnly' }),
    );
    q<HTMLButtonElement>('#g-solid').addEventListener('click', () =>
      this.bus.emit('stage-env', { ground: 'solid' }),
    );
    q<HTMLButtonElement>('#g-none').addEventListener('click', () =>
      this.bus.emit('stage-env', { ground: 'none' }),
    );
    q<HTMLButtonElement>('#tone-aces').addEventListener('click', () =>
      this.bus.emit('stage-env', { toneMapping: 'aces' }),
    );
    q<HTMLButtonElement>('#tone-neutral').addEventListener('click', () =>
      this.bus.emit('stage-env', { toneMapping: 'neutral' }),
    );
    q<HTMLButtonElement>('#tone-none').addEventListener('click', () =>
      this.bus.emit('stage-env', { toneMapping: 'none' }),
    );
  }

  private applyEnvUI(env: StageEnvParams): void {
    this.env = env;
    const q = <T extends HTMLElement>(sel: string): T => this.el.querySelector(sel) as T;
    (q('#stg-key') as HTMLInputElement).value = String(env.key);
    (q('#stg-fill') as HTMLInputElement).value = String(env.fill);
    (q('#stg-amb') as HTMLInputElement).value = String(env.ambient);
    (q('#stg-exp') as HTMLInputElement).value = String(env.exposure);
    (q('#stg-shadow') as HTMLInputElement).value = String(env.shadowOpacity);
    (q('#stg-bgtop') as HTMLInputElement).value = env.bgTop;
    (q('#stg-bgbottom') as HTMLInputElement).value = env.bgBottom;
    (q('#stg-gcolor') as HTMLInputElement).value = env.groundColor;
    q('#stg-key-v').textContent = env.key.toFixed(1);
    q('#stg-fill-v').textContent = env.fill.toFixed(2);
    q('#stg-amb-v').textContent = env.ambient.toFixed(2);
    q('#stg-exp-v').textContent = env.exposure.toFixed(2);
    q('#stg-shadow-v').textContent = env.shadowOpacity.toFixed(2);
    (q('#preset-studio') as HTMLButtonElement).classList.toggle('active', env.preset === 'studioDark');
    (q('#preset-paper') as HTMLButtonElement).classList.toggle('active', env.preset === 'paperLight');
    (q('#g-shadow') as HTMLButtonElement).classList.toggle('active', env.ground === 'shadowOnly');
    (q('#g-solid') as HTMLButtonElement).classList.toggle('active', env.ground === 'solid');
    (q('#g-none') as HTMLButtonElement).classList.toggle('active', env.ground === 'none');
    (q('#tone-aces') as HTMLButtonElement).classList.toggle('active', env.toneMapping === 'aces');
    (q('#tone-neutral') as HTMLButtonElement).classList.toggle('active', env.toneMapping === 'neutral');
    (q('#tone-none') as HTMLButtonElement).classList.toggle('active', env.toneMapping === 'none');
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function toHex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
