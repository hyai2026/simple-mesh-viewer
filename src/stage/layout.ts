import * as THREE from 'three';

export interface LayoutUnitInput {
  id: string;
  positions: Float32Array;
}

export interface LayoutUnitResult {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: number;
}

export interface LayoutOptions {
  targetRadius?: number;
  gapRatio?: number;
  cols?: number;
}

const MAX_SAMPLES = 20000;
const DEGENERATE_RATIO = 1.2;
const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];

function sampleStep(count: number): number {
  return Math.max(1, Math.floor(count / MAX_SAMPLES));
}

function covarianceOf(
  positions: Float32Array,
  stride: number,
): { cov: number[]; count: number } {
  const n = Math.floor(positions.length / stride);
  const step = sampleStep(n);
  const mean = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < n; i += step) {
    const o = i * stride;
    mean[0] += positions[o];
    mean[1] += positions[o + 1];
    mean[2] += positions[o + 2];
    count++;
  }
  for (let k = 0; k < 3; k++) mean[k] /= count;
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i += step) {
    const o = i * stride;
    const dx = positions[o] - mean[0];
    const dy = positions[o + 1] - mean[1];
    const dz = positions[o + 2] - mean[2];
    cov[0] += dx * dx; cov[1] += dx * dy; cov[2] += dx * dz;
    cov[4] += dy * dy; cov[5] += dy * dz;
    cov[8] += dz * dz;
  }
  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 3; b++) cov[b * 3 + a] = cov[a * 3 + b];
  }
  for (let k = 0; k < 9; k++) cov[k] /= count;
  return { cov, count };
}

function jacobiEigen(cov: number[]): { values: [number, number, number]; vectors: THREE.Vector3[] } {
  const a = [...cov];
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) off += a[p * 3 + q] * a[p * 3 + q];
    }
    if (off < 1e-20) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = a[p * 3 + q];
        if (Math.abs(apq) < 1e-15) continue;
        const tau = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
        const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(tau * tau + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k * 3 + p];
          const akq = a[k * 3 + q];
          a[k * 3 + p] = c * akp - s * akq;
          a[k * 3 + q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p * 3 + k];
          const aqk = a[q * 3 + k];
          a[p * 3 + k] = c * apk - s * aqk;
          a[q * 3 + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k * 3 + p];
          const vkq = v[k * 3 + q];
          v[k * 3 + p] = c * vkp - s * vkq;
          v[k * 3 + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [0, 1, 2].sort((x, y) => a[y * 3 + y] - a[x * 3 + x]);
  const vec = (k: number): THREE.Vector3 =>
    new THREE.Vector3(v[k], v[3 + k], v[6 + k]).normalize();
  return {
    values: [a[order[0] * 3 + order[0]], a[order[1] * 3 + order[1]], a[order[2] * 3 + order[2]]],
    vectors: order.map(vec),
  };
}

export function uprightQuat(
  positions: Float32Array,
  stride = 3,
): { q: [number, number, number, number]; uprighted: boolean } {
  const n = Math.floor(positions.length / stride);
  if (n < 3) return { q: IDENTITY, uprighted: false };
  const { cov } = covarianceOf(positions, stride);
  const { values, vectors } = jacobiEigen(cov);
  if (values[0] <= 1e-12) return { q: IDENTITY, uprighted: false };
  if (values[0] < DEGENERATE_RATIO * Math.max(values[1], 1e-12)) {
    return { q: IDENTITY, uprighted: false };
  }
  const up = vectors[0].clone();
  const step = sampleStep(n);
  let proj = 0;
  let count = 0;
  for (let i = 0; i < n; i += step) {
    const o = i * stride;
    proj += positions[o] * up.x + positions[o + 1] * up.y + positions[o + 2] * up.z;
    count++;
  }
  if (proj / count > 0) up.negate();
  let second = vectors[1].clone().addScaledVector(up, -vectors[1].dot(up));
  if (second.lengthSq() < 1e-6) {
    const seed = Math.abs(up.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    second = seed.addScaledVector(up, -seed.dot(up));
  }
  second.normalize();
  const e1 = up;
  const e2 = second;
  const e3 = new THREE.Vector3().crossVectors(e1, e2).normalize();
  const m = new THREE.Matrix4().set(
    e3.x, e3.y, e3.z, 0,
    e1.x, e1.y, e1.z, 0,
    e2.x, e2.y, e2.z, 0,
    0, 0, 0, 1,
  );
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  return { q: [q.x, q.y, q.z, q.w], uprighted: true };
}

function rotatedBox(positions: Float32Array, q: THREE.Quaternion): THREE.Box3 {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const t = new THREE.Vector3();
  const qv = new THREE.Vector3(q.x, q.y, q.z);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    v.set(positions[i], positions[i + 1], positions[i + 2]);
    t.copy(qv).cross(v).multiplyScalar(2);
    v.addScaledVector(t, q.w).add(tmp.copy(qv).cross(t));
    box.expandByPoint(v);
  }
  return box;
}

export function planLayout(
  units: LayoutUnitInput[],
  opts: LayoutOptions = {},
): Map<string, LayoutUnitResult> {
  const targetRadius = opts.targetRadius ?? 1;
  const gapRatio = opts.gapRatio ?? 0.3;
  const cols = opts.cols ?? Math.max(1, Math.ceil(Math.sqrt(units.length)));
  const rowCount = Math.ceil(units.length / cols);
  const cell = 2 * targetRadius * (1 + gapRatio);
  const out = new Map<string, LayoutUnitResult>();
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const { q } = uprightQuat(u.positions);
    const quat = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
    const box = rotatedBox(u.positions, quat);
    const size = box.getSize(new THREE.Vector3());
    const radius = 0.5 * size.length();
    const s = radius > 1e-9 ? targetRadius / radius : 1;
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = (col - (cols - 1) / 2) * cell;
    const z = (row - (rowCount - 1) / 2) * cell;
    out.set(u.id, { position: [x, -box.min.y * s, z], quaternion: q, scale: s });
  }
  return out;
}
