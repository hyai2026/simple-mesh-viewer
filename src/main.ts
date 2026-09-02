import './styles.css';
import * as THREE from 'three';
import { DiagnosticsController } from './app/DiagnosticsController';
import { InteractionController } from './app/InteractionController';
import { LoadingQueue } from './app/LoadingQueue';
import { CameraRig } from './render/CameraRig';
import { HighlightLayer } from './render/HighlightLayer';
import { ModelRegistry } from './render/ModelRegistry';
import { NavGizmo } from './render/NavGizmo';
import { PickingEngine } from './render/PickingEngine';
import { SceneManager } from './render/SceneManager';
import { StageController } from './stage/StageController';
import { EnvironmentPanel } from './ui/EnvironmentPanel';
import { DiagnosticsPanel } from './ui/DiagnosticsPanel';
import { ExportDialog } from './ui/ExportDialog';
import { EventBus, type LightingParams, DEFAULT_LIGHTING, type AppMode } from './ui/EventBus';
import { SelectionPanel } from './ui/SelectionPanel';
import { StatusBar } from './ui/StatusBar';
import { StagePanel } from './ui/StagePanel';
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
new StagePanel(stageSection, bus, models);

let mode: AppMode = 'analysis';
const getMode = (): AppMode => mode;

const diagnostics = new DiagnosticsController(bus, models, getMode);
const loading = new LoadingQueue({ bus, models, picking, stage, rig, getMode });
const interaction = new InteractionController({
  bus,
  viewport,
  rig,
  navGizmo,
  picking,
  models,
  stage,
  selectHighlight,
  hoverHighlight,
  getMode,
  isLoading: () => loading.isLoading,
});

const modePoses = new Map<AppMode, { position: THREE.Vector3; target: THREE.Vector3 }>();
const ANALYSIS_PROFILE = { toneMapping: THREE.NoToneMapping, exposure: 1, shadowMap: false } as const;

bus.on('set-mode', ({ mode: next }) => {
  if (next === mode) return;
  modePoses.set(mode, rig.getPose());
  mode = next;
  document.body.classList.toggle('mode-stage', next === 'stage');
  if (next === 'stage') {
    diagnostics.resetToNone();
    stage.enter();
    sceneMgr.setActiveScene(stage.scene);
    sceneMgr.applyProfile(stage.profileParams());
  } else {
    stage.leave();
    sceneMgr.setActiveScene(null);
    sceneMgr.applyProfile({ ...ANALYSIS_PROFILE });
    loading.ensureSpatialIndexAll();
  }
  const saved = modePoses.get(next);
  if (saved) rig.setPose(saved);
  else if (next === 'stage') rig.fitAll(stage.box(), rig.homeDir);
  else interaction.resetView();
  bus.emit('mode-changed', { mode: next });
});

let lighting: LightingParams = { ...DEFAULT_LIGHTING };

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

bus.on('remove-model', ({ id }) => {
  if (!models.remove(id)) return;
  picking.unregister(id);
  stage.onModelRemoved(id);
  bus.emit('model-removed', { id });
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
  bus.emit('model-shown-changed', { id, shown });
});

bus.on('set-shading', ({ flat }) => {
  for (const view of models.all()) view.setShading(flat);
  bus.emit('shading-changed', { flat });
});

bus.on('set-grid', ({ visible }) => {
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

sceneMgr.start(
  (dt) => {
    if (!navGizmo.isAnimating) rig.update();
    if (navGizmo.update(dt)) rig.adoptExternalPose(navGizmo.focusPoint);
    interaction.onFrame();
  },
  () => navGizmo.render(),
);
