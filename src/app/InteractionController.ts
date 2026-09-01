import * as THREE from 'three';
import { nextCameraMode, type CameraRig } from '../render/CameraRig';
import type { HighlightLayer } from '../render/HighlightLayer';
import type { ModelRegistry } from '../render/ModelRegistry';
import type { NavGizmo } from '../render/NavGizmo';
import type { PickHit, PickingEngine, ViewportRect } from '../render/PickingEngine';
import { hitsEqual } from '../render/PickingEngine';
import type { StageController } from '../stage/StageController';
import type { AppMode, EventBus } from '../ui/EventBus';

export interface InteractionDeps {
  bus: EventBus;
  viewport: HTMLElement;
  rig: CameraRig;
  navGizmo: NavGizmo;
  picking: PickingEngine;
  models: ModelRegistry;
  stage: StageController;
  selectHighlight: HighlightLayer;
  hoverHighlight: HighlightLayer;
  getMode: () => AppMode;
  isLoading: () => boolean;
}

export class InteractionController {
  private hoverHit: PickHit | null = null;
  private selHit: PickHit | null = null;
  private pointerDirty = false;
  private lastClient: { x: number; y: number } | null = null;
  private downInfo: { x: number; y: number; button: number } | null = null;
  private dragMoved = false;
  private gridVisible = true;
  private bus: EventBus;

  constructor(private d: InteractionDeps) {
    this.bus = d.bus;

    d.bus.on('selection-changed', (hit) => {
      this.selHit = hit;
      this.refreshHighlights();
    });
    d.bus.on('hover-changed', (hit) => {
      this.hoverHit = hit;
      this.refreshHighlights();
    });
    d.bus.on('view-reset', () => this.resetView());
    d.bus.on('grid-changed', ({ visible }) => {
      this.gridVisible = visible;
    });
    d.bus.on('set-camera-mode', ({ mode }) => {
      d.rig.setMode(mode);
      d.bus.emit('camera-mode-changed', { mode });
    });
    d.bus.on('model-removed', ({ id }) => this.clearHitsFor(id));
    d.bus.on('model-shown-changed', ({ id, shown }) => {
      if (!shown) this.clearHitsFor(id);
    });

    this.wirePointer();
    this.wireDrop();
    this.wireKeyboard();
  }

  resetView(): void {
    const { rig, models, stage, getMode } = this.d;
    if (getMode() === 'stage') {
      rig.fitAll(stage.box(), rig.homeDir);
    } else {
      rig.fitAll(models.unionBox(new THREE.Box3()), rig.homeDir);
    }
  }

  onFrame(): void {
    const { picking, rig, navGizmo, getMode, isLoading } = this.d;
    if (
      getMode() === 'analysis' &&
      this.pointerDirty &&
      !rig.isActive() &&
      !navGizmo.isAnimating &&
      this.lastClient &&
      !isLoading()
    ) {
      this.pointerDirty = false;
      const hit = picking.pick(this.lastClient.x, this.lastClient.y, this.viewportRect(), 6);
      if (!hitsEqual(hit, this.hoverHit)) {
        this.hoverHit = hit;
        this.bus.emit('hover-changed', hit);
      }
    }
  }

  private clearHitsFor(modelId: string): void {
    let changed = false;
    if (this.selHit?.modelId === modelId) {
      this.selHit = null;
      this.bus.emit('selection-changed', null);
      changed = true;
    }
    if (this.hoverHit?.modelId === modelId) {
      this.hoverHit = null;
      this.bus.emit('hover-changed', null);
      changed = true;
    }
    if (!changed) this.refreshHighlights();
  }

  private refreshHighlights(): void {
    const { models, selectHighlight, hoverHighlight } = this.d;
    const selData = this.selHit ? (models.get(this.selHit.modelId)?.meshData ?? null) : null;
    selectHighlight.show(this.selHit, selData, true);
    const showHover =
      this.hoverHit && !hitsEqual(this.hoverHit, this.selHit)
        ? { hit: this.hoverHit, data: models.get(this.hoverHit.modelId)?.meshData ?? null }
        : null;
    hoverHighlight.show(showHover?.hit ?? null, showHover?.data ?? null, false);
  }

  private viewportRect(): ViewportRect {
    const r = this.d.viewport.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  private wirePointer(): void {
    const { viewport, picking, stage, getMode } = this.d;
    viewport.addEventListener('pointerdown', (e) => {
      this.downInfo = { x: e.clientX, y: e.clientY, button: e.button };
      this.dragMoved = false;
    });
    viewport.addEventListener('pointermove', (e) => {
      this.lastClient = { x: e.clientX, y: e.clientY };
      this.pointerDirty = true;
      if (this.downInfo) {
        const dx = e.clientX - this.downInfo.x;
        const dy = e.clientY - this.downInfo.y;
        if (dx * dx + dy * dy > 16) this.dragMoved = true;
      }
    });
    viewport.addEventListener('pointerup', (e) => {
      const wasClick =
        this.downInfo &&
        this.downInfo.button === 0 &&
        !this.dragMoved &&
        Math.abs(e.clientX - this.downInfo.x) + Math.abs(e.clientY - this.downInfo.y) <= 6;
      this.downInfo = null;
      if (!wasClick) return;
      if (getMode() === 'stage') {
        stage.handleClick(e);
        return;
      }
      const hit = picking.pick(e.clientX, e.clientY, this.viewportRect(), 10);
      this.bus.emit('selection-changed', hit);
    });
    viewport.addEventListener('pointerleave', () => {
      this.lastClient = null;
      this.pointerDirty = true;
      if (this.hoverHit) {
        this.hoverHit = null;
        this.bus.emit('hover-changed', null);
      }
    });
  }

  private wireDrop(): void {
    const { viewport } = this.d;
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
        this.bus.emit('open-file', { file });
      }
    });
  }

  private wireKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      const { stage, rig, getMode } = this.d;
      if (key === 'f') {
        if (getMode() === 'analysis') this.frameSelection();
      } else if (e.key === 'Home') this.resetView();
      else if (key === 'g') {
        if (getMode() === 'stage') stage.toggleGrid();
        else this.bus.emit('set-grid', { visible: !this.gridVisible });
      } else if (key === 'c') {
        this.bus.emit('set-camera-mode', { mode: nextCameraMode(rig.mode) });
      } else if (getMode() === 'stage') {
        if (key === 'w') this.bus.emit('stage-gizmo', { mode: 'translate' });
        else if (key === 'e') this.bus.emit('stage-gizmo', { mode: 'rotate' });
        else if (key === 'r') this.bus.emit('stage-gizmo', { mode: 'scale' });
        else if (e.key === 'Escape') stage.select(null, null);
      } else if (e.key === 'Escape') this.bus.emit('selection-changed', null);
    });
  }

  private frameSelection(): void {
    if (!this.selHit) {
      this.resetView();
      return;
    }
    const data = this.d.models.get(this.selHit.modelId)?.meshData;
    if (!data) {
      this.resetView();
      return;
    }
    const box = new THREE.Box3();
    const p = data.positions;
    if (this.selHit.kind === 'vertex') {
      box.expandByPoint(this.selHit.position);
    } else if (this.selHit.kind === 'edge') {
      for (const vi of [this.selHit.v0, this.selHit.v1]) {
        box.expandByPoint(new THREE.Vector3(p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2]));
      }
    } else {
      for (const vi of this.selHit.corners) {
        box.expandByPoint(new THREE.Vector3(p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2]));
      }
    }
    if (!box.isEmpty()) {
      const diag = box.min.distanceTo(box.max);
      box.expandByVector(new THREE.Vector3(diag, diag, diag).multiplyScalar(0.02));
      this.d.rig.frameBox(box, 4);
    } else {
      this.resetView();
    }
  }
}
