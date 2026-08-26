export type SelectionState =
  | { kind: 'none' }
  | { modelId: string; kind: 'vertex'; index: number }
  | { modelId: string; kind: 'face'; index: number }
  | { modelId: string; kind: 'edge'; index: number };

export class SelectionStore {
  private state: SelectionState = { kind: 'none' };
  private listeners = new Set<(s: SelectionState) => void>();

  get(): SelectionState {
    return this.state;
  }

  set(s: SelectionState): void {
    this.state = s;
    for (const l of this.listeners) l(s);
  }

  clear(): void {
    this.set({ kind: 'none' });
  }

  clearModel(modelId: string): boolean {
    if (this.state.kind !== 'none' && this.state.modelId === modelId) {
      this.clear();
      return true;
    }
    return false;
  }

  onChange(l: (s: SelectionState) => void): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
}
