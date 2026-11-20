# L4.5 inline twin piston（直列双缸，不是 V8）

这是 L5 之前的第一个多缸阶梯：一根 Y 轴曲柄、两个沿曲柄轴分开的活塞-缸筒、右缸相位落后 180°。它是**直列双缸**，不是 V8 的 V 角横截面；L5 仍未开始。

## 任务

`tasks/twin-inline-8-28.json` 拥有机构合同：

- 曲柄半径 8 mm、连杆 28 mm；
- 两缸中心在 y = -25 / +25 mm（分开 50 mm）；
- 右缸相位 180°；
- 五个输入角 0/90/180/270/360°；
- 六个实例：frame、crank、rod_left、rod_right、slider_left、slider_right；
- 滑块中心位置容差 0.1 mm。

提交拥有几何和 `crank_angle` 参数。评分器在每个角度真实重渲染六个实例：

1. 从滑块网格包围盒测 z/y 中心，与曲柄-连杆闭合公式比较；
2. 15 对实例网格逐对做三角形/BVH 碰撞；
3. 重新渲染源码，保证不是静态几何或同一相位；
4. 用规范三角形哈希确认六个实例分别可导出。

证据层：`distinct-exported-parts`、`measured-joint-frames`、`sampled-motion`、`source-motion`。

## 当前结果

```
bun run bench:twin:check
SELF-CHECK OK: 1 reference(s) pass, 5 adversarial submission(s) rejected.
```

| 提交 | 结果 |
|---|---|
| `reference` | **PASS 4/4**；6 实例；5 角 × 15 对 = 75 次碰撞全分离；滑块 z 误差 **0.0000 mm**；0° 为 36/20 mm，90° 为 26.833/26.833 mm |
| `adversarial-same-phase` | FAIL 1/4；右缸不再落后 180°，z 误差 16.0000 mm |
| `adversarial-crank-radius` | FAIL 1/4；曲柄 9 mm，z 误差 1.0000 mm，且出现碰撞 |
| `adversarial-rod-length` | FAIL 2/4；杆长 30 mm，z 误差 2.0808 mm；碰撞仍分离，只靠位置/相位层拒绝 |
| `adversarial-static` | FAIL 2/4；源码不随角度运动，z 误差 16.0000 mm |
| `adversarial-collision` | FAIL 1/4；右滑块移到左缸 y，90° 时两滑块重叠；位置和碰撞同时失败 |

`adversarial-rod-length` 是一个有意义的区分：它碰撞全分离，但位置/相位错，说明 `sampled-motion` 不能替代 `measured-joint-frames`/`source-motion`。

## 隐藏集

`hidden.json` 的 family 新增 `twin`；外部 dev 副本 `hidden-twin-dev [twin]` 为 `1 task / 1 case`，reference PASS，`layers 4/4`，`independentHiddenEvaluation=NOT_RUN`。这仍只是开发副本，不是独立隐藏评估。

## 边界

- **直列双缸，不是 V8 V 角**；不测两缸夹角、气道、点火、曲轴平衡或完整 V8。
- 只覆盖 5 个输入角和 75 次离散碰撞；不是连续运动、负载、润滑、摩擦、磨损或实物功能。
- 滑块位置来自网格包围盒，不是独立识别的销轴/孔轴线；容差 0.1 mm 是网格值。
- 机构合同由任务拥有；提交只拥有几何和曲柄角参数，不测自主提出机构合同。
