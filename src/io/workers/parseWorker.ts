/// <reference lib="webworker" />
import { assembleMeshData } from '../../core/MeshData';
import { detectFormat, getParser } from '../ParserRegistry';

interface ParseRequest {
  fileName: string;
  buffer: ArrayBuffer;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<ParseRequest>) => {
  const { fileName, buffer } = e.data;
  try {
    const parser = getParser(detectFormat(fileName));
    const raw = parser(buffer, (fraction) => {
      ctx.postMessage({ type: 'progress', value: fraction });
    });
    const mesh = assembleMeshData(raw, fileName);
    const transfers = new Set<ArrayBuffer>();
    const maybe = (a: ArrayBufferView | null | undefined) => {
      if (a && a.buffer instanceof ArrayBuffer) transfers.add(a.buffer as ArrayBuffer);
    };
    maybe(mesh.positions);
    maybe(mesh.faceOffsets);
    maybe(mesh.faceIndices);
    maybe(mesh.renderIndex);
    maybe(mesh.triToFace);
    maybe(mesh.edges);
    ctx.postMessage({ type: 'done', mesh }, [...transfers]);
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
