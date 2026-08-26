import type { RawParsedMesh } from '../../core/MeshData';
import { GrowableU32 } from '../growable';

const decoder = new TextDecoder('utf-8');

type PlyType = 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64';

const CANONICAL: Record<string, PlyType> = {
  char: 'int8', int8: 'int8',
  uchar: 'uint8', uint8: 'uint8',
  short: 'int16', int16: 'int16',
  ushort: 'uint16', uint16: 'uint16',
  int: 'int32', int32: 'int32',
  uint: 'uint32', uint32: 'uint32',
  float: 'float32', float32: 'float32',
  double: 'float64', float64: 'float64',
};

const TYPE_SIZE: Record<PlyType, number> = {
  int8: 1, uint8: 1, int16: 2, uint16: 2,
  int32: 4, uint32: 4, float32: 4, float64: 8,
};

interface PlyProperty {
  name: string;
  type: PlyType;
  countType: PlyType | null;
}

interface PlyElement {
  name: string;
  count: number;
  props: PlyProperty[];
}

interface Header {
  format: string;
  elements: PlyElement[];
  bodyOffset: number;
}

interface ValueReader {
  scalar(type: PlyType): number;
  skipScalar(type: PlyType): void;
}

class AsciiCursor implements ValueReader {
  private i: number;

  constructor(private readonly s: string, start = 0) {
    this.i = start;
  }

  private skipWs(): void {
    const s = this.s;
    while (this.i < s.length) {
      const c = s.charCodeAt(this.i);
      if (c === 32 || c === 9 || c === 10 || c === 13) this.i++;
      else break;
    }
  }

  scalar(_type: PlyType): number {
    const tok = this.token();
    if (tok === null) throw new Error('PLY: 数据提前结束');
    const v = Number(tok);
    if (Number.isNaN(v)) throw new Error(`PLY: 非法数值 "${tok}"`);
    return v;
  }

  skipScalar(): void {
    if (this.token() === null) throw new Error('PLY: 数据提前结束');
  }

  private token(): string | null {
    this.skipWs();
    if (this.i >= this.s.length) return null;
    const s = this.s;
    let j = this.i;
    while (j < s.length) {
      const c = s.charCodeAt(j);
      if (c === 32 || c === 9 || c === 10 || c === 13) break;
      j++;
    }
    const tok = s.slice(this.i, j);
    this.i = j;
    return tok;
  }
}

class BinCursor implements ValueReader {
  constructor(private dv: DataView, public o: number, private le: boolean) {}

  scalar(type: PlyType): number {
    const dv = this.dv;
    const o = this.o;
    let v = 0;
    switch (type) {
      case 'int8': v = dv.getInt8(o); this.o += 1; break;
      case 'uint8': v = dv.getUint8(o); this.o += 1; break;
      case 'int16': v = dv.getInt16(o, this.le); this.o += 2; break;
      case 'uint16': v = dv.getUint16(o, this.le); this.o += 2; break;
      case 'int32': v = dv.getInt32(o, this.le); this.o += 4; break;
      case 'uint32': v = dv.getUint32(o, this.le); this.o += 4; break;
      case 'float32': v = dv.getFloat32(o, this.le); this.o += 4; break;
      case 'float64': v = dv.getFloat64(o, this.le); this.o += 8; break;
    }
    return v;
  }

  skipScalar(type: PlyType): void {
    this.o += TYPE_SIZE[type];
  }
}

function probeHeader(buffer: ArrayBuffer): Header {
  if (buffer.byteLength < 8) throw new Error('PLY: 文件过小');
  let windowSize = Math.min(buffer.byteLength, 1 << 16);
  let headerText = '';
  let bodyOffset = -1;
  for (;;) {
    headerText = decoder.decode(new Uint8Array(buffer, 0, windowSize));
    if (!/^ply\s*$/im.test(headerText.trimStart().split(/\r?\n/)[0] ?? '')) {
      throw new Error('PLY: 缺少 magic "ply"');
    }
    const endIdx = headerText.indexOf('end_header');
    if (endIdx >= 0) {
      const nl = headerText.indexOf('\n', endIdx);
      if (nl >= 0) {
        bodyOffset = nl + 1;
        break;
      }
    }
    if (windowSize >= buffer.byteLength) throw new Error('PLY: 未找到 end_header');
    windowSize = Math.min(buffer.byteLength, windowSize * 4);
  }
  const lines = headerText.slice(0, bodyOffset).split(/\r?\n/);
  let format = '';
  const elements: PlyElement[] = [];
  let current: PlyElement | null = null;
  for (const rawLine of lines) {
    const t = rawLine.trim();
    if (t.startsWith('format')) {
      const f = t.split(/\s+/)[1] ?? '';
      if (f !== 'ascii' && f !== 'binary_little_endian' && f !== 'binary_big_endian') {
        throw new Error(`PLY: 未知格式 "${f}"`);
      }
      format = f;
    } else if (t.startsWith('element')) {
      const tk = t.split(/\s+/);
      current = { name: tk[1] ?? '', count: Number(tk[2]), props: [] };
      elements.push(current);
    } else if (t.startsWith('property') && current) {
      const tk = t.split(/\s+/);
      if (tk[1] === 'list') {
        const countType = CANONICAL[tk[2]];
        const type = CANONICAL[tk[3]];
        if (!countType || !type || !tk[4]) throw new Error(`PLY: 非法 list 属性 "${t}"`);
        current.props.push({ name: tk[4], type, countType });
      } else {
        const type = CANONICAL[tk[1]];
        if (!type || !tk[2]) throw new Error(`PLY: 非法属性 "${t}"`);
        current.props.push({ name: tk[2], type, countType: null });
      }
    }
  }
  if (!format) throw new Error('PLY: 缺少 format 行');
  return { format, elements, bodyOffset };
}

function readList(r: ValueReader, p: PlyProperty, sink: ((v: number) => void) | null): void {
  const n = r.scalar(p.countType!);
  if (sink) {
    for (let k = 0; k < n; k++) sink(r.scalar(p.type));
  } else {
    for (let k = 0; k < n; k++) r.skipScalar(p.type);
  }
}

function skipPropValue(r: ValueReader, p: PlyProperty): void {
  if (p.countType !== null) readList(r, p, null);
  else r.skipScalar(p.type);
}

function pickEndpointProps(props: PlyProperty[]): [number, number] {
  const nameAt = (re: RegExp) =>
    props.findIndex((p) => p.countType === null && re.test(p.name));
  let i1 = nameAt(/^(v|vertex|vert|edge_v|e)1$/i);
  let i2 = nameAt(/^(v|vertex|vert|edge_v|e)2$/i);
  if (i1 < 0 || i2 < 0 || i1 === i2) {
    const scalars: number[] = [];
    props.forEach((p, i) => {
      if (p.countType === null) scalars.push(i);
    });
    if (scalars.length < 2) throw new Error('PLY: edge 元素缺少两个标量端点属性');
    i1 = scalars[0];
    i2 = scalars[1];
  }
  return [i1, i2];
}

export function parsePLY(buffer: ArrayBuffer, onProgress?: (fraction: number) => void): RawParsedMesh {
  const { format, elements, bodyOffset } = probeHeader(buffer);
  const ascii = format === 'ascii';
  let reader: ValueReader;
  if (ascii) {
    const bodyText = decoder.decode(new Uint8Array(buffer, bodyOffset));
    const cur = new AsciiCursor(bodyText);
    reader = {
      scalar: (t) => cur.scalar(t),
      skipScalar: () => cur.skipScalar(),
    };
  } else {
    const bin = new BinCursor(new DataView(buffer), bodyOffset, format === 'binary_little_endian');
    reader = {
      scalar: (t) => bin.scalar(t),
      skipScalar: (t) => bin.skipScalar(t),
    };
  }

  let positionCount = 0;
  let positions: Float32Array | null = null;
  const faceOffsets = new GrowableU32(1 << 10);
  const faceIndices = new GrowableU32(1 << 14);
  const explicitEdges = new GrowableU32(256);

  for (let ei = 0; ei < elements.length; ei++) {
    const el = elements[ei];
    if (el.name === 'vertex') {
      const xi = el.props.findIndex((p) => p.name === 'x');
      const yi = el.props.findIndex((p) => p.name === 'y');
      const zi = el.props.findIndex((p) => p.name === 'z');
      if (xi < 0 || yi < 0 || zi < 0) throw new Error('PLY: vertex 元素缺少 x/y/z 属性');
      positionCount = el.count;
      positions = new Float32Array(el.count * 3);
      for (let row = 0; row < el.count; row++) {
        for (let pi = 0; pi < el.props.length; pi++) {
          const p = el.props[pi];
          if (p.countType !== null) {
            skipPropValue(reader, p);
            continue;
          }
          const v = reader.scalar(p.type);
          if (pi === xi) positions[row * 3] = v;
          else if (pi === yi) positions[row * 3 + 1] = v;
          else if (pi === zi) positions[row * 3 + 2] = v;
        }
      }
    } else if (el.name === 'face') {
      const listProp = el.props.find((p) => p.countType !== null);
      if (!listProp) throw new Error('PLY: face 元素缺少 list 属性');
      for (let row = 0; row < el.count; row++) {
        faceOffsets.push(faceIndices.len);
        for (const p of el.props) {
          if (p === listProp) readList(reader, p, (v) => faceIndices.push(v));
          else skipPropValue(reader, p);
        }
      }
    } else if (el.name === 'edge') {
      const [i1, i2] = pickEndpointProps(el.props);
      for (let row = 0; row < el.count; row++) {
        let a = 0;
        let b = 0;
        for (let pi = 0; pi < el.props.length; pi++) {
          const p = el.props[pi];
          if (p.countType !== null) {
            skipPropValue(reader, p);
            continue;
          }
          const v = reader.scalar(p.type);
          if (pi === i1) a = v;
          else if (pi === i2) b = v;
        }
        explicitEdges.push2(a, b);
      }
    } else {
      for (let row = 0; row < el.count; row++) {
        for (const p of el.props) skipPropValue(reader, p);
      }
    }
    onProgress?.((ei + 1) / elements.length);
  }
  onProgress?.(1);

  if (!positions) throw new Error('PLY: 缺少 vertex 元素');
  const hasFaces = faceOffsets.len > 0;
  if (hasFaces) faceOffsets.push(faceIndices.len);
  return {
    format: 'ply',
    positionCount,
    positions,
    faceOffsets: hasFaces ? faceOffsets.packed() : null,
    faceIndices: faceIndices.len > 0 ? faceIndices.packed() : null,
    explicitEdges: explicitEdges.len > 0 ? explicitEdges.packed() : null,
  };
}
