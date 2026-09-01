import type { MeshData } from './MeshData';

export type CurvatureType = 'mean' | 'gauss' | 'min' | 'max';
export type Colormap = 'jet' | 'bwr';

export type CurvatureInput = Pick<MeshData, 'positionCount' | 'positions' | 'renderIndex'>;

export interface CurvatureData {
  mean: Float32Array;
  gauss: Float32Array;
  valid: Uint8Array;
}

export interface NormalizedScalars {
  data: Float32Array;
  min: number;
  max: number;
}

const EPS_AREA = 1e-14;
const EPS_LEN = 1e-12;
const DERIVE_STRIDE_LIMIT = 93_000_000;

export function computeCurvature(data: CurvatureInput): CurvatureData {
  const n = data.positionCount;
  const mean = new Float32Array(n);
  const gauss = new Float32Array(n);
  const valid = new Uint8Array(n).fill(1);
  const idx = data.renderIndex;
  if (!idx || idx.length < 3) return { mean, gauss, valid };

  const pos = data.positions;

  const stride = n;
  if (stride > DERIVE_STRIDE_LIMIT) throw new Error('网格规模超出曲率计算上限');

  const keys = new Float64Array(idx.length);
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t + k];
      const b = idx[t + ((k + 1) % 3)];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      keys[t + k] = lo * stride + hi;
    }
  }
  keys.sort();
  let runStart = 0;
  for (let k = 1; k <= keys.length; k++) {
    if (k === keys.length || keys[k] !== keys[runStart]) {
      if (k - runStart === 1) {
        const key = keys[runStart];
        const lo = Math.floor(key / stride);
        const hi = key % stride;
        valid[lo] = 0;
        valid[hi] = 0;
      }
      runStart = k;
    }
  }

  const lapX = new Float64Array(n);
  const lapY = new Float64Array(n);
  const lapZ = new Float64Array(n);
  const normX = new Float64Array(n);
  const normY = new Float64Array(n);
  const normZ = new Float64Array(n);
  const area = new Float64Array(n);
  const angleSum = new Float64Array(n);

  for (let t = 0; t + 2 < idx.length; t += 3) {
    const ia = idx[t];
    const ib = idx[t + 1];
    const ic = idx[t + 2];

    const ax = pos[ia * 3], ay = pos[ia * 3 + 1], az = pos[ia * 3 + 2];
    const bx = pos[ib * 3], by = pos[ib * 3 + 1], bz = pos[ib * 3 + 2];
    const cx = pos[ic * 3], cy = pos[ic * 3 + 1], cz = pos[ic * 3 + 2];

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const area2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(area2 > EPS_AREA) || !Number.isFinite(area2)) continue;

    normX[ia] += nx; normY[ia] += ny; normZ[ia] += nz;
    normX[ib] += nx; normY[ib] += ny; normZ[ib] += nz;
    normX[ic] += nx; normY[ic] += ny; normZ[ic] += nz;

    const sixth = area2 / 6;
    area[ia] += sixth;
    area[ib] += sixth;
    area[ic] += sixth;

    const cotA = (e1x * e2x + e1y * e2y + e1z * e2z) / area2;
    const bax = ax - bx, bay = ay - by, baz = az - bz;
    const bcx = cx - bx, bcy = cy - by, bcz = cz - bz;
    const cotB = (bax * bcx + bay * bcy + baz * bcz) / area2;
    const cax = ax - cx, cay = ay - cy, caz = az - cz;
    const cbx = bx - cx, cby = by - cy, cbz = bz - cz;
    const cotC = (cax * cbx + cay * cby + caz * cbz) / area2;

    angleSum[ia] += Math.atan2(area2, cotA * area2);
    angleSum[ib] += Math.atan2(area2, cotB * area2);
    angleSum[ic] += Math.atan2(area2, cotC * area2);

    lapX[ia] += cotC * (bx - ax) + cotB * (cx - ax);
    lapY[ia] += cotC * (by - ay) + cotB * (cy - ay);
    lapZ[ia] += cotC * (bz - az) + cotB * (cz - az);

    lapX[ib] += cotC * (ax - bx) + cotA * (cx - bx);
    lapY[ib] += cotC * (ay - by) + cotA * (cy - by);
    lapZ[ib] += cotC * (az - bz) + cotA * (cz - bz);

    lapX[ic] += cotB * (ax - cx) + cotA * (bx - cx);
    lapY[ic] += cotB * (ay - cy) + cotA * (by - cy);
    lapZ[ic] += cotB * (az - cz) + cotA * (bz - cz);
  }

  for (let i = 0; i < n; i++) {
    const A = area[i];
    if (!valid[i] || !(A > EPS_AREA)) {
      valid[i] = 0;
      continue;
    }

    let nlen = Math.sqrt(normX[i] * normX[i] + normY[i] * normY[i] + normZ[i] * normZ[i]);
    if (!(nlen > EPS_LEN)) continue;
    const invLen = 1 / nlen;

    const lx = lapX[i] / (2 * A);
    const ly = lapY[i] / (2 * A);
    const lz = lapZ[i] / (2 * A);

    mean[i] = -0.5 * (lx * normX[i] + ly * normY[i] + lz * normZ[i]) * invLen;
    gauss[i] = (2 * Math.PI - angleSum[i]) / A;
  }

  return { mean, gauss, valid };
}

export function derivePrincipal(
  type: CurvatureType,
  mean: Float32Array,
  gauss: Float32Array,
): Float32Array {
  const out = new Float32Array(mean.length);
  if (type === 'mean') return mean.slice();
  if (type === 'gauss') return gauss.slice();
  for (let i = 0; i < mean.length; i++) {
    const root = Math.sqrt(Math.max(mean[i] * mean[i] - gauss[i], 0));
    out[i] = type === 'max' ? mean[i] + root : mean[i] - root;
  }
  return out;
}

export function normalizeForColormap(
  values: Float32Array,
  loPercentile = 0.02,
  hiPercentile = 0.98,
  valid?: Uint8Array | null,
): NormalizedScalars {
  const n = values.length;
  const out = new Float32Array(n);
  out.fill(0.5);
  if (n === 0) return { data: out, min: 0, max: 0 };

  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (valid && !valid[i]) continue;
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
    count++;
  }
  if (!(max > min)) {
    return { data: out, min: count ? min : 0, max: count ? max : 0 };
  }

  const BINS = 1024;
  const hist = new Int32Array(BINS);
  const spanInv = BINS / (max - min);
  for (let i = 0; i < n; i++) {
    if (valid && !valid[i]) continue;
    let b = ((values[i] - min) * spanInv) | 0;
    if (b < 0) b = 0;
    if (b >= BINS) b = BINS - 1;
    hist[b]++;
  }

  const quantile = (p: number): number => {
    const target = p * count;
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      acc += hist[b];
      if (acc >= target) return min + ((b + 0.5) / BINS) * (max - min);
    }
    return max;
  };

  let vLo = quantile(loPercentile);
  let vHi = quantile(hiPercentile);
  if (!(vHi > vLo)) vHi = vLo + (max - min) * 1e-3 + 1e-12;
  if (vLo < 0 && vHi > 0) {
    const m = Math.max(Math.abs(vLo), Math.abs(vHi));
    vLo = -m;
    vHi = m;
  }
  const span = vHi - vLo;

  for (let i = 0; i < n; i++) {
    if (valid && !valid[i]) continue;
    let s = (values[i] - vLo) / span;
    if (s < 0) s = 0;
    else if (s > 1) s = 1;
    out[i] = s;
  }
  return { data: out, min: vLo, max: vHi };
}
