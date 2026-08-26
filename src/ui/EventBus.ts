import type { MeshStats } from '../core/MeshData';
import type { LayerKey, LayerVisibility } from '../render/MeshView';
import type { PickHit } from '../render/PickingEngine';

export interface LightingParams {
  hemi: number;
  key: number;
  fill: number;
  background: string;
}

export const DEFAULT_LIGHTING: LightingParams = {
  hemi: 1.5,
  key: 2.8,
  fill: 0.9,
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
  'set-shading': { flat: boolean };
  'shading-changed': { flat: boolean };
  'set-grid': { visible: boolean };
  'grid-changed': { visible: boolean };
  'set-lighting': Partial<LightingParams>;
  'lighting-changed': LightingParams;
  'view-reset': Record<string, never>;
  'hover-changed': PickHit | null;
  'selection-changed': PickHit | null;
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
