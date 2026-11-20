# 单缸曲柄滑块基准（slider-crank）

这是公开装配基准的 **L3/L3.5/A08 家族**，目前有三类任务：

- `slider-crank-8-28`：四件式（机架、曲柄、连杆、滑块）、闭环四关节、输入角 0–360°；
- `slider-crank-keyed-8-28`：在四件基础上加一个偏心保持键，共五件；它同时冻结**正确拆卸顺序**和**错误顺序**，要求错误顺序被键挡住；
- `slider-crank-guided-8-28`：六件导向/保持候选，增加前导向件和偏心键；正确顺序必须先取导向件，错误顺序必须被导向件挡住。

它问的不是「画出四个像曲柄滑块的形状」，而是：

> 真实重渲染的曲柄销是否画出一个半径等于合同的圆？连杆长度是否保持？销轴是否仍在 +Y？
> 滑块位置是否由闭环关系决定？在列出的角度上四件是否互不干涉？四件是否能分别导出？

## 与产品/装配评测的区别

- 任务拥有合同：曲柄半径 8 mm、连杆 28 mm、截面 y=2.3 mm、销/孔半径窗口、五个输入角。
- 提交只提供 SCAD 文件；不声明半径、杆长、关节轴或采样结果。
- 评分器调用 `sampleSliderCrankSource`，对每个角度真实重渲染四个选择器，再从 STL 三角形测量：
  - 圆周轮廓中心（曲柄销、滑块销、连杆两端孔）；
  - 曲柄销轨迹拟合出的半径与残差；
  - 连杆长度跨姿态散布；
  - 两个截面上的销轴漂移；
  - 全件两两 BVH 三角相交。
- 这不是 `bench/assembly` 的两件式 scorer；也不是产品的装配声明/A01 证据链。它是独立的 L3/L3.5 几何家族。

## 运行

```bash
bun run bench:slider            # 跑所有滑块任务和提交
bun run bench:slider:check      # reference 必须 PASS，adversarial 不能 PASS
bun run bench:slider --task slider-crank-8-28 --submission reference --verbose
bun run bench:slider --task slider-crank-keyed-8-28 --submission reference --verbose
bun run bench:slider --task slider-crank-guided-8-28 --submission reference --verbose
```

需要本机 `openscad`；无模型调用。输出 `bench/slider/report.json`（gitignored）。全部任务一起跑：`bun run bench:slider:check` → `SELF-CHECK OK: 3 reference(s) pass, 14 adversarial submission(s) rejected`。

## 任务格式

见 [`tasks/slider-crank-8-28.json`](tasks/slider-crank-8-28.json)。任务声明：

- four selectors（crank / rod / slider / frame）、`motionParameter`（这里是 `motion_angle`）、`poseParameters`（`agentscad_pose: true`）；
- `angles`：五个输入角，必须包含 0°；
- `contract`：曲柄半径、杆长、容差、截面、可选轴探针截面、销/孔半径窗口；
- `requirements`：`distinct-exported-parts`（必须等于 4 + attachment 数）、`measured-joint-frames`、`sampled-motion`、`source-motion`；带保持键的任务再加 `disassembly-path`。
- 可选 `attachments`：额外的运动件（如 `eccentric_key`），其选择器必须与四角色不同。
- 可选 `disassembly`：`plan`（正确顺序）与 `wrongOrder`（冻结的错误顺序）；声明 `disassembly-path` 时必须同时提供两者，且错误顺序必须与正确顺序不同。

任务自身不一致会被拒绝：缺选择器、角度缺 0°、容差低于 1e-4、半径窗口非法、不可观测的 requirement、拆卸计划漏件/重复件/预算超限。

## 提交与当前结果

一个任务一个目录，一个 `.scad` 一个提交。`reference.scad` 是原创四件夹具；每条 `adversarial-*` 只破坏一个事实。

| 提交 | 破坏的事实 | 结果 |
|---|---|---|
| `adversarial-crank-radius` | 曲柄半径 8 → 9 | FAIL；实测半径 9.000 |
| `adversarial-rod-length` | 杆长 28 → 30 | FAIL；landmark + source-motion |
| `adversarial-uncoupled-rod` | 连杆角度不随曲柄 | FAIL；landmark 拦截，碰撞仍 PASS |
| `adversarial-shifted-crank` | 曲柄整体平移 1 mm | FAIL；landmark、碰撞、source-motion 均失败 |
| `adversarial-static` | 运动参数不起作用 | FAIL；source-motion NOT_RUN（共线销位置） |
| `adversarial-missing-bearing` | 机架缺轴承孔 | FAIL；碰撞在列出的角度上被拦截 |
| `adversarial-wrong-axis` | 曲柄绕 X 轴转 | ERROR；截面中找不到应有的销轮廓，不是伪造 PASS |
| `reference` | 无 | **PASS**；4/4 层 |

reference 实测：曲柄半径 **8.000000 mm**、圆拟合残差 0、杆长跨姿态散布 **5.96e−8 mm**、销轴漂移 0；五个角度的三角对约 7.8 万–8.8 万，全部 `SEPARATED`。

```
SELF-CHECK OK: 1 reference(s) pass, 7 adversarial submission(s) rejected.
```

## 带偏心保持键的五件任务

`slider-crank-keyed-8-28` 复用四件合同，并增加 `eccentric_key` 和两条冻结拆卸计划：正确顺序先取键，再取滑块、连杆、曲柄；错误顺序先取滑块和连杆，必须被键挡住。评分器在零位姿网格上同时运行两条计划，只有**正确通过且错误被挡住**才给 `disassembly-path` PASS。

| 提交 | 破坏的事实 | 结果 |
|---|---|---|
| `adversarial-crank-radius` | 曲柄半径 8 → 9 | FAIL 3/5；实测 9.000 |
| `adversarial-missing-bearing` | 机架缺轴承孔 | FAIL 3/5；碰撞和拆卸失败 |
| `adversarial-static` | 运动参数不起作用 | FAIL 3/5；source-motion NOT_RUN |
| `adversarial-key-out-of-way` | 把键移到不挡错误顺序的位置 | FAIL 4/5；**只有 disassembly-path 失败**，证明错误顺序检查本身有牙 |
| `reference` | 无 | **PASS 5/5**；五件分别导出 |

```
SELF-CHECK OK: 1 reference(s) pass, 4 adversarial submission(s) rejected.
```

reference 同样实测曲柄半径 8.000000 mm、杆长散布约 6e−8 mm、轴漂移 0；正确拆卸计划 PASS，错误计划 FAIL。`key-out-of-way` 是这一层最重要的反例：它不改变运动或轮廓，只让“键”不再挡住错误顺序，评分器仍然拒绝。

## 六件导向/保持（A08）

`slider-crank-guided-8-28` 增加 `guide_front`，共六件；九个输入角，15 对实例网格的 BVH 碰撞；正确拆卸顺序为 **导向件 → 偏心键 → 滑块 → 连杆 → 曲柄**，错误顺序先取键和滑块，必须被导向件挡住。

| 提交 | 破坏的事实 | 结果 |
|---|---|---|
| `adversarial-crank-radius` | 曲柄半径 8 → 9 | FAIL 3/5；实测 9.000 |
| `adversarial-static` | 运动参数不起作用 | FAIL 3/5；source-motion NOT_RUN |
| `adversarial-guide-away` | 把导向件沿 +Z 移出 **40 mm**，不再挡错误顺序 | FAIL 4/5；**只有 disassembly-path 失败** |
| `reference` | 无 | **PASS 5/5**；六件分别导出 |

```
SELF-CHECK OK: 1 reference(s) pass, 3 adversarial submission(s) rejected.
```

`guide-away` 是导向层的关键反例：运动、轮廓、碰撞和 source 全 PASS；评分器单独拒绝“错误顺序不再被挡”。六个 part 网格分别约 1072/780/268/424/508/28 三角形。

## 边界

- 只覆盖列出的五个输入角；角与角之间、连续运动、隐藏障碍、间隙/过盈、摩擦、间隙和载荷都没有证据。
- 轮廓身份仍依赖选择器和半径窗口；它不是独立特征语义识别。
- 没有工具可达、连续拆卸、制造公差、逐件 ZIP、产品端到端、隐藏集或实物。
- 五件带键和六件导向版本仍只有零位姿的离散拆卸计划；不证明连续拆卸、力、意外释放、工具可达或保持力。六件 guided 基准已加入，但 A08 的产品端到端/逐件 ZIP/实物仍不属于这个家族。
