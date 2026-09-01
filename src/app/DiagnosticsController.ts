import {
  derivePrincipal,
  normalizeForColormap,
  type Colormap,
  type CurvatureData,
  type CurvatureType,
  type NormalizedScalars,
} from '../core/Curvature';
import { computeCurvatureAsync } from '../io/computeCurvatureAsync';
import type { MeshView, SurfaceDiagnostic } from '../render/MeshView';
import type { ModelRegistry } from '../render/ModelRegistry';
import type { AppMode, EventBus } from '../ui/EventBus';

export class DiagnosticsController {
  private surfaceDiagnostic: SurfaceDiagnostic = 'none';
  private curvOpts: { type: CurvatureType; colormap: Colormap } = { type: 'mean', colormap: 'jet' };
  private cache = new Map<string, CurvatureData>();
  private inflight = new Map<string, Promise<void>>();
  private epoch = 0;

  constructor(
    private bus: EventBus,
    private models: ModelRegistry,
    private getMode: () => AppMode,
  ) {
    bus.on('set-surface-diagnostic', ({ mode }) => this.setDiagnostic(mode));
    bus.on('set-zebra-density', ({ count }) => {
      for (const view of models.all()) view.setStripeCount(count);
    });
    bus.on('set-curvature-options', (opts) => {
      this.curvOpts = opts;
      bus.emit('curvature-options-changed', opts);
      if (this.surfaceDiagnostic !== 'curvature' || this.cache.size === 0) return;
      this.applyAll();
    });
    bus.on('model-added', () => {
      if (this.getMode() !== 'analysis' || this.surfaceDiagnostic === 'none') return;
      this.setDiagnostic(this.surfaceDiagnostic);
    });
    bus.on('model-removed', ({ id }) => {
      this.cache.delete(id);
    });
  }

  get mode(): SurfaceDiagnostic {
    return this.surfaceDiagnostic;
  }

  resetToNone(): void {
    if (this.surfaceDiagnostic === 'none') return;
    this.surfaceDiagnostic = 'none';
    this.epoch++;
    this.applyAll();
  }

  private setDiagnostic(mode: SurfaceDiagnostic): void {
    this.surfaceDiagnostic = mode;
    const epoch = ++this.epoch;
    const views = this.models.all().filter((v) => v.meshData && v.hasLayer('surface'));
    if (mode === 'curvature' && views.some((v) => !this.cache.has(v.id))) {
      this.bus.emit('busy', { active: true, label: '计算曲率…' });
      void Promise.all(views.map((v) => this.prefetch(v))).then(() => {
        this.bus.emit('busy', { active: false });
        if (epoch === this.epoch) this.applyAll();
      });
    } else {
      this.applyAll();
    }
  }

  private prefetch(view: MeshView): Promise<void> {
    if (this.cache.has(view.id)) return Promise.resolve();
    const existing = this.inflight.get(view.id);
    if (existing) return existing;
    const data = view.meshData;
    if (!data || !view.hasLayer('surface')) return Promise.resolve();
    const p = computeCurvatureAsync({
      positionCount: data.positionCount,
      positions: data.positions,
      renderIndex: data.renderIndex,
    })
      .then((cd) => {
        if (this.models.get(view.id)) this.cache.set(view.id, cd);
      })
      .catch(() => {
        // 计算失败时保持未缓存状态，下次触发会重试
      })
      .finally(() => {
        this.inflight.delete(view.id);
      });
    this.inflight.set(view.id, p);
    return p;
  }

  private scalarsFor(view: MeshView): NormalizedScalars | null {
    const cd = this.cache.get(view.id);
    if (!cd) return null;
    const values = derivePrincipal(this.curvOpts.type, cd.mean, cd.gauss);
    return normalizeForColormap(values, 0.02, 0.98, cd.valid);
  }

  private applyToView(view: MeshView): { min: number; max: number } | null {
    if (!view.meshData || !view.hasLayer('surface')) return null;
    let range: { min: number; max: number } | null = null;
    if (this.surfaceDiagnostic === 'curvature') {
      view.setColormap(this.curvOpts.colormap);
      const sc = this.scalarsFor(view);
      if (sc) {
        view.setCurvatureScalars(sc.data);
        range = { min: sc.min, max: sc.max };
      }
    }
    view.setSurfaceDiagnostic(this.surfaceDiagnostic);
    return range;
  }

  private applyAll(): void {
    let lo = Infinity;
    let hi = -Infinity;
    let found = false;
    for (const view of this.models.all()) {
      const r = this.applyToView(view);
      if (r) {
        found = true;
        if (r.min < lo) lo = r.min;
        if (r.max > hi) hi = r.max;
      }
    }
    if (found) this.bus.emit('curvature-range', { min: lo, max: hi });
    this.bus.emit('surface-diagnostic-changed', { mode: this.surfaceDiagnostic });
  }
}
