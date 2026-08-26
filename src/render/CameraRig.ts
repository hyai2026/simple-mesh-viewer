import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { ArcballControls } from 'three/examples/jsm/controls/ArcballControls.js';

export type CameraMode = 'orbit' | 'trackball' | 'arcball';

export const CAMERA_MODES: CameraMode[] = ['orbit', 'trackball', 'arcball'];

export function nextCameraMode(mode: CameraMode): CameraMode {
  const i = CAMERA_MODES.indexOf(mode);
  return CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
}

export class CameraRig {
  readonly orbit: OrbitControls;
  readonly ball: TrackballControls;
  readonly arc: ArcballControls;
  private _mode: CameraMode = 'arcball';
  private active = false;
  private minDist = 1e-4;
  private maxDist = 5000;

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.zoomToCursor = true;
    this.orbit.screenSpacePanning = true;
    this.orbit.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.ball = new TrackballControls(camera, dom);
    this.ball.rotateSpeed = 1.5;
    this.ball.zoomSpeed = 1.2;
    this.ball.panSpeed = 0.8;
    this.ball.dynamicDampingFactor = 0.08;
    this.ball.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.arc = new ArcballControls(camera, dom);
    this.arc.rotateSpeed = 1.2;

    for (const c of [this.orbit, this.ball, this.arc]) {
      c.addEventListener('start', () => {
        this.active = true;
      });
      c.addEventListener('end', () => {
        this.active = false;
      });
    }

    this.applyMode();
  }

  get mode(): CameraMode {
    return this._mode;
  }

  setMode(mode: CameraMode): void {
    if (mode === this._mode) return;
    this.syncTargets();
    this._mode = mode;
    this.applyMode();
    if (mode === 'arcball') this.syncArcState();
  }

  isActive(): boolean {
    return this.active;
  }

  activeTarget(): THREE.Vector3 {
    if (this.mode === 'orbit') return this.orbit.target;
    if (this.mode === 'trackball') return this.ball.target;
    return this.arcTarget;
  }

  update(): void {
    if (this.mode === 'orbit') {
      this.orbit.update();
    } else if (this.mode === 'trackball') {
      this.ball.update();
    }
  }

  frameBox(box: THREE.Box3, padding = 1.25): void {
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1e-6);
    const fovV = THREE.MathUtils.degToRad(this.camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    const dist = (r / Math.sin(Math.min(fovV, fovH) / 2)) * padding;
    const dir = this.camera.position.clone().sub(this.orbit.target);
    if (dir.lengthSq() < 1e-12) dir.set(0.6, 0.45, 1).normalize();
    else dir.normalize();
    this.camera.near = Math.max(dist / 1000, r / 10000, 1e-6);
    this.camera.far = dist + r * 200;
    this.camera.updateProjectionMatrix();
    this.minDist = Math.max(r * 0.0005, this.camera.near);
    this.maxDist = Math.max(dist * 50, r * 500);
    this.orbit.minDistance = this.minDist;
    this.orbit.maxDistance = this.maxDist;
    this.arc.minDistance = this.minDist;
    this.arc.maxDistance = this.maxDist;
    this.orbit.target.copy(sphere.center);
    this.ball.target.copy(sphere.center);
    this.arcTarget.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.orbit.update();
    this.ball.update();
    this.syncArcState();
  }

  fitAll(worldBox: THREE.Box3): void {
    this.frameBox(worldBox);
  }

  dispose(): void {
    this.orbit.dispose();
    this.ball.dispose();
    this.arc.dispose();
  }

  private syncArcState(): void {
    const arcTarget = this.arcTarget;
    arcTarget.copy(this.activeTarget());
    this.arc.setCamera(this.camera);
  }

  private syncTargets(): void {
    const arcTarget = this.arcTarget;
    if (this.mode === 'orbit') {
      this.ball.target.copy(this.orbit.target);
      arcTarget.copy(this.orbit.target);
    } else if (this.mode === 'trackball') {
      this.orbit.target.copy(this.ball.target);
      arcTarget.copy(this.ball.target);
    } else {
      this.orbit.target.copy(arcTarget);
      this.ball.target.copy(arcTarget);
    }
  }

  private get arcTarget(): THREE.Vector3 {
    return (this.arc as unknown as { target: THREE.Vector3 }).target;
  }

  private applyMode(): void {
    this.orbit.enabled = this.mode === 'orbit';
    this.ball.enabled = this.mode === 'trackball';
    this.arc.enabled = this.mode === 'arcball';
  }
}
