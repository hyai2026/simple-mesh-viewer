export type EdgeSource = 'explicit' | 'derived';

export interface RawParsedMesh {
  format: string;
  positionCount: number;
  positions: Float32Array;
  faceOffsets: Uint32Array | null;
  faceIndices: Uint32Array | null;
  explicitEdges: Uint32Array | null;
}

export interface MeshData {
  fileName: string;
  format: string;
  positionCount: number;
  positions: Float32Array;
  faceCount: number;
  faceOffsets: Uint32Array | null;
  faceIndices: Uint32Array | null;
  triangleCount: number;
  renderIndex: Uint32Array | null;
  triToFace: Uint32Array | null;
  edgeCount: number;
  edges: Uint32Array | null;
  edgeSource: EdgeSource | null;
}

export interface MeshStats {
  vertices: number;
  faces: number;
  triangles: number;
  edges: number;
  edgeSource: EdgeSource | null;
}

export function faceSize(data: MeshData, face: number): number {
  if (!data.faceOffsets) return 0;
  return data.faceOffsets[face + 1] - data.faceOffsets[face];
}

export function faceCorners(data: MeshData, face: number, out: number[] = []): number[] {
  out.length = 0;
  if (!data.faceOffsets || !data.faceIndices) return out;
  const s = data.faceOffsets[face];
  const e = data.faceOffsets[face + 1];
  for (let i = s; i < e; i++) out.push(data.faceIndices[i]);
  return out;
}

export function vertexPosition(
  data: MeshData,
  index: number,
  out: { x: number; y: number; z: number },
): void {
  out.x = data.positions[index * 3];
  out.y = data.positions[index * 3 + 1];
  out.z = data.positions[index * 3 + 2];
}

export function edgeVertices(data: MeshData, edge: number, out: [number, number]): [number, number] {
  if (!data.edges) return out;
  out[0] = data.edges[edge * 2];
  out[1] = data.edges[edge * 2 + 1];
  return out;
}

export function edgeLength(data: MeshData, edge: number): number {
  if (!data.edges) return 0;
  const a = data.edges[edge * 2] * 3;
  const b = data.edges[edge * 2 + 1] * 3;
  const p = data.positions;
  const dx = p[b] - p[a];
  const dy = p[b + 1] - p[a + 1];
  const dz = p[b + 2] - p[a + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const DERIVE_KEY_STRIDE_LIMIT = 93_000_000;

export function deriveEdgesFromFaces(
  faceOffsets: Uint32Array,
  faceIndices: Uint32Array,
): Uint32Array {
  const faceCount = faceOffsets.length - 1;
  let directed = 0;
  for (let f = 0; f < faceCount; f++) directed += faceOffsets[f + 1] - faceOffsets[f];
  let maxVert = 0;
  for (let i = 0; i < faceIndices.length; i++) {
    if (faceIndices[i] > maxVert) maxVert = faceIndices[i];
  }
  const stride = maxVert + 1;
  if (stride > DERIVE_KEY_STRIDE_LIMIT) {
    throw new Error('网格规模超出派生边算法上限');
  }
  const keys = new Float64Array(directed);
  let p = 0;
  for (let f = 0; f < faceCount; f++) {
    const s = faceOffsets[f];
    const n = faceOffsets[f + 1] - s;
    for (let j = 0; j < n; j++) {
      const a = faceIndices[s + j];
      const b = faceIndices[s + ((j + 1) % n)];
      if (a === b) continue;
      keys[p++] = (a < b ? a : b) * stride + (a < b ? b : a);
    }
  }
  const used = keys.subarray(0, p);
  used.sort();
  let unique = 0;
  for (let i = 0; i < p; i++) {
    if (i === 0 || used[i] !== used[i - 1]) unique++;
  }
  const out = new Uint32Array(unique * 2);
  let o = 0;
  for (let i = 0; i < p; i++) {
    if (i === 0 || used[i] !== used[i - 1]) {
      out[o++] = Math.floor(used[i] / stride);
      out[o++] = used[i] % stride;
    }
  }
  return out;
}

export function assembleMeshData(raw: RawParsedMesh, fileName: string): MeshData {
  const hasFaces = !!(raw.faceOffsets && raw.faceIndices && raw.faceOffsets.length > 1);
  let faceCount = 0;
  let triangleCount = 0;
  let renderIndex: Uint32Array | null = null;
  let triToFace: Uint32Array | null = null;
  if (hasFaces) {
    const fo = raw.faceOffsets!;
    const fi = raw.faceIndices!;
    faceCount = fo.length - 1;
    for (let f = 0; f < faceCount; f++) triangleCount += fo[f + 1] - fo[f] - 2;
    renderIndex = new Uint32Array(triangleCount * 3);
    triToFace = new Uint32Array(triangleCount);
    let t = 0;
    for (let f = 0; f < faceCount; f++) {
      const s = fo[f];
      const n = fo[f + 1] - s;
      const a = fi[s];
      for (let j = 1; j < n - 1; j++) {
        renderIndex[t * 3] = a;
        renderIndex[t * 3 + 1] = fi[s + j];
        renderIndex[t * 3 + 2] = fi[s + j + 1];
        triToFace[t] = f;
        t++;
      }
    }
  }
  let edges: Uint32Array | null = null;
  let edgeSource: EdgeSource | null = null;
  if (raw.explicitEdges && raw.explicitEdges.length >= 2) {
    edges = raw.explicitEdges;
    edgeSource = 'explicit';
  } else if (hasFaces) {
    edges = deriveEdgesFromFaces(raw.faceOffsets!, raw.faceIndices!);
    edgeSource = 'derived';
  }
  return {
    fileName,
    format: raw.format,
    positionCount: raw.positionCount,
    positions: raw.positions,
    faceCount,
    faceOffsets: hasFaces ? raw.faceOffsets : null,
    faceIndices: hasFaces ? raw.faceIndices : null,
    triangleCount,
    renderIndex,
    triToFace,
    edgeCount: edges ? edges.length / 2 : 0,
    edges,
    edgeSource,
  };
}

export function meshStats(data: MeshData): MeshStats {
  return {
    vertices: data.positionCount,
    faces: data.faceCount,
    triangles: data.triangleCount,
    edges: data.edgeCount,
    edgeSource: data.edgeSource,
  };
}
