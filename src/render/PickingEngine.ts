import * as THREE from 'three';
import type { Intersection, Raycaster, Vector2, Vector3 } from 'three';
import { acceleratedRaycast } from 'three-mesh-bvh';
import type { MeshData } from '../core/MeshData';
import { edgeLength, faceCorners } from '../core/MeshData';
import { buildVertexEdgeAdjacency, type VertexAdjacency } from '../core/Topology';
import type { MeshView } from './MeshView';
import { VertexGrid } from './VertexGrid';

type ThreeMesh = import('three').Mesh;

(THREE.Mesh.prototype as unknown as { raycast: unknown }).raycast = acceleratedRaycast;

export type PickHit =
  | { modelId: string; kind: 'vertex'; index: number; position: THREE.Vector3 }
  | {
      modelId: string;
      kind: 'face';
      index: number;
      corners: number[];
      point: THREE.Vector3;
    }
  | {
      modelId: string;
      kind: 'edge';
      index: number;
      v0: number;
      v1: number;
      length: number;
      point: THREE.Vector3;
    };

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Entry {
  view: MeshView;
  data: MeshData;
  grid?: VertexGrid;
  adj?: VertexAdjacency;
}

interface Ranked {
  hit: PickHit;
  d2: number;
}

type VertexHit = Extract<PickHit, { kind: 'vertex' }>;

interface VertexRanked {
  hit: VertexHit;
  d2: number;
}

const MAX_CANDIDATES_PROCESSED = 512;
const EDGE_CANDIDATE_VERTS = 16;
const MAX_VERTEX_OCCLUSION_TESTS = 6;

export function hitsEqual(a: PickHit | null, b: PickHit | null): boolean {
  if (!a || !b) return a === b;
  return a.modelId === b.modelId && a.kind === b.kind && a.index === b.index;
}

export class PickingEngine {
  private entries = new Map<string, Entry>();
  private rc: Raycaster = new THREE.Raycaster();
  private ocRc: Raycaster = new THREE.Raycaster();
  private ndc: Vector2 = new THREE.Vector2();
  private tmp: Vector3 = new THREE.Vector3();
  private ocDir: Vector3 = new THREE.Vector3();
  private invMat = new THREE.Matrix4();

  constructor(private camera: THREE.PerspectiveCamera) {
    (this.rc as unknown as { firstHitOnly: boolean }).firstHitOnly = true;
    (this.ocRc as unknown as { firstHitOnly: boolean }).firstHitOnly = true;
  }

  register(view: MeshView): void {
    if (!view.meshData) return;
    this.entries.set(view.id, { view, data: view.meshData });
  }

  unregister(id: string): void {
    this.entries.delete(id);
  }

  pick(
    clientX: number,
    clientY: number,
    rect: ViewportRect,
    radiusPx: number,
  ): PickHit | null {
    if (this.entries.size === 0) return null;
    this.invMat.copy(this.camera.matrixWorldInverse);
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.rc.setFromCamera(this.ndc, this.camera);
    this.rc.far = Infinity;

    let anyPoints = false;
    let anyEdges = false;
    for (const entry of this.entries.values()) {
      const vis = entry.view.getVisibility();
      if (vis.points) anyPoints = true;
      if (vis.edges && entry.data.edgeCount > 0) anyEdges = true;
    }

    let faceBest: { entry: Entry; hit: Intersection } | null = null;
    for (const entry of this.entries.values()) {
      if (!entry.view.getVisibility().surface) continue;
      const mesh = entry.view.getSurfaceMesh();
      if (!mesh) continue;
      const hit = this.rc.intersectObject(mesh as ThreeMesh, false)[0];
      if (hit && (!faceBest || hit.distance < faceBest.hit.distance)) {
        faceBest = { entry, hit };
      }
    }

    const vertexRanks: VertexRanked[] = [];
    const radiusD2 = radiusPx * radiusPx;
    for (const entry of this.entries.values()) {
      this.ensureSpatial(entry);
      if (!entry.grid) continue;
      const cand: number[] = [];
      entry.grid.queryRay(this.rc.ray, this.rayRange(entry), cand);
      const p = entry.data.positions;
      const limit = Math.min(cand.length, MAX_CANDIDATES_PROCESSED);
      for (let i = 0; i < limit; i++) {
        const vi = cand[i];
        const pr = this.project(p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2], rect);
        if (!pr) continue;
        const dx = pr.sx - clientX;
        const dy = pr.sy - clientY;
        const d2 = dx * dx + dy * dy;
        if (d2 < radiusD2) {
          vertexRanks.push({
            d2,
            hit: {
              modelId: entry.view.id,
              kind: 'vertex',
              index: vi,
              position: new THREE.Vector3(p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2]),
            },
          });
        }
      }
    }
    vertexRanks.sort((a, b) => a.d2 - b.d2);

    let visibleVertex: VertexRanked | null = null;
    let tested = 0;
    for (const rank of vertexRanks) {
      if (++tested > MAX_VERTEX_OCCLUSION_TESTS) break;
      if (this.isUnoccluded(rank.hit.position)) {
        visibleVertex = rank;
        break;
      }
    }

    if (visibleVertex && anyPoints) return visibleVertex.hit;

    if (faceBest && faceBest.hit.faceIndex != null) {
      const data = faceBest.entry.data;
      const triToFace = data.triToFace;
      if (!triToFace) return null;
      const srcFace = triToFace[faceBest.hit.faceIndex];
      const corners = faceCorners(data, srcFace);
      const snap = this.nearestCorner(faceBest.entry, corners, clientX, clientY, rect, radiusPx);
      if (snap) {
        if (visibleVertex && visibleVertex.d2 < snap.d2) return visibleVertex.hit;
        return snap.hit;
      }
      if (visibleVertex) return visibleVertex.hit;
      if (anyEdges) {
        const e = this.bestEdge(clientX, clientY, rect, Math.max(2.5, radiusPx * 0.45));
        if (e) return e.hit;
      }
      return {
        modelId: faceBest.entry.view.id,
        kind: 'face',
        index: srcFace,
        corners,
        point: faceBest.hit.point.clone(),
      };
    }

    if (visibleVertex) return visibleVertex.hit;

    if (anyEdges) {
      const e = this.bestEdge(clientX, clientY, rect, radiusPx);
      if (e) return e.hit;
    }
    return null;
  }

  private ensureSpatial(entry: Entry): void {
    if (!entry.grid && entry.data.positionCount > 0) {
      entry.grid = VertexGrid.build(entry.data.positions, entry.data.positionCount);
    }
    if (!entry.adj && entry.data.edges) {
      entry.adj = buildVertexEdgeAdjacency(entry.data) ?? undefined;
    }
  }

  private isUnoccluded(position: Vector3): boolean {
    this.ocDir.subVectors(position, this.camera.position);
    const dist = this.ocDir.length();
    if (dist < 1e-9) return true;
    this.ocDir.divideScalar(dist);
    this.ocRc.set(this.camera.position, this.ocDir);
    this.ocRc.near = 0;
    this.ocRc.far = Math.max(dist - Math.max(dist * 1e-3, 1e-5), 1e-6);
    for (const entry of this.entries.values()) {
      if (!entry.view.getVisibility().surface) continue;
      const mesh = entry.view.getSurfaceMesh();
      if (!mesh) continue;
      if (this.ocRc.intersectObject(mesh as ThreeMesh, false).length > 0) return false;
    }
    return true;
  }

  private project(
    x: number,
    y: number,
    z: number,
    rect: ViewportRect,
  ): { sx: number; sy: number } | null {
    const e = this.invMat.elements;
    const camZ = e[2] * x + e[6] * y + e[10] * z + e[14];
    if (camZ >= -1e-9) return null;
    this.tmp.set(x, y, z).project(this.camera);
    return {
      sx: rect.left + (this.tmp.x * 0.5 + 0.5) * rect.width,
      sy: rect.top + (-this.tmp.y * 0.5 + 0.5) * rect.height,
    };
  }

  private rayRange(entry: Entry): number {
    const box = entry.view.boundingBox;
    if (!box.isEmpty()) return Math.max(box.min.distanceTo(box.max) * 2, 1e-3);
    return 1e-3;
  }

  private nearestCorner(
    entry: Entry,
    corners: number[],
    clientX: number,
    clientY: number,
    rect: ViewportRect,
    radiusPx: number,
  ): Ranked | null {
    const p = entry.data.positions;
    let bestIdx = -1;
    let bestD2 = radiusPx * radiusPx;
    for (const vi of corners) {
      const pr = this.project(p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2], rect);
      if (!pr) continue;
      const dx = pr.sx - clientX;
      const dy = pr.sy - clientY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = vi;
      }
    }
    if (bestIdx < 0) return null;
    return {
      d2: bestD2,
      hit: {
        modelId: entry.view.id,
        kind: 'vertex',
        index: bestIdx,
        position: new THREE.Vector3(p[bestIdx * 3], p[bestIdx * 3 + 1], p[bestIdx * 3 + 2]),
      },
    };
  }

  private bestEdge(
    clientX: number,
    clientY: number,
    rect: ViewportRect,
    radiusPx: number,
  ): Ranked | null {
    let best: Ranked | null = null;
    for (const entry of this.entries.values()) {
      if (!entry.view.getVisibility().edges || entry.data.edgeCount === 0) continue;
      const r = this.pickEdgeIn(entry, clientX, clientY, rect, radiusPx);
      if (r && (!best || r.d2 < best.d2)) best = r;
    }
    return best;
  }

  private pickEdgeIn(
    entry: Entry,
    clientX: number,
    clientY: number,
    rect: ViewportRect,
    radiusPx: number,
  ): Ranked | null {
    this.ensureSpatial(entry);
    if (!entry.grid || !entry.adj) return null;
    const cand: number[] = [];
    entry.grid.queryRay(this.rc.ray, this.rayRange(entry), cand);

    const p = entry.data.positions;
    const nearR = Math.max(radiusPx * 6, 40);
    const nearD2 = nearR * nearR;
    const vertCand: { v: number; d2: number }[] = [];
    const limit = Math.min(cand.length, MAX_CANDIDATES_PROCESSED);
    for (let i = 0; i < limit; i++) {
      const vi = cand[i];
      const pr = this.project(p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2], rect);
      if (!pr) continue;
      const dx = pr.sx - clientX;
      const dy = pr.sy - clientY;
      const d2 = dx * dx + dy * dy;
      if (d2 <= nearD2) vertCand.push({ v: vi, d2 });
    }
    if (vertCand.length === 0) return null;
    vertCand.sort((a, b) => a.d2 - b.d2);

    const seen = new Set<number>();
    const edgeIds: number[] = [];
    const take = Math.min(vertCand.length, EDGE_CANDIDATE_VERTS);
    for (let i = 0; i < take; i++) {
      const v = vertCand[i].v;
      for (let k = entry.adj.offsets[v]; k < entry.adj.offsets[v + 1]; k++) {
        const eid = entry.adj.edgeIds[k];
        if (!seen.has(eid)) {
          seen.add(eid);
          edgeIds.push(eid);
        }
      }
    }

    let bestEdge = -1;
    let bestD2 = radiusPx * radiusPx;
    let bestT = 0;
    for (const eid of edgeIds) {
      const a = entry.data.edges![eid * 2];
      const b = entry.data.edges![eid * 2 + 1];
      const pa = this.project(p[a * 3], p[a * 3 + 1], p[a * 3 + 2], rect);
      const pb = this.project(p[b * 3], p[b * 3 + 1], p[b * 3 + 2], rect);
      if (!pa || !pb) continue;
      const r = segPointDist2(clientX, clientY, pa.sx, pa.sy, pb.sx, pb.sy);
      if (r.d2 < bestD2) {
        bestD2 = r.d2;
        bestEdge = eid;
        bestT = r.t;
      }
    }
    if (bestEdge < 0) return null;
    const v0 = entry.data.edges![bestEdge * 2];
    const v1 = entry.data.edges![bestEdge * 2 + 1];
    const point = new THREE.Vector3(
      p[v0 * 3] + (p[v1 * 3] - p[v0 * 3]) * bestT,
      p[v0 * 3 + 1] + (p[v1 * 3 + 1] - p[v0 * 3 + 1]) * bestT,
      p[v0 * 3 + 2] + (p[v1 * 3 + 2] - p[v0 * 3 + 2]) * bestT,
    );
    return {
      d2: bestD2,
      hit: {
        modelId: entry.view.id,
        kind: 'edge',
        index: bestEdge,
        v0,
        v1,
        length: edgeLength(entry.data, bestEdge),
        point,
      },
    };
  }
}

function segPointDist2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { d2: number; t: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 1e-12) {
    t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return { d2: dx * dx + dy * dy, t };
}
