import type { MeshData } from '../core/MeshData';

export function loadModelFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<MeshData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/parseWorker.ts', import.meta.url), {
      type: 'module',
    });
    const cleanup = () => worker.terminate();
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as
        | { type: 'progress'; value: number }
        | { type: 'done'; mesh: MeshData }
        | { type: 'error'; message: string };
      if (m.type === 'progress') onProgress?.(m.value);
      else if (m.type === 'done') {
        cleanup();
        resolve(m.mesh);
      } else {
        cleanup();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (ev) => {
      cleanup();
      reject(new Error(ev.message || '解析 Worker 异常'));
    };
    file.arrayBuffer().then(
      (buf) => {
        worker.postMessage({ fileName: file.name, buffer: buf }, [buf]);
      },
      (err) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
