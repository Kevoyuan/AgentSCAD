# 主轴横销与导向锁止候选：七种制造零件、九个实例

原创候选 `slider_crank_shaft_keyed.scad` 保留前导向件，并把主轴延长，在机架后侧增加横向孔和第二根横销。两根横销几何相同：装配声明引用同一个 `eccentric_key` 零件 ID，实例分别为 `eccentric_key` 与 `main_key`。制造包只有一个横销 STL、数量 2。

本轮新增两根相同的导向锁 `guide_lock`，分别穿过前导向件左右侧板与机架外侧通道壁，把导向件的 +Z 退出锁住。制造包因此是七种零件、九个实例，`eccentric_key` 与 `guide_lock` 各为数量 2。

## 已取得的证据

### 横销四分之一转防脱

- 横销在偏心销/主轴内的孔中有一段环形槽（半径 1.05 mm、轴向 1.0–1.5 mm），槽的 +X 侧有一条 0.6 × 1.8 mm 的入口槽。销上的锁舌是 1.7 × 0.5 × 0.4 mm，装配位姿下锁舌在槽内、长轴沿 Y。
- 直拔 +X：第 1 个 0.25 mm 采样位姿就与曲柄相交（`blockedAt.poseIndex = 1, obstacleId = crank`）。两根横销分别单独直拔都失败：主轴横销先拆时失败，偏心横销单独直拔也在同一位姿失败。
- 正确路径：绕自身 X 轴转 −90°（5° 步长、19 个位姿），锁舌长轴转到 Z，正好通过入口槽；再沿 +X 退出 30 mm（0.25 mm 步长、120 个位姿）。两根横销都通过。
- 横销锁舌只在采样位姿上被证明挡得住；手力、磨损、锁舌强度、转动过程中的重力与自锁都没有验证。

### 前导向件 +Z 锁止

- 导向件左右侧板各有一个 r=0.7 mm 的通孔（x = ±9.1, z = 40）。机架外侧通道壁在对应位置有一条 1.4 × 2.8 mm 的通槽，槽贯穿 1.2 mm 壁厚。
- 锁销轴 r=0.5 mm，锁舌 2.4 × 0.3 × 0.5 mm。锁定位下锁舌长轴沿 X，卡在壁的内侧；锁舌与侧板、壁各留 0.05 mm 间隙，销轴与侧板孔留 0.2 mm。
- 直拔 +Y：第 1 个 0.25 mm 采样位姿锁舌端部与机架相交（`obstacleId = frame`）。必须先绕自身 Y 轴转 90°（锁舌长轴转到 Z，5° 步长、19 个位姿），锁舌才能通过 1.4 × 2.8 mm 的槽，再沿 +Y 退出 5 mm（0.25 mm 步长、20 个位姿）。
- 两根锁销都在位时，导向件沿 +Z 移动：第 1 个 0.25 mm 采样位姿侧板孔就与右锁销轴相交（`obstacleId = guide_lock_right`）。两根锁销都取出后，导向件 +Z 40 mm（161 个采样位姿）畅通。
- 锁销的锁舌只在槽两侧各约 0.4–0.5 mm 的宽度上压住壁的内表面；壁厚 1.2 mm，槽靠通道内侧只留 0.4 mm 边距、靠外侧留 1.6 mm。壁的局部强度、锁舌根部应力集中、锁舌磨损、手感和工具可达性都没有验证。

### 完整声明拆卸

正确顺序：右导向锁 → 左导向锁 → 前导向件 → 主轴横销 → 偏心横销 → 滑块 → 连杆 → 曲柄。八次操作共 792 个采样位姿；直接调用检查器 2.6–3.2 s（不同运行），预算 5000 ms。

真实导出运行（`bun scripts/eval/check-declared-export.ts`，原生 OpenSCAD，无模型调用）目录 `.agentscad/experiments/declared-export-pb8SaQ/`：

| 运行 | `evidence.disassembly` | `declaredDisassembly.status` | `measuredStatus` | 实际失败点 |
|---|---|---|---|---|
| 已确认合同 | PASS | PASS | PASS | — |
| 未确认合同 | NOT_RUN | NOT_RUN | **PASS** | — |
| 先拆导向件（锁销仍在） | FAIL | FAIL | FAIL | 第 1 位姿，`guide_lock_right` |
| 右锁销直拔（不转） | FAIL | FAIL | FAIL | 第 1 位姿，`frame` |

ZIP 清单：七种零件（`eccentric_key:2`、`guide_lock:2`），九个实例；README 写出 `- disassembly: PASS` 或对应的 `NOT_RUN` / `FAIL`。ZIP SHA256 `07ce75fbee2233980b50e7bca285f71a584f39fb58c984e873164a86e78fbcd4`。

### 主轴孔配合测量

`main_shaft` 连接现在声明 `boreInstanceId: "frame"`，孔/轴角色由声明给出，不再由调用方猜。`bun scripts/eval/measure-fit.ts benchmarks/assembly/slider_crank_shaft_keyed.scad --connection main_shaft --bore-instance frame --stations -9.5,-8.5,-7.5`：

| 项目 | 实测 |
|---|---|
| 机架孔直径 | 4.394701 – 4.400000 mm（64 边形，三个截面） |
| 曲柄轴直径 | 3.995182 – 4.000000 mm |
| 直径间隙 | **0.394701 – 0.404817 mm** |
| 轴线偏移 / 夹角 | 0.000 mm / 0.000° |

这是对机架主轴孔的独立测量，不再只靠碰撞间接约束。它仍然只覆盖三个轴向截面；孔/轴角色是声明的，不是网格判定的；不含打印公差。

### ZIP 重建与运动

`bun scripts/eval/check-keyed-export.ts benchmarks/assembly/slider_crank_shaft_keyed.scad`（目录 `.agentscad/experiments/keyed-export-zVW4TK/`）：

- 七个零件 STL 加九个实例位姿逐三角面重建：9/9 PASS，最大顶点差 1.98e-6 mm。
- 把连杆位姿 z 偏移 1 mm 的负例：FAIL（包围盒差 1 mm）。
- 用 ZIP 内的局部 STL（不是内存网格）重跑声明拆卸：PASS。
- ZIP SHA256 `b75b55f38318a09cf1393068c1e8136a89a2f2cfbee6936a34a0ee29db5c6a29`。

`bun scripts/eval/measure-slider-crank.ts ...`（目录 `.agentscad/experiments/slider-crank-o4zHCT/`）：九姿态、每姿态 10 个零件（四角色 + 六附件，含两根导向锁）45 对碰撞全 PASS；曲柄半径 7.9999995 mm（残差 2.3e-8 mm）、连杆长 27.9999992–27.9999996 mm、销轴漂移 0 mm。锁销是静止附件，不参与运动。

## 复现

```sh
bun scripts/eval/build-keyed-declaration.py benchmarks/assembly/slider_crank_shaft_keyed.scad
bun scripts/eval/check-declared-export.ts
bun scripts/eval/check-keyed-export.ts benchmarks/assembly/slider_crank_shaft_keyed.scad
bun scripts/eval/measure-slider-crank.ts benchmarks/assembly/slider_crank_shaft_keyed.scad scripts/eval/assembly-fixtures/slider-crank-shaft-keyed-geometry.json
bun test src/lib/tools/__tests__/slider-crank.openscad.test.ts
```

`build-keyed-declaration.py` 同时写出四个负例：

- `slider-crank-keyed-straight-withdrawal.json`：两根横销都直拔；
- `slider-crank-keyed-eccentric-straight.json`：只让偏心横销直拔；
- `slider-crank-keyed-guide-first.json`：先拆导向件、锁销仍在；
- `slider-crank-keyed-lock-straight-pull.json`：右锁销不转就直拔。

当前源码 SHA256 `9e3f74e79cadcc2fad9357061918f176504dbb65453cc6a63c316466198575e9`。源码包含内嵌声明，重新生成声明会改变这个哈希；它不是冻结版本。

## 尚未完成

- 只有几何阻挡，没有力。锁舌/锁销的强度、手力、磨损、振动、自锁、预紧、公差与 FDM 收缩都未验证；0.05 mm 与 0.2 mm 间隙是网格值。
- 仍是离散采样：5° / 0.25 mm 步长只覆盖已测位姿，不证明帧间无干涉；锁舌转动的连续扫掠体积没有单独证明。
- 锁销的锁舌只在槽两侧各约 0.4–0.5 mm 的宽度上压住壁的内表面；壁厚 1.2 mm，槽靠通道内侧只留 0.4 mm 边距、靠外侧留 1.6 mm。壁的局部强度、锁舌根部应力集中未验证。两根锁销是同一零件，但安装/取出时手能否同时够到两侧未验证。
- 运动证据只覆盖九个输入角、两个截面；连续运动、载荷、摩擦与实物功能未验证。
- 完整自然语言生成流程、M5 螺纹/齿轮、M6 V8、独立隐藏集与实物 L5 仍未完成。本候选不等于完整可用机构。
