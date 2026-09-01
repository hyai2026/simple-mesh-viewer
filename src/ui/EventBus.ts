import type { MeshStats } from '../core/MeshData';
import type { Colormap, CurvatureType } from '../core/Curvature';
import type { CameraMode } from '../render/CameraRig';
import type { LayerKey, LayerVisibility, SurfaceDiagnostic } from '../render/MeshView';
import type { PickHit } from '../render/PickingEngine';
import type { StageTreeSnapshot } from '../stage/StageModel';
import type { StageEnvParams, StagePreset } from '../stage/StageScene';

export type AppMode = 'analysis' | 'stage';
export type StageGizmoMode = 'translate' | 'rotate' | 'scale';
export type StageGizmoSpace = 'world' | 'local';

export interface StageTransformPayload {
  unitId: string | null;
  modelId: string | null;
  position: [number, number, number];
  rotationDeg: [number, number, number];
  scale: [number, number, number];
}

export interface LightingParams {
  hemi: number;
  key: number;
  fill: number;
  background: string;
}

export const DEFAULT_LIGHTING: LightingParams = {
  hemi: 1.9,
  key: 3.4,
  fill: 1.2,
  background: '#1a1d22',
};

export interface EventMap {
  'open-file': { file: File };
  'load-queue-changed': { pending: number };
  'cancel-load-queue': Record<string, never>;
  'progress': { fraction: number };
  'file-loading': { name: string };
  'file-error': { message: string };
  'model-added': { id: string; name: string; stats: MeshStats; ms: number };
  'model-removed': { id: string };
  'remove-model': { id: string };
  'set-model-layers': { id: string; partial: Partial<LayerVisibility> };
  'model-layer-changed': { id: string; vis: LayerVisibility };
  'set-model-opacity': { id: string; opacity: number };
  'model-opacity-changed': { id: string; opacity: number };
  'set-model-color': { id: string; layer: LayerKey; color: number };
  'model-color-changed': { id: string; layer: LayerKey; color: number };
  'set-model-pickable': { id: string; pickable: boolean };
  'model-pickable-changed': { id: string; pickable: boolean };
  'set-model-shown': { id: string; shown: boolean };
  'model-shown-changed': { id: string; shown: boolean };
  'set-shading': { flat: boolean };
  'shading-changed': { flat: boolean };
  'set-grid': { visible: boolean };
  'grid-changed': { visible: boolean };
  'set-lighting': Partial<LightingParams>;
  'lighting-changed': LightingParams;
  'view-reset': Record<string, never>;
  'set-camera-mode': { mode: CameraMode };
  'camera-mode-changed': { mode: CameraMode };
  'set-headlight': { on: boolean };
  'headlight-changed': { on: boolean };
  'set-navgizmo': { visible: boolean };
  'navgizmo-changed': { visible: boolean };
  'hover-changed': PickHit | null;
  'selection-changed': PickHit | null;
  'set-surface-diagnostic': { mode: SurfaceDiagnostic };
  'surface-diagnostic-changed': { mode: SurfaceDiagnostic };
  'set-zebra-density': { count: number };
  'set-curvature-options': { type: CurvatureType; colormap: Colormap };
  'curvature-options-changed': { type: CurvatureType; colormap: Colormap };
  'curvature-range': { min: number; max: number };
  'export-image': { scale: number; transparent: boolean };
  'busy': { active: boolean; label?: string };
  'set-mode': { mode: AppMode };
  'mode-changed': { mode: AppMode };
  'stage-select': { unitId: string | null; modelId?: string | null };
  'stage-selection-changed': { unitId: string | null; modelId: string | null };
  'stage-transform-changed': StageTransformPayload;
  'stage-set-transform': StageTransformPayload;
  'stage-gizmo': { mode: StageGizmoMode; space?: StageGizmoSpace };
  'stage-gizmo-changed': { mode: StageGizmoMode; space: StageGizmoSpace };
  'stage-group': { modelIds: string[] };
  'stage-ungroup': { groupId: string };
  'stage-rename': { groupId: string; name: string };
  'stage-structure-changed': { tree: StageTreeSnapshot };
  'stage-arrange': Record<string, never>;
  'stage-arranged': { count: number };
  'stage-env': Partial<StageEnvParams> & { preset?: StagePreset };
  'stage-env-changed': StageEnvParams;
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private map = new Map<keyof EventMap, Set<Handler<never>>>();

  on<K extends keyof EventMap>(key: K, handler: Handler<EventMap[K]>): () => void {
    let set = this.map.get(key);
    if (!set) {
      set = new Set();
      this.map.set(key, set);
    }
    set.add(handler as Handler<never>);
    return () => {
      set!.delete(handler as Handler<never>);
    };
  }

  emit<K extends keyof EventMap>(key: K, payload: EventMap[K]): void {
    const set = this.map.get(key);
    if (!set) return;
    for (const h of [...set]) (h as Handler<EventMap[K]>)(payload);
  }
}
