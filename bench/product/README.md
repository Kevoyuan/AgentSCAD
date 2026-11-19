# P-A08 product-path preparation（六件导向/保持）

这是第一个**产品路径** bench family：调用真实的 `prepareContractAssembly`，不是工具级渲染器。任务用六件导向/保持内嵌声明，评分产品准备路径能测到的七层：

- `distinct-exported-parts`：选择器分件数；
- `part-connectivity`：每个渲染 part 的连通性；
- `assembly-reconstruction`：交付三角面重装；
- `assembly-path`：提交声明的插入顺序（用拆卸路径的逆序列测量）；
- `disassembly-path`：提交声明的拆卸顺序；
- `diametral-clearance`：**偏心 revolute 的单关节配合**（0.1–0.6 mm）；
- `measured-joint-frames`：该偏心配合的实测关节坐标系一致性。

fit 只覆盖偏心 revolute；main-shaft 与 wrist 的截面站不是有效圆柱探针，仍为 NOT_RUN。jointFrames、assemblyPath、motion、sourceMotion、physical 也不计入本 family。

## 结果

```
bun run bench:product:check
SELF-CHECK OK: 1 reference(s) pass, 4 adversarial submission(s) rejected.
```

| 提交 | 结果 |
|---|---|
| `reference` | **PASS 7/7**；6 parts；topology/reconstruction/assembly/disassembly 全 PASS；eccentric fit 0.395–0.405 mm PASS，joint frames PASS |
| `adversarial-slider-before-guide` | **FAIL 5/7**；topology/reconstruction/fit/joint PASS，disassembly FAIL；assembly NOT_RUN（该反例没有插入顺序） |
| `adversarial-declaration-missing-guide` | FAIL 4/7；5 parts；reconstruction NOT_RUN，distinct 失败 |
| `adversarial-crank-radius` | FAIL 3/7；reconstruction NOT_RUN、disassembly FAIL，topology 仍 PASS |
| `adversarial-fit-pin` | FAIL 3/7；eccentric clearance **−0.605–−0.594 mm**，fit FAIL；joint 仍 PASS，reconstruction NOT_RUN |

### 一个语义边界

早期把“key/guide 互换”当作反例，但产品路径正确地 PASS 了它：这两个顺序在几何上都能拆。真正被挡的是 **slider 先于 guide**。因此本 family 用 `adversarial-slider-before-guide`，而不是结构合同层的 key/guide 互换。产品层测几何顺序，声明合同层还可额外冻结结构顺序，两者不是同一件事。

## 隐藏集

隐藏 manifest 的 family 新增 `product`；外部 dev 副本 `hidden-product-joint-dev [product]` 为 `1 task / 1 case`、reference PASS、`layers 7/7`、`independentHiddenEvaluation=NOT_RUN`。这仍只是开发副本，不是独立隐藏评估。

## 边界

- 只测产品准备路径的 7 层；fit/joint 只覆盖偏心 revolute；assembly 是离散插入路径的逆序列，不是连续搬运；不是 A001 合同 gate、用户验收、连续运动或物理功能。
- fit 之外的 jointFrames/assemblyPath/motion/sourceMotion/physical 仍为 NOT_RUN；不是这些层通过。
- 一个 fixture、一个正确顺序和三个反例；不证明任意产品工作流或模型生成。
- 已加入 `bench:all`（十一家族）与 hidden family；完整总门禁结果见主 README。
