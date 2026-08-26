import type { RawParsedMesh } from '../../core/MeshData';
import { GrowableF32, GrowableU32 } from '../growable';

const decoder = new TextDecoder('utf-8');

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 11 || code === 12 || code === 13;
}

export function parseOBJ(buffer: ArrayBuffer, onProgress?: (fraction: number) => void): RawParsedMesh {
  const text = decoder.decode(buffer);
  const lines = text.split('\n');
  const positions = new GrowableF32(1 << 16);
  const faceIndices = new GrowableU32(1 << 16);
  const faceOffsets = new GrowableU32(1 << 12);
  const explicitEdges = new GrowableU32(1 << 10);
  let vertexCount = 0;

  const resolveIndex = (tok: string, lineNo: number): number => {
    const v = Number(tok);
    if (!Number.isInteger(v) || v === 0) {
      throw new Error(`OBJ 第 ${lineNo + 1} 行：非法索引 "${tok}"`);
    }
    const idx = v > 0 ? v - 1 : vertexCount + v;
    if (idx < 0 || idx >= vertexCount) {
      throw new Error(`OBJ 第 ${lineNo + 1} 行：顶点索引越界 "${tok}"`);
    }
    return idx;
  };

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let s = 0;
    while (s < line.length && isSpace(line.charCodeAt(s))) s++;
    if (s >= line.length) continue;
    const c0 = line[s];
    if (c0 === '#') continue;
    if (c0 === 'v') {
      if (!isSpace(line.charCodeAt(s + 1))) continue;
      const parts = line.slice(s + 1).trim().split(/\s+/);
      if (parts.length < 3 || parts[0] === '') continue;
      positions.push3(Number(parts[0]), Number(parts[1]), Number(parts[2]));
      vertexCount++;
    } else if (c0 === 'f') {
      const parts = line.slice(s + 1).trim().split(/\s+/);
      if (parts.length < 3 || parts[0] === '') continue;
      faceOffsets.push(faceIndices.len);
      for (const tok of parts) {
        const slash = tok.indexOf('/');
        const base = slash >= 0 ? tok.slice(0, slash) : tok;
        if (base === '') continue;
        faceIndices.push(resolveIndex(base, li));
      }
    } else if (c0 === 'l') {
      const parts = line.slice(s + 1).trim().split(/\s+/);
      if (parts.length < 2 || parts[0] === '') continue;
      let prev = resolveIndex(parts[0], li);
      for (let k = 1; k < parts.length; k++) {
        const cur = resolveIndex(parts[k], li);
        explicitEdges.push2(prev, cur);
        prev = cur;
      }
    }
    if (onProgress && (li & 0x3ffff) === 0x3ffff) onProgress(li / lines.length);
  }
  onProgress?.(1);

  const hasFaces = faceOffsets.len > 0;
  if (hasFaces) faceOffsets.push(faceIndices.len);
  return {
    format: 'obj',
    positionCount: vertexCount,
    positions: positions.packed(),
    faceOffsets: hasFaces ? faceOffsets.packed() : null,
    faceIndices: faceIndices.len > 0 ? faceIndices.packed() : null,
    explicitEdges: explicitEdges.len > 0 ? explicitEdges.packed() : null,
  };
}
