import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { CameraRig } from '../render/CameraRig';
import type { MeshView } from '../render/MeshView';
import type { ModelRegistry } from '../render/ModelRegistry';
import type { SceneManager } from '../render/SceneManager';
import type { EventBus } from '../ui/EventBus';
import { StageModel } from './StageModel';
import {
  STAGE_PRESETS,
  StageScene,
  toneMappingOf,
  type StageEnvParams,
  type StagePreset,
} from './StageScene';
import { planLayout, type LayoutUnitInput } from './layout';

export interface StageSelection {
  unitId: string | null;
  modelId: string | null;
}

export class StageController {
  readonly stage = new StageScene();
  readonly data = new StageModel();

  private pivots = new Map<string, THREE.Group>();
  private groupNodes = new Map<string, THREE.Group>();
  private modelOfPivot = new Map<THREE.Group, string>();
  private tc: TransformControls;
  private selected: StageSelection = { unitId: null, modelId: null };
  private staged = false;
  private presetStates: Record<StagePreset, StageEnvParams>;
  private currentPreset: StagePreset;

  constructor(
    private bus: EventBus,
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    private models: ModelRegistry,
    private analysisRoot: THREE.Group,
    private sceneMgr: SceneManager,
    private rig: CameraRig,
  ) {
    this.tc = new TransformControls(camera, dom);
    this.tc.setMode('translate');
    this.tc.setSpace('world');
    this.tc.enabled = false;
    this.stage.scene.add(this.tc.getHelper());
    this.tc.addEventListener('mouseDown', () => this.setRigGated(true));
    this.tc.addEventListener('mouseUp', () => this.setRigGated(false));
    this.tc.addEventListener('objectChange', () => this.emitTransform());
    window.addEventListener('pointerup', () => {
      if (!this.tc.dragging) this.setRigGated(false);
    });
    window.addEventListener('pointercancel', () => {
      if (!this.tc.dragging) this.setRigGated(false);
    });
    this.presetStates = {
      studioDark: this.stage.params(),
      paperLight: { ...STAGE_PRESETS.paperLight },
    };
    this.currentPreset = this.stage.params().preset;
    this.wireEvents();
  }

  private rigGated = false;

  private setRigGated(on: boolean): void {
    if (this.rigGated === on) return;
    this.rigGated = on;
    this.rig.setEnabled(!on);
  }

  get scene(): THREE.Scene {
    return this.stage.scene;
  }

  isStaged(): boolean {
    return this.staged;
  }

  box(): THREE.Box3 {
    return new THREE.Box3().setFromObject(this.stage.stageRoot);
  }

  profileParams(): { toneMapping: THREE.ToneMapping; exposure: number; shadowMap: boolean } {
    const env = this.stage.params();
    return { toneMapping: toneMappingOf(env.toneMapping), exposure: env.exposure, shadowMap: true };
  }

  enter(): void {
    this.staged = true;
    this.rebuildHierarchy();
    this.stage.fitShadowCamera(this.box());
    this.tc.enabled = true;
    this.bus.emit('stage-structure-changed', { tree: this.treeSnapshot() });
  }

  leave(): void {
    this.staged = false;
    this.tc.detach();
    this.tc.enabled = false;
    this.setRigGated(false);
    this.rig.cancelMomentum();
    for (const [id] of this.pivots) {
      const view = this.models.get(id);
      if (view) this.analysisRoot.add(view.group);
    }
    this.selected = { unitId: null, modelId: null };
  }

  onModelAdded(view: MeshView): void {
    if (this.staged) {
      this.ensurePivot(view);
      this.stage.stageRoot.add(this.pivots.get(view.id)!);
      this.stage.fitShadowCamera(this.box());
    }
    this.bus.emit('stage-structure-changed', { tree: this.treeSnapshot() });
  }

  onModelRemoved(id: string): void {
    const gid = this.data.groupOf(id);
    const pivot = this.pivots.get(id);
    if (pivot) {
      pivot.parent?.remove(pivot);
      this.pivots.delete(id);
      this.modelOfPivot.delete(pivot);
    }
    this.data.removeModel(id);
    if (gid && this.data.hasGroup(gid)) {
      const g = this.treeSnapshot().groups.find((x) => x.id === gid);
      if (g && g.members.length === 0) this.data.ungroup(gid);
    }
    this.pruneGroupNodes();
    if (this.selected.modelId === id || this.selected.unitId === id) this.select(null, null);
    if (this.staged) this.stage.fitShadowCamera(this.box());
    this.bus.emit('stage-structure-changed', { tree: this.treeSnapshot() });
  }

  select(unitId: string | null, modelId: string | null): void {
    this.selected = { unitId, modelId };
    const node = this.nodeForSelection();
    if (node && this.staged) this.tc.attach(node);
    else this.tc.detach();
    this.bus.emit('stage-selection-changed', { unitId, modelId });
    this.emitTransform();
  }

  handleClick(e: { clientX: number; clientY: number }): void {
    if (this.tc.dragging) return;
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObject(this.stage.stageRoot, true);
    const hit = hits.find((h) => this.chainVisible(h.object));
    let modelId: string | null = null;
    if (hit) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !this.modelOfPivot.has(o as THREE.Group)) o = o.parent;
      if (o) modelId = this.modelOfPivot.get(o as THREE.Group) ?? null;
    }
    if (!modelId) {
      this.select(null, null);
      return;
    }
    const gid = this.data.groupOf(modelId);
    this.select(gid ?? modelId, null);
  }

  toggleGrid(): void {
    this.applyEnvParams({ grid: !this.stage.params().grid });
  }

  setGroundVisible(v: boolean): void {
    this.stage.setGroundVisible(v);
  }

  arrange(): void {
    const ids = this.models.all().map((v) => v.id);
    const snap = this.data.snapshot(ids);
    const units: LayoutUnitInput[] = [];
    for (const g of snap.groups) {
      const merged = mergePositions(g.members, this.models);
      if (merged) units.push({ id: g.id, positions: merged });
    }
    for (const mid of snap.ungrouped) {
      const v = this.models.get(mid);
      if (v?.meshData && v.meshData.positions.length > 0) {
        units.push({ id: mid, positions: v.meshData.positions });
      }
    }
    if (units.length === 0) return;
    const result = planLayout(units, {});
    for (const [id, r] of result) {
      const node = this.groupNodes.get(id) ?? this.pivots.get(id);
      if (!node) continue;
      node.quaternion.set(r.quaternion[0], r.quaternion[1], r.quaternion[2], r.quaternion[3]);
      node.position.set(r.position[0], r.position[1], r.position[2]);
      node.scale.setScalar(r.scale);
    }
    this.stage.fitShadowCamera(this.box());
    this.bus.emit('stage-arranged', { count: units.length });
    if (this.tc.object) this.emitTransform();
  }

  private wireEvents(): void {
    this.bus.on('stage-select', ({ unitId, modelId }) => this.select(unitId, modelId ?? null));

    this.bus.on('stage-set-transform', (t) => {
      if (t.unitId !== this.selected.unitId || (t.modelId ?? null) !== (this.selected.modelId ?? null)) return;
      const node = this.tc.object;
      if (!node) return;
      node.position.set(t.position[0], t.position[1], t.position[2]);
      node.quaternion.setFromEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(t.rotationDeg[0]),
          THREE.MathUtils.degToRad(t.rotationDeg[1]),
          THREE.MathUtils.degToRad(t.rotationDeg[2]),
          'XYZ',
        ),
      );
      node.scale.set(t.scale[0], t.scale[1], t.scale[2]);
      this.emitTransform();
    });

    this.bus.on('stage-gizmo', ({ mode, space }) => {
      const sp = space ?? this.tc.space;
      this.tc.setMode(mode);
      this.tc.setSpace(sp);
      this.bus.emit('stage-gizmo-changed', { mode, space: sp });
    });

    this.bus.on('stage-group', ({ modelIds }) => {
      const ids = modelIds.filter((id) => this.models.get(id));
      if (ids.length < 2) return;
      const info = this.data.createGroup(ids);
      if (this.staged) {
        for (const id of ids) this.pivots.get(id)!.updateWorldMatrix(true, true);
        const box = new THREE.Box3();
        for (const id of ids) box.expandByObject(this.pivots.get(id)!);
        const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
        const node = this.ensureGroupNode(info.id);
        node.position.copy(center);
        for (const id of ids) {
          const pivot = this.pivots.get(id)!;
          node.add(pivot);
          pivot.position.sub(center);
        }
      }
      this.bus.emit('stage-structure-changed', { tree: this.treeSnapshot() });
      this.select(info.id, null);
    });

    this.bus.on('stage-ungroup', ({ groupId }) => {
      const node = this.groupNodes.get(groupId);
      const members = this.data.ungroup(groupId);
      if (node && this.staged) {
        node.updateMatrixWorld(true);
        for (const child of [...node.children]) {
          const pivot = child as THREE.Group;
          const wp = new THREE.Vector3();
          const wq = new THREE.Quaternion();
          const ws = new THREE.Vector3();
          pivot.matrixWorld.decompose(wp, wq, ws);
          this.stage.stageRoot.add(pivot);
          pivot.position.copy(wp);
          pivot.quaternion.copy(wq);
          pivot.scale.copy(ws);
        }
        node.parent?.remove(node);
        this.groupNodes.delete(groupId);
      }
      this.bus.emit('stage-structure-changed', { tree: this.treeSnapshot() });
      const first = members.find((m) => this.models.get(m)) ?? null;
      this.select(first, null);
    });

    this.bus.on('stage-rename', ({ groupId, name }) => {
      this.data.rename(groupId, name);
      this.bus.emit('stage-structure-changed', { tree: this.treeSnapshot() });
    });

    this.bus.on('stage-arrange', () => this.arrange());

    this.bus.on('stage-env', (partial) => this.applyEnvParams(partial));
  }

  private applyEnvParams(partial: Partial<StageEnvParams>): void {
    if (partial.preset && Object.keys(partial).length === 1) {
      this.presetStates[this.currentPreset] = this.stage.params();
      this.currentPreset = partial.preset;
      this.stage.applyEnv({ ...this.presetStates[partial.preset] });
    } else {
      const merged = { ...this.stage.params(), ...partial };
      this.currentPreset = merged.preset;
      this.stage.applyEnv(merged);
      this.presetStates[merged.preset] = { ...merged };
    }
    this.sceneMgr.applyProfile(this.profileParams());
    this.bus.emit('stage-env-changed', this.stage.params());
  }

  private rebuildHierarchy(): void {
    const seen = new Set<string>();
    for (const view of this.models.all()) {
      const pivot = this.ensurePivot(view);
      seen.add(view.id);
      const gid = this.data.groupOf(view.id);
      const parent = gid ? this.ensureGroupNode(gid) : this.stage.stageRoot;
      parent.add(pivot);
    }
    for (const [id, pivot] of [...this.pivots]) {
      if (!seen.has(id)) {
        pivot.parent?.remove(pivot);
        this.pivots.delete(id);
        this.modelOfPivot.delete(pivot);
      }
    }
  }

  private ensurePivot(view: MeshView): THREE.Group {
    let pivot = this.pivots.get(view.id);
    if (!pivot) {
      pivot = new THREE.Group();
      this.pivots.set(view.id, pivot);
      this.modelOfPivot.set(pivot, view.id);
    }
    pivot.add(view.group);
    const mesh = view.getSurfaceMesh();
    if (mesh) mesh.castShadow = true;
    return pivot;
  }

  private ensureGroupNode(gid: string): THREE.Group {
    let node = this.groupNodes.get(gid);
    if (!node) {
      node = new THREE.Group();
      this.groupNodes.set(gid, node);
      this.stage.stageRoot.add(node);
    }
    return node;
  }

  private pruneGroupNodes(): void {
    for (const [gid, node] of [...this.groupNodes]) {
      if (!this.data.hasGroup(gid)) {
        node.parent?.remove(node);
        this.groupNodes.delete(gid);
      }
    }
  }

  private nodeForSelection(): THREE.Object3D | null {
    if (!this.selected.unitId) return null;
    if (this.selected.modelId) return this.pivots.get(this.selected.modelId) ?? null;
    return this.groupNodes.get(this.selected.unitId) ?? this.pivots.get(this.selected.unitId) ?? null;
  }

  private chainVisible(o: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = o;
    while (cur && cur !== this.stage.stageRoot) {
      if (!cur.visible) return false;
      cur = cur.parent;
    }
    return true;
  }

  private emitTransform(): void {
    const node = this.tc.object;
    if (!node || !this.selected.unitId) return;
    const p = node.position;
    const s = node.scale;
    const e = new THREE.Euler().setFromQuaternion(node.quaternion, 'XYZ');
    this.bus.emit('stage-transform-changed', {
      unitId: this.selected.unitId,
      modelId: this.selected.modelId,
      position: [p.x, p.y, p.z],
      rotationDeg: [
        THREE.MathUtils.radToDeg(e.x),
        THREE.MathUtils.radToDeg(e.y),
        THREE.MathUtils.radToDeg(e.z),
      ],
      scale: [s.x, s.y, s.z],
    });
  }

  private treeSnapshot() {
    return this.data.snapshot(this.models.all().map((v) => v.id));
  }
}

function mergePositions(memberIds: string[], models: ModelRegistry): Float32Array | null {
  const parts: Float32Array[] = [];
  let total = 0;
  for (const id of memberIds) {
    const v = models.get(id);
    if (!v?.meshData) continue;
    parts.push(v.meshData.positions);
    total += v.meshData.positions.length;
  }
  if (total === 0) return null;
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
