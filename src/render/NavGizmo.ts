import * as THREE from 'three';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';

const DIM = 128;
const ANIM_DURATION = 500;

const Z_UNIT = new THREE.Vector3(0, 0, 1);

const AXIS_VECTORS: Record<string, THREE.Vector3> = {
  posX: new THREE.Vector3(1, 0, 0),
  negX: new THREE.Vector3(-1, 0, 0),
  posY: new THREE.Vector3(0, 1, 0),
  negY: new THREE.Vector3(0, -1, 0),
  posZ: new THREE.Vector3(0, 0, 1),
  negZ: new THREE.Vector3(0, 0, -1),
};

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class NavGizmo {
  private helper: ViewHelper;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private overlay: HTMLDivElement;
  private visible = true;
  private raycaster = new THREE.Raycaster();
  private orthoCamera: THREE.OrthographicCamera;
  private mouse = new THREE.Vector2();
  private animating = false;
  private animStartTime = 0;
  private animRadius = 0;
  private animCenter = new THREE.Vector3();
  private animDirStart = new THREE.Vector3();
  private animDirEnd = new THREE.Vector3();
  private animQuatStart = new THREE.Quaternion();
  private animQuatEnd = new THREE.Quaternion();

  centerProvider?: () => THREE.Vector3;
  onAnimationEnd?: () => void;

  constructor(container: HTMLElement, camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.overlay = document.createElement('div');
    this.overlay.className = 'nav-gizmo';
    const canvas = document.createElement('canvas');
    canvas.width = DIM;
    canvas.height = DIM;
    this.overlay.appendChild(canvas);
    container.appendChild(this.overlay);

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(DIM, DIM, false);
    this.renderer.setClearAlpha(0);

    this.helper = new ViewHelper(camera, this.overlay);
    this.helper.setLabels('X', 'Y', 'Z');
    this.orthoCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0, 4);
    this.orthoCamera.position.set(0, 0, 2);

    for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) {
      this.overlay.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'pointerup') this.handleClick(e);
      });
    }
  }

  get isVisible(): boolean {
    return this.visible;
  }

  get isAnimating(): boolean {
    return this.animating;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.overlay.style.display = v ? 'block' : 'none';
  }

  update(): void {
    if (!this.animating) return;
    const camera = this.camera;
    const raw = Math.min((performance.now() - this.animStartTime) / ANIM_DURATION, 1);
    const t = easeInOutCubic(raw);

    const qDir = new THREE.Quaternion().slerpQuaternions(
      new THREE.Quaternion().setFromUnitVectors(Z_UNIT, this.animDirStart),
      new THREE.Quaternion().setFromUnitVectors(Z_UNIT, this.animDirEnd),
      t,
    );
    const dir = Z_UNIT.clone().applyQuaternion(qDir);
    camera.position.copy(this.animCenter).addScaledVector(dir, this.animRadius);
    camera.quaternion.slerpQuaternions(this.animQuatStart, this.animQuatEnd, t);

    if (raw >= 1) {
      camera.position.copy(this.animCenter).addScaledVector(this.animDirEnd, this.animRadius);
      camera.quaternion.copy(this.animQuatEnd);
      this.animating = false;
      this.onAnimationEnd?.();
    }
  }

  render(): void {
    if (!this.visible) return;
    this.helper.render(this.renderer);
  }

  dispose(): void {
    this.helper.dispose();
    this.renderer.dispose();
    this.overlay.remove();
  }

  private handleClick(e: PointerEvent): void {
    if (this.animating) return;
    const rect = this.overlay.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.orthoCamera);

    const sprites = this.helper.children.filter((o) => (o as THREE.Sprite).isSprite);
    const hits = this.raycaster.intersectObjects(sprites, false);
    if (hits.length === 0) return;

    const type = hits[0].object.userData.type as string;
    const axis = AXIS_VECTORS[type];
    if (!axis) return;
    this.beginAnimation(axis);
  }

  private beginAnimation(axis: THREE.Vector3): void {
    const camera = this.camera;
    const center = this.centerProvider
      ? this.centerProvider()
      : this.animCenter.set(0, 0, 0);
    this.animCenter.copy(center);
    this.animRadius = Math.max(camera.position.distanceTo(center), 1e-6);
    this.animDirStart.copy(camera.position).sub(center).normalize();
    this.animDirEnd.copy(axis).normalize();
    this.animQuatStart.copy(camera.quaternion);

    const endPos = center.clone().addScaledVector(this.animDirEnd, this.animRadius);
    const up = Math.abs(this.animDirEnd.y) > 0.999
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4().lookAt(endPos, center, up);
    this.animQuatEnd.setFromRotationMatrix(m);

    this.animStartTime = performance.now();
    this.animating = true;
  }
}
