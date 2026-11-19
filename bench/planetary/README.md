# L2.75 epicyclic/planetary gear train（12/12/36）

这是齿轮家族的传动阶梯：固定内齿圈、太阳轮输入、行星架输出，测一个行星轮。它复用产品里的 `measureGearProfile`、`measureGearMarkerAngle` 和 `checkPlanetaryCoupling`，但**不调用模型或产品路由**。

## 任务

`tasks/planetary-12-12-36.json`：

- 模数 2 mm，太阳 12 齿、行星 12 齿、内齿圈 36 齿；
- 行星架半径 24 mm；
- 输入位姿 `[0, 120, 240, -120, -240]`（正负都覆盖）；
- 角度容差 0.5°、比值容差 0.005、中心距容差 0.25 mm；
- 四个选择器：sun_pose、planet_pose、ring、carrier_pose。

评分器真实渲染：

1. 内齿圈 internal profile（中心、齿数、节圆估计）；
2. 每个位姿的太阳/行星/行星架；从径向 marker 测相位；
3. `checkPlanetaryCoupling` 检查 `ring = sun + 2·planet`、节圆闭合、太阳/行星架/行星绝对斜率、正负反转和中心距；
4. 四个 part 分别可导出。

## 当前结果

```
bun run bench:planetary:check
SELF-CHECK OK: 1 reference(s) pass, 3 adversarial submission(s) rejected.
```

| 提交 | 结果 |
|---|---|
| `reference` | **PASS 2/2**；4 parts；carrier/planet residual **0.000°**；实测太阳斜率 1、行星架 0.25、行星绝对 −0.5 |
| `adversarial-carrier-ratio` | FAIL 1/2；行星架 1:1，carrier residual 360°、planet 720° |
| `adversarial-static` | FAIL 1/2；markers 不随输入，residual 120°/240° |
| `adversarial-sun-teeth` | ERROR 0/2；太阳 13 齿使 `ring = sun + 2·planet` 不成立，profile gate 拒绝 |

`adversarial-sun-teeth` 是结构 gate：它在测到齿数后直接拒绝，不伪造 PASS。

## 边界

- 只测一个行星轮；不测多行星均载、齿面接触、侧隙、效率、负载、磨损或实物制造。
- 直边全齿高齿形；节圆是 tip/root 半径估计，不是渐开线计量。
- 只覆盖 5 个输入位姿；marker/bores 是测量特征，不是任意生成件的身份证明。
- 尚未加入 `bench:all`/hidden family；作为第九个独立家族通过 self-check。
