# L2.8 three-planet epicyclic gear train（12/12/36 × 3）

这是行星齿轮系的多行星阶梯：固定内齿圈、太阳轮输入、行星架输出，**三个行星轮相隔 120°**，每个行星轮独立测量。它是单 carrier/单 ring 的三行星演示，不是完整齿轮箱或均载机构。

## 任务

`tasks/planetary-3x-12-12-36.json`：

- 模数 2 mm、太阳 12、行星 12、内齿圈 36、行星架半径 24 mm；
- 三个行星选择器 `planet0/1/2_pose`，偏移 0/120/240°；
- 输入位姿 `[0, 120, 240, -120, -240]`；
- 六件：sun、ring、carrier、三个 planets；
- 角度容差 0.5°、比值 0.005、中心距 0.25 mm。

评分器对每个位姿真实渲染 sun/carrier/三个 planets，对每个行星独立跑 `checkPlanetaryCoupling`：

- ring = sun + 2·planet；
- 节圆闭合、太阳/行星架/行星绝对斜率；
- 正负反转和行星中心距；
- 六个 part 分别导出。

## 当前结果

```
bun run bench:planetary3:check
SELF-CHECK OK: 1 reference(s) pass, 3 adversarial submission(s) rejected.
```

| 提交 | 结果 |
|---|---|
| `reference` | **PASS 2/2**；6 parts；三个行星全部 PASS；max planet/carrier residual **0.0000°** |
| `adversarial-carrier-ratio` | FAIL 1/2；行星架 1:1，planet 720°、carrier 360° |
| `adversarial-static` | FAIL 1/2；planet 240°、carrier 120° |
| `adversarial-sun-teeth` | ERROR 0/2；太阳 13 齿使 ring 闭合不成立，profile gate 拒绝 |

每个行星独立测到 12/12/36 齿、carrier 0.25、planet −0.5；参考件的三行星残差在 3.1e−6° 内。

## 隐藏集

隐藏 manifest 的 family 新增 `planetary3`；外部 dev 副本 `hidden-planetary3-dev [planetary3]` 为 `1 task / 1 case`、reference PASS、`layers 2/2`、`independentHiddenEvaluation=NOT_RUN`。这仍只是开发副本，不是独立隐藏评估。

## 边界

- 只有**一个 carrier、一个 ring、三个行星**；不测多级齿轮箱、多 carrier、均载、轴承、齿面接触、侧隙、效率、负载、磨损或实物制造。
- 直边齿；节圆是 tip/root 估计；5 个离散位姿。
- 三个行星的 marker/中心是测量特征，不是任意生成件的身份证明。
- 已加入 `bench:all`（十家族）与 hidden family；完整总门禁结果见主 README。
