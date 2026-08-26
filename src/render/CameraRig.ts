import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class CameraRig {
  readonly controls: OrbitControls;
  private active = false;

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.addEventListener('start', () => {
      this.active = true;
    });
    this.controls.addEventListener('end', () => {
      this.active = false;
    });
  }

  isActive(): boolean {
    return this.active;
  }

  frameBox(box: THREE.Box3, padding = 1.25): void {
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1e-6);
    const fovV = THREE.MathUtils.degToRad(this.camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    const dist = (r / Math.sin(Math.min(fovV, fovH) / 2)) * padding;
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-12) dir.set(0.6, 0.45, 1).normalize();
    else dir.normalize();
    this.camera.near = Math.max(dist / 1000, r / 10000, 1e-6);
    this.camera.far = dist + r * 200;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.max(r * 0.002, 1e-6);
    this.controls.maxDistance = Math.max(dist * 50, r * 500);
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.controls.update();
  }

  fitAll(worldBox: THREE.Box3): void {
    this.frameBox(worldBox);
  }
}
