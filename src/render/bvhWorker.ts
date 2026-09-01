/// <reference lib="webworker" />
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

interface BvhRequest {
  positions: Float32Array;
  renderIndex: Uint32Array;
}

ctx.onmessage = (e: MessageEvent<BvhRequest>) => {
  try {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(e.data.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(e.data.renderIndex, 1));
    const bvh = new MeshBVH(geo, { indirect: true });
    const data = MeshBVH.serialize(bvh, { cloneBuffers: true });
    const transfers: Transferable[] = [...data.roots];
    if (data.index) transfers.push(data.index.buffer as ArrayBuffer);
    if (data.indirectBuffer) transfers.push(data.indirectBuffer.buffer as ArrayBuffer);
    ctx.postMessage({ type: 'done', data }, transfers);
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
