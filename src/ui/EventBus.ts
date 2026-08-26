import type { MeshStats } from '../core/MeshData';
import type { Colormap, CurvatureType } from '../core/Curvature';
import type { CameraMode } from '../render/CameraRig';
import type { LayerKey, LayerVisibility, SurfaceDiagnostic } from '../render/MeshView';
import type { PickHit } from '../render/PickingEngine';

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
  'set-model-pickable': { id: string; pickable: boolean };
  'model-pickable-changed': { id: string; pickable: boolean };
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
