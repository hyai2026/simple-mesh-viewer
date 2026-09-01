import type { CameraMode } from '../render/CameraRig';
import type { EventBus, StageGizmoMode, StageGizmoSpace } from './EventBus';

const TEMPLATE = `
<span class="brand">Mesh Viewer</span>
<div class="seg" id="seg-mode">
  <button id="btn-mode-analysis" class="seg-btn active" title="几何分析模式">分析</button>
  <button id="btn-mode-stage" class="seg-btn" title="舞台展示模式">舞台</button>
</div>
<span class="sep"></span>
<button id="btn-open" class="btn primary">打开…</button>
<input id="file-input" type="file" accept=".obj,.ply" multiple hidden />
<div class="seg stage-only" id="seg-gizmo">
  <button id="btn-g-translate" class="seg-btn active" title="移动 (W)">移动</button>
  <button id="btn-g-rotate" class="seg-btn" title="旋转 (E)">旋转</button>
  <button id="btn-g-scale" class="seg-btn" title="缩放 (R)">缩放</button>
</div>
<div class="seg stage-only" id="seg-space">
  <button id="btn-sp-world" class="seg-btn active">世界</button>
  <button id="btn-sp-local" class="seg-btn">局部</button>
</div>
<button id="btn-arrange" class="btn stage-only" title="自动网格排布（PCA 摆正 + 统一缩放 + 贴地）">自动排布</button>
<span class="sep analysis-only"></span>
<div class="seg analysis-only">
  <button id="btn-flat" class="seg-btn active">平直</button>
  <button id="btn-smooth" class="seg-btn">平滑</button>
</div>
<div class="seg">
  <button id="btn-orbit" class="seg-btn">轨道</button>
  <button id="btn-ball" class="seg-btn">球面</button>
  <button id="btn-arc" class="seg-btn active">弧球</button>
</div>
<div class="seg analysis-only">
  <button id="btn-diag-none" class="seg-btn active">无</button>
  <button id="btn-diag-zebra" class="seg-btn">斑马纹</button>
  <button id="btn-diag-curv" class="seg-btn">曲率</button>
</div>
<label class="chip analysis-only"><input type="checkbox" id="chk-headlight" checked /><span>头灯</span></label>
<label class="chip"><input type="checkbox" id="chk-navgizmo" checked /><span>视向轴</span></label>
<span class="sep analysis-only"></span>
<label class="chip analysis-only"><input type="checkbox" id="chk-grid" checked /><span>网格地面</span></label>
<button id="btn-reset" class="btn">复位视图</button>
<div class="spacer"></div>
<span class="hint-text">拖放 .obj / .ply · C 视角模式 · Home 全景 · G 网格 · 舞台: W/E/R 变换 · Esc 取消</span>
`;

export class Toolbar {
  private btnFlat: HTMLButtonElement;
  private btnSmooth: HTMLButtonElement;
  private chkGrid: HTMLInputElement;
  private fileInput: HTMLInputElement;

  constructor(el: HTMLElement, bus: EventBus) {
    el.innerHTML = TEMPLATE;
    const q = <T extends HTMLElement>(sel: string): T => el.querySelector(sel) as T;
    this.btnFlat = q<HTMLButtonElement>('#btn-flat');
    this.btnSmooth = q<HTMLButtonElement>('#btn-smooth');
    this.chkGrid = q<HTMLInputElement>('#chk-grid');
    this.fileInput = q<HTMLInputElement>('#file-input');

    q<HTMLButtonElement>('#btn-open').addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => {
      for (const f of Array.from(this.fileInput.files ?? [])) {
        bus.emit('open-file', { file: f });
      }
      this.fileInput.value = '';
    });

    const btnAnalysis = q<HTMLButtonElement>('#btn-mode-analysis');
    const btnStage = q<HTMLButtonElement>('#btn-mode-stage');
    const setModeButtons = (mode: string): void => {
      btnAnalysis.classList.toggle('active', mode === 'analysis');
      btnStage.classList.toggle('active', mode === 'stage');
    };
    btnAnalysis.addEventListener('click', () => bus.emit('set-mode', { mode: 'analysis' }));
    btnStage.addEventListener('click', () => bus.emit('set-mode', { mode: 'stage' }));
    bus.on('mode-changed', ({ mode }) => setModeButtons(mode));

    this.btnFlat.addEventListener('click', () => bus.emit('set-shading', { flat: true }));
    this.btnSmooth.addEventListener('click', () => bus.emit('set-shading', { flat: false }));
    this.chkGrid.addEventListener('change', () =>
      bus.emit('set-grid', { visible: this.chkGrid.checked }),
    );
    q<HTMLButtonElement>('#btn-reset').addEventListener('click', () =>
      bus.emit('view-reset', {}),
    );

    const btnOrbit = q<HTMLButtonElement>('#btn-orbit');
    const btnBall = q<HTMLButtonElement>('#btn-ball');
    const btnArc = q<HTMLButtonElement>('#btn-arc');
    const setCamButtons = (mode: CameraMode): void => {
      btnOrbit.classList.toggle('active', mode === 'orbit');
      btnBall.classList.toggle('active', mode === 'trackball');
      btnArc.classList.toggle('active', mode === 'arcball');
    };
    const emitMode = (mode: CameraMode): void => {
      setCamButtons(mode);
      bus.emit('set-camera-mode', { mode });
    };
    btnOrbit.addEventListener('click', () => emitMode('orbit'));
    btnBall.addEventListener('click', () => emitMode('trackball'));
    btnArc.addEventListener('click', () => emitMode('arcball'));

    q<HTMLInputElement>('#chk-headlight').addEventListener('change', (e) =>
      bus.emit('set-headlight', { on: (e.target as HTMLInputElement).checked }),
    );

    const diagButtons: Array<[HTMLButtonElement, string]> = [
      [q<HTMLButtonElement>('#btn-diag-none'), 'none'],
      [q<HTMLButtonElement>('#btn-diag-zebra'), 'zebra'],
      [q<HTMLButtonElement>('#btn-diag-curv'), 'curvature'],
    ];
    const setDiagButtons = (mode: string): void => {
      for (const [btn, m] of diagButtons) btn.classList.toggle('active', m === mode);
    };
    for (const [btn, m] of diagButtons) {
      btn.addEventListener('click', () => {
        setDiagButtons(m);
        bus.emit('set-surface-diagnostic', { mode: m as 'none' | 'zebra' | 'curvature' });
      });
    }

    bus.on('surface-diagnostic-changed', ({ mode }) => setDiagButtons(mode));
    q<HTMLInputElement>('#chk-navgizmo').addEventListener('change', (e) =>
      bus.emit('set-navgizmo', { visible: (e.target as HTMLInputElement).checked }),
    );

    bus.on('shading-changed', ({ flat }) => {
      this.btnFlat.classList.toggle('active', flat);
      this.btnSmooth.classList.toggle('active', !flat);
    });
    bus.on('grid-changed', ({ visible }) => {
      this.chkGrid.checked = visible;
    });
    bus.on('camera-mode-changed', ({ mode }) => setCamButtons(mode));

    const gizmoButtons: Array<[HTMLButtonElement, StageGizmoMode]> = [
      [q<HTMLButtonElement>('#btn-g-translate'), 'translate'],
      [q<HTMLButtonElement>('#btn-g-rotate'), 'rotate'],
      [q<HTMLButtonElement>('#btn-g-scale'), 'scale'],
    ];
    const spaceButtons: Array<[HTMLButtonElement, StageGizmoSpace]> = [
      [q<HTMLButtonElement>('#btn-sp-world'), 'world'],
      [q<HTMLButtonElement>('#btn-sp-local'), 'local'],
    ];
    let curSpace: StageGizmoSpace = 'world';
    const currentGizmoMode = (): StageGizmoMode => {
      for (const [btn, m] of gizmoButtons) if (btn.classList.contains('active')) return m;
      return 'translate';
    };
    const setGizmoButtons = (mode: StageGizmoMode, space: StageGizmoSpace): void => {
      curSpace = space;
      for (const [btn, m] of gizmoButtons) btn.classList.toggle('active', m === mode);
      for (const [btn, m] of spaceButtons) btn.classList.toggle('active', m === space);
    };
    for (const [btn, m] of gizmoButtons) {
      btn.addEventListener('click', () => bus.emit('stage-gizmo', { mode: m, space: curSpace }));
    }
    for (const [btn, m] of spaceButtons) {
      btn.addEventListener('click', () =>
        bus.emit('stage-gizmo', { mode: currentGizmoMode(), space: m }),
      );
    }
    bus.on('stage-gizmo-changed', ({ mode, space }) => setGizmoButtons(mode, space));

    q<HTMLButtonElement>('#btn-arrange').addEventListener('click', () =>
      bus.emit('stage-arrange', {}),
    );
  }

  toggleGrid(): void {
    this.chkGrid.checked = !this.chkGrid.checked;
    this.chkGrid.dispatchEvent(new Event('change'));
  }
}
