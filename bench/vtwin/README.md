# L5a 90° V-twin cross-section（V 角，不是完整 V8）

这是 V8 之前真正的 **V 角**阶梯：两根缸筒轴线各偏 45°（夹角 90°），共用一个曲柄销；曲柄半径 8 mm、连杆 28 mm。它是 V8 横截面的两缸简化，不是完整 V8。

## 任务

`tasks/v-twin-8-28.json` 拥有机构合同：

- 曲柄半径 8 mm、连杆 28 mm；
- 两缸轴线在 XZ 平面内 ±45°；
- 两缸沿 Y 分开，bank y = ±10 mm；连杆在 y = ±12 mm（在各自缸筒内偏 2 mm）；
- 共用一个曲柄销，销半径 8 mm；
- 九个输入角 0–360°（每 45°）；
- 六个实例：frame、crank、rod_left/right、slider_left/right；
- 滑块中心位置容差 0.1 mm。

提交只拥有几何。评分器在每个角度真实重渲染六件：

1. 从滑块包围盒中心测位置，与共享销闭合公式沿 ±45° 轴线比较；
2. 15 对实例网格 × 9 个角 = **135 次** BVH 三角碰撞；
3. 用规范三角形哈希确认六实例分别可导出；
4. 源码重新执行，静态或错误 V 角不能通过。

证据层：`distinct-exported-parts`、`measured-joint-frames`、`sampled-motion`、`source-motion`。

## 当前结果

```
bun run bench:vtwin:check
SELF-CHECK OK: 1 reference(s) pass, 4 adversarial submission(s) rejected.
```

| 提交 | 结果 |
|---|---|
| `reference` | **PASS 4/4**；6 实例；135 次碰撞全分离；共享销闭合位置误差 **0.0000 mm** |
| `adversarial-v-angle` | FAIL 2/4；半角 45°→30°，位置误差 **9.3587 mm** |
| `adversarial-crank-radius` | FAIL 2/4；曲柄 9 mm，位置误差 1.0000 mm |
| `adversarial-static` | FAIL 2/4；源码不随角运动，位置误差 13.0795 mm |
| `adversarial-collision` | FAIL 1/4；右滑块移到左 bank，y 位置错 20.0000 mm 且碰撞失败 |

参考位置：0° 时两滑块都在 33.079 mm；45° 时左 36.000 / 右 26.833 mm；90° 时左 33.079 / 右 21.766 mm。共享销让两缸在 45°/135°/225°/315° 出现不同的行程，正是 V 角与直列双缸的区别。

## 隐藏集

隐藏 manifest 的 family 新增 `vtwin`；外部 dev 副本 `hidden-vtwin-dev [vtwin]` 为 `1 task / 1 case`、reference PASS、`layers 4/4`、`independentHiddenEvaluation=NOT_RUN`。这仍只是开发副本，不是独立隐藏评估。

## 边界

- **90° V-twin 横截面，不是完整 V8**；不测两缸以上、点火、气道、曲轴平衡、轴承或整机。
- **frame 是两根倾斜导向管 + 一块底部基板，不是完整曲轴箱**；两根管和基板在几何上不连通，本家族不评分 frame 连通性。
- 只测九个离散角、网格包围盒中心和 135 次离散碰撞；不测连续运动、负载、润滑、摩擦、磨损、制造公差或实物功能。
- 机构合同由任务拥有；不测自主提出机构合同。
