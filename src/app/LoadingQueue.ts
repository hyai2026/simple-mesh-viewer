import * as THREE from 'three';
import { meshStats } from '../core/MeshData';
import { detectFormat, getParser } from '../io/ParserRegistry';
import { loadModelFile } from '../io/loadModelFile';
import { buildBVHAsync } from '../render/buildBVHAsync';
import type { CameraRig } from '../render/CameraRig';
import type { MeshView } from '../render/MeshView';
import type { ModelRegistry } from '../render/ModelRegistry';
import type { PickingEngine } from '../render/PickingEngine';
import type { StageController } from '../stage/StageController';
import type { AppMode, EventBus } from '../ui/EventBus';

export interface LoadingDeps {
  bus: EventBus;
  models: ModelRegistry;
  picking: PickingEngine;
  stage: StageController;
  rig: CameraRig;
  getMode: () => AppMode;
}

export class LoadingQueue {
  private pending: File[] = [];
  private loading = false;
  private bus: EventBus;

  constructor(private deps: LoadingDeps) {
    this.bus = deps.bus;
    this.bus.on('open-file', ({ file }) => this.enqueue(file));
    this.bus.on('cancel-load-queue', () => this.cancel());
  }

  get isLoading(): boolean {
    return this.loading;
  }

  enqueue(file: File): void {
    this.pending.push(file);
    this.bus.emit('load-queue-changed', { pending: this.pending.length });
    void this.drain();
  }

  cancel(): void {
    this.pending.length = 0;
    this.bus.emit('load-queue-changed', { pending: 0 });
  }

  ensureSpatialIndexAll(): void {
    for (const view of this.deps.models.all()) this.ensureSpatialIndex(view);
  }

  private ensureSpatialIndex(view: MeshView): void {
    if (view.hasBVH()) return;
    const data = view.meshData;
    if (!data?.renderIndex || !view.getSurfaceMesh()) return;
    this.bus.emit('busy', { active: true, label: '构建空间索引…' });
    buildBVHAsync(data.positions, data.renderIndex)
      .then((serialized) => {
        if (this.deps.models.get(view.id)) view.attachBVH(serialized);
      })
      .catch(() => {
        if (this.deps.models.get(view.id)) view.ensureBVH();
      })
      .finally(() => this.bus.emit('busy', { active: false }));
  }

  private async drain(): Promise<void> {
    if (this.loading) return;
    const next = this.pending.shift();
    if (!next) return;
    this.bus.emit('load-queue-changed', { pending: this.pending.length });
    await this.load(next);
    if (this.pending.length > 0) void this.drain();
  }

  private async load(file: File): Promise<void> {
    if (this.loading) return;
    const { models, picking, stage, rig, getMode } = this.deps;
    try {
      getParser(detectFormat(file.name));
    } catch (err) {
      this.bus.emit('file-error', { message: err instanceof Error ? err.message : String(err) });
      return;
    }
    this.loading = true;
    this.bus.emit('file-loading', { name: file.name });
    this.bus.emit('progress', { fraction: 0 });
    const t0 = performance.now();
    try {
      const mesh = await loadModelFile(file, (f) => this.bus.emit('progress', { fraction: f }));
      const view = models.add(mesh);
      picking.register(view);
      this.bus.emit('model-added', {
        id: view.id,
        name: mesh.fileName,
        stats: meshStats(mesh),
        ms: performance.now() - t0,
      });
      stage.onModelAdded(view);
      if (getMode() === 'stage') {
        rig.fitAll(stage.box());
      } else {
        rig.fitAll(models.unionBox(new THREE.Box3()));
      }
      this.bus.emit('model-layer-changed', { id: view.id, vis: view.getVisibility() });
      if (getMode() === 'analysis' && mesh.triangleCount > 0) {
        this.ensureSpatialIndex(view);
      }
    } catch (err) {
      this.bus.emit('file-error', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      this.loading = false;
    }
  }
}
