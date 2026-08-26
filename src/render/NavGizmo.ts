import * as THREE from 'three';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';

const DIM = 128;

export class NavGizmo {
  private helper: ViewHelper;
  private renderer: THREE.WebGLRenderer;
  private overlay: HTMLDivElement;
  private visible = true;

  constructor(container: HTMLElement, camera: THREE.PerspectiveCamera) {
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

    this.overlay.addEventListener('pointerup', (e) => {
      this.helper.handleClick(e);
    });
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.overlay.style.display = v ? 'block' : 'none';
  }

  update(dt: number): void {
    if (this.helper.animating) this.helper.update(dt);
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
}
