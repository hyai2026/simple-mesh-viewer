/// <reference lib="webworker" />
import { computeCurvature, type CurvatureInput } from '../../core/Curvature';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<CurvatureInput>) => {
  try {
    const cd = computeCurvature(e.data);
    ctx.postMessage({ type: 'done', data: cd }, [
      cd.mean.buffer,
      cd.gauss.buffer,
      cd.valid.buffer,
    ]);
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
