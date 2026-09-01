import type { SerializedBVH } from 'three-mesh-bvh';

export function buildBVHAsync(
  positions: Float32Array,
  renderIndex: Uint32Array,
): Promise<SerializedBVH> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./bvhWorker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => worker.terminate();
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: 'done'; data: SerializedBVH } | { type: 'error'; message: string };
      if (m.type === 'done') {
        cleanup();
        resolve(m.data);
      } else {
        cleanup();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (ev) => {
      cleanup();
      reject(new Error(ev.message || 'BVH Worker 异常'));
    };
    worker.postMessage({ positions, renderIndex });
  });
}
