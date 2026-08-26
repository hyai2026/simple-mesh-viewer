import * as THREE from 'three';

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly root = new THREE.Group();
  readonly hemiLight: THREE.HemisphereLight;
  readonly keyLight: THREE.DirectionalLight;
  readonly fillLight: THREE.DirectionalLight;
  readonly headLight: THREE.DirectionalLight;
  private grid: THREE.GridHelper;
  private ro: ResizeObserver;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d22);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    this.camera.position.set(3, 2.4, 3);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.hemiLight = new THREE.HemisphereLight(0xd6e0f0, 0x3a3f46, 1.9);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
    this.keyLight.position.set(5, 8, 4);
    this.fillLight = new THREE.DirectionalLight(0xbfd0ff, 1.2);
    this.fillLight.position.set(-5, -2, -6);
    this.headLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.headLight.position.set(0, 0, 1);
    this.camera.add(this.headLight);
    this.scene.add(this.camera);
    this.scene.add(this.hemiLight, this.keyLight, this.fillLight);

    this.grid = new THREE.GridHelper(10, 20, 0x3a3f47, 0x24272d);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.9;
    this.scene.add(this.grid);
    this.scene.add(this.root);

    const resize = () => this.applySize();
    this.ro = new ResizeObserver(resize);
    this.ro.observe(container);
    resize();
  }

  private applySize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setGridVisible(v: boolean): void {
    this.grid.visible = v;
  }

  setHeadlight(on: boolean): void {
    this.headLight.intensity = on ? 2.5 : 0;
  }

  async renderToBlob(scale: number, transparentBg: boolean): Promise<Blob> {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const oldPixelRatio = this.renderer.getPixelRatio();
    const oldBackground = this.scene.background;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(Math.round(w * scale), Math.round(h * scale), false);
      if (transparentBg) {
        this.scene.background = null;
        this.renderer.setClearColor(0x000000, 0);
      }
      this.renderer.render(this.scene, this.camera);
      return await new Promise<Blob>((resolve, reject) => {
        this.renderer.domElement.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('图像导出失败'))),
          'image/png',
        );
      });
    } finally {
      this.scene.background = oldBackground;
      this.renderer.setPixelRatio(oldPixelRatio);
      this.applySize();
      this.renderer.render(this.scene, this.camera);
    }
  }

  setBackground(colorHex: number): void {
    (this.scene.background as THREE.Color).setHex(colorHex);
  }

  start(onFrame: (dt: number) => void, onAfterRender?: () => void): void {
    const clock = new THREE.Clock();
    const loop = (): void => {
      requestAnimationFrame(loop);
      const dt = clock.getDelta();
      onFrame(dt);
      this.renderer.render(this.scene, this.camera);
      onAfterRender?.();
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
