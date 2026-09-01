# 三维网格查看器 — 设计文档

> 版本 v1.3.0 · 2026-08-25 · 技术栈：Vite + TypeScript + three.js + three-mesh-bvh + Vitest
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
>
> **v1.1.5 修复**：视向轴动画重写为自绘补间 —— 官方实现的完成判定基于位置弧，
> 相机朝向补间可能中途终止，导致落位后另外两轴残留角度；现以单一进度参数
> 同步驱动位置与朝向，终点姿态强制三轴与世界坐标正交（lookAt + 世界 Y 上，
> ±Y 轴向自动换参考轴），固定时长缓动免疫帧率波动；旋转中心实时同步控制器
> target，弧球模式动画结束后调用官方 setCamera 重建内部缓存。
>
> **v1.1.6 修复与调整**：① 关闭弧球内置惯性动画（enableAnimations=false）——
> 其内部 rAF 循环导致拖拽释放后视角继续漂移，且与主循环/Gizmo 动画并发冲突；
> ② 球面模式开启 staticMoving（关闭释放惯性）—— 查看器场景不需要惯性；
> ③ 补全弧球缓存矩阵重同步点（frameBox / 切换模式 / 距离钳制触发）——
> 弧球手势基于内部缓存矩阵而非实时相机计算，任何绕过的外部相机修改
> （fitAll、聚焦、钳制等）都会造成失同步，表现为小幅拖拽引发整屏翻转；
> ④ 视向轴手柄命中区域 ×1.3。
>
> **v1.1.7 回退**：v1.1.5/v1.1.6 针对视向轴与控制器惯性的两轮修复引入了新的
> 回归（弧球拖拽后残余偏转、Gizmo 手柄点击失效），实测体验劣于修复前。
> 经评估将 `CameraRig / NavGizmo / main` 三个文件回退至 v1.1.4（34baacd）
> 状态 —— 该版本旋转行为稳定，已知残留问题为：Gizmo 点击切视角存在跳变、
> 弧球模式带释放惯性。后续如需解决，应在充分集成测试的前提下重新设计，
> 而非增量修补。许可协议（AGPL）、拾取修复、外观系统等成果均不受影响。
>
> **v1.1.8 修复与调整**：① 弧球控制器改为官方集成模式 —— 主循环对其零干预
> （变换在指针事件内即时生效），仅在加载/复位/聚焦与切换模式的瞬时重定位后
> 调用 setCamera 采纳新位姿；此前每帧 setCamera 内部的 lookAt 在接近上下轴向
> 时产生翻转基底，导致轻微拖拽即视角失控；② 默认光照提亮（环境 1.9 / 主 3.4 /
> 补 1.2），改善导入模型的初始观感；③ 头灯默认开启。
>
> **v1.1.9 新增**：**几何诊断可视化** —— 工具栏新增 [无|斑马纹|曲率] 分段控件：
> ① 斑马纹：视空间反射向量条纹着色，叠加于现有光照（onBeforeCompile 注入），
> 用于曲面连续性检查；② 曲率热力图：余切权拉普拉斯平均曲率 + 角亏高斯曲率
> （core/Curvature.ts 纯函数，O(F) 单遍，主曲率按需推导），标量写入顶点属性
> 由片元色带映射（jet 默认/蓝白红），分位截断归一化，开放边界顶点标记无效；
> 按模型缓存计算结果，InfoPanel 提供类型/色图选择与色带图例。
>
> **v1.3.0 新增**：**渲染图导出** —— 工具栏"导出图像"按钮弹出选项面板
> （分辨率 1×/2×/4× 超采样、透明背景 PNG），同步重绘单帧后经 toBlob 下载，
> 时间戳命名；实现要点：renderer 开启 alpha 通道、无需 preserveDrawingBuffer、
> 导出后恢复像素比/尺寸/背景并强制补绘一帧。视向轴 Gizmo 为独立覆盖层，不包含在导出图中。
>
> **v1.4.0 新增**：**舞台展示模式** —— 工具栏切换 分析/舞台；舞台用独立
> THREE.Scene（三点光、承接阴影/实色/隐藏地面、渐变背景、阴影相机随内容自适应），
> 模型经 pivot 组节点 reparent（变换只落 pivot/组节点，退出舞台挂回分析场景）；
> 场景单元树支持勾选成组/解组/双击重命名/整组显隐；自动排布 = PCA 摆正（简并跳过）
> + 统一缩放 + 网格阵列 + 贴地（layout.ts 纯函数，有单测）；环境双预设
> （影棚深色/论文浅色）各自记忆手调参数。
>
> **v1.4.1 工程化**：① BVH 构建与曲率计算移入 Worker（MeshBVH.serialize 传递、
> 曲率结果 Transferable 回传），大模型不再冻结界面；② main.ts 拆分为
> app/ 三个控制器（加载队列/诊断/交互），事件契约不变；③ 场景单元树改为直读
> MeshView 真源；④ 缺陷修复：详情统计首载缺失、组显隐图标漂移、hover 残留、
> 舞台点/线误选、阴影裁剪、变换输入跳变、busy 覆盖、多模型曲率图例冲突；
> ⑤ 交互增强：错误红色常驻、工具栏窄屏横滚、侧栏可折叠、加载队列可取消。
>
> **v1.2.0 调整**：斑马纹改为 MeshLab 式**纯镜面**形态 —— 专用无光照
> ShaderMaterial 输出方波黑白条纹（近黑 0.02 / 近白 0.95），基于 fwidth 的
> 分辨率自适应抗锯齿；密度滑杆（2~120）与不透明度滑杆继续有效；
> 此前的"叠加光照"注入式实现移除。

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
├── main.ts                  # App 装配：模块实例化、模式切换、模型/光照/导出事件接线
├── styles.css
├── app/                     # 装配层控制器（订阅总线事件，无 DOM 模板）
│   ├── LoadingQueue.ts      # 加载队列（可取消）+ Worker 解析 + BVH 索引后台构建
│   ├── DiagnosticsController.ts # 斑马纹/曲率状态、曲率 Worker 预取、多模型图例聚合
│   └── InteractionController.ts # 点击/hover 拾取、拖放导入、快捷键、复位与聚焦
├── core/                    # 与 three.js 无关的纯数据/算法层
│   ├── MeshData.ts          # 中立网格数据模型 + 组装 + 派生边
│   ├── Topology.ts          # 顶点→边邻接（CSR）
│   └── Curvature.ts         # 余切权平均/高斯曲率 + 主曲率推导 + 分位归一化
├── io/
│   ├── ParserRegistry.ts    # 扩展名 → 解析器（扩展点①）
│   ├── loadModelFile.ts     # File → Promise<MeshData>（Worker 封装）
│   ├── computeCurvatureAsync.ts # 曲率 Worker 封装（Transferable 回传）
│   ├── growable.ts          # 可增长 TypedArray 构建器
│   ├── parsers/
│   │   ├── obj.ts           # v/f/l；多边形面；负索引；显式边
│   │   └── ply.ts           # ascii + binary LE/BE；vertex/face/edge 元素
│   └── workers/
│       ├── parseWorker.ts
│       └── curvatureWorker.ts
├── render/
│   ├── SceneManager.ts      # 场景/相机/可调灯光(含头灯)/地面网格/resize/渲染循环/导出
│   ├── CameraRig.ts         # 三控制器：轨道/球面/弧球 切换 + frameBox/fitAll
│   ├── ModelRegistry.ts     # 多模型容器：add/remove/unionBox（遮挡=同场景深度缓冲）
│   ├── MeshView.ts          # 单个模型的点/边/面图层 + 外观（透明度/成分颜色/诊断材质）
│   ├── VertexGrid.ts        # 均匀空间哈希网格（CSR）+ 射线 DDA 遍历
│   ├── PickingEngine.ts     # 跨模型统一拾取入口 → PickHit{modelId,...}
│   ├── NavGizmo.ts          # 视口右上角视向轴 Gizmo（ViewHelper 独立覆盖层）
│   ├── HighlightLayer.ts    # hover/选中 高亮覆盖层（选中/悬停各一实例）
│   ├── buildBVHAsync.ts     # BVH Worker 封装（MeshBVH.serialize/deserialize 传递）
│   └── bvhWorker.ts
├── stage/                   # 舞台展示模式（独立 THREE.Scene，与分析模式共享 renderer/相机）
│   ├── StageController.ts   # TransformControls 编排、分组节点、pivot 挂载、排布应用
│   ├── StageModel.ts        # 分组数据模型（纯 TS，可单测）
│   ├── StageScene.ts        # 舞台场景：三点光/地面(承接阴影|实色|隐藏)/渐变背景/阴影相机
│   └── layout.ts            # 自动排布纯函数：PCA 摆正 + 统一缩放 + 网格阵列 + 贴地
└── ui/
    ├── EventBus.ts          # 类型化事件总线（扩展点③）
    ├── dom.ts               # escapeHtml 等 DOM 小工具
    ├── Toolbar.ts           # 模式切换 / 打开 / 控制器 / 着色 / 诊断 / 复位
    ├── StagePanel.ts        # 场景单元树（两种模式共用的模型列表）+ 变换 + 舞台环境
    ├── EnvironmentPanel.ts  # 光照：环境光/主光/补光强度、背景色
    ├── SelectionPanel.ts    # 选中元素详情（含所属模型）
    ├── ExportDialog.ts      # 导出 PNG 选项弹层
    └── StatusBar.ts         # hover 提示 + 进度 + 忙碌态(计数) + 队列取消 + 错误常驻
```

依赖方向：`app/ui → render/stage/core/io`，`io/render/stage → core`，`core` 不依赖任何其他层。

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
| 球面 Trackball | 拖拽向量→屏幕轴四元数，转速 ×1.5 | 无极点、实现简单 | 无抓取参照，易过冲 |
| 弧球 Arcball (默认) | Shoemake 弧球投影 | 抓取跟随感强、无死锁、关闭惯性后拖拽即停 | 失去上方向 |

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

深色简洁主题。顶部工具栏依次是：模式切换（分析/舞台）、打开、相机控制器
（轨道/球面/弧球）、平直/平滑、诊断（无/斑马纹/曲率）、头灯、视向轴、
网格地面、复位视图、导出图像；窄窗口时工具栏横向滚动。右侧栏为**场景单元树**
（StagePanel，两种模式共用的唯一模型列表，对齐 Blender outliner 惯例），
其下方分析模式显示 环境/诊断/选中 区块（`.analysis-only`），舞台模式显示
变换与舞台环境区块（`.stage-only`）；视口右缘把手可整体折叠侧栏。

```
┌──────────────────────────────────────────────────────┐
│ Mesh Viewer │分析|舞台│ [打开…] │轨道|球面|弧球│ … │ [导出图像] │
├──────────────────────────────────┬──────────┬───────┤
│                                  │          │ 场景单元 │
│       视口（拖放导入，drop 高亮）  │  [⇥]    │ ▾ 分组 1 │
│                                  │  侧栏把手 │   ▸ a.obj│
│                                  │          │ ▸ b.ply  │
│                                  │          │  环境/…  │
├──────────────────────────────────┴──────────┴───────┤
│ b.ply · 顶点 #1027 · (x,y,z)      队列 n ✕ [████] 忙碌 │
└──────────────────────────────────────────────────────┘
```

- 模型行：详情箭头 + 成组勾选框 + 文件名 + 眼睛显隐 + ●点/●边/●面 图层开关 + 移除 ✕；
  行下常驻三成分取色；展开详情显示统计（含边来源徽标）、不透明度滑杆、拾取开关。
- 分组：勾选 ≥2 个模型后「成组」；组行支持折叠、整组显隐、双击重命名、解散。
- 面板渲染时直接读取 MeshView 真源（名称/统计/显隐/图层/颜色/不透明度/拾取），
  事件只回写 DOM，不做状态镜像。
- 状态栏：hover 索引实时显示；加载进度条；忙碌标签按引用计数叠加；
  多文件排队时显示"队列 n"并可一键取消；解析错误红色常驻至下次加载。
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
