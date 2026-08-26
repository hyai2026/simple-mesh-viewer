import type { MeshData } from './MeshData';

export interface VertexAdjacency {
  offsets: Uint32Array;
  edgeIds: Uint32Array;
}

export function buildVertexEdgeAdjacency(data: MeshData): VertexAdjacency | null {
  if (!data.edges) return null;
  const n = data.positionCount;
  const counts = new Uint32Array(n + 1);
  const m = data.edges.length >> 1;
  for (let i = 0; i < m; i++) {
    counts[data.edges[i * 2] + 1]++;
    counts[data.edges[i * 2 + 1] + 1]++;
  }
  for (let i = 0; i < n; i++) counts[i + 1] += counts[i];
  const edgeIds = new Uint32Array(m * 2);
  const cursor = counts.slice(0, n);
  for (let i = 0; i < m; i++) {
    const a = data.edges[i * 2];
    const b = data.edges[i * 2 + 1];
    edgeIds[cursor[a]++] = i;
    edgeIds[cursor[b]++] = i;
  }
  return { offsets: counts, edgeIds };
}
