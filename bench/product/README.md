# P-A08 product-path preparation（六件导向/保持）

这是第一个**产品路径** bench family：调用真实的 `prepareContractAssembly`，不是工具级渲染器。任务用六件导向/保持内嵌声明，评分产品准备路径能测到的四层：

- `distinct-exported-parts`：选择器分件数；
- `part-connectivity`：每个渲染 part 的连通性；
- `assembly-reconstruction`：交付三角面重装；
- `disassembly-path`：提交声明的拆卸顺序。

这些层不需要已确认的 requirement contract；fit、jointFrames、assemblyPath、motion、sourceMotion、physical 仍为 NOT_RUN，不计入本 family。

## 结果

```
bun run bench:product:check
SELF-CHECK OK: 1 reference(s) pass, 3 adversarial submission(s) rejected.
```

| 提交 | 结果 |
|---|---|
| `reference` | **PASS 4/4**；6 parts；topology/reconstruction/disassembly 全 PASS |
| `adversarial-slider-before-guide` | **FAIL 3/4**；topology/reconstruction PASS，**只有 disassembly FAIL**；slider 先于 guide 被挡 |
| `adversarial-declaration-missing-guide` | FAIL 2/4；5 parts；reconstruction NOT_RUN，distinct 失败 |
| `adversarial-crank-radius` | FAIL 2/4；reconstruction NOT_RUN、disassembly FAIL，topology 仍 PASS |

### 一个语义边界

早期把“key/guide 互换”当作反例，但产品路径正确地 PASS 了它：这两个顺序在几何上都能拆。真正被挡的是 **slider 先于 guide**。因此本 family 用 `adversarial-slider-before-guide`，而不是结构合同层的 key/guide 互换。产品层测几何顺序，声明合同层还可额外冻结结构顺序，两者不是同一件事。

## 边界

- 只测产品准备路径的 4 层；不是 A001 合同 gate、用户验收、连续运动、配合或物理功能。
- 没有确认合同，所以 fit/joint/motion 仍为 NOT_RUN；不是这些层通过。
- 一个 fixture、一个正确顺序和三个反例；不证明任意产品工作流或模型生成。
- 尚未加入 `bench:all`/hidden；作为独立产品路径 family 通过 self-check。
