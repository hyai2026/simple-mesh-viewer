import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { assembleMeshData } from '../src/core/MeshData';
import { parseOBJ } from '../src/io/parsers/obj';
import { MeshView } from '../src/render/MeshView';
import { PickingEngine } from '../src/render/PickingEngine';

const CUBE_OBJ = `
v -1 -1 -1
v 1 -1 -1
v 1 1 -1
v -1 1 -1
v -1 -1 1
v 1 -1 1
v 1 1 1
v -1 1 1
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 2 6 7 3
f 3 7 8 4
f 5 1 4 8
`;

const RECT = { left: 0, top: 0, width: 800, height: 600 };

function makeCubeView(): MeshView {
  const raw = parseOBJ(new TextEncoder().encode(CUBE_OBJ).buffer);
  const view = new MeshView('m1', 'cube.obj');
  view.build(assembleMeshData(raw, 'cube.obj'));
  return view;
}

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, RECT.width / RECT.height, 0.01, 100);
  camera.position.set(3, 2.4, 3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('PickingEngine 集成', () => {
  it('视线中心命中立方体（面拾取）', () => {
    const view = makeCubeView();
    view.ensureBVH();
    const picking = new PickingEngine(makeCamera());
    picking.register(view);
    const hit = picking.pick(RECT.width / 2, RECT.height / 2, RECT, 10);
    expect(hit).not.toBeNull();
    expect(hit!.modelId).toBe('m1');
    expect(hit!.kind).toBe('face');
  });

  it('无 BVH 时回退普通 raycast 仍可命中', () => {
    const view = makeCubeView();
    const picking = new PickingEngine(makeCamera());
    picking.register(view);
    const hit = picking.pick(RECT.width / 2, RECT.height / 2, RECT, 10);
    expect(hit).not.toBeNull();
    expect(hit!.kind).toBe('face');
  });

  it('点图层开启时顶点优先', () => {
    const view = makeCubeView();
    view.ensureBVH();
    view.mergeVisibility({ points: true });
    const picking = new PickingEngine(makeCamera());
    picking.register(view);
    // 顶点 7 (1,1,1) 投影到屏幕后在其附近拾取
    const camera = makeCamera();
    const picking2 = new PickingEngine(camera);
    picking2.register(view);
    const corner = new THREE.Vector3(1, 1, 1).project(camera);
    const sx = (corner.x * 0.5 + 0.5) * RECT.width;
    const sy = (-corner.y * 0.5 + 0.5) * RECT.height;
    const hit = picking2.pick(sx, sy, RECT, 10);
    expect(hit).not.toBeNull();
    expect(hit!.kind).toBe('vertex');
    expect(hit!.index).toBe(6);
  });

  it('模型不可拾取时不命中', () => {
    const view = makeCubeView();
    view.ensureBVH();
    view.setPickable(false);
    const picking = new PickingEngine(makeCamera());
    picking.register(view);
    const hit = picking.pick(RECT.width / 2, RECT.height / 2, RECT, 10);
    expect(hit).toBeNull();
  });

  it('点击远离模型返回 null', () => {
    const view = makeCubeView();
    view.ensureBVH();
    const picking = new PickingEngine(makeCamera());
    picking.register(view);
    const hit = picking.pick(5, 5, RECT, 10);
    expect(hit).toBeNull();
  });
});
