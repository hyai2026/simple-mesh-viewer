import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { planLayout, uprightQuat } from '../src/stage/layout';
import { StageModel } from '../src/stage/StageModel';

function gridBox(sx: number, sy: number, sz: number, nx: number, ny: number, nz: number): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        out.push((i / (nx - 1) - 0.5) * sx, (j / (ny - 1) - 0.5) * sy, (k / (nz - 1) - 0.5) * sz);
      }
    }
  }
  return new Float32Array(out);
}

function rotateByQ(v: [number, number, number], q: [number, number, number, number]): THREE.Vector3 {
  const quat = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
  return new THREE.Vector3(...v).applyQuaternion(quat);
}

describe('uprightQuat', () => {
  it('把最长轴转到竖直方向', () => {
    const pos = gridBox(10, 1, 1, 41, 5, 5);
    const { q, uprighted } = uprightQuat(pos);
    expect(uprighted).toBe(true);
    const y = rotateByQ([1, 0, 0], q);
    expect(Math.abs(y.y)).toBeCloseTo(1, 5);
    expect(Math.abs(y.x)).toBeLessThan(1e-6);
    expect(Math.abs(y.z)).toBeLessThan(1e-6);
  });

  it('各向同性时跳过摆正', () => {
    const pos = gridBox(4, 4, 4, 9, 9, 9);
    const { q, uprighted } = uprightQuat(pos);
    expect(uprighted).toBe(false);
    expect(q).toEqual([0, 0, 0, 1]);
  });

  it('质量偏重的一端朝下', () => {
    const base = gridBox(10, 1, 1, 41, 3, 3);
    const extra: number[] = [];
    for (let i = 0; i < 600; i++) {
      const x = 8 + (i % 17) / 8;
      const y = ((i * 7) % 11) / 10 - 0.5;
      const z = ((i * 13) % 9) / 8 - 0.5;
      extra.push(x, y, z);
    }
    const merged = new Float32Array([...base, ...extra]);
    const { q, uprighted } = uprightQuat(merged);
    expect(uprighted).toBe(true);
    let sumY = 0;
    for (let i = 0; i < merged.length; i += 3) {
      sumY += rotateByQ([merged[i], merged[i + 1], merged[i + 2]], q).y;
    }
    expect(sumY / (merged.length / 3)).toBeLessThan(0);
  });
});

describe('planLayout', () => {
  it('统一缩放到目标半径并贴地', () => {
    const cube = gridBox(2, 2, 2, 5, 5, 5);
    const result = planLayout([
      { id: 'a', positions: cube },
      { id: 'b', positions: cube },
    ]);
    const a = result.get('a')!;
    expect(a.scale).toBeCloseTo(1 / Math.sqrt(3), 6);
    expect(a.position[1]).toBeCloseTo(1 * a.scale, 6);
  });

  it('网格居中：两单元 x 坐标对称', () => {
    const cube = gridBox(2, 2, 2, 4, 4, 4);
    const result = planLayout([
      { id: 'a', positions: cube },
      { id: 'b', positions: cube },
    ]);
    const a = result.get('a')!;
    const b = result.get('b')!;
    expect(a.position[0] + b.position[0]).toBeCloseTo(0, 9);
    expect(a.position[2]).toBeCloseTo(0, 9);
    expect(b.position[2]).toBeCloseTo(0, 9);
  });

  it('支持指定列数', () => {
    const cube = gridBox(2, 2, 2, 3, 3, 3);
    const result = planLayout(
      [
        { id: 'a', positions: cube },
        { id: 'b', positions: cube },
        { id: 'c', positions: cube },
      ],
      { cols: 3 },
    );
    const a = result.get('a')!;
    const c = result.get('c')!;
    expect(a.position[0]).toBeLessThan(0);
    expect(c.position[0]).toBeGreaterThan(0);
    expect(a.position[2]).toBeCloseTo(c.position[2], 9);
  });
});

describe('StageModel', () => {
  it('成组/解散/重命名/移除', () => {
    const m = new StageModel();
    const g = m.createGroup(['m1', 'm2']);
    expect(m.groupOf('m1')).toBe(g.id);
    expect(m.groupOf('m3')).toBeNull();
    m.rename(g.id, '  特征组  ');
    expect(m.snapshot(['m1', 'm2', 'm3']).groups[0].name).toBe('特征组');
    const snap = m.snapshot(['m1', 'm2', 'm3']);
    expect(snap.groups[0].members).toEqual(['m1', 'm2']);
    expect(snap.ungrouped).toEqual(['m3']);
    const freed = m.ungroup(g.id);
    expect(freed).toEqual(['m1', 'm2']);
    expect(m.hasGroup(g.id)).toBe(false);
    expect(m.groupOf('m1')).toBeNull();
    const g2 = m.createGroup(['m1', 'm3']);
    m.removeModel('m1');
    expect(m.snapshot(['m1', 'm3']).groups[0].members).toEqual(['m3']);
    m.removeModel('m3');
    expect(m.hasGroup(g2.id)).toBe(true);
  });
});
