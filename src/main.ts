import './styles.css';
import * as THREE from 'three';
import type { SelectionState } from './core/SelectionStore';
import { SelectionStore } from './core/SelectionStore';
import { meshStats } from './core/MeshData';
import { computeCurvature, derivePrincipal, normalizeForColormap, type Colormap, type CurvatureData, type CurvatureType, type NormalizedScalars } from './core/Curvature';
import type { MeshView } from './render/MeshView';
import { detectFormat, getParser } from './io/ParserRegistry';
import { loadModelFile } from './io/loadModelFile';
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
import { EventBus, type LightingParams, DEFAULT_LIGHTING } from './ui/EventBus';
import { ModelList } from './ui/ModelList';
import { SelectionPanel } from './ui/SelectionPanel';
import { StatusBar } from './ui/StatusBar';
import { Toolbar } from './ui/Toolbar';

const viewport = document.getElementById('viewport') as HTMLElement;
const toolbarEl = document.getElementById('toolbar') as HTMLElement;
const infoEl = document.getElementById('info') as HTMLElement;
const statusEl = document.getElementById('statusbar') as HTMLElement;

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

const listSection = document.createElement('div');
const envSection = document.createElement('div');
const diagSection = document.createElement('div');
const selSection = document.createElement('div');
infoEl.append(listSection, envSection, diagSection, selSection);
new ModelList(listSection, bus);
new EnvironmentPanel(envSection, bus);
new DiagnosticsPanel(diagSection, bus);
new SelectionPanel(selSection, bus, models);
new ExportDialog(toolbarEl, bus);
new StatusBar(statusEl, bus);

let isLoading = false;
let gridVisible = true;
let lighting: LightingParams = { ...DEFAULT_LIGHTING };
let surfaceDiagnostic: 'none' | 'zebra' | 'curvature' = 'none';
let curvOpts: { type: CurvatureType; colormap: Colormap } = { type: 'mean', colormap: 'jet' };
const curvatureCache = new Map<string, CurvatureData>();
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
  await loadModel(next);
  if (pendingFiles.length > 0) void drainQueue();
}

function enqueueLoad(file: File): void {
  pendingFiles.push(file);
  void drainQueue();
}

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
    rig.fitAll(models.unionBox(new THREE.Box3()));
    bus.emit('model-added', {
      id: view.id,
      name: mesh.fileName,
      stats: meshStats(mesh),
      ms: performance.now() - t0,
    });
    bus.emit('model-layer-changed', { id: view.id, vis: view.getVisibility() });
    if (surfaceDiagnostic !== 'none' && mesh.triangleCount > 0) {
      bus.emit('set-surface-diagnostic', { mode: surfaceDiagnostic });
    }
    if (mesh.triangleCount > 0) {
      bus.emit('busy', { active: true, label: '构建空间索引…' });
      setTimeout(() => {
        view.ensureBVH();
        bus.emit('busy', { active: false });
      }, 30);
    }
  } catch (err) {
    bus.emit('file-error', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    isLoading = false;
  }
}

bus.on('open-file', ({ file }) => enqueueLoad(file));

bus.on('remove-model', ({ id }) => {
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
  resetView();
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
});

bus.on('set-model-pickable', ({ id, pickable }) => {
  const view = models.get(id);
  if (!view) return;
  view.setPickable(pickable);
  bus.emit('model-pickable-changed', { id, pickable });
});

function scalarsFor(view: MeshView): NormalizedScalars {
  const data = view.meshData;
  if (!data) return { data: new Float32Array(0), min: 0, max: 0 };
  let cd = curvatureCache.get(view.id);
  if (!cd) {
    cd = computeCurvature(data);
    curvatureCache.set(view.id, cd);
  }
  const values = derivePrincipal(curvOpts.type, cd.mean, cd.gauss);
  return normalizeForColormap(values, 0.02, 0.98, cd.valid);
}

function applyDiagnosticToView(view: MeshView): void {
  if (!view.meshData || !view.hasLayer('surface')) return;
    if (surfaceDiagnostic === 'curvature') {
      view.setColormap(curvOpts.colormap);
      const { data: scalars, min, max } = scalarsFor(view);
      view.setCurvatureScalars(scalars);
      bus.emit('curvature-range', { min, max });
    }
    view.setSurfaceDiagnostic(surfaceDiagnostic);
}

function applyDiagnosticToAll(): void {
  for (const view of models.all()) applyDiagnosticToView(view);
  bus.emit('surface-diagnostic-changed', { mode: surfaceDiagnostic });
}

function needsCurvatureCompute(): boolean {
  return models
    .all()
    .some((v) => v.meshData && v.hasLayer('surface') && !curvatureCache.has(v.id));
}

bus.on('set-surface-diagnostic', ({ mode }) => {
  surfaceDiagnostic = mode;
  if (needsCurvatureCompute()) {
    bus.emit('busy', { active: true, label: '计算曲率…' });
    setTimeout(() => {
      applyDiagnosticToAll();
      bus.emit('busy', { active: false });
    }, 10);
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
  bus.emit('busy', { active: true, label: '更新色带…' });
  setTimeout(() => {
    for (const view of models.all()) {
      if (!view.meshData || !view.hasLayer('surface')) continue;
      view.setColormap(curvOpts.colormap);
      const { data: scalars, min, max } = scalarsFor(view);
      view.setCurvatureScalars(scalars);
      bus.emit('curvature-range', { min, max });
    }
    bus.emit('busy', { active: false });
  }, 10);
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
  }
});

function setCameraMode(mode: CameraMode): void {
  rig.setMode(mode);
  bus.emit('camera-mode-changed', { mode });
}

bus.on('set-camera-mode', ({ mode }) => setCameraMode(mode));

function resetView(): void {
  rig.fitAll(models.unionBox(new THREE.Box3()), rig.homeDir);
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
  const hit = picking.pick(e.clientX, e.clientY, viewportRect(), 10);
  bus.emit('selection-changed', hit);
});

viewport.addEventListener('pointerleave', () => {
  lastClient = null;
  pointerDirty = true;
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
  const key = e.key.toLowerCase();
  if (key === 'f') frameSelection();
  else if (e.key === 'Home') resetView();
  else if (key === 'g') bus.emit('set-grid', { visible: !gridVisible });
  else if (key === 'c') {
    bus.emit('set-camera-mode', { mode: nextCameraMode(rig.mode) });
  }
  else if (e.key === 'Escape') bus.emit('selection-changed', null);
});

sceneMgr.start(
  (dt) => {
    if (!navGizmo.isAnimating) rig.update();
    if (navGizmo.update(dt)) rig.adoptExternalPose(navGizmo.focusPoint);
    if (pointerDirty && !rig.isActive() && !navGizmo.isAnimating && lastClient && !isLoading) {
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
