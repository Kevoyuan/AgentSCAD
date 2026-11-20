# L4 declaration-bound slider-crank（7 件 / 9 实例）

这是公开基准里第一个 **declaration-bound** 的多关节家族：七种制造零件、九个实例、四关节闭环，加两个横向键和两个四分之一转导向锁。

它不是模型自由生成任务。任务拥有**完整冻结的装配声明**（parts / instances / connections / motions / operations），提交只拥有几何；如果提交内嵌声明与冻结声明的 SHA-256 不一致，直接拒绝，不会把候选拿去和另一套机构比较。

## 任务

`tasks/slider-shaft-keyed-7x9.json` 引用 `specs/slider-shaft-keyed.spec.json`：

- 7 个 part、9 个 instance；两个 `eccentric_key` 实例、两个 `guide_lock` 实例；
- 四关节：主轴、曲柄销、腕销、滑块导轨；输入 0–360°；
- 8 个声明拆卸操作：两个导向锁四分之一转释放 → 导向件 → 主轴键 → 偏心键 → 滑块 → 连杆 → 曲柄；
- 冻结的**错误顺序**把 `remove_guide` 移到 `release_guide_lock_right` 之前，必须被导向锁挡住。

## 测量

评分器：

1. 提取提交内嵌声明，比对冻结 spec SHA；
2. 真实渲染 7 个 part 网格，运行**正确**与**错误**两条声明拆卸序列（离线预算 120 s）；
3. 用 `sampleSliderCrankSource` 在 0/90/180/270/360° 重渲染 9 个实例，检查：
   - 9 个实例网格是否分别可导出；
   - 曲柄/连杆/滑块轮廓与冻结 oracle；
   - 9 个实例、36 对的三角碰撞；
   - 曲柄圆拟合、杆长散布、销轴漂移。

证据层：`distinct-exported-parts`、`measured-joint-frames`、`sampled-motion`、`source-motion`、`disassembly-path`。

## 当前结果

```
slider-shaft-keyed-7x9  reference                     PASS  5/5  9  PASS PASS PASS PASS
slider-shaft-keyed-7x9  adversarial-crank-radius      FAIL  2/5  9  FAIL PASS FAIL FAIL
slider-shaft-keyed-7x9  adversarial-static            FAIL  3/5  9  FAIL PASS NOT_RUN PASS
slider-shaft-keyed-7x9  adversarial-guide-locks-away  FAIL  4/5  9  PASS PASS PASS FAIL
slider-shaft-keyed-7x9  adversarial-declaration-motion-range  ERROR 0/5  —  ERROR ERROR ERROR ERROR
```

- reference 实测曲柄半径 **8.000000 mm**、9 个实例、7 个 part 网格；正确拆卸 PASS，错误顺序被 `guide_lock_right` 挡住。
- `adversarial-guide-locks-away` 把 `guide_lock` 的 part 局部网格和两个实例选择器一起移出导向路径：运动/轮廓/碰撞/source 全 PASS，**只有 `disassembly-path` FAIL**。这是错误顺序检查的存在理由。
- `adversarial-crank-radius` 实测 9.000 mm，landmark/source/disassembly 失败。
- `adversarial-static` 的 source-motion 是 NOT_RUN（共线销位置），不是伪造 FAIL/PASS。
- `adversarial-declaration-motion-range` 把内嵌声明的 motion 上限从 360° 改成 180°；spec SHA 不匹配，报告 `changed: motions` 并在渲染前拒绝，所有 requirement 为 ERROR。声明哈希是门，spec 差异只是可行动的诊断。

自检：`SELF-CHECK OK: 1 reference(s) pass, 4 adversarial submission(s) rejected.`

## 边界

- 这是 **declaration-bound** 家族：冻结声明是任务的一部分，不测模型能否提出或修正声明本身。
- 只覆盖 5 个输入角和声明的离散拆卸位姿；连续运动、齿轮/螺纹啮合、力、磨损、工具可达、制造公差和实物功能都未验证。
- 正确/错误拆卸都使用同一组 7 个 part 网格；错误顺序只是一个冻结重排，不证明不存在其他绕行路径。
- 7 件/9 实例不是 V8；L5 两缸仍在后面。
