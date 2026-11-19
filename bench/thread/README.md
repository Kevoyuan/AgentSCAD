# M5 threaded-fastener（方形牙型，M10×1.5）

这是螺纹副阶梯：螺栓与螺母两件，方形牙型螺旋，右旋 1.5 mm 螺距。它测量真实网格上的几何螺距/手性/大径/小径，以及转 2 圈时螺母的导程/前进量。**不是 ISO 米制牙型计量**。

## 任务

`tasks/threaded-fastener-1.5.json`：

- selectors bolt / nut；
- 外/内螺纹几何合同：pitch 1.5、right、major/minor 直径窗口、thread range；
- 运动合同：pitch 1.5、right、minTurns 2；
- 9 个转角 0–720°；
- 三个证据层：`distinct-exported-parts`、`measured-joint-frames`、`rigid-motion`。

评分器调用 `sampleThreadedFastener`，只把**几何**和**啮合/导程**作为要求；工具的 exit/coaxiality 总状态可以仍是 NOT_RUN，不计入本 family。

## 当前结果

```
bun run bench:thread:check
SELF-CHECK OK: 1 reference(s) pass, 3 adversarial submission(s) rejected.
```

| 提交 | 结果 |
|---|---|
| `reference` | **PASS 3/3**；2 parts；外/内几何 PASS；engagement/motion PASS；导程 **1.5000 mm/转**、残差 ~0 |
| `adversarial-plain-bore` | NOT_RUN 1/3；内螺纹 plain bore，几何层 NOT_RUN |
| `adversarial-spin-only` | FAIL 2/3；螺母空转不前进，motion FAIL |
| `adversarial-wrong-pitch` | FAIL 1/3；螺距 1.25，几何和 motion 都 FAIL |

`adversarial-plain-bore` 是 NOT_RUN 而不是伪造 FAIL/PASS；self-check 仍拒绝它。

## 隐藏集

隐藏 manifest 的 family 新增 `thread`；外部 dev 副本 `hidden-thread-dev [thread]` 为 `1 task / 1 case`、reference PASS、`layers 3/3`、`independentHiddenEvaluation=NOT_RUN`。这仍只是开发副本，不是独立隐藏评估。

## 边界

- 方形牙型，不是 ISO 米制牙；不测牙型角、公差等级或制造计量。
- 不测扭矩、预紧、强度、磨损、自锁、旋入/旋出全程或实物。
- 只测 9 个转角；exit/coaxiality 总状态仍可 NOT_RUN，本 family 只主张列出的几何/运动层。
- 已加入 `bench:all`（十二家族）与 hidden family；完整总门禁结果见主 README。
