import type { RawParsedMesh } from '../core/MeshData';
import { parseOBJ } from './parsers/obj';
import { parsePLY } from './parsers/ply';

export type MeshParser = (
  buffer: ArrayBuffer,
  onProgress?: (fraction: number) => void,
) => RawParsedMesh;

const registry = new Map<string, MeshParser>();

export function registerParser(ext: string, parser: MeshParser): void {
  registry.set(ext.toLowerCase(), parser);
}

export function getParser(ext: string): MeshParser {
  const p = registry.get(ext.toLowerCase());
  if (!p) {
    throw new Error(`不支持的网格格式 ".${ext}"（已支持：${[...registry.keys()].join(', ')}）`);
  }
  return p;
}

export function detectFormat(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

registerParser('obj', parseOBJ);
registerParser('ply', parsePLY);
