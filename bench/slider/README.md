# 单缸曲柄滑块基准（slider-crank）

这是公开装配基准的 **L3 基础家族**：四件式（机架、曲柄、连杆、滑块）、闭环四关节、输入角 0–360°。

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
- 这不是 `bench/assembly` 的两件式 scorer；也不是产品的装配声明/A01 证据链。它是独立的 L3 几何家族。

## 运行

```bash
bun run bench:slider            # 跑所有滑块任务和提交
bun run bench:slider:check      # reference 必须 PASS，adversarial 不能 PASS
bun run bench:slider --task slider-crank-8-28 --submission reference --verbose
```

需要本机 `openscad`；无模型调用。输出 `bench/slider/report.json`（gitignored）。

## 任务格式

见 [`tasks/slider-crank-8-28.json`](tasks/slider-crank-8-28.json)。任务声明：

- four selectors（crank / rod / slider / frame）、`motionParameter`（这里是 `motion_angle`）、`poseParameters`（`agentscad_pose: true`）；
- `angles`：五个输入角，必须包含 0°；
- `contract`：曲柄半径、杆长、容差、截面、可选轴探针截面、销/孔半径窗口；
- `requirements`：`distinct-exported-parts`（必须等于 4）、`measured-joint-frames`、`sampled-motion`、`source-motion`。

任务自身不一致会被拒绝：缺选择器、角度缺 0°、容差低于 1e-4、半径窗口非法、不可观测的 requirement。

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

## 边界

- 只覆盖列出的五个输入角；角与角之间、连续运动、隐藏障碍、间隙/过盈、摩擦、间隙和载荷都没有证据。
- 轮廓身份仍依赖选择器和半径窗口；它不是独立特征语义识别。
- 没有拆卸/工具可达、制造公差、逐件 ZIP、产品端到端、隐藏集或实物。
- 6 件带保持件的单缸版本属于 A08 的产品工作，不由这个基准家族替代。
