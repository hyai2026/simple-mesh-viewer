import type { CurvatureData, CurvatureInput } from '../core/Curvature';

export function computeCurvatureAsync(input: CurvatureInput): Promise<CurvatureData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/curvatureWorker.ts', import.meta.url), {
      type: 'module',
    });
    const cleanup = () => worker.terminate();
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: 'done'; data: CurvatureData } | { type: 'error'; message: string };
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
      reject(new Error(ev.message || '曲率 Worker 异常'));
    };
    worker.postMessage(input);
  });
}
