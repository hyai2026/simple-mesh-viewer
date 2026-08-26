import { describe, expect, it } from 'vitest';
import { assembleMeshData, deriveEdgesFromFaces, faceCorners } from '../src/core/MeshData';
import { parseOBJ } from '../src/io/parsers/obj';

const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('parseOBJ', () => {
  it('解析四边形面并支持 v/vt/n 变体与负索引', () => {
    const obj = [
      'o cube',
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'v 0 1 0',
      'v 0 0 1',
      'v 1 0 1',
      'v 1 1 1',
      'v 0 1 1',
      'vn 0 0 1',
      'vt 0 0',
      'f 1/1/1 2/1/1 3/1/1 4/1/1',
      'f 5 6 7 8',
      'f -4 -3 -2 -1',
      '',
    ].join('\n');
    const raw = parseOBJ(enc(obj));
    expect(raw.positionCount).toBe(8);
    expect(raw.faceOffsets!.length - 1).toBe(3);
    const mesh = assembleMeshData(raw, 'cube.obj');
    expect(mesh.faceCount).toBe(3);
    expect(mesh.triangleCount).toBe(6);
    expect([...mesh.triToFace!]).toEqual([0, 0, 1, 1, 2, 2]);
    expect(faceCorners(mesh, 2)).toEqual([4, 5, 6, 7]);
    expect(mesh.edgeSource).toBe('derived');
    expect(mesh.edgeCount).toBe(8);
  });

  it('纯 l 行线框文件：faces 为 null，显式边按折线展开', () => {
    const raw = parseOBJ(enc('v 0 0 0\nv 1 0 0\nv 0 1 0\nl 1 2 3\nl 3 1\n'));
    expect(raw.faceOffsets).toBeNull();
    expect(raw.explicitEdges).not.toBeNull();
    const mesh = assembleMeshData(raw, 'wire.obj');
    expect(mesh.faceCount).toBe(0);
    expect(mesh.triangleCount).toBe(0);
    expect(mesh.edgeSource).toBe('explicit');
    expect(mesh.edgeCount).toBe(3);
    expect([...mesh.edges!]).toEqual([0, 1, 1, 2, 2, 0]);
  });

  it('面与 l 并存时优先使用显式边', () => {
    const raw = parseOBJ(enc('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nl 1 2\n'));
    const mesh = assembleMeshData(raw, 'mixed.obj');
    expect(mesh.edgeSource).toBe('explicit');
    expect(mesh.edgeCount).toBe(1);
  });

  it('索引越界时抛出带行号的错误', () => {
    expect(() => parseOBJ(enc('v 0 0 0\nf 1 2 9\n'))).toThrowError(/越界/);
    expect(() => parseOBJ(enc('f 1 2 3\n'))).toThrowError(/越界/);
  });
});

describe('deriveEdgesFromFaces', () => {
  it('共享边去重，四边形不产生对角线', () => {
    const offsets = new Uint32Array([0, 4, 8]);
    const indices = new Uint32Array([0, 1, 2, 3, 3, 2, 4, 5]);
    const edges = deriveEdgesFromFaces(offsets, indices);
    expect(edges.length).toBe(14);
    const set = new Set<number>();
    for (let i = 0; i < edges.length; i += 2) set.add(edges[i] * 100 + edges[i + 1]);
    expect(set.size).toBe(7);
    expect(set.has(2 * 100 + 3)).toBe(true);
    for (let i = 0; i < edges.length; i += 2) {
      expect(edges[i]).toBeLessThan(edges[i + 1]);
    }
  });

  it('单个四边形只有周长 4 条边', () => {
    const edges = deriveEdgesFromFaces(new Uint32Array([0, 4]), new Uint32Array([7, 8, 9, 10]));
    expect([...edges]).toEqual([7, 8, 7, 10, 8, 9, 9, 10]);
  });

  it('退化环被剔除', () => {
    const edges = deriveEdgesFromFaces(new Uint32Array([0, 3]), new Uint32Array([0, 0, 1]));
    expect([...edges]).toEqual([0, 1]);
  });

  it('三角扇共享对角边只保留一份', () => {
    const edges = deriveEdgesFromFaces(
      new Uint32Array([0, 3, 6]),
      new Uint32Array([0, 1, 2, 0, 2, 3]),
    );
    expect(edges.length).toBe(10);
  });
});
