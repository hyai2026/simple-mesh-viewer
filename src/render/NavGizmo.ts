import * as THREE from 'three';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';

const DIM = 128;

export class NavGizmo {
  private helper: ViewHelper;
  private renderer: THREE.WebGLRenderer;
  private overlay: HTMLDivElement;
  private visible = true;
  private wasAnimating = false;

  constructor(
    container: HTMLElement,
    camera: THREE.PerspectiveCamera,
    private getFocusPoint: () => THREE.Vector3,
  ) {
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

    for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) {
      this.overlay.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'pointerup') {
          this.helper.center.copy(this.getFocusPoint());
          this.helper.handleClick(e);
        }
      });
    }
  }

  get isVisible(): boolean {
    return this.visible;
  }

  get isAnimating(): boolean {
    return this.helper.animating;
  }

  get focusPoint(): THREE.Vector3 {
    return this.helper.center;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.overlay.style.display = v ? 'block' : 'none';
  }

  update(dt: number): boolean {
    if (this.helper.animating) this.helper.update(dt);
    const settled = this.wasAnimating && !this.helper.animating;
    this.wasAnimating = this.helper.animating;
    return settled;
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
