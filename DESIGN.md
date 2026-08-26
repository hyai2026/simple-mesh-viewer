# 三维网格查看器 — 设计文档

> 版本 v1.1.4 · 2026-08-25 · 技术栈：Vite + TypeScript + three.js + three-mesh-bvh + Vitest
>
> **v1.1 变更**：① 多模型同屏（遮挡关系）+ 模型列表面板，逐模型控制成分显隐 /
> 不透明度 / 成分着色，移除顶部栏的单模型开关；② 场景光照可调（环境/主光/补光/背景色），
> 并整体提亮默认光照。
>
> **v1.1.1 修复**：① 补上 `set-lighting` 事件接线（此前环境光/背景调节无效）；
> ② 重构拾取优先级 —— 全局顶点搜索 + 遮挡过滤，点图层开启时顶点绝对优先，
> 面命中时角点吸附与全局可见顶点按屏幕距离竞争，紧阈值边覆盖，详见 §7。
>
> **v1.1.2 修复与增强**：① 面拾取错位修复 —— three-mesh-bvh 默认会重排几何体
> index 缓冲，导致 `triToFace` 映射失效；改用 `indirect: true` 模式保持索引原序；
> ② 新增逐模型"拾取"开关，关闭后该模型不参与 hover/点击（遮挡测试不受影响）。
>
> **v1.1.3 新增**：① **双视角控制器** —— Trackball（球面，默认，无极点死锁）与
> Orbit（轨道，缩放到光标）随时切换（工具栏 / C 键），切换保持视角不跳变；
> 距离钳制放宽为允许穿入模型内部观察；② **头灯** —— 相机挂载补光灯，视线方向
> 恒定照明，工具栏开关；③ **视向轴 Gizmo** —— 视口右上角官方 ViewHelper，
> 点击 XYZ 手柄平滑切换六向视角，可显隐。
>
> **v1.1.4 变更**：① 控制器扩展为**三模式** —— 新增 Arcball（弧球），
> C 键循环 轨道→球面→弧球；② 球面模式转速 ×1.5；③ 许可协议采用
> **AGPL-3.0-or-later**（LICENSE / THIRD-PARTY-NOTICES / package.json SPDX）；
> ④ 修复视向轴 Gizmo 点击动画无效（事件冒泡干扰控制器 + 动画期冻结 rig.update）。

## 1. 目标与需求映射

| 需求 | 实现方案 |
|---|---|
| 多格式导入 | 解析器注册表（v1: OBJ / PLY，ascii + binary LE/BE），拖放或按钮载入 |
| 三角/四边网格渲染，点/边/面任意组合 | 三个独立渲染图层；**多模型下由模型列表逐模型控制** |
| 多模型同屏、遮挡关系、逐模型管理 | ModelRegistry 统一管理场景中的 MeshView；深度缓冲天然产生遮挡 |
| 自由检视、无死锁 | OrbitControls 阻尼轨道 + 右键平移 + 缩放到光标；F/Home/G 快捷键 |
| **点击拾取并显示源文件索引** | 自写解析器忠实保留源索引；BVH 面拾取反查 `triToFace`；顶点/边经空间哈希网格加速 |
| 大规模性能（数十万顶点起步） | Worker 解析 + CSR 紧凑结构 + 单 draw call 图层 + BVH/空间网格加速拾取 |
| 场景偏暗、光照与着色可调 | 环境面板：环境光/主光/补光强度滑杆 + 背景色；逐模型三成分颜色 |
| 模块化、可扩展 | core/io/render/ui 四层 + 三个注册扩展点（解析器/图层/事件总线） |

## 2. 架构与目录

```
src/
├── main.ts                  # App 装配：模块实例化、事件接线、交互循环
├── styles.css
├── core/                    # 与 three.js 无关的纯数据/算法层
│   ├── MeshData.ts          # 中立网格数据模型 + 组装 + 派生边
│   ├── Topology.ts          # 顶点→边邻接（CSR）
│   └── SelectionStore.ts    # 选中状态 {modelId, kind, index}
├── io/
│   ├── ParserRegistry.ts    # 扩展名 → 解析器（扩展点①）
│   ├── loadModelFile.ts     # File → Promise<MeshData>（Worker 封装）
│   ├── growable.ts          # 可增长 TypedArray 构建器
│   ├── parsers/
│   │   ├── obj.ts           # v/f/l；多边形面；负索引；显式边
│   │   └── ply.ts           # ascii + binary LE/BE；vertex/face/edge 元素
│   └── workers/parseWorker.ts
├── render/
│   ├── SceneManager.ts      # 场景/相机/可调灯光(含头灯)/地面网格/resize/渲染循环
│   ├── CameraRig.ts         # 双控制器：Trackball(默认) / Orbit 切换 + frameBox/fitAll
│   ├── ModelRegistry.ts     # 多模型容器：add/remove/unionBox（遮挡=同场景深度缓冲）
│   ├── MeshView.ts          # 单个模型的点/边/面图层 + 外观（透明度/成分颜色）
│   ├── VertexGrid.ts        # 均匀空间哈希网格（CSR）+ 射线 DDA 遍历
│   ├── PickingEngine.ts     # 跨模型统一拾取入口 → PickHit{modelId,...}
│   ├── NavGizmo.ts          # 视口右上角视向轴 Gizmo（ViewHelper 独立覆盖层）
│   └── HighlightLayer.ts    # hover/选中 高亮覆盖层（选中/悬停各一实例）
└── ui/
    ├── EventBus.ts          # 类型化事件总线（扩展点③）
    ├── Toolbar.ts           # 打开 / 全局着色 / 地面网格 / 复位视图
    ├── ModelList.ts         # 模型列表：逐模型 V/E/F 开关、α 滑杆、展开详情与配色
    ├── EnvironmentPanel.ts  # 光照：环境光/主光/补光强度、背景色
    ├── SelectionPanel.ts    # 选中元素详情（含所属模型）
    └── StatusBar.ts         # hover 提示 + 进度 + 忙碌态
```

依赖方向：`ui → render/core/io`，`io/render → core`，`core` 不依赖任何其他层。

## 3. 核心数据模型

**不使用** `THREE.OBJLoader/PLYLoader`：官方 Loader 会重排顶点、立即三角化四边形，
无法满足"显示源文件中的索引"。自写解析器产出中立数据：

```ts
interface RawParsedMesh {                 // 解析器原始输出
  format: string;
  positionCount: number;                  // 顶点索引 == 源文件出现顺序
  positions: Float32Array;
  faceOffsets: Uint32Array | null;        // CSR 行首，len = F+1
  faceIndices: Uint32Array | null;        // 所有面的角点平铺（支持任意多边形）
  explicitEdges: Uint32Array | null;      // OBJ 的 l 行 / PLY 的 edge 元素，按源顺序
}

interface MeshData {                      // assembleMeshData() 组装产物
  fileName: string; format: string;
  positionCount: number; positions: Float32Array;
  faceCount: number;
  faceOffsets: Uint32Array | null; faceIndices: Uint32Array | null;
  triangleCount: number;
  renderIndex: Uint32Array | null;        // 扇形三角化后的渲染索引
  triToFace: Uint32Array | null;          // 渲染三角形下标 → 源面索引
  edgeCount: number;
  edges: Uint32Array | null;              // [v0,v1,...] 对
  edgeSource: 'explicit' | 'derived' | null;
}
```

要点：
- 面/边全部用扁平 TypedArray（CSR），百万级元素无对象开销；
- 四边形面渲染时扇形三角化，`triToFace` 保证拾取还原为**源面索引**；
- 全部数据在 Worker 内组装完成后以 Transferable 零拷贝回传主线程。

## 4. 格式解析

### OBJ（文本）
- 仅处理 `v` / `f` / `l`；忽略 vn/vt/g/o/s/usemtl 等；
- `f a/b/c ...` 支持任意多边形与 `v//n`、`v/vt/n` 变体；
- 支持**负索引**（相对索引，OBJ 规范）；
- `l` 行按折线语义展开为连续顶点对（显式边）；
- 索引非法即抛错（带行号），快速失败。

### PLY（ascii + binary_little/big_endian）
- 头部解析 element/property/list 声明（含 char..double 别名表）；
- ascii 用流式游标逐 token 消费（避免整文件 split 产生巨量字符串）；
- binary 用 DataView 按类型尺寸直读，未知属性按 schema 跳过；
- vertex 取 x/y/z（其余属性跳过）；face 取第一个 list 属性；
- edge 元素端点属性名兼容 `v1/v2`、`vertex1/vertex2`，兜底取前两个标量；
- 头部探测采用倍增窗口解码，二进制大文件不解码正文。

### Worker 流水线
```
File.arrayBuffer()
  └─ parseWorker: detectFormat → parser(buffer, 进度回调) → assembleMeshData
       ├─ 扇形三角化 renderIndex + triToFace
       └─ 边：explicit ?? deriveEdgesFromFaces()
            （有向边对打包成键排序去重，无哈希/GC 压力）
  └─ postMessage(mesh, [所有 buffer])   主线程零重活
```

## 5. 渲染图层、外观与多模型

### 图层

| 图层 | 实现 | 新载入默认可见 |
|---|---|---|
| 面 Surface | indexed BufferGeometry + `MeshStandardMaterial`(DoubleSide, polygonOffset) | 有面时 |
| 边 Edges | LineSegments（共享位置属性 + edges 作索引） | 纯线框文件 |
| 点 Points | ShaderMaterial 圆形点精灵，固定像素大小 | 纯点云文件 |

- 三图层各一次 draw call，共享同一 position attribute。
- **边来源优先级**：文件显式存储 → 直接使用（可显示源边索引）；
  否则由面派生：遍历面收集无向边去重 —— 四边形只产生 4 条边，**绝无对角线**。
- 平直着色用材质 `flatShading`（GLSL 导数）；切平滑时才惰性计算顶点法线（全局选项）。

### 逐模型外观（v1.1）
- **不透明度 α ∈ (0,1]**：同时作用于该模型的面材质（transparent 动态开关）、
  边材质与点精灵 shader 的 `uAlpha`；默认 1。α<1 时三个图层**关闭深度写入**
  （depthWrite=false），由渲染器的透明排序（由远及近）处理遮挡 —— 后方模型可以透出；
  恢复 100% 时回到完全不透明并重新写深度，保证常规遮挡精度。
- **成分颜色**：面 / 边 / 点各自独立取色（color input），存于 MeshView，
  材质/uniform 即时更新。

### 多模型管理（v1.1）
- `ModelRegistry` 持有全部 MeshView 并挂接到同一 Scene 根节点 ——
  所有模型共用同一深度缓冲，**遮挡关系由渲染器自然保证**；
- 每个 MeshView 分配稳定 `id`，PickHit / Selection 均携带 `{modelId, kind, index}`；
- `unionBox()` 汇总所有模型包围盒用于全景适配；加载新模型后自动重新 fit；
- 移除模型时同步释放几何体/材质/BVH，并清理拾取缓存与引用该模型的高亮/选中。

## 6. 相机与检视（v1.1.4 三控制器）

- **三控制器**，工具栏分段控件或 `C` 键循环切换（轨道→球面→弧球），
  切换时同步 target/相机位置（视角无跳变）：

| 模式 | 旋转模型 | 特点 | 局限 |
|---|---|---|---|
| 轨道 Orbit | 球面坐标绕固定上轴 | 缩放到光标、水平方向感 | 极点旋转退化 |
| 球面 Trackball（默认） | 拖拽向量→屏幕轴四元数，转速 ×1.5 | 无极点、实现简单 | 无抓取参照，易过冲 |
| 弧球 Arcball (v1.1.4) | Shoemake 弧球投影 | 抓取跟随感强、无死锁 | 失去上方向 |

- **距离钳制**：`CameraRig.update()` 每帧统一执行 —— 下限取近裁剪面量级
  （**允许穿入模型内部**观察内壁），上限防飞出；三种模式行为一致
  （弧球另有原生 minDistance/maxDistance 同步设置）。
- 加载后自动 fit：按全体模型包围球计算距离，同步设置 near/far。
- **视向轴 Gizmo**：视口右上角独立覆盖层 + 迷你渲染器 + 官方 `ViewHelper`
  （轴线 + XYZ 字母手柄）；点击平滑动画切换六向标准视角（绕目标旋转、距离不变）；
  工具栏"视向轴"chip 控制显隐；Gizmo 上的指针事件 stopPropagation 隔离，
  动画期间冻结控制器更新，避免相机所有权冲突（v1.1.4 修复）。
- 快捷键：`F` 聚焦选中元素（无选中则全景）、`Home` 全景、`G` 地面网格、
  `C` 循环切换 轨道→球面→弧球 控制器、`Esc` 取消选中。

### 场景光照组成

| 灯光 | 类型 | 方向 | 默认强度 | 可调 |
|---|---|---|---|---|
| 环境光 | HemisphereLight | 无（天空 #d6e0f0 / 地 #3a3f46） | 1.5 | 环境面板 0~3 |
| 主光 | DirectionalLight | 世界固定 (5,8,4) | 2.8 | 环境面板 0~6 |
| 补光 | DirectionalLight | 世界固定 (-5,-2,-6) | 0.9 | 环境面板 0~3 |
| 头灯 (v1.1.3) | DirectionalLight 挂载于相机 | 恒为视线方向 | 0（关） | 工具栏开关，开 = 2.5 |

## 7. 拾取系统（核心）

统一入口 `PickingEngine.pick(px, py, radiusPx): PickHit | null`，
跨所有**可拾取**（pickable，逐模型开关）的可见模型分派候选，
按以下**优先级裁决**（v1.1.1）：

1. **全局顶点候选**：每模型空间哈希网格沿射线 DDA 收集顶点 → 屏幕半径内按距离排序
   → 对最近若干个做**遮挡测试**（BVH 射线到顶点，容差 0.1% 距离），取首个未被遮挡者。
   遮挡测试遍历所有可见表面 —— 不可拾取但可见的模型仍会挡住视线。
2. **点图层开启 ⇒ 顶点绝对优先**：任一模型开启点图层时，可见顶点直接命中 ——
   "显示点即表示要与点交互"（无需再切到纯点模式）。
3. **面命中流程**：各模型 BVH raycast 取全局最近面 → `triToFace` 还原源面索引；
   角点吸附（光标 radius 内的该面角点升级为顶点命中）；吸附结果与全局可见顶点
   按**屏幕距离**竞争取近者；无吸附且有可见顶点时也返回顶点；
   否则若边图层开启，先做**紧阈值边覆盖**（约 2.5px / 半径×0.45），
   刻意贴近边点击选中边，其余情况返回面。
4. **无边面命中**：可见顶点优先；否则全半径边搜索（线框/剪影场景）。

配套：
- hover 浅色预览 + 状态栏实时索引（含模型名）；单击锁定选中（橙色高亮）+ 详情面板；
- 点击空白清除选中；高亮通过独立覆盖层（depthTest 关闭，透视显示）绘制，不改原几何体；
- hover 拾取每帧最多一次、相机交互中跳过、结果变化才发事件；
- 遮挡测试每次 hover 上限 6 次 BVH 查询，保证大网格流畅；
- 空间网格/邻接等加速结构按模型惰性构建并缓存，模型移除即释放。

## 8. 性能设计（目标：50 万顶点 / 100 万四边形流畅）

| 环节 | 策略 |
|---|---|
| 解析 | Web Worker 全程离主线；TypedArray 直读；进度回调 |
| 数据结构 | CSR 面 + 扁平边；派生边键排序去重 O(E log E) |
| 渲染 | 每模型三图层各一次 draw call；flatShading 导数实现省一半显存 |
| 面拾取 | three-mesh-bvh（MIT），百万三角形毫秒级；多模型取全局最近 |
| 顶点/边拾取 | 按模型惰性构建空间哈希网格（构建 O(N)，查询近似 O(1)）+ 邻接 CSR |
| 交互节流 | hover 每帧一次、交互中跳过、hover 结果变化才发事件 |
| 内存预算 | 约 150~250MB/百万四边形（含 BVH）；Transferable 零拷贝回传 |

已知取舍（v1.1.2）：半透明采用"关闭深度写入 + 物体级由远及近排序"方案，
模型之间透出关系正确；同一网格内部不做三角形级排序，极端视角下可能看到
内部面的混合次序瑕疵（OIT 列入路线图）。边拾取偏向线段端点附近的候选顶点；
被表面遮挡的顶点/边在射线未命中面时也可能命中 —— 与主流建模软件行为一致。

## 9. UI 设计

深色简洁主题。单模型开关从顶部工具栏移除，改为右侧**模型列表逐行控制**
（对齐多对象工作流的用户习惯：Blender outliner / DCC 场景大纲模式）：

```
┌──────────────────────────────────────────────────────┐
│ Mesh Viewer │ [打开…] │ 平直|平滑 │ ▣网格地面 │ [复位视图] │
├──────────────────────────────────────┬───────────────┤
│                                      │ 模型           │
│       视口（拖放导入，drop 高亮）       │ ▸ a.obj  ✕     │
│                                      │   ●点 ●边 ●面  α──○ 100% │
│                                      │ ▾ b.ply  ✕     │
│                                      │   … 展开详情    │
│                                      │   V/F/T/E 计数  │
│                                      │   面/边/点 取色 │
│                                      │ 环境           │
│                                      │  环境光 ──○──  │
│                                      │  主光源 ──○──  │
│                                      │  补光   ──○──  │
│                                      │  背景  [■]     │
│                                      │ 选中           │
│                                      │  类型/索引/详情 │
├──────────────────────────────────────┴───────────────┤
│ b.ply · 顶点 #1027 · (x,y,z)           [████进度] 忙碌 │
└──────────────────────────────────────────────────────┘
```

- 模型行：折叠箭头 + 文件名 + 移除 ✕；第二行为 V/E/F 三个小开关 + α 滑杆（实时生效）；
  展开后显示统计与三成分取色。
- 选中详情标注所属模型（如 `b.ply · Face #213（四边形）[12, 48, 49, 13]`）。
- 光照参数持久于会话内（App 状态），新载入模型不受影响。

## 10. 扩展性设计（三个注册点）

1. **解析器注册表**：新格式实现 `(buffer, onProgress) => RawParsedMesh` 一行注册（STL/OFF）。
2. **图层接口**：MeshView 内图层皆"从 MeshData 构建 Object3D"，法线可视化、特征边、
   剖面等新图层即插即用。
3. **类型化事件总线**：UI 只发意图事件（`set-model-layers` / `set-lighting` /
   `remove-model` 等），App 应用后广播状态事件；后续"按条件显示"
   （如只显示 z>0 的面）可作为过滤器订阅模型事件实现。

路线图：STL/OFF、模型重命名/显隐批量操作、测量工具、网格平滑/简化、选择集导出、
GPU 拾取（ID 缓冲）、超大网格 LOD/流式、透明排序（OIT）。

## 11. 测试策略

- Vitest（node 环境）：
  - OBJ：四边形面、负索引、`l` 显式边、纯线框、faces+l 并存时显式边优先、非法索引抛错；
  - PLY：ascii 与 binary LE/BE 同内容解析结果一致；额外属性跳过；edge 元素；
  - 派生边：共享边去重、四边形无对角线、退化环剔除；
  - 大规模冒烟：300×300 四边形网格计数与 triToFace 映射、6 万面二进制 PLY。
- 手动验证：samples/ 目录样例走查多模型加载/移除、逐模型显隐与 α、光照调节、拾取。
- 门禁：`npm run typecheck && npm test && npm run build`。

## 12. 关键决策记录

| 决策 | 理由 |
|---|---|
| 自写解析器而非官方 Loader | 保真源文件拓扑与索引（核心需求） |
| 引入 three-mesh-bvh | 大规模面拾取事实标准，自研风险高 |
| 顶点/边自研空间哈希而非 GPU ID 拾取 | 实现简单稳定，规模足够；GPU 方案列入路线图 |
| 显式边存在时优先显示显式边 | 忠实于源文件；派生线框覆盖无边情形 |
| BVH 使用 indirect 模式 | 默认模式会重排 index 缓冲、破坏 triToFace 契约；indirect 保序，代价 ~10-20% 射线耗时（毫秒级无感） |
| 拾取与可见性解耦为独立开关 | "看得见但不可选"是多模型工作流刚需（背景参考模型） |
| 原生 DOM UI 而非框架 | 界面简单，减少依赖，保持核心可移植 |
| 多模型经 ModelRegistry 同场景挂载 | 深度缓冲天然给出正确遮挡，零额外算法成本 |
| 显隐控制放模型列表而非顶部栏 | 多对象工作流惯例（outliner 模式），顶部栏只留全局项 |
| α 作用于整模型、颜色按成分 | 满足"半隐"需求的最小心智负担；按成分透明度列入路线图 |
