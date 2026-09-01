import * as THREE from 'three';

export type StagePreset = 'studioDark' | 'paperLight';
export type StageGroundMode = 'shadowOnly' | 'solid' | 'none';

export interface StageEnvParams {
  preset: StagePreset;
  bgTop: string;
  bgBottom: string;
  key: number;
  fill: number;
  ambient: number;
  ground: StageGroundMode;
  groundColor: string;
  shadowOpacity: number;
  exposure: number;
  toneMapping: 'aces' | 'neutral' | 'none';
  grid: boolean;
}

export const STUDIO_DARK: StageEnvParams = {
  preset: 'studioDark',
  bgTop: '#39404e',
  bgBottom: '#101216',
  key: 3.2,
  fill: 0.9,
  ambient: 0.55,
  ground: 'shadowOnly',
  groundColor: '#20242c',
  shadowOpacity: 0.42,
  exposure: 1.0,
  toneMapping: 'aces',
  grid: true,
};

export const PAPER_LIGHT: StageEnvParams = {
  preset: 'paperLight',
  bgTop: '#ffffff',
  bgBottom: '#dde2e8',
  key: 2.6,
  fill: 1.1,
  ambient: 0.85,
  ground: 'solid',
  groundColor: '#f0f2f5',
  shadowOpacity: 0.22,
  exposure: 1.0,
  toneMapping: 'neutral',
  grid: true,
};

export const STAGE_PRESETS: Record<StagePreset, StageEnvParams> = {
  studioDark: STUDIO_DARK,
  paperLight: PAPER_LIGHT,
};

export function toneMappingOf(mode: StageEnvParams['toneMapping']): THREE.ToneMapping {
  if (mode === 'aces') return THREE.ACESFilmicToneMapping;
  if (mode === 'neutral') return THREE.NeutralToneMapping;
  return THREE.NoToneMapping;
}

export class StageScene {
  readonly scene = new THREE.Scene();
  readonly stageRoot = new THREE.Group();

  private hemi = new THREE.HemisphereLight(0xffffff, 0x3a3f48, 0.6);
  private key = new THREE.DirectionalLight(0xffffff, 3.2);
  private fill = new THREE.DirectionalLight(0xbfd0ff, 1.0);
  private ground: THREE.Mesh;
  private shadowMat: THREE.ShadowMaterial;
  private solidMat: THREE.MeshStandardMaterial;
  private grid: THREE.GridHelper;
  private bgTexture: THREE.CanvasTexture | null = null;
  private env: StageEnvParams = { ...STUDIO_DARK };
  private groundOn = true;

  constructor() {
    this.scene.add(this.stageRoot);

    this.key.position.set(6, 10, 7);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -5e-4;
    this.key.shadow.normalBias = 0.02;
    const sc = this.key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -6;
    sc.right = 6;
    sc.top = 6;
    sc.bottom = -6;
    sc.near = 0.1;
    sc.far = 60;
    this.scene.add(this.key, this.key.target);

    this.fill.position.set(-7, 4, -6);
    this.scene.add(this.hemi, this.fill);

    this.shadowMat = new THREE.ShadowMaterial({ opacity: this.env.shadowOpacity });
    this.solidMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.env.groundColor),
      roughness: 0.95,
      metalness: 0,
    });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), this.shadowMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.grid = new THREE.GridHelper(40, 40, 0x5a6270, 0x2c313a);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.5;
    this.grid.position.y = 0.002;
    this.scene.add(this.grid);

    this.applyEnv(this.env);
  }

  params(): StageEnvParams {
    return { ...this.env };
  }

  applyEnv(p: StageEnvParams): void {
    this.env = { ...p };
    this.updateBackground(p.bgTop, p.bgBottom);
    this.key.intensity = p.key;
    this.fill.intensity = p.fill;
    this.hemi.intensity = p.ambient;
    if (p.ground === 'solid') {
      this.ground.material = this.solidMat;
      this.solidMat.color.set(p.groundColor);
    } else {
      this.ground.material = this.shadowMat;
      this.shadowMat.opacity = p.shadowOpacity;
    }
    this.ground.visible = p.ground !== 'none' && this.groundOn;
    this.grid.visible = p.grid;
  }

  setGroundVisible(v: boolean): void {
    this.groundOn = v;
    this.ground.visible = this.env.ground !== 'none' && this.groundOn;
  }

  fitShadowCamera(box: THREE.Box3): void {
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1);
    const dir = new THREE.Vector3(6, 10, 7).normalize();
    this.key.position.copy(sphere.center).addScaledVector(dir, r * 2.5 + 2);
    this.key.target.position.copy(sphere.center);
    this.key.target.updateMatrixWorld();
    const sc = this.key.shadow.camera as THREE.OrthographicCamera;
    const half = r * 1.25;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 0.1;
    sc.far = r * 6 + 8;
    sc.updateProjectionMatrix();
  }

  private updateBackground(top: string, bottom: string): void {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, top);
      grad.addColorStop(1, bottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 2, 256);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = tex;
    this.bgTexture?.dispose();
    this.bgTexture = tex;
  }
}
