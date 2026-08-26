import { describe, expect, it } from 'vitest';
import { assembleMeshData } from '../src/core/MeshData';
import { parsePLY } from '../src/io/parsers/ply';

interface Row {
  x: number;
  y: number;
  z: number;
  quality: number;
}

const ROWS: Row[] = [
  { x: 0, y: 0, z: 0, quality: 0.25 },
  { x: 1, y: 0, z: 0, quality: 0.5 },
  { x: 0, y: 1, z: 0, quality: 0.75 },
  { x: 0, y: 0, z: 1, quality: 1 },
];

const FACES = [
  [3, 0, 2, 1],
  [3, 0, 3, 2],
];
const EDGES = [
  [0, 2],
];

function asciiPly(): string {
  const lines = [
    'ply',
    'format ascii 1.0',
    'comment test file',
    'element vertex 4',
    'property float x',
    'property float y',
    'property float z',
    'property float quality',
    'element face 2',
    'property list uchar int vertex_indices',
    'element edge 1',
    'property int vertex1',
    'property int vertex2',
    'end_header',
  ];
  for (const r of ROWS) lines.push(`${r.x} ${r.y} ${r.z} ${r.quality}`);
  for (const f of FACES) lines.push(f.join(' '));
  for (const e of EDGES) lines.push(`${e[0]} ${e[1]}`);
  return lines.join('\n') + '\n';
}

function binaryPly(le: boolean): ArrayBuffer {
  const header = [
    'ply',
    `format binary_${le ? 'little' : 'big'}_endian 1.0`,
    'comment test file',
    'element vertex 4',
    'property float x',
    'property float y',
    'property float z',
    'property float quality',
    'element face 2',
    'property list uchar int vertex_indices',
    'element edge 1',
    'property int vertex1',
    'property int vertex2',
    'end_header',
  ].join('\n') + '\n';
  const headBytes = new TextEncoder().encode(header);
  const bodySize =
    ROWS.length * (4 * 4) +
    FACES.length * (1 + 4 * 4) +
    EDGES.length * (2 * 4);
  const buf = new ArrayBuffer(headBytes.length + bodySize);
  new Uint8Array(buf).set(headBytes, 0);
  const dv = new DataView(buf, headBytes.length);
  let o = 0;
  for (const r of ROWS) {
    dv.setFloat32(o, r.x, le); o += 4;
    dv.setFloat32(o, r.y, le); o += 4;
    dv.setFloat32(o, r.z, le); o += 4;
    dv.setFloat32(o, r.quality, le); o += 4;
  }
  for (const f of FACES) {
    dv.setUint8(o, f[0]); o += 1;
    for (let k = 1; k < f.length; k++) {
      dv.setInt32(o, f[k], le); o += 4;
    }
  }
  for (const e of EDGES) {
    dv.setInt32(o, e[0], le); o += 4;
    dv.setInt32(o, e[1], le); o += 4;
  }
  return buf;
}

describe('parsePLY', () => {
  const asciiRaw = parsePLY(new TextEncoder().encode(asciiPly()).buffer as ArrayBuffer);
  const leMesh = assembleMeshData(parsePLY(binaryPly(true)), 'le.ply');
  const beMesh = assembleMeshData(parsePLY(binaryPly(false)), 'be.ply');
  const asciiMesh = assembleMeshData(asciiRaw, 'ascii.ply');

  it('ascii：跳过额外属性，正确读取坐标/面/边', () => {
    expect(asciiRaw.positionCount).toBe(4);
    expect(Array.from(asciiRaw.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(asciiRaw.faceOffsets!.length - 1).toBe(2);
    expect([...asciiRaw.faceIndices!]).toEqual([0, 2, 1, 0, 3, 2]);
    expect([...asciiRaw.explicitEdges!]).toEqual([0, 2]);
  });

  it('binary little/big endian 与 ascii 结果完全一致', () => {
    for (const m of [leMesh, beMesh]) {
      expect(m.positionCount).toBe(asciiMesh.positionCount);
      expect([...m.positions]).toEqual([...asciiMesh.positions]);
      expect([...m.faceOffsets!]).toEqual([...asciiMesh.faceOffsets!]);
      expect([...m.faceIndices!]).toEqual([...asciiMesh.faceIndices!]);
      expect(m.edgeSource).toBe('explicit');
      expect([...m.edges!]).toEqual([...asciiMesh.edges!]);
    }
  });

  it('edge 元素端点属性名兼容 vertex1/vertex2 与 v1/v2 兜底', () => {
    const alt = [
      'ply',
      'format ascii 1.0',
      'element vertex 2',
      'property float x',
      'property float y',
      'property float z',
      'element edge 1',
      'property int v1',
      'property int v2',
      'end_header',
      '0 0 0',
      '5 5 5',
      '0 1',
    ].join('\n');
    const raw = parsePLY(new TextEncoder().encode(alt).buffer as ArrayBuffer);
    expect([...raw.explicitEdges!]).toEqual([0, 1]);
  });

  it('缺少 end_header 时抛错', () => {
    const bad = 'ply\nformat ascii 1.0\nelement vertex 0\nend_header';
    expect(() =>
      parsePLY(new TextEncoder().encode(bad.replace('end_header', '')).buffer as ArrayBuffer),
    ).toThrowError(/end_header/);
  });
});
