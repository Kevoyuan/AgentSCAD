# 单缸偏心销横销候选（原创、未完成机构）

目标是验证一处明确的保持作用：连杆不能沿 +Y 从偏心销上直接取出，必须先沿 +X 取下横销。基线 `slider_crank.scad` 保留不变；候选为独立完整源码 `slider_crank_keyed.scad`，不是第三方代码改写。

## 条件与尺寸

- 单位 mm，机构在 XZ 平面运动，主轴/连杆孔轴沿 Y；拆卸姿态为输入角 0°。
- 曲柄半径 8，连杆孔心距 28；既有数字运动容差 0.02，未修改以迎合候选。
- 横销穿过偏心销，孔中心在曲柄局部 `[0,5,8]`，孔轴 +X，孔半径 0.7。
- 横销杆半径 0.5，局部 X 从 -4 到 4.1；销头半径 0.8，X 从 4 到 5。以上是源码设计值，孔销配合尚无独立截面实测，也不是实物公差。
- `eccentric_key` 单独选择器默认输出零件局部坐标；`agentscad_pose=true` 时与曲柄一起定位/旋转。验证器检查其实际渲染网格参与碰撞，但尚未独立验证横销的整段轨迹和防脱约束。

## 已执行的数字断言

1. 0°–360° 每 45° 重新执行源码，五件每姿态十对碰撞无干涉；原有关键点解析比较和跨姿态检查通过。
2. 在 0° 姿态先取横销（+X 30 mm），再取滑块、连杆、曲柄（各 +Y 20 mm），路径以 0.25 mm 采样通过。
3. 先取滑块但保留横销，随后试图取连杆：0.25 mm 处连杆与横销相交，失败。
4. 第一版销头半径 1.2 在装配姿态就与连杆干涉，失败产物保留；修订为 0.8 后才取得上述结果，没有改放行阈值。

复现：

```sh
bun scripts/eval/measure-slider-crank.ts benchmarks/assembly/slider_crank_keyed.scad scripts/eval/assembly-fixtures/slider-crank-keyed-geometry.json
bun scripts/eval/check-slider-crank-disassembly.ts benchmarks/assembly/slider_crank_keyed.scad scripts/eval/assembly-fixtures/slider-crank-keyed-disassembly.json scripts/eval/assembly-fixtures/slider-crank-keyed-wrong-order.json
```

## 未完成项

横销自身没有防脱锁止；主轴轴向保持、滑块完整导向仍缺失。不得宣称机构可以脱手稳定运转，也不得把几何阻挡当成承载强度。保持件仍需纳入正式装配合同和制造包；目前碰撞附件列表来自冻结实验配置，不能证明没有漏列其他几何。连续路径、手/工具空间、支撑、制造公差和实物功能全部未验证。后续应解决这些条件，保留本例作为偏心销保持和顺序约束的回归，而不是扩展其 PASS 的含义。

## 装配包与坐标复核（2026-10-30）

候选源码内现有 `AGENTSCAD_ASSEMBLY_V1` 声明。五件各有稳定 ID/selector；装配位姿仅对应 0°；连接为意图声明，不能据此认定自由度已经由实体结构约束。制造条件保持未知。拆卸操作明确从装配位姿到移出终点，顺序由声明读取并验证。

`bun scripts/eval/check-keyed-export.ts` 使用现有装配包构建器生成 ZIP，再从 ZIP 读取五件 STL 和 manifest 位姿，逐三角面比较其重建结果与重新渲染的各件装配姿态。当前五件通过，最大顶点差约 1.91e-6 mm；将连杆清单位姿偏移 1 mm 后失败。匹配只证明一个姿态的无向网格表面一致，不能替代零件语义、闭合网格、制造或物理约束检查。若三角剖分不同，保守返回 NOT_RUN，需要独立表面距离算法；不因为包围盒一致就通过。

本实验没有用户确认的需求合同，ZIP 的合同门禁保留未确认；独立的重建实验 PASS 不会写回或提升 ZIP 的功能证据状态。源内声明派生的拆卸路径另行通过，但正式产品路由尚未自动执行这项重建检查。
