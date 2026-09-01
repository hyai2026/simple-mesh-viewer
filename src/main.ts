import './styles.css';
import * as THREE from 'three';
import type { SelectionState } from './core/SelectionStore';
import { SelectionStore } from './core/SelectionStore';
import { meshStats } from './core/MeshData';
import { derivePrincipal, normalizeForColormap, type Colormap, type CurvatureData, type CurvatureType, type NormalizedScalars } from './core/Curvature';
import { computeCurvatureAsync } from './io/computeCurvatureAsync';
import type { MeshView } from './render/MeshView';
import { detectFormat, getParser } from './io/ParserRegistry';
import { loadModelFile } from './io/loadModelFile';
import { buildBVHAsync } from './render/buildBVHAsync';
import { CameraRig, nextCameraMode, type CameraMode } from './render/CameraRig';
import { HighlightLayer } from './render/HighlightLayer';
import { ModelRegistry } from './render/ModelRegistry';
import { NavGizmo } from './render/NavGizmo';
import type { PickHit, ViewportRect } from './render/PickingEngine';
import { hitsEqual, PickingEngine } from './render/PickingEngine';
import { SceneManager } from './render/SceneManager';
import { EnvironmentPanel } from './ui/EnvironmentPanel';
import { DiagnosticsPanel } from './ui/DiagnosticsPanel';
import { ExportDialog } from './ui/ExportDialog';
import { EventBus, type LightingParams, DEFAULT_LIGHTING, type AppMode } from './ui/EventBus';
import { SelectionPanel } from './ui/SelectionPanel';
import { StatusBar } from './ui/StatusBar';
import { StagePanel } from './ui/StagePanel';
import { StageController } from './stage/StageController';
import { Toolbar } from './ui/Toolbar';

const viewport = document.getElementById('viewport') as HTMLElement;
const toolbarEl = document.getElementById('toolbar') as HTMLElement;
const infoEl = document.getElementById('info') as HTMLElement;
const statusEl = document.getElementById('statusbar') as HTMLElement;

const sidebarToggle = document.getElementById('sidebar-toggle') as HTMLButtonElement;
for (const type of ['pointerdown', 'pointerup'] as const) {
  sidebarToggle.addEventListener(type, (e) => e.stopPropagation());
}
sidebarToggle.addEventListener('click', () => {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  sidebarToggle.textContent = collapsed ? '⇤' : '⇥';
  sidebarToggle.title = collapsed ? '展开侧栏' : '收起侧栏';
});

const bus = new EventBus();
const sceneMgr = new SceneManager(viewport);
const rig = new CameraRig(sceneMgr.camera, viewport);
const models = new ModelRegistry(sceneMgr.root);
const navGizmo = new NavGizmo(viewport, sceneMgr.camera, () => rig.activeTarget());
const picking = new PickingEngine(sceneMgr.camera);
const selectHighlight = new HighlightLayer();
const hoverHighlight = new HighlightLayer();
sceneMgr.root.add(selectHighlight.group);
sceneMgr.root.add(hoverHighlight.group);
const selection = new SelectionStore();

new Toolbar(toolbarEl, bus);

const envSection = document.createElement('div');
const diagSection = document.createElement('div');
const selSection = document.createElement('div');
const stageSection = document.createElement('div');
envSection.className = 'analysis-only';
diagSection.className = 'analysis-only';
selSection.className = 'analysis-only';
infoEl.append(stageSection, envSection, diagSection, selSection);
new EnvironmentPanel(envSection, bus);
new DiagnosticsPanel(diagSection, bus);
new SelectionPanel(selSection, bus, models);
new ExportDialog(toolbarEl, bus);
new StatusBar(statusEl, bus);

const stage = new StageController(bus, sceneMgr.camera, viewport, models, sceneMgr.root, sceneMgr, rig);
new StagePanel(stageSection, bus);

let mode: AppMode = 'analysis';
const modePoses = new Map<AppMode, { position: THREE.Vector3; target: THREE.Vector3 }>();
const ANALYSIS_PROFILE = { toneMapping: THREE.NoToneMapping, exposure: 1, shadowMap: false } as const;

bus.on('set-mode', ({ mode: next }) => {
  if (next === mode) return;
  modePoses.set(mode, rig.getPose());
  mode = next;
  document.body.classList.toggle('mode-stage', next === 'stage');
  if (next === 'stage') {
    if (surfaceDiagnostic !== 'none') {
      surfaceDiagnostic = 'none';
      applyDiagnosticToAll();
    }
    stage.enter();
    sceneMgr.setActiveScene(stage.scene);
    sceneMgr.applyProfile(stage.profileParams());
  } else {
    stage.leave();
    sceneMgr.setActiveScene(null);
    sceneMgr.applyProfile({ ...ANALYSIS_PROFILE });
    for (const v of models.all()) ensureBVHWorker(v);
  }
  const saved = modePoses.get(next);
  if (saved) rig.setPose(saved);
  else if (next === 'stage') rig.fitAll(stage.box(), rig.homeDir);
  else resetView();
  bus.emit('mode-changed', { mode: next });
});

let isLoading = false;
let gridVisible = true;
let lighting: LightingParams = { ...DEFAULT_LIGHTING };
let surfaceDiagnostic: 'none' | 'zebra' | 'curvature' = 'none';
let curvOpts: { type: CurvatureType; colormap: Colormap } = { type: 'mean', colormap: 'jet' };
const curvatureCache = new Map<string, CurvatureData>();
const curvatureInflight = new Map<string, Promise<void>>();
let diagEpoch = 0;
let hoverHit: PickHit | null = null;
let selHit: PickHit | null = null;

let pointerDirty = false;
let lastClient: { x: number; y: number } | null = null;
let downInfo: { x: number; y: number; button: number } | null = null;
let dragMoved = false;

function applyLighting(): void {
  sceneMgr.hemiLight.intensity = lighting.hemi;
  sceneMgr.keyLight.intensity = lighting.key;
  sceneMgr.fillLight.intensity = lighting.fill;
  sceneMgr.setBackground(parseInt(lighting.background.slice(1), 16));
}
applyLighting();

bus.on('set-lighting', (partial) => {
  lighting = { ...lighting, ...partial };
  applyLighting();
  bus.emit('lighting-changed', lighting);
});

function viewportRect(): ViewportRect {
  const r = viewport.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function refreshHighlights(): void {
  const selData = selHit ? (models.get(selHit.modelId)?.meshData ?? null) : null;
  selectHighlight.show(selHit, selData, true);
  const showHover =
    hoverHit && !hitsEqual(hoverHit, selHit)
      ? { hit: hoverHit, data: models.get(hoverHit.modelId)?.meshData ?? null }
      : null;
  hoverHighlight.show(showHover?.hit ?? null, showHover?.data ?? null, false);
}

const pendingFiles: File[] = [];

async function drainQueue(): Promise<void> {
  if (isLoading) return;
  const next = pendingFiles.shift();
  if (!next) return;
  bus.emit('load-queue-changed', { pending: pendingFiles.length });
  await loadModel(next);
  if (pendingFiles.length > 0) void drainQueue();
}

function enqueueLoad(file: File): void {
  pendingFiles.push(file);
  bus.emit('load-queue-changed', { pending: pendingFiles.length });
  void drainQueue();
}

bus.on('cancel-load-queue', () => {
  pendingFiles.length = 0;
  bus.emit('load-queue-changed', { pending: 0 });
});

async function loadModel(file: File): Promise<void> {
  if (isLoading) return;
  try {
    getParser(detectFormat(file.name));
  } catch (err) {
    bus.emit('file-error', { message: err instanceof Error ? err.message : String(err) });
    return;
  }
  isLoading = true;
  bus.emit('file-loading', { name: file.name });
  bus.emit('progress', { fraction: 0 });
  const t0 = performance.now();
  try {
    const mesh = await loadModelFile(file, (f) => bus.emit('progress', { fraction: f }));
    const view = models.add(mesh);
    picking.register(view);
    bus.emit('model-added', {
      id: view.id,
      name: mesh.fileName,
      stats: meshStats(mesh),
      ms: performance.now() - t0,
    });
    stage.onModelAdded(view);
    if (mode === 'stage') {
      rig.fitAll(stage.box());
    } else {
      rig.fitAll(models.unionBox(new THREE.Box3()));
    }
    bus.emit('model-layer-changed', { id: view.id, vis: view.getVisibility() });
    if (mode === 'analysis' && surfaceDiagnostic !== 'none' && mesh.triangleCount > 0) {
      bus.emit('set-surface-diagnostic', { mode: surfaceDiagnostic });
    }
    if (mode === 'analysis' && mesh.triangleCount > 0) {
      ensureBVHWorker(view);
    }
  } catch (err) {
    bus.emit('file-error', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    isLoading = false;
  }
}

bus.on('open-file', ({ file }) => enqueueLoad(file));

bus.on('remove-model', ({ id }) => {
  stage.onModelRemoved(id);
  if (!models.remove(id)) return;
  picking.unregister(id);
  curvatureCache.delete(id);
  selection.clearModel(id);
  if (selHit?.modelId === id) {
    selHit = null;
    bus.emit('selection-changed', null);
  }
  if (hoverHit?.modelId === id) {
    hoverHit = null;
    bus.emit('hover-changed', null);
  }
  refreshHighlights();
  bus.emit('model-removed', { id });
  if (mode === 'stage') {
    if (stage.isStaged()) rig.fitAll(stage.box());
  } else {
    resetView();
  }
});

bus.on('set-model-layers', ({ id, partial }) => {
  const view = models.get(id);
  if (!view) return;
  const vis = view.mergeVisibility(partial);
  bus.emit('model-layer-changed', { id, vis });
});

bus.on('set-model-opacity', ({ id, opacity }) => {
  const view = models.get(id);
  if (!view) return;
  view.setOpacity(opacity);
});

bus.on('set-model-color', ({ id, layer, color }) => {
  const view = models.get(id);
  if (!view) return;
  view.setColor(layer, color);
  bus.emit('model-color-changed', { id, layer, color });
});

bus.on('set-model-pickable', ({ id, pickable }) => {
  const view = models.get(id);
  if (!view) return;
  view.setPickable(pickable);
  bus.emit('model-pickable-changed', { id, pickable });
});

bus.on('set-model-shown', ({ id, shown }) => {
  const view = models.get(id);
  if (!view) return;
  view.setShown(shown);
  if (selHit?.modelId === id) {
    selHit = null;
    bus.emit('selection-changed', null);
  }
  if (hoverHit?.modelId === id) {
    hoverHit = null;
    bus.emit('hover-changed', null);
  }
  refreshHighlights();
  bus.emit('model-shown-changed', { id, shown });
});

function ensureBVHWorker(view: MeshView): void {
  if (view.hasBVH()) return;
  const data = view.meshData;
  if (!data?.renderIndex || !view.getSurfaceMesh()) return;
  bus.emit('busy', { active: true, label: '构建空间索引…' });
  buildBVHAsync(data.positions, data.renderIndex)
    .then((serialized) => {
      if (models.get(view.id)) view.attachBVH(serialized);
    })
    .catch(() => {
      if (models.get(view.id)) view.ensureBVH();
    })
    .finally(() => bus.emit('busy', { active: false }));
}

function prefetchCurvature(view: MeshView): Promise<void> {
  if (curvatureCache.has(view.id)) return Promise.resolve();
  const existing = curvatureInflight.get(view.id);
  if (existing) return existing;
  const data = view.meshData;
  if (!data || !view.hasLayer('surface')) return Promise.resolve();
  const p = computeCurvatureAsync({
    positionCount: data.positionCount,
    positions: data.positions,
    renderIndex: data.renderIndex,
  })
    .then((cd) => {
      if (models.get(view.id)) curvatureCache.set(view.id, cd);
    })
    .catch(() => {
      // 计算失败时保持未缓存状态，下次触发会重试
    })
    .finally(() => {
      curvatureInflight.delete(view.id);
    });
  curvatureInflight.set(view.id, p);
  return p;
}

function scalarsFor(view: MeshView): NormalizedScalars | null {
  const cd = curvatureCache.get(view.id);
  if (!cd) return null;
  const values = derivePrincipal(curvOpts.type, cd.mean, cd.gauss);
  return normalizeForColormap(values, 0.02, 0.98, cd.valid);
}

function applyDiagnosticToView(view: MeshView): { min: number; max: number } | null {
  if (!view.meshData || !view.hasLayer('surface')) return null;
  let range: { min: number; max: number } | null = null;
  if (surfaceDiagnostic === 'curvature') {
    view.setColormap(curvOpts.colormap);
    const sc = scalarsFor(view);
    if (sc) {
      view.setCurvatureScalars(sc.data);
      range = { min: sc.min, max: sc.max };
    }
  }
  view.setSurfaceDiagnostic(surfaceDiagnostic);
  return range;
}

function applyDiagnosticToAll(): void {
  let lo = Infinity;
  let hi = -Infinity;
  let found = false;
  for (const view of models.all()) {
    const r = applyDiagnosticToView(view);
    if (r) {
      found = true;
      if (r.min < lo) lo = r.min;
      if (r.max > hi) hi = r.max;
    }
  }
  if (found) bus.emit('curvature-range', { min: lo, max: hi });
  bus.emit('surface-diagnostic-changed', { mode: surfaceDiagnostic });
}

bus.on('set-surface-diagnostic', ({ mode }) => {
  surfaceDiagnostic = mode;
  const epoch = ++diagEpoch;
  const views = models.all().filter((v) => v.meshData && v.hasLayer('surface'));
  if (mode === 'curvature' && views.some((v) => !curvatureCache.has(v.id))) {
    bus.emit('busy', { active: true, label: '计算曲率…' });
    void Promise.all(views.map(prefetchCurvature)).then(() => {
      bus.emit('busy', { active: false });
      if (epoch === diagEpoch) applyDiagnosticToAll();
    });
  } else {
    applyDiagnosticToAll();
  }
});

bus.on('set-zebra-density', ({ count }) => {
  for (const view of models.all()) view.setStripeCount(count);
});

bus.on('set-curvature-options', (opts) => {
  curvOpts = opts;
  bus.emit('curvature-options-changed', opts);
  if (surfaceDiagnostic !== 'curvature' || curvatureCache.size === 0) return;
  applyDiagnosticToAll();
});

bus.on('set-shading', ({ flat }) => {
  for (const view of models.all()) view.setShading(flat);
  bus.emit('shading-changed', { flat });
});

bus.on('set-grid', ({ visible }) => {
  gridVisible = visible;
  sceneMgr.setGridVisible(visible);
  bus.emit('grid-changed', { visible });
});

bus.on('set-headlight', ({ on }) => {
  sceneMgr.setHeadlight(on);
  bus.emit('headlight-changed', { on });
});

bus.on('set-navgizmo', ({ visible }) => {
  navGizmo.setVisible(visible);
  bus.emit('navgizmo-changed', { visible });
});

function timestamp(): string {
  const d = new Date();
  const p = (v: number): string => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

bus.on('export-image', async ({ scale, transparent }) => {
  bus.emit('busy', { active: true, label: '正在生成图像…' });
  await new Promise((r) => setTimeout(r, 10));
  if (mode === 'stage' && transparent) stage.setGroundVisible(false);
  try {
    const blob = await sceneMgr.renderToBlob(scale, transparent);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mesh-viewer-${timestamp()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    bus.emit('busy', { active: false });
  } catch (err) {
    bus.emit('busy', { active: false });
    bus.emit('file-error', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    if (mode === 'stage') stage.setGroundVisible(true);
  }
});

function setCameraMode(camMode: CameraMode): void {
  rig.setMode(camMode);
  bus.emit('camera-mode-changed', { mode: camMode });
}

bus.on('set-camera-mode', ({ mode }) => setCameraMode(mode));

function resetView(): void {
  if (mode === 'stage') {
    rig.fitAll(stage.box(), rig.homeDir);
  } else {
    rig.fitAll(models.unionBox(new THREE.Box3()), rig.homeDir);
  }
}

bus.on('view-reset', resetView);

bus.on('selection-changed', (hit) => {
  selHit = hit;
  selection.set(
    hit
      ? ({ modelId: hit.modelId, kind: hit.kind, index: hit.index } as SelectionState)
      : { kind: 'none' },
  );
  refreshHighlights();
});

bus.on('hover-changed', (hit) => {
  hoverHit = hit;
  refreshHighlights();
});

viewport.addEventListener('pointerdown', (e) => {
  downInfo = { x: e.clientX, y: e.clientY, button: e.button };
  dragMoved = false;
});

viewport.addEventListener('pointermove', (e) => {
  lastClient = { x: e.clientX, y: e.clientY };
  pointerDirty = true;
  if (downInfo) {
    const dx = e.clientX - downInfo.x;
    const dy = e.clientY - downInfo.y;
    if (dx * dx + dy * dy > 16) dragMoved = true;
  }
});

viewport.addEventListener('pointerup', (e) => {
  const wasClick =
    downInfo &&
    downInfo.button === 0 &&
    !dragMoved &&
    Math.abs(e.clientX - downInfo.x) + Math.abs(e.clientY - downInfo.y) <= 6;
  downInfo = null;
  if (!wasClick) return;
  if (mode === 'stage') {
    stage.handleClick(e);
    return;
  }
  const hit = picking.pick(e.clientX, e.clientY, viewportRect(), 10);
  bus.emit('selection-changed', hit);
});

viewport.addEventListener('pointerleave', () => {
  lastClient = null;
  pointerDirty = true;
  if (hoverHit) {
    hoverHit = null;
    bus.emit('hover-changed', null);
  }
});

viewport.addEventListener('dragenter', (e) => {
  e.preventDefault();
  viewport.classList.add('dropping');
});
viewport.addEventListener('dragover', (e) => {
  e.preventDefault();
});
viewport.addEventListener('dragleave', () => {
  viewport.classList.remove('dropping');
});
viewport.addEventListener('drop', (e) => {
  e.preventDefault();
  viewport.classList.remove('dropping');
  for (const file of Array.from(e.dataTransfer?.files ?? [])) {
    enqueueLoad(file);
  }
});

function frameSelection(): void {
  if (!selHit) {
    resetView();
    return;
  }
  const data = models.get(selHit.modelId)?.meshData;
  if (!data) {
    resetView();
    return;
  }
  const box = new THREE.Box3();
  const p = data.positions;
  if (selHit.kind === 'vertex') {
    box.expandByPoint(selHit.position);
  } else if (selHit.kind === 'edge') {
    for (const vi of [selHit.v0, selHit.v1]) {
      box.expandByPoint(new THREE.Vector3(p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2]));
    }
  } else {
    for (const vi of selHit.corners) {
      box.expandByPoint(new THREE.Vector3(p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2]));
    }
  }
  if (!box.isEmpty()) {
    const diag = box.min.distanceTo(box.max);
    box.expandByVector(new THREE.Vector3(diag, diag, diag).multiplyScalar(0.02));
    rig.frameBox(box, 4);
  } else {
    resetView();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const key = e.key.toLowerCase();
  if (key === 'f') {
    if (mode === 'analysis') frameSelection();
  } else if (e.key === 'Home') resetView();
  else if (key === 'g') {
    if (mode === 'stage') stage.toggleGrid();
    else bus.emit('set-grid', { visible: !gridVisible });
  } else if (key === 'c') {
    bus.emit('set-camera-mode', { mode: nextCameraMode(rig.mode) });
  } else if (mode === 'stage') {
    if (key === 'w') bus.emit('stage-gizmo', { mode: 'translate' });
    else if (key === 'e') bus.emit('stage-gizmo', { mode: 'rotate' });
    else if (key === 'r') bus.emit('stage-gizmo', { mode: 'scale' });
    else if (e.key === 'Escape') stage.select(null, null);
  } else if (e.key === 'Escape') bus.emit('selection-changed', null);
});

sceneMgr.start(
  (dt) => {
    if (!navGizmo.isAnimating) rig.update();
    if (navGizmo.update(dt)) rig.adoptExternalPose(navGizmo.focusPoint);
    if (
      mode === 'analysis' &&
      pointerDirty &&
      !rig.isActive() &&
      !navGizmo.isAnimating &&
      lastClient &&
      !isLoading
    ) {
      pointerDirty = false;
      const hit = picking.pick(lastClient.x, lastClient.y, viewportRect(), 6);
      if (!hitsEqual(hit, hoverHit)) {
        hoverHit = hit;
        bus.emit('hover-changed', hit);
      }
    }
  },
  () => navGizmo.render(),
);

