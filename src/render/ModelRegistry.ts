import * as THREE from 'three';
import type { MeshData } from '../core/MeshData';
import { MeshView } from './MeshView';

export class ModelRegistry {
  private items = new Map<string, MeshView>();
  private seq = 0;

  constructor(private root: THREE.Group) {}

  get count(): number {
    return this.items.size;
  }

  add(data: MeshData): MeshView {
    this.seq++;
    const view = new MeshView(`m${this.seq}`, data.fileName);
    view.build(data);
    this.root.add(view.group);
    this.items.set(view.id, view);
    return view;
  }

  remove(id: string): boolean {
    const view = this.items.get(id);
    if (!view) return false;
    this.root.remove(view.group);
    view.dispose();
    this.items.delete(id);
    return true;
  }

  get(id: string): MeshView | null {
    return this.items.get(id) ?? null;
  }

  all(): MeshView[] {
    return [...this.items.values()];
  }

  unionBox(target: THREE.Box3): THREE.Box3 {
    target.makeEmpty();
    for (const view of this.items.values()) {
      if (!view.boundingBox.isEmpty()) target.union(view.boundingBox);
    }
    return target;
  }
}
