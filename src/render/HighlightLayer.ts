import * as THREE from 'three';
import type { MeshData } from '../core/MeshData';
import type { PickHit } from './PickingEngine';

const HOVER_COLOR = new THREE.Color(0x4db2ff);
const SELECT_COLOR = new THREE.Color(0xff8a3d);
const MAX_FACE_VERTS = 260;

const VERT_SHADER = `
uniform float uSize;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize;
}`;

const FRAG_SHADER = `
uniform vec3 uColor;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  if (dot(d, d) > 0.25) discard;
  gl_FragColor = vec4(uColor, 1.0);
}`;

export class HighlightLayer {
  readonly group = new THREE.Group();
  private data: MeshData | null = null;
  private facePosArr = new Float32Array(MAX_FACE_VERTS * 3);
  private faceAttr = new THREE.BufferAttribute(this.facePosArr, 3).setUsage(THREE.DynamicDrawUsage);
  private faceGeom = new THREE.BufferGeometry();
  private faceMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.38,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  private edgePosArr = new Float32Array(6);
  private edgeAttr = new THREE.BufferAttribute(this.edgePosArr, 3).setUsage(THREE.DynamicDrawUsage);
  private edgeGeom = new THREE.BufferGeometry();
  private edgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false });
  private vertPosArr = new Float32Array(3);
  private vertAttr = new THREE.BufferAttribute(this.vertPosArr, 3).setUsage(THREE.DynamicDrawUsage);
  private vertGeom = new THREE.BufferGeometry();
  private vertMat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 10 }, uColor: { value: new THREE.Color() } },
    vertexShader: VERT_SHADER,
    fragmentShader: FRAG_SHADER,
    depthTest: false,
  });
  private faceMesh: THREE.Mesh;
  private edgeLine: THREE.LineSegments;
  private vertPts: THREE.Points;

  constructor() {
    this.faceGeom.setAttribute('position', this.faceAttr);
    const fan = new Uint16Array((MAX_FACE_VERTS - 2) * 3);
    let o = 0;
    for (let k = 1; k < MAX_FACE_VERTS - 1; k++) {
      fan[o++] = 0;
      fan[o++] = k;
      fan[o++] = k + 1;
    }
    this.faceGeom.setIndex(new THREE.BufferAttribute(fan, 1));
    this.faceMesh = new THREE.Mesh(this.faceGeom, this.faceMat);
    this.faceMesh.renderOrder = 90;

    this.edgeGeom.setAttribute('position', this.edgeAttr);
    this.edgeLine = new THREE.LineSegments(this.edgeGeom, this.edgeMat);
    this.edgeLine.renderOrder = 95;

    this.vertGeom.setAttribute('position', this.vertAttr);
    this.vertPts = new THREE.Points(this.vertGeom, this.vertMat);
    this.vertPts.renderOrder = 100;

    for (const obj of [this.faceMesh, this.edgeLine, this.vertPts]) {
      obj.frustumCulled = false;
      obj.visible = false;
      this.group.add(obj);
    }
  }

  attach(data: MeshData | null): void {
    this.data = data;
    this.clear();
  }

  show(hit: PickHit | null, data: MeshData | null, selected: boolean): void {
    this.hideAll();
    if (!hit || !data) return;
    this.data = data;
    const color = selected ? SELECT_COLOR : HOVER_COLOR;
    const p = this.data.positions;
    if (hit.kind === 'vertex') {
      this.vertPosArr[0] = hit.position.x;
      this.vertPosArr[1] = hit.position.y;
      this.vertPosArr[2] = hit.position.z;
      this.vertAttr.needsUpdate = true;
      this.vertMat.uniforms.uColor.value.copy(color);
      this.vertPts.visible = true;
    } else if (hit.kind === 'edge') {
      const a = p[hit.v0 * 3];
      const b = p[hit.v1 * 3];
      this.edgePosArr.set([a, p[hit.v0 * 3 + 1], p[hit.v0 * 3 + 2], b, p[hit.v1 * 3 + 1], p[hit.v1 * 3 + 2]]);
      this.edgeAttr.needsUpdate = true;
      this.edgeMat.color.copy(color);
      this.edgeLine.visible = true;
    } else {
      const n = Math.min(hit.corners.length, MAX_FACE_VERTS);
      for (let i = 0; i < n; i++) {
        const vi = hit.corners[i];
        this.facePosArr[i * 3] = p[vi * 3];
        this.facePosArr[i * 3 + 1] = p[vi * 3 + 1];
        this.facePosArr[i * 3 + 2] = p[vi * 3 + 2];
      }
      this.faceAttr.needsUpdate = true;
      this.faceGeom.setDrawRange(0, Math.max(0, n - 2) * 3);
      this.faceMat.color.copy(color);
      this.faceMesh.visible = true;
    }
  }

  clear(): void {
    this.hideAll();
  }

  dispose(): void {
    this.faceGeom.dispose();
    this.edgeGeom.dispose();
    this.vertGeom.dispose();
    this.faceMat.dispose();
    this.edgeMat.dispose();
    this.vertMat.dispose();
  }

  private hideAll(): void {
    this.faceMesh.visible = false;
    this.edgeLine.visible = false;
    this.vertPts.visible = false;
  }
}
