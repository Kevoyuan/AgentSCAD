# AgentSCAD 视觉设计系统与规范标准 (DESIGN.md)

**设计代号**: Stitch Precision Engineering (精密仪器工程工作台)  
**当前版本**: 1.0.0  
**基准分辨率与平台**: Web Desktop IDE (1440×900 基准，支持 1024px~2560px 响应式自适应)  
**适用范围**: AgentSCAD 全局前端界面、CAD 3D 视口外壳、检查器面板、状态与微动效系统

---

## 1. 设计哲学与核心原则 (Design Philosophy & Pillars)

AgentSCAD 是一台严密的**数字机床与参数化 CAD 工程工作站**，并非消费级娱乐 AI 或营销落地页。界面的核心职责是以极高清晰度、绝对确定的视觉层级呈现几何事实、制造约束与参数关联，提供如同真实工程仪器般的物理触感与反馈闭环。

### 1.1 精密数字仪器感 (Precision Instrument Sensibility)
- **零光污染**：杜绝非功能性的霓虹发光、未校准的高饱和光斑与模糊渐变；每一个发光像素都必须具备明确的状态指示或警示职能。
- **机械装配级结构**：使用 1px 亚像素发丝分割线（Hairline Dividers）替代厚重阴影；模块之间犹如精密加工的铝合金与阳极氧化碳纤维构件般严丝合缝。

### 1.2 单一权威强调色 (Single Chromatic Authority)
- 放弃散乱的彩虹配色，收敛至单一高质感强调色 —— **Stitch Blueprint Indigo (`#5e6ad2`)**。
- 界面 92% 以上面积由严谨校准的黑曜石深色或建筑钛白中性色底基构成，高饱和色仅作为交互聚焦与系统状态警示。

### 1.3 极低认知负担与无阻反馈 (Cognitive Ergonomics & Closed Feedback Loops)
- **信息分级与渐进呈现 (Progressive Disclosure)**：最关键的三维模型与生成管线占据视觉重心，次级参数与制造遥测隐藏在 6 标签检查器中，杜绝界面信息过载。
- **触觉微反馈 (Tactile Micro-Feedback)**：滑块具备微米阻尼感，按钮具有 `active:scale-[0.98]` 微触感，状态推进符合目标梯度效应。

---

## 2. 色彩系统与色彩代码规范 (Color System Specification)

严禁在代码中直接混用无规则的十六进制色或未经校准的 Tailwind 色阶。所有颜色均基于语义化设计变量体系。

### 2.1 中性基底 (Calibrated Neutral Foundations)
严禁使用纯黑 `#000000` 作为背景。纯黑会导致 OLED/高端显示器上的高反差视觉疲劳并抹杀深度层级。

| 语义角色 | 深色模式 (Obsidian Graphite) | 浅色模式 (Architectural Titanium) | 职能描述 |
|---|---|---|---|
| **Canvas Background** | `#0b0d10` (RGB: 11, 13, 16) | `#f4f5f7` (RGB: 244, 245, 247) | 视口外部最底层工作台基底 |
| **Surface 1 (Panels)** | `#111418` (RGB: 17, 20, 24) | `#fbfbfc` (RGB: 251, 251, 252) | 侧边栏、检查器底板、顶部导航条 |
| **Surface 2 (Containers)**| `#171b20` (RGB: 23, 27, 32) | `#ffffff` (RGB: 255, 255, 255) | 任务卡片、表单输入框、代码容器 |
| **Surface 3 (Hover/Active)**| `#1e2229` (RGB: 30, 34, 41) | `#edf0f4` (RGB: 237, 240, 244) | 悬浮高亮态、选中条目衬底 |
| **Border Subtle** | `rgba(214, 224, 235, 0.08)` | `rgba(15, 23, 42, 0.08)` | 内部微弱分割线、输入框边框 |
| **Border Default** | `rgba(214, 224, 235, 0.12)` | `rgba(15, 23, 42, 0.14)` | 核心面板发丝边线 (1px) |
| **Border Strong** | `rgba(214, 224, 235, 0.22)` | `rgba(15, 23, 42, 0.22)` | 激活/聚焦外框、模态框边界 |

### 2.2 权威强调色 (Blueprint Indigo Accent)
- **权威色彩代码**: `#5e6ad2` (`hsl(236, 56%, 60%)`)
- **浅色模式悬停 (Hover Light)**: `#4e58b5` (`hsl(236, 56%, 48%)`)
- **深色模式悬停 (Hover Dark)**: `#7580e0` (`hsl(236, 56%, 68%)`)
- **微光衬底 (Accent Surface/Tint)**:
  - 深色模式: `rgba(94, 106, 210, 0.16)` (`var(--cad-accent-soft)`)
  - 浅色模式: `rgba(94, 106, 210, 0.10)`
- **聚焦光圈 (Focus Ring)**: `rgba(94, 106, 210, 0.28)`
- **废弃收敛**: 全面废弃原有分散的紫罗兰 (`#7c3aed`, `#8b5cf6`)。

### 2.3 状态语义色彩与双态 WCAG AA 对比度矩阵
浅色模式下严禁使用暗色专属的淡色文本（如 `text-lime-300`, `text-amber-300`）。所有前景色/背景色搭配在深浅双态下必须达到 WCAG AA（对比度 >= 4.5:1，大号文本/图标 >= 3:1）。

| 状态语义 | 业务状态对应 | 深色模式文本与对比度 | 浅色模式文本与对比度 | 对应背景与边框 |
|---|---|---|---|---|
| **SUCCESS** | `DELIVERED`, `VALIDATED`, Passed | `#34d399` (11.2:1) | `#065f46` (7.2:1) | `bg-emerald-500/15 dark:bg-emerald-500/20` `border-emerald-500/30` |
| **READY / DELIVER**| `DELIVERED` | `#a3e635` (12.4:1) | `#3f6212` (6.1:1) | `bg-lime-500/15 dark:bg-lime-500/20` `border-lime-500/30` |
| **WARNING** | `HUMAN_REVIEW`, Ambiguity | `#facc15` (12.1:1) | `#854d0e` (6.0:1) | `bg-yellow-500/15 dark:bg-yellow-500/20` `border-yellow-500/30` |
| **IN_PROGRESS** | `SCAD_GENERATED`, Inferred | `#fbbf24` (10.5:1) | `#92400e` (6.5:1) | `bg-amber-500/15 dark:bg-amber-500/20` `border-amber-500/30` |
| **DANGER / FAILED**| `VALIDATION_FAILED`, `GEOMETRY_FAILED`, `RENDER_FAILED` | `#f87171` (9.1:1) | `#991b1b` (6.5:1) | `bg-red-500/15 dark:bg-red-500/20` `border-red-500/30` |
| **INFO / RENDER** | `RENDERED`, Coordinates, Dimension | `#22d3ee` (10.8:1) | `#155e75` (6.8:1) | `bg-cyan-500/15 dark:bg-cyan-500/20` `border-cyan-500/30` |
| **REPAIRING** | `DEBUGGING`, `REPAIRING` | `#fb923c` (9.3:1) | `#9a3412` (6.3:1) | `bg-orange-500/15 dark:bg-orange-500/20` `border-orange-500/30` |
| **NEUTRAL** | `NEW`, `CANCELLED`, Idle | `#a1a1aa` (8.0:1) | `#4a4a58` (6.2:1) | `var(--app-state-neutral-bg)` `var(--app-state-neutral-border)` |

---

## 3. 排版体系与等宽数字纪律 (Typography & Monospace Discipline)

### 3.1 字体栈分配
- **界面文本 (UI Proportional Text)**:
  `var(--font-geist-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
  用于标签、说明文案、按钮文本、普通对话流。
- **等宽数据与代码 (Technical Data & Code)**:
  `var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
  **强制约束**：所有高密度参数数值、CAD 坐标、尺寸测量（mm/deg）、代码行号、时间戳与统计看板跳动数字，必须强制使用 `font-mono tabular-nums`。

### 3.2 严控字阶规范 (Typographic Scale)
| 层级 | 字号 / 行高 | 字重 | 样式规范 | 典型应用场景 |
|---|---|---|---|---|
| **Display Title** | 16px / 1.25 | SemiBold (600) | `tracking-tight` | 工作台顶栏标题、弹窗主标题 |
| **Section Header** | 14px / 1.3 | SemiBold (600) | `tracking-tight` | 检查器标签页主标题、面板区段名 |
| **Section Eyebrow**| 11px / 1.0 | Medium (500) | `font-mono uppercase tracking-[0.16em]` | 面板栏目眉标 (`.text-eyebrow`) |
| **Body Primary** | 13px / 1.5 | Regular (400) | 标准文本 | 任务描述、参数说明、常规内容 |
| **Body Secondary**| 12px / 1.4 | Regular (400) | 次级柔和文本 (`text-muted`) | 辅助提示、时间戳、状态说明 |
| **Data / Metric** | 12px-14px / 1.0 | Bold / Medium | `font-mono tabular-nums` | 滑动条数值、计数器、遥测数据 |
| **Micro Badge** | 9px-10px / 1.0 | Medium (500) | `font-mono uppercase tracking-wider` | 状态药丸、版本号、管线阶段徽章 |

---

## 4. 组件规范与微交互标准 (Component & Interaction Standards)

### 4.1 容器、圆角与边框 (Containers & Radii)
- **三栏主工作台面板**: `0px` 内外圆角，边界使用 `1px solid var(--app-border)` 发丝线分割。
- **卡片 / 弹出浮层 (Cards & Overlays)**: `rounded-[8px]` 或 `rounded-[6px]`，搭配 `1px solid var(--app-border)`。
- **输入框 / 按钮 / 标签页**: `rounded-[6px]`。
- **药丸徽章 (Badges / Chips)**: `rounded-[4px]`。
- **严禁过度圆润**: 严禁在工作区容器或卡片中使用 `rounded-2xl` 或 `rounded-3xl`（圆角过大会破坏严谨的工业仪器质感）。

### 4.2 阴影与微光效果 (Shadows & Micro-Glow)
- **静态容器**: 仅使用 1px 发丝边框，禁用扩散重阴影。
- **浮动模态框 / 菜单**:
  - 深色: `box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45), 0 0 0 1px var(--app-border-strong)`
  - 浅色: `box-shadow: 0 16px 36px rgba(15, 23, 42, 0.08), 0 0 0 1px var(--app-border-strong)`
- **严禁霓虹发散**: 彻底禁用 `box-shadow: 0 0 12px 4px ...` 这类漂浮光晕。

### 4.3 交互微动效标准 (Interaction Micro-Animations)
- **物理弹簧曲线**: 状态展开、标签切换均遵循精密工程曲线：`cubic-bezier(0.25, 0.46, 0.45, 0.94)`，持续时间在 150ms ~ 220ms 之间。
- **按钮微反馈**: 点击时微幅物理内收 `active:scale-[0.98]`。
- **减弱动效偏好**: 必须完整响应 `@media (prefers-reduced-motion: reduce)`，关闭非必要位移与循环扫光。

### 4.4 尺寸自适应骨架屏标准 (Skeleton Shimmer Standard)
- **彻底杜绝粗暴居中旋转菊花 (`Loader2 animate-spin`)**：加载态必须采用保留空间骨架的微光扫描组件。
- **微光扫描动画 (`.skeleton-shimmer`)**：
  - 采用半透明微光伪元素在表面进行 1.8s 的单向平滑水平扫描 (`animation: shimmer 1.8s infinite cubic-bezier(0.4, 0, 0.2, 1)`)。
  - 骨架屏组件 (`src/components/ui/skeleton.tsx`) 支持自适应尺寸、圆角定制并默认集成 Shimmer 质感。

---

## 5. 禁用反模式清单 (Banned Anti-Patterns Checklist)

所有涉及 AgentSCAD 界面开发的代码必须严格遵守以下反模式禁令。违反者无法通过代码审查与合规审计。

- [ ] **BAP-01 (严禁纯黑画布)**: 严禁将背景设为 `#000000`。深色基底必须使用严密调校的 Obsidian Graphite (`#0b0d10`)。
- [ ] **BAP-02 (严禁浅色模式对比度失效)**: 严禁在浅色模式直接使用暗色系浅色高亮类（如 `text-amber-300`, `text-lime-300`, `text-cyan-300`）。必须使用深浅自适应的双态类名（如 `text-amber-800 dark:text-amber-300`）确保对比度 >= 4.5:1。
- [ ] **BAP-03 (严禁未校准霓虹辉光)**: 严禁添加任何脱离实体几何的模糊光晕与霓虹辉光（如 `pulseGlow`、`filter="blur(3px)"`、`shadow-[0_0_12px_...]`）。
- [ ] **BAP-04 (严禁营销类文字渐变)**: 严禁在界面工作区、标题或正文中使用 `bg-clip-text text-transparent` 渐变文字。所有文字必须为高清晰度实体排版。
- [ ] **BAP-05 (严禁粗暴黑遮罩)**: 严禁使用硬编码 `bg-black/60` 或 `bg-black/10` 涂抹遮罩。必须使用磨砂玻璃语义变量 (`var(--cad-viewport-glass)`) 或语义化分层底色。
- [ ] **BAP-06 (严禁通用居中旋转菊花)**: 严禁使用毫无空间提示的通用居中转圈菊花图作为页面或面板加载态。加载状态必须使用尺寸自适应的骨架屏（Skeleton Shimmer）占位。
- [ ] **BAP-07 (严禁高密度数据非等宽数字)**: 严禁在参数数值、CAD 尺寸度量、代码行号与看板指标中缺少 `font-mono tabular-nums` 导致数字跳动与基线抖动。

---

## 6. 开发者落地指引与速查表 (Quick Reference)

### 6.1 常用语义类速查
- **主强调背景与文字**: `bg-[var(--app-accent)] text-white hover:bg-[var(--app-accent-hover)]`
- **强调次级色块**: `bg-[var(--cad-accent-soft)] text-[var(--cad-accent)]`
- **发丝边框**: `border border-[color:var(--app-border)]`
- **工整区块眉标**: `<span className="text-eyebrow text-[var(--app-text-muted)]">PARAMETER CONSTRAINTS</span>`
- **精密度量数值**: `<span className="font-mono tabular-nums text-xs">24.50 mm</span>`
- **骨架屏占位**: `<Skeleton className="h-8 w-full rounded-md" />`

---

*本文档由 AgentSCAD 架构与视觉工程委员会维护，任何样式变更需严格对齐本规范。*
