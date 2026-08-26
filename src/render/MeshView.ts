import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { MeshData, MeshStats } from '../core/MeshData';
import { meshStats } from '../core/MeshData';

export type LayerKey = 'points' | 'edges' | 'surface';
export type SurfaceDiagnostic = 'none' | 'zebra' | 'curvature';

export interface LayerVisibility {
  points: boolean;
  edges: boolean;
  surface: boolean;
}

const POINTS_VERT = `
uniform float uSize;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize;
}`;

function pointsFrag(): string {
  return `
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  if (dot(d, d) > 0.25) discard;
  gl_FragColor = vec4(uColor, uAlpha);
}`;
}

export const ZEBRA_DEFAULT_STRIPE_COUNT = 48;

function createZebraMaterial(stripeCount: number): {
  material: THREE.ShaderMaterial;
  uniforms: { uStripeCount: { value: number } };
} {
  const uniforms = { uStripeCount: { value: stripeCount } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
varying vec3 vMVPos;
varying vec3 vVNormal;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vMVPos = mvPosition.xyz;
  vVNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
}`,
    fragmentShader: `
varying vec3 vMVPos;
varying vec3 vVNormal;
uniform float uStripeCount;
uniform float uAlpha;
void main() {
  vec3 V = normalize(-vMVPos);
  vec3 N = normalize(vVNormal);
  float phase = reflect(-V, N).y * uStripeCount;
  float aa = max(fwidth(phase) * 1.2, 1e-4);
  float tri = abs(fract(phase) - 0.5) * 2.0;
  float band = smoothstep(0.5 - aa, 0.5 + aa, tri);
  vec3 col = mix(vec3(0.02), vec3(0.95), band);
  gl_FragColor = vec4(col, uAlpha);
}`,
    side: THREE.DoubleSide,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  return { material: mat, uniforms };
}

const CURVATURE_VERT = `
attribute float aScalar;
varying float vScalar;
varying vec3 vMVPos;
varying vec3 vVNormal;
void main() {
  vScalar = aScalar;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vMVPos = mvPosition.xyz;
  vVNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
}`;

const CURVATURE_FRAG = `
varying float vScalar;
varying vec3 vMVPos;
varying vec3 vVNormal;
uniform float uAlpha;
uniform int uColormap;
vec3 jet(float t) {
  return clamp(vec3(
    1.5 - abs(4.0 * t - 3.0),
    1.5 - abs(4.0 * t - 2.0),
    1.5 - abs(4.0 * t - 1.0)
  ), 0.0, 1.0);
}
vec3 bwr(float t) {
  return t < 0.5
    ? mix(vec3(0.05, 0.05, 1.0), vec3(1.0), t * 2.0)
    : mix(vec3(1.0), vec3(1.0, 0.05, 0.05), (t - 0.5) * 2.0);
}
void main() {
  float s = clamp(vScalar, 0.0, 1.0);
  vec3 col = uColormap == 0 ? jet(s) : bwr(s);
  vec3 N = normalize(vVNormal);
  vec3 V = normalize(-vMVPos);
  float l = 0.6 + 0.4 * abs(dot(N, V));
  gl_FragColor = vec4(col * l, uAlpha);
}`;

function createCurvatureMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAlpha: { value: 1 },
      uColormap: { value: 0 },
    },
    vertexShader: CURVATURE_VERT,
    fragmentShader: CURVATURE_FRAG,
    side: THREE.DoubleSide,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export const DEFAULT_COLORS = {
  surface: 0xaeb6bf,
  edges: 0x616164,
  points: 0xffd166,
} as const;

export class MeshView {
  readonly id: string;
  readonly label: string;
  readonly group = new THREE.Group();
  private data: MeshData | null = null;
  private positionAttr: THREE.BufferAttribute | null = null;
  private surfaceGeo: THREE.BufferGeometry | null = null;
  private surfaceMat: THREE.MeshStandardMaterial | null = null;
  private surfaceMesh: THREE.Mesh | null = null;
  private pointsGeo: THREE.BufferGeometry | null = null;
  private pointsMat: THREE.ShaderMaterial | null = null;
  private pointsObj: THREE.Points | null = null;
  private edgesGeo: THREE.BufferGeometry | null = null;
  private edgesMat: THREE.LineBasicMaterial | null = null;
  private edgesObj: THREE.LineSegments | null = null;
  private vis: LayerVisibility = { points: false, edges: false, surface: false };
  private worldBox = new THREE.Box3();
  private bvhBuilt = false;
  private flatShading = true;
  private pickable = true;
  private diagMode: SurfaceDiagnostic = 'none';
  private diagZebraMat: THREE.ShaderMaterial | null = null;
  private diagZebraUniforms: { uStripeCount: { value: number } } | null = null;
  private diagCurvMat: THREE.ShaderMaterial | null = null;
  private stripeCount = ZEBRA_DEFAULT_STRIPE_COUNT;
  private opacity = 1;
  private colors: Record<LayerKey, number> = { ...DEFAULT_COLORS };

  constructor(id: string, label: string) {
    this.id = id;
    this.label = label;
  }

  build(data: MeshData): void {
    this.dispose();
    this.data = data;
    this.positionAttr = new THREE.BufferAttribute(data.positions, 3);

    if (data.triangleCount > 0 && data.renderIndex) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', this.positionAttr);
      g.setIndex(new THREE.BufferAttribute(data.renderIndex, 1));
      g.computeBoundingSphere();
      this.surfaceGeo = g;
      this.surfaceMat = new THREE.MeshStandardMaterial({
        color: this.colors.surface,
        roughness: 0.85,
        metalness: 0.05,
        side: THREE.DoubleSide,
        flatShading: this.flatShading,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      this.surfaceMesh = new THREE.Mesh(g, this.surfaceMat);
      this.surfaceMesh.renderOrder = 0;
      this.group.add(this.surfaceMesh);
    }
    if (data.edgeCount > 0 && data.edges) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', this.positionAttr);
      g.setIndex(new THREE.BufferAttribute(data.edges, 1));
      g.computeBoundingSphere();
      this.edgesGeo = g;
      this.edgesMat = new THREE.LineBasicMaterial({
        color: this.colors.edges,
        transparent: true,
      });
      this.edgesObj = new THREE.LineSegments(g, this.edgesMat);
      this.edgesObj.renderOrder = 1;
      this.group.add(this.edgesObj);
    }
    if (data.positionCount > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', this.positionAttr);
      g.computeBoundingSphere();
      this.pointsGeo = g;
      this.pointsMat = new THREE.ShaderMaterial({
        uniforms: {
          uSize: { value: 4 },
          uColor: { value: new THREE.Color(this.colors.points) },
          uAlpha: { value: this.opacity },
        },
        vertexShader: POINTS_VERT,
        fragmentShader: pointsFrag(),
        transparent: true,
      });
      this.pointsObj = new THREE.Points(g, this.pointsMat);
      this.pointsObj.renderOrder = 2;
      this.group.add(this.pointsObj);
    }

    this.computeWorldBox();
    this.diagMode = 'none';
    this.vis = defaultVisibility(data);
    this.applyVis();
    this.applyOpacity();
  }

  getSurfaceDiagnostic(): SurfaceDiagnostic {
    return this.diagMode;
  }

  setSurfaceDiagnostic(mode: SurfaceDiagnostic): void {
    if (this.diagMode === mode) return;
    if (!this.surfaceMesh || !this.surfaceGeo) return;
    this.diagMode = mode;
    if (mode !== 'none' && !this.surfaceGeo.getAttribute('normal')) {
      this.surfaceGeo.computeVertexNormals();
    }
    switch (mode) {
      case 'zebra':
        if (!this.diagZebraMat || !this.diagZebraUniforms) {
          const z = createZebraMaterial(this.stripeCount);
          this.diagZebraMat = z.material;
          this.diagZebraUniforms = z.uniforms;
        }
        this.surfaceMesh.material = this.diagZebraMat;
        break;
      case 'curvature':
        if (!this.diagCurvMat) this.diagCurvMat = createCurvatureMaterial();
        this.surfaceMesh.material = this.diagCurvMat;
        break;
      default:
        this.surfaceMesh.material = this.surfaceMat!;
    }
    this.applyOpacity();
  }

  setCurvatureScalars(scalars: Float32Array): void {
    if (!this.surfaceGeo) return;
    this.surfaceGeo.setAttribute('aScalar', new THREE.BufferAttribute(scalars, 1));
  }

  getStripeCount(): number {
    return this.stripeCount;
  }

  setStripeCount(count: number): void {
    this.stripeCount = Math.max(2, Math.round(count));
    if (this.diagZebraUniforms) {
      this.diagZebraUniforms.uStripeCount.value = this.stripeCount;
    }
  }

  getOpacity(): number {
    return this.opacity;
  }

  setOpacity(alpha: number): void {
    this.opacity = Math.min(1, Math.max(0.01, alpha));
    this.applyOpacity();
  }

  getColor(layer: LayerKey): number {
    return this.colors[layer];
  }

  setColor(layer: LayerKey, color: number): void {
    this.colors[layer] = color;
    if (layer === 'surface') this.surfaceMat?.color.setHex(color);
    else if (layer === 'edges') this.edgesMat?.color.setHex(color);
    else this.pointsMat?.uniforms.uColor.value.setHex(color);
  }

  private applyOpacity(): void {
    const solid = this.opacity > 0.999;
    const transparent = !solid;
    if (this.surfaceMat) {
      if (this.surfaceMat.transparent !== transparent) {
        this.surfaceMat.transparent = transparent;
        this.surfaceMat.needsUpdate = true;
      }
      this.surfaceMat.depthWrite = solid;
      this.surfaceMat.opacity = this.opacity;
    }
    for (const dm of [this.diagZebraMat, this.diagCurvMat]) {
      if (!dm) continue;
      if ((dm as THREE.ShaderMaterial).isShaderMaterial) {
        (dm as THREE.ShaderMaterial).uniforms.uAlpha.value = this.opacity;
      } else {
        dm.opacity = this.opacity;
      }
      dm.depthWrite = solid;
    }
    if (this.edgesMat) {
      if (this.edgesMat.transparent !== transparent) {
        this.edgesMat.transparent = transparent;
        this.edgesMat.needsUpdate = true;
      }
      this.edgesMat.depthWrite = solid;
      this.edgesMat.opacity = this.opacity;
    }
    if (this.pointsMat) {
      if (this.pointsMat.transparent !== transparent) {
        this.pointsMat.transparent = transparent;
        this.pointsMat.needsUpdate = true;
      }
      this.pointsMat.depthWrite = solid;
      this.pointsMat.uniforms.uAlpha.value = this.opacity;
    }
  }

  get meshData(): MeshData | null {
    return this.data;
  }

  get boundingBox(): THREE.Box3 {
    return this.worldBox;
  }

  getVisibility(): LayerVisibility {
    return { ...this.vis };
  }

  setVisibility(v: LayerVisibility): void {
    this.vis = { ...v };
    this.applyVis();
  }

  mergeVisibility(partial: Partial<LayerVisibility>): LayerVisibility {
    this.vis = { ...this.vis, ...partial };
    this.applyVis();
    return { ...this.vis };
  }

  hasLayer(k: LayerKey): boolean {
    if (k === 'surface') return !!this.surfaceMesh;
    if (k === 'edges') return !!this.edgesObj;
    return !!this.pointsObj;
  }

  getSurfaceMesh(): THREE.Mesh | null {
    return this.surfaceMesh;
  }

  setShading(flat: boolean): void {
    this.flatShading = flat;
    if (!this.surfaceMat || !this.surfaceGeo) return;
    if (!flat && !this.surfaceGeo.getAttribute('normal')) {
      this.surfaceGeo.computeVertexNormals();
    }
    this.surfaceMat.flatShading = flat;
    this.surfaceMat.needsUpdate = true;
  }

  isFlatShading(): boolean {
    return this.flatShading;
  }

  ensureBVH(): boolean {
    if (this.bvhBuilt || !this.surfaceGeo || !this.data?.renderIndex) return false;
    this.disposeBVH();
    this.surfaceGeo.boundsTree = new MeshBVH(this.surfaceGeo, { indirect: true });
    this.bvhBuilt = true;
    return true;
  }

  isPickable(): boolean {
    return this.pickable;
  }

  setPickable(v: boolean): void {
    this.pickable = v;
  }

  stats(): MeshStats | null {
    return this.data ? meshStats(this.data) : null;
  }

  dispose(): void {
    this.disposeBVH();
    for (const child of [...this.group.children]) {
      this.group.remove(child);
    }
    this.surfaceGeo?.dispose();
    this.pointsGeo?.dispose();
    this.edgesGeo?.dispose();
    this.surfaceMat?.dispose();
    this.pointsMat?.dispose();
    this.edgesMat?.dispose();
    this.diagZebraMat?.dispose();
    this.diagCurvMat?.dispose();
    this.diagZebraMat = null;
    this.diagZebraUniforms = null;
    this.diagCurvMat = null;
    this.diagMode = 'none';
    this.surfaceGeo = null;
    this.surfaceMat = null;
    this.surfaceMesh = null;
    this.pointsGeo = null;
    this.pointsMat = null;
    this.pointsObj = null;
    this.edgesGeo = null;
    this.edgesMat = null;
    this.edgesObj = null;
    this.positionAttr = null;
    this.data = null;
    this.bvhBuilt = false;
    this.worldBox.makeEmpty();
  }

  private disposeBVH(): void {
    if (!this.surfaceGeo) return;
    const bvh = this.surfaceGeo.boundsTree as { dispose?: () => void } | undefined;
    if (bvh && typeof bvh.dispose === 'function') bvh.dispose();
    (this.surfaceGeo as { boundsTree?: unknown }).boundsTree = undefined;
  }

  private computeWorldBox(): void {
    this.worldBox.makeEmpty();
    if (!this.data) return;
    const p = this.data.positions;
    const v = new THREE.Vector3();
    for (let i = 0; i < this.data.positionCount; i++) {
      v.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      this.worldBox.expandByPoint(v);
    }
  }

  private applyVis(): void {
    if (this.surfaceMesh) this.surfaceMesh.visible = this.vis.surface;
    if (this.edgesObj) this.edgesObj.visible = this.vis.edges;
    if (this.pointsObj) this.pointsObj.visible = this.vis.points;
  }
}

function defaultVisibility(d: MeshData): LayerVisibility {
  const hasFaces = d.triangleCount > 0;
  const hasEdges = d.edgeCount > 0;
  const hasVerts = d.positionCount > 0;
  return {
    surface: hasFaces,
    edges: !hasFaces && hasEdges,
    points: !hasFaces && !hasEdges && hasVerts,
  };
}
