# L4.1 contract-bound declaration（六件导向/保持）

这是 L4 声明路线的一次前进：不再要求提交的 `AGENTSCAD_ASSEMBLY_V1` 与一个冻结 spec **逐字相同**，而是要求它满足一份**角色/选择器合同**。part ID、instance ID、part/connection 顺序可以变化；六个角色、实例数、关节端点、0–360° motion 和拆卸顺序被冻结。

## 合同

`tasks/guided-declaration-8-28.json` 要求：

- 六个 part 角色：`frame` / `crank` / `rod` / `slider` / `eccentric_key` / `guide_front`，各一个实例；
- 六个关节记录：三个 revolute（frame-crank、crank-rod、rod-slider）、一个 slider-frame prismatic、一个 crank-key `other`、一个 frame-guide prismatic；
- motion 覆盖 0–360°；
- 五个拆卸操作，顺序为 **guide_front → eccentric_key → slider → rod → crank**；
- 错误顺序先 key/slider 再 guide，必须被 guide 挡住。

合同只按 **part selector** 匹配，因此提交可以改 ID 和顺序。下面的 reference 就是**故意改过 ID 的声明**（`part_frame` / `inst_frame` 等），仍然通过。

## 测量

评分器：

1. 提取内嵌声明；按合同检查 parts/instances/connections/motion/operations；失败则**在渲染前** ERROR；
2. 渲染声明中的六个 part 网格；
3. 用 `sampleSliderCrankSource` 在九个角度重渲染六实例，测轮廓/圆周/杆长/轴漂移和 15 对碰撞；
4. 对**提交的声明**跑正确拆卸顺序；用合同冻结的错误顺序重建 spec 再跑一次，要求正确 PASS、错误 FAIL；
5. 六实例分别导出。

## 当前结果

```
bun run bench:declaration:check
SELF-CHECK OK: 1 reference(s) pass, 3 adversarial submission(s) rejected.
```

| 提交 | 结果 |
|---|---|
| `reference`（renamed IDs） | **PASS 5/5**；六件；正确拆卸 PASS，错误顺序被 guide 挡住 |
| `adversarial-declaration-missing-guide` | **ERROR 0/5**；合同报告 missing guide part/connection、operations 少一项；渲染前拒绝 |
| `adversarial-declaration-wrong-order` | **ERROR 0/5**；合同报告 `eccentric_key, guide_front, ...` 不等于冻结顺序；渲染前拒绝 |
| `adversarial-crank-radius` | FAIL 2/5；合同通过，但几何/运动/拆卸失败 |

参考件用 renamed 声明仍然 PASS，证明合同接受不同的 ID/顺序；两个声明反例都在渲染前被拒绝，证明不是“先渲染再补声明”。

## 边界

- 这是**合同约束**，不是自主声明 authorship：角色/选择器、实例数、关节端点、运动范围和操作顺序仍由任务冻结。模型可以换 ID/顺序，但不能决定机构。
- reference 的“renamed”是本地手工变体，不是模型生成，也不是付费试验。
- 只覆盖九个输入角、零位姿拆卸和 15 对碰撞；不测连续运动、力、磨损、工具可达、逐件 ZIP、A08 产品端到端或物理功能。
- 合同检查是结构性的，不证明关节轴线、配合或保持力本身；这些仍由几何测量单独给出。
