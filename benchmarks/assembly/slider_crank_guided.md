# 六件单缸导向候选（原创，未完成整机）

在五件横销候选基础上加入一个独立 `guide_front`，并修改机架：后唇边限制滑块 -Y，前导向件限制 +Y；两侧原导轨限制 X。前导向件由机架的开口朝 +Z 的通道捕获，可沿 +Z 取下。没有借助“固定关节”声明把一个悬空板当作已固定结构。

前导向件自身的 +Y/-Y/-Z 平移会被机架挡住，+Z 可退出；它没有向上锁止，重力稳定性未验证。制造材料/间隙/强度未确定；横销自身防脱、主轴轴向保持仍未解决。不得把本候选称为完整可用单缸机构。

## 实测覆盖

同一源码 SHA256 `6fdd428079a8b09258cc2f822de043f0b899d992386ac7fa2c6f817cba5d8531`：

- 9 个输入角（0°–360°、步长 45°），六件每姿态十五对碰撞通过，原位置闭环/孔心距/双截面测量通过。
- 0° 隔离导向副（只含滑块、机架、前导向件），±X 首次阻挡在 ±0.4 mm，+Y 在 0.4 mm，-Y 在 -0.2 mm；步长 0.05 mm。这些是首次采样到接触/干涉的位置，不是精确配合间隙测量。
- 同一导向副沿 -Z 16 mm、0.25 mm 步长畅通；未包含连杆曲柄，不代表全机构可做任意独立平移。
- 前导向件相对机架沿 ±Y/-Z 首次阻挡在 0.4 mm，+Z 移出 40 mm 无采样碰撞。仅平移，不证明角向约束或机械锁止。
- 先取前导向件 → 横销 → 滑块 → 连杆 → 曲柄，路径采样通过；曲柄最终移出距离为 +Y 24 mm。旧 20 mm 方案未满足终点完全移出条件，原始失败保留。
- 不先取前导向件就取滑块，滑块 +Y 0.5 mm 处被前导向件挡住（该路径步长 0.25 mm）；后续步骤 NOT_RUN。
- 六件从 ZIP 的局部 STL 和清单位姿重建，与各件 0° 装配网格匹配；位置偏移负例失败。需求合同未确认，未提升 ZIP 功能证据状态。

## 复现

```sh
bun scripts/eval/measure-slider-crank.ts benchmarks/assembly/slider_crank_guided.scad scripts/eval/assembly-fixtures/slider-crank-guided-geometry.json
bun scripts/eval/check-slider-crank-disassembly.ts benchmarks/assembly/slider_crank_guided.scad scripts/eval/assembly-fixtures/slider-crank-guided-disassembly.json scripts/eval/assembly-fixtures/slider-crank-guided-wrong-order.json
bun scripts/eval/check-guided-translations.ts <上一条输出的原始产物目录>
bun scripts/eval/check-keyed-export.ts benchmarks/assembly/slider_crank_guided.scad
```

原始目录分别为 `.agentscad/experiments/slider-crank-v4GK0s/`、`slider-crank-disassembly-hUOUfq/`（含 `guide-probes.json`）、`keyed-export-GL8cFQ/`。每个目录保留相同源码快照。它们是本地数字证据，尚未独立工程师/外部几何工具复核。连续碰撞、角向间隙、支撑/重力、手/工具操作、承载、制造和实物功能均未执行。
