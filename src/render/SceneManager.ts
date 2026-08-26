import * as THREE from 'three';

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly root = new THREE.Group();
  readonly hemiLight: THREE.HemisphereLight;
  readonly keyLight: THREE.DirectionalLight;
  readonly fillLight: THREE.DirectionalLight;
  private grid: THREE.GridHelper;
  private ro: ResizeObserver;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d22);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    this.camera.position.set(3, 2.4, 3);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.hemiLight = new THREE.HemisphereLight(0xd6e0f0, 0x3a3f46, 1.5);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    this.keyLight.position.set(5, 8, 4);
    this.fillLight = new THREE.DirectionalLight(0xbfd0ff, 0.9);
    this.fillLight.position.set(-5, -2, -6);
    this.scene.add(this.hemiLight, this.keyLight, this.fillLight);

    this.grid = new THREE.GridHelper(10, 20, 0x3a3f47, 0x24272d);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.9;
    this.scene.add(this.grid);
    this.scene.add(this.root);

    const resize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    this.ro = new ResizeObserver(resize);
    this.ro.observe(container);
    resize();
  }

  setGridVisible(v: boolean): void {
    this.grid.visible = v;
  }

  setBackground(colorHex: number): void {
    (this.scene.background as THREE.Color).setHex(colorHex);
  }

  start(onFrame: (dt: number) => void): void {
    const clock = new THREE.Clock();
    const loop = (): void => {
      requestAnimationFrame(loop);
      const dt = clock.getDelta();
      onFrame(dt);
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  dispose(): void {
    this.ro.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    void this.container;
  }
}
