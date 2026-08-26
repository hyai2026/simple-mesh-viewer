export class GrowableF32 {
  private buf: Float32Array;
  len = 0;

  constructor(cap = 1 << 12) {
    this.buf = new Float32Array(cap);
  }

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  push3(a: number, b: number, c: number): void {
    this.ensure(3);
    this.buf[this.len++] = a;
    this.buf[this.len++] = b;
    this.buf[this.len++] = c;
  }

  packed(): Float32Array {
    return this.len === this.buf.length ? this.buf : this.buf.slice(0, this.len);
  }
}

export class GrowableU32 {
  private buf: Uint32Array;
  len = 0;

  constructor(cap = 1 << 12) {
    this.buf = new Uint32Array(cap);
  }

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint32Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  push(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v;
  }

  push2(a: number, b: number): void {
    this.ensure(2);
    this.buf[this.len++] = a;
    this.buf[this.len++] = b;
  }

  packed(): Uint32Array {
    return this.len === this.buf.length ? this.buf : this.buf.slice(0, this.len);
  }
}
