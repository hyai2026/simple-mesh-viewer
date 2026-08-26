import { describe, expect, it } from 'vitest';
import type { MeshData } from '../src/core/MeshData';
import { assembleMeshData } from '../src/core/MeshData';
import {
  computeCurvature,
  derivePrincipal,
  normalizeForColormap,
} from '../src/core/Curvature';

function makeMesh(positions: number[][], faces: number[][]): MeshData {
  const faceOffsets = new Uint32Array(faces.length + 1);
  const faceIndices: number[] = [];
  faces.forEach((f, i) => {
    faceOffsets[i] = faceIndices.length;
    for (const v of f) faceIndices.push(v);
  });
  faceOffsets[faces.length] = faceIndices.length;
  const raw = {
    format: 'test',
    positionCount: positions.length,
    positions: new Float32Array(positions.flat()),
    faceOffsets,
    faceIndices: new Uint32Array(faceIndices),
    explicitEdges: null,
  };
  return assembleMeshData(raw, 'test');
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function uvSphere(radius: number, rings: number, sectors: number) {
  const positions: number[][] = [];
  const faces: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (Math.PI * i) / rings;
    const y = radius * Math.cos(phi);
    const ringR = radius * Math.sin(phi);
    for (let j = 0; j < sectors; j++) {
      const theta = (2 * Math.PI * j) / sectors;
      positions.push([ringR * Math.sin(theta), y, ringR * Math.cos(theta)]);
    }
  }
  const at = (i: number, j: number) => i * sectors + ((j % sectors) + sectors) % sectors;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sectors; j++) {
      if (i === 0) {
        faces.push([at(0, j), at(1, j + 1), at(1, j)]);
      } else if (i === rings - 1) {
        faces.push([at(i, j), at(i + 1, j), at(i, j + 1)]);
      } else {
        faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
      }
    }
  }
  return { positions, faces };
}

describe('computeCurvature 解析解', () => {
  it('平面：H ≈ 0，K ≈ 0', () => {
    const positions: number[][] = [];
    const faces: number[][] = [];
    const n = 10;
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) positions.push([i / n, j / n, 0.3]);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const a = i * (n + 1) + j;
        faces.push([a, a + n + 1, a + n + 2]);
        faces.push([a, a + n + 2, a + 1]);
      }
    const { mean, gauss } = computeCurvature(makeMesh(positions, faces));
    for (let i = 0; i < mean.length; i++) {
      expect(Math.abs(mean[i])).toBeLessThan(1e-4);
      expect(Math.abs(gauss[i])).toBeLessThan(1e-4);
    }
  });

  it('球面：内部顶点 H ≈ 1/r（凸面为正），K ≈ 1/r²', () => {
    const r = 2;
    const { positions, faces } = uvSphere(r, 24, 32);
    const mesh = makeMesh(positions, faces);
    const { mean, gauss } = computeCurvature(mesh);

    const hErrors: number[] = [];
    const kErrors: number[] = [];
    for (let i = 0; i < mesh.positionCount; i++) {
      const y = positions[i][1];
      if (Math.abs(y) > 0.9 * r) continue;
      hErrors.push(Math.abs(mean[i] - 1 / r));
      kErrors.push(Math.abs(gauss[i] - 1 / (r * r)));
    }
    expect(hErrors.length).toBeGreaterThan(100);
    expect(median(hErrors)).toBeLessThan(0.06);
    expect(median(kErrors)).toBeLessThan(0.05);
  });

  it('圆柱侧面：中部 H ≈ 1/(2r)，K ≈ 0', () => {
    const r = 1;
    const height = 4;
    const rings = 8;
    const sectors = 48;
    const positions: number[][] = [];
    const faces: number[][] = [];
    for (let i = 0; i <= rings; i++) {
      const y = -height / 2 + (height * i) / rings;
      for (let j = 0; j < sectors; j++) {
        const theta = (2 * Math.PI * j) / sectors;
        positions.push([r * Math.sin(theta), y, r * Math.cos(theta)]);
      }
    }
    const at = (i: number, j: number) => i * sectors + ((j % sectors) + sectors) % sectors;
    for (let i = 0; i < rings; i++)
      for (let j = 0; j < sectors; j++)
        faces.push([at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)]);

    const mesh = makeMesh(positions, faces);
    const { mean, gauss } = computeCurvature(mesh);

    const hErrors: number[] = [];
    for (let i = 2; i <= rings - 2; i++) {
      for (let j = 0; j < sectors; j++) {
        const v = at(i, j);
        hErrors.push(Math.abs(mean[v] - 1 / (2 * r)));
        expect(Math.abs(gauss[v])).toBeLessThan(0.03);
      }
    }
    expect(median(hErrors)).toBeLessThan(0.04);
  });

  it('主曲率推导：球面 κmin ≈ κmax ≈ 1/r²·r = 1/r', () => {
    const r = 2;
    const { positions, faces } = uvSphere(r, 12, 16);
    const mesh = makeMesh(positions, faces);
    const { mean, gauss } = computeCurvature(mesh);
    const kmin = derivePrincipal('min', mean, gauss);
    const kmax = derivePrincipal('max', mean, gauss);
    const errsMin: number[] = [];
    const errsMax: number[] = [];
    for (let i = 0; i < mesh.positionCount; i++) {
      const y = positions[i][1];
      if (Math.abs(y) > 0.9 * r) continue;
      errsMin.push(Math.abs(kmin[i] - 1 / r));
      errsMax.push(Math.abs(kmax[i] - 1 / r));
    }
    expect(median(errsMin)).toBeLessThan(0.08);
    expect(median(errsMax)).toBeLessThan(0.08);
  });
});

describe('normalizeForColormap', () => {
  it('线性映射与边界截断', () => {
    const values = new Float32Array([0, 1, 2, 3, 4]);
    const { data, min, max } = normalizeForColormap(values, 0, 1);
    expect(min).toBeCloseTo(0);
    expect(max).toBeCloseTo(4);
    expect(data[0]).toBeCloseTo(0);
    expect(data[4]).toBeCloseTo(1);
    expect(data[2]).toBeGreaterThan(0.45);
    expect(data[2]).toBeLessThan(0.55);
  });

  it('离群值被分位截断，零值居中（对称映射）', () => {
    const values: number[] = [];
    for (let i = 0; i < 200; i++) values.push(-2 + (4 * i) / 199);
    values.push(100, 100, 100, -100, -100, -100);
    const { data } = normalizeForColormap(new Float32Array(values));
    const nearestIdx = (v: number): number => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < values.length; i++) {
        const d = Math.abs(values[i] - v);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };
    expect(data[0]).toBeLessThan(0.03);
    expect(data[199]).toBeGreaterThan(0.97);
    expect(data[nearestIdx(100)]).toBe(1);
    expect(data[nearestIdx(-100)]).toBe(0);
    expect(data[nearestIdx(2)]).toBeGreaterThan(0.95);
    expect(data[nearestIdx(-2)]).toBeLessThan(0.05);
    expect(data[nearestIdx(0)]).toBeGreaterThan(0.45);
    expect(data[nearestIdx(0)]).toBeLessThan(0.55);
  });

  it('空数组兜底', () => {
    const { data, min, max } = normalizeForColormap(new Float32Array([]));
    expect(data.length).toBe(0);
    expect(min).toBe(0);
    expect(max).toBe(0);
  });
});
