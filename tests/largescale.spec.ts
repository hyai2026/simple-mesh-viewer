import { describe, expect, it } from 'vitest';
import { assembleMeshData } from '../src/core/MeshData';
import { parseOBJ } from '../src/io/parsers/obj';
import { parsePLY } from '../src/io/parsers/ply';

function gridObj(n: number): string {
  const lines: string[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      lines.push(`v ${i} ${j} ${((i * 7 + j * 13) % 5) * 0.01}`);
    }
  }
  const idx = (i: number, j: number) => j * (n + 1) + i + 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      lines.push(`f ${idx(i, j)} ${idx(i + 1, j)} ${idx(i + 1, j + 1)} ${idx(i, j + 1)}`);
    }
  }
  return lines.join('\n');
}

describe('较大网格冒烟', () => {
  const n = 300;
  const obj = gridObj(n);

  it(`解析 ${n}x${n} 四边形网格并正确组装（顶点/面/边计数与索引映射）`, () => {
    const buf = new TextEncoder().encode(obj).buffer as ArrayBuffer;
    const raw = parseOBJ(buf);
    expect(raw.positionCount).toBe((n + 1) * (n + 1));
    const mesh = assembleMeshData(raw, 'grid.obj');
    expect(mesh.faceCount).toBe(n * n);
    expect(mesh.triangleCount).toBe(2 * n * n);
    expect(mesh.renderIndex!.length).toBe(mesh.triangleCount * 3);
    expect(mesh.edgeCount).toBe(2 * n * (n + 1));
    const triIdx = 123456;
    if (triIdx < mesh.triangleCount) {
      const f = mesh.triToFace![triIdx];
      expect(f).toBe(Math.floor(triIdx / 2));
      const s = mesh.faceOffsets![f];
      expect(mesh.faceOffsets![f + 1] - s).toBe(4);
    }
  });

  it('binary PLY 大面表解析', () => {
    const count = 60000;
    const header = [
      'ply',
      'format binary_little_endian 1.0',
      `element vertex ${count}`,
      'property float x',
      'property float y',
      'property float z',
      `element face ${count}`,
      'property list uchar int vertex_indices',
      'end_header',
    ].join('\n') + '\n';
    const head = new TextEncoder().encode(header);
    const bodySize = count * 12 + count * (1 + 12);
    const buf = new ArrayBuffer(head.length + bodySize);
    new Uint8Array(buf).set(head, 0);
    const dv = new DataView(buf, head.length);
    let o = 0;
    for (let i = 0; i < count; i++) {
      dv.setFloat32(o, i * 0.5, true); o += 4;
      dv.setFloat32(o, i % 97, true); o += 4;
      dv.setFloat32(o, -(i % 13), true); o += 4;
    }
    for (let i = 0; i < count; i++) {
      dv.setUint8(o, 3); o += 1;
      const a = i % count;
      const b = (i * 7 + 1) % count;
      const c = (i * 11 + 2) % count;
      dv.setInt32(o, a, true); o += 4;
      dv.setInt32(o, b, true); o += 4;
      dv.setInt32(o, c, true); o += 4;
    }
    const mesh = assembleMeshData(parsePLY(buf), 'big.ply');
    expect(mesh.positionCount).toBe(count);
    expect(mesh.faceCount).toBe(count);
    expect(mesh.triangleCount).toBe(count);
    const probe = Math.floor(count / 2);
    const s = mesh.faceOffsets![probe];
    expect([...mesh.faceIndices!.slice(s, s + 3)]).toEqual([
      probe,
      (probe * 7 + 1) % count,
      (probe * 11 + 2) % count,
    ]);
  });
});
