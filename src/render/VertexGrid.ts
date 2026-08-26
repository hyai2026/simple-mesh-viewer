import * as THREE from 'three';

const MAX_DIM = 2047;
const MAX_CELLS_VISITED = 8192;
const MAX_CANDIDATES = 4096;

export class VertexGrid {
  readonly cellStart: Uint32Array;
  readonly items: Uint32Array;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly cellSize: number;

  private constructor(
    cellStart: Uint32Array,
    items: Uint32Array,
    minX: number,
    minY: number,
    minZ: number,
    nx: number,
    ny: number,
    nz: number,
    cellSize: number,
  ) {
    this.cellStart = cellStart;
    this.items = items;
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.cellSize = cellSize;
  }

  static build(positions: Float32Array, count: number): VertexGrid {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) {
      minX = minY = minZ = 0;
      maxX = maxY = maxZ = 0;
    }
    const ex = maxX - minX;
    const ey = maxY - minY;
    const ez = maxZ - minZ;
    const maxExt = Math.max(ex, ey, ez, 1e-9);
    const target = Math.max(1, Math.ceil(Math.cbrt(Math.max(count, 1))));
    let cs = maxExt / target;
    if (!(cs > 0)) cs = 1e-9;
    const nx = Math.max(1, Math.min(MAX_DIM, Math.ceil(ex / cs)));
    const ny = Math.max(1, Math.min(MAX_DIM, Math.ceil(ey / cs)));
    const nz = Math.max(1, Math.min(MAX_DIM, Math.ceil(ez / cs)));
    const total = nx * ny * nz;

    const counts = new Uint32Array(total + 1);
    for (let i = 0; i < count; i++) {
      const ix = clampCell((positions[i * 3] - minX) / cs, nx);
      const iy = clampCell((positions[i * 3 + 1] - minY) / cs, ny);
      const iz = clampCell((positions[i * 3 + 2] - minZ) / cs, nz);
      counts[cellId(ix, iy, iz, nx, ny) + 1]++;
    }
    for (let c = 0; c < total; c++) counts[c + 1] += counts[c];
    const items = new Uint32Array(count);
    const cursor = counts.slice(0, total);
    for (let i = 0; i < count; i++) {
      const ix = clampCell((positions[i * 3] - minX) / cs, nx);
      const iy = clampCell((positions[i * 3 + 1] - minY) / cs, ny);
      const iz = clampCell((positions[i * 3 + 2] - minZ) / cs, nz);
      items[cursor[cellId(ix, iy, iz, nx, ny)]++] = i;
    }
    return new VertexGrid(counts, items, minX, minY, minZ, nx, ny, nz, cs);
  }

  queryRay(ray: THREE.Ray, maxDist: number, out: number[]): number {
    out.length = 0;
    const o = ray.origin;
    const d = ray.direction;
    const maxX = this.minX + this.nx * this.cellSize;
    const maxY = this.minY + this.ny * this.cellSize;
    const maxZ = this.minZ + this.nz * this.cellSize;

    let t0 = -Infinity;
    let t1 = maxDist;
    const axes: [number, number, number][] = [
      [o.x, d.x, this.minX],
      [o.y, d.y, this.minY],
      [o.z, d.z, this.minZ],
    ];
    const maxes = [maxX, maxY, maxZ];
    for (let a = 0; a < 3; a++) {
      const [oo, dd, lo] = axes[a];
      if (Math.abs(dd) < 1e-12) {
        if (oo < lo || oo > maxes[a]) return 0;
        continue;
      }
      const inv = 1 / dd;
      let ta = (lo - oo) * inv;
      let tb = (maxes[a] - oo) * inv;
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
    }
    if (t0 > t1 || t1 <= 0) return 0;
    const tEnter = Math.max(t0, 0) + this.cellSize * 1e-4;

    let ix = clampCell((o.x + d.x * tEnter - this.minX) / this.cellSize, this.nx);
    let iy = clampCell((o.y + d.y * tEnter - this.minY) / this.cellSize, this.ny);
    let iz = clampCell((o.z + d.z * tEnter - this.minZ) / this.cellSize, this.nz);

    const stepX = d.x > 1e-12 ? 1 : d.x < -1e-12 ? -1 : 0;
    const stepY = d.y > 1e-12 ? 1 : d.y < -1e-12 ? -1 : 0;
    const stepZ = d.z > 1e-12 ? 1 : d.z < -1e-12 ? -1 : 0;
    const tdx = stepX !== 0 ? Math.abs(this.cellSize / d.x) : Infinity;
    const tdy = stepY !== 0 ? Math.abs(this.cellSize / d.y) : Infinity;
    const tdz = stepZ !== 0 ? Math.abs(this.cellSize / d.z) : Infinity;
    let tmx = stepX !== 0 ? ((stepX > 0 ? ix + 1 : ix) * this.cellSize + this.minX - o.x) / d.x : Infinity;
    let tmy = stepY !== 0 ? ((stepY > 0 ? iy + 1 : iy) * this.cellSize + this.minY - o.y) / d.y : Infinity;
    let tmz = stepZ !== 0 ? ((stepZ > 0 ? iz + 1 : iz) * this.cellSize + this.minZ - o.z) / d.z : Infinity;

    let visited = 0;
    for (;;) {
      const cell = cellId(ix, iy, iz, this.nx, this.ny);
      const start = this.cellStart[cell];
      const end = this.cellStart[cell + 1];
      for (let k = start; k < end; k++) out.push(this.items[k]);
      visited++;
      if (visited > MAX_CELLS_VISITED || out.length >= MAX_CANDIDATES) break;
      if (tmx <= tmy && tmx <= tmz) {
        if (tmx > t1) break;
        ix += stepX;
        if (ix < 0 || ix >= this.nx) break;
        tmx += tdx;
      } else if (tmy <= tmz) {
        if (tmy > t1) break;
        iy += stepY;
        if (iy < 0 || iy >= this.ny) break;
        tmy += tdy;
      } else {
        if (tmz > t1) break;
        iz += stepZ;
        if (iz < 0 || iz >= this.nz) break;
        tmz += tdz;
      }
    }
    return out.length;
  }
}

function cellId(ix: number, iy: number, iz: number, nx: number, ny: number): number {
  return ix + iy * nx + iz * nx * ny;
}

function clampCell(v: number, n: number): number {
  let c = Math.floor(v);
  if (c < 0) c = 0;
  if (c > n - 1) c = n - 1;
  return c;
}
