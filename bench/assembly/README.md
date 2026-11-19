# assembly-bench — 功能性装配生成的小型评测

一个**窄而完整**的评测：给定一句自然语言需求，模型能否产出真的能装、能转、能拆的两件式装配几何？

它回答的问题是可机器判定的：

1. 两个选择器是否真的导出两个不同的实体？
2. 轴与孔的直径间隙是否落在指定的窗口内？
3. 活动件在声明角度范围内旋转时是否与固定件干涉？
4. 活动件能否沿轴方向抽开？

不需要人类标注，不需要视觉模型，不需要 Chamfer distance。全部结论来自确定性几何测量。

## 为什么是这个形态

现有的 CAD 生成 benchmark（DeepCAD / ABC / Fusion 360 Gallery / Text2CAD）几乎全部只评**静态几何**：重建误差、序列相似度、Chamfer distance。没有一个评"这东西动起来会不会撞""间隙是不是真的 0.4 mm"。

这个仓库里已经有一个真实的几何验证器（`src/lib/assembly/`、`src/lib/geometry/`），这个 benchmark 是把它从产品里**解耦**出来、换成模型无关的提交接口之后的产物。

## 两条设计规则

**任务拥有几何契约，提交只拥有几何。**
模型从不声明自己的关节、间隙带宽或运动范围，所以它无法把验收窗口放宽成它画出来的东西。任务 JSON 决定一切；模型的输出就是一个 `.scad` 文件。

**证据分级，`NOT_RUN` 永不等于通过。**
每条结论带 `PASS | FAIL | SKIP | ERROR | NOT_RUN`。渲染失败是 `ERROR` 不是 `FAIL`——没有候选可测。没测到的项目保持 `NOT_RUN` 并让整体 gate 失败。

## 跑起来

```bash
bun run bench:assembly            # 跑全矩阵，写出 report.json
bun run bench:assembly:check      # 自检：参考解必须全过，作弊解必须全被拦
bun run bench:assembly --task hinge-45-loose --submission reference --verbose
```

依赖本机 `openscad`（原生）或设置 `AGENTSCAD_OPENSCAD_BACKEND=wasm` 使用固定校验和的 WASM 运行时。

## 提交格式

一个任务对应一个目录，每个提交一个 `.scad` 文件：

```
submissions/<task-id>/<submission>.scad
```

文件名决定预期结果，这是自检的依据：

| 文件名 | 预期 | 含义 |
|---|---|---|
| `reference.scad` | 必须 PASS | 参考解，证明任务可解 |
| `adversarial-*.scad` | 必须不 PASS | 作弊样例，证明判据有牙 |

SCAD 文件必须用变量 `agentscad_part` 选择要导出的零件。评测器分别以 `-D agentscad_part=fixed` 和 `-D agentscad_part=moving` 渲染两次，两次结果必须在**同一个装配坐标系**里。

```scad
agentscad_part = "all";
$fn = 64;

module fixed_leaf() { /* 带销的固定件 */ }
module moving_leaf() { /* 带轴套的活动件 */ }

module generated_part() {
  if (agentscad_part == "all" || agentscad_part == "fixed") fixed_leaf();
  if (agentscad_part == "all" || agentscad_part == "moving") moving_leaf();
}
generated_part();
```

`-D` 会覆盖文件内的赋值，所以文件顶部写 `"all"` 是安全默认值。

## 任务格式

见 [`tasks/hinge-45-loose.json`](tasks/hinge-45-loose.json)。任务声明：

- `parts[]` —— 零件 id 与选择器
- `joint` —— 关节类型、轴原点、轴方向、哪个零件带孔
- `requirements[]` —— 冻结的验收契约（`equals` / `range` / `atLeast`）
- `motion` —— 角度范围与采样数
- `disassembly` —— 抽开距离与采样数

目前只支持 `revolute + 圆孔/圆销`。要加 `prismatic` 需要新的观测器，`src/lib/assembly/fit-measurement.ts` 已经支持 `prismatic` 的配合测量，缺的是运动与拆卸的对应采样。

## 当前任务集

| 任务 | 家族 | 轴孔带宽 (mm) | 运动 |
|---|---|---|---|
| `hinge-45-loose` | 转动副 | 0.35 – 0.45 | ±45° |
| `hinge-90-tight` | 转动副 | 0.20 – 0.30 | ±90° |
| `hinge-60-wide` | 转动副 | 0.40 – 0.55 | ±60° |
| `piston-bore-30` | 移动副 | 0.35 – 0.45 | 行程 30 mm |
| `piston-bore-45` | 移动副 | 0.20 – 0.30 | 行程 45 mm |
| `hinge-captured-45` | 转动副 + 轴向保持 | 0.35 – 0.45 | ±45°，拉拔 2 mm 被挡住 |

两个家族对应 V8 机构的两种基本关节：铰链是转动副，活塞-缸筒是移动副。同家族内只有公差和行程不同——它们测的是**是否命中指定公差**，不是"能不能画出一个铰链形状"。

家族之间的差别不是参数而是**语义**：铰链里带孔的零件在转（`borePartId == movingPartId`），活塞里带孔的零件固定不动（`borePartId != movingPartId`）。`joint.movingPartId` 就是为了让同一个判分器覆盖这两种情况而不预设"带孔的就是活动件"。

## 当前结果

```
task              submission                    status  cover   parts  clearance      motion  disasm
hinge-45-loose    adversarial-floating          ERROR   4/6     PASS   —              PASS    PASS
hinge-45-loose    adversarial-fused-bore        ERROR   2/6     PASS   —              FAIL    FAIL
hinge-45-loose    adversarial-solid-blob        ERROR   1/6     FAIL   —              FAIL    FAIL
hinge-45-loose    adversarial-static-pose       FAIL    5/6     PASS   0.400-0.415    PASS    PASS
hinge-45-loose    adversarial-tight-bore        FAIL    5/6     PASS   0.050-0.065    PASS    PASS
hinge-45-loose    adversarial-whole-rotation    FAIL    5/6     PASS   0.400-0.415    PASS    PASS
hinge-45-loose    reference                     PASS    6/6     PASS   0.400-0.415    PASS    PASS
hinge-60-wide     reference                     PASS    6/6     PASS   0.450-0.465    PASS    PASS
hinge-90-tight    reference                     PASS    6/6     PASS   0.250-0.265    PASS    PASS
hinge-captured-45 adversarial-no-cap            FAIL    5/6     PASS   0.400-0.415    PASS    —
hinge-captured-45 reference                     PASS    6/6     PASS   0.400-0.415    PASS    —
piston-bore-30    adversarial-tight-bore        FAIL    5/6     PASS   0.100-0.124    PASS    PASS
piston-bore-30    reference                     PASS    6/6     PASS   0.400-0.425    PASS    PASS
piston-bore-45    reference                     PASS    6/6     PASS   0.250-0.274    PASS    PASS
hinge-45-loose    model-deepseek-v4-flash       PASS    6/6     PASS   0.392-0.407    PASS    PASS
hinge-60-wide     model-deepseek-v4-flash       PASS    6/6     PASS   0.492-0.507    PASS    PASS
hinge-90-tight    model-deepseek-v4-flash       PASS    6/6     PASS   0.247-0.253    PASS    PASS
hinge-captured-45 model-deepseek-v4-flash       PASS    6/6     PASS   0.397-0.403    PASS    —
piston-bore-30    model-deepseek-v4-flash       PASS    6/6     PASS   0.387-0.412    PASS    PASS
piston-bore-45    model-deepseek-v4-flash       PASS    6/6     PASS   0.247-0.253    PASS    PASS
```

`model-*` 行来自 `main` 分支的**已记录模型产物**（`bench/assembly/submissions/*/model-deepseek-v4-flash.scad`，PR #64 的 6 次 DeepSeek v4 flash 输出），在本分支原样复制并重评分；这是**replay**，不是新一轮模型调用。

实测间隙与解析值一致（6.40 mm 内切孔 − 6.00 mm 外接销 = 0.400 mm；10.40 − 10.00 = 0.400 mm），说明测量链没有系统性偏差。

### 这组作弊样例证明了什么

四个 adversarial 各自只打一个点：

| 提交 | 打中的判据 | 结果 |
|---|---|---|
| `adversarial-solid-blob` | 同一实体穿两个名字 | `distinct-exported-parts` FAIL |
| `adversarial-fused-bore` | 有孔的形状但没有孔 | 配合 ERROR + 运动 FAIL |
| `adversarial-tight-bore` | 形状完全正确，只有间隙差 0.35 mm | 仅 `diametral-clearance` FAIL |
| `adversarial-floating` | 两块彼此不接触的实体 | 配合 ERROR |
| `adversarial-static-pose` | 源码声明了位姿参数但不用 | `source-motion` FAIL |
| `adversarial-whole-rotation` | 位姿作用在整机而不是活动件 | `source-motion` FAIL |
| `adversarial-no-cap` | 铰链没有销头，能被直接抽走 | `axial-retention` FAIL |

**`adversarial-floating` 是这组里最重要的一条。** 它的零件数、运动、拆卸全部 PASS，因为它确实不干涉、也确实能抽开——它只是从来没形成过关节。只有配合测量拦住了它。这说明：**任何单一判据都不够，删掉配合测量这个 benchmark 就形同虚设。**

`adversarial-tight-bore` 同样重要：它证明判据能分辨"画出了铰链"和"画出了所要求的铰链"。

## 覆盖度 ≠ 数量

这两件事经常被混为一谈，但成本曲线完全不同：

| 扩什么 | 边际成本 | 得到什么 |
|---|---|---|
| 同家族加 case（换公差/行程） | 1 个 JSON + 1 个 SCAD，约 10 分钟 | 统计自由度，不增加覆盖 |
| 加一个家族（移动副） | 1 个关节类型 + 1 个运动采样分支 | 真正的覆盖增量 |
| 加一个闭环机构（曲柄滑块） | 多关节运动学 + 闭环约束求解 | 覆盖 V8 级别的机构 |
| 加一个自由形状（叶轮、壳体） | 全新判据：曲面相似度、壁厚、流道 | 换一个评测维度 |

所以"100 个 case"和"100 种能力"不是一回事。这个 benchmark 现在有 5 个 case / 2 种能力，它成立的理由是判据，不是行数。

## 层覆盖

每个 case 除了 `status`（交付门槛）还报一个 `cover`：

```
task              submission                status  cover   parts  clearance      motion  disasm
hinge-45-loose    adversarial-floating      ERROR   3/4     PASS   —              PASS    PASS
hinge-45-loose    reference                 PASS    4/4     PASS   0.400-0.415    PASS    PASS
```

`status` 是"这个 case 能不能交付"，`cover` 是"在已经看得到的层里过了几层"。`adversarial-floating` 就是两者分离的例子：3/4 层通过，但没通过的那层正是它作弊的地方，所以 gate 仍然失败。

分母是**本 case 有证据的层数**，未观测的层列在 `report.json` 的 `layers.coverage.unobserved` 里，不进分母也不进分子。完整的层清单、缺口诊断和跨批次报告见 [`bench/README.md`](../README.md)。

## 两个容易做成空壳的检查

这两个层在历史试验里长期是 `NOT_RUN`，补的时候各踩了一个坑。

### `source-motion`：源码自己会不会动

之前的运动检查是**由评测器旋转网格**——这只能证明几何摆在那儿不打架，证明不了模型的源码是参数化的。`source-motion` 改成用任务声明的位姿参数（`hinge_angle` / `piston_stroke`）**重新渲染提交的 SCAD**，再比对。

第一版用质心比对，结果直接失效：铰链的活动件按顶点数算大部分是轴套，质心几乎在轴上，转 45° 只挪 0.42 mm——比容差还小。改成**双向 Hausdorff**：把参考位姿的点集按期望刚体变换过去，量最大最近邻偏差。刚体应该给出 ~1e-6 mm，静止源码给出 ~10 mm。

还有两个防空过：

- 如果声明的位姿根本移动不了这个零件（最大位移 ≤ 容差），判 `NOT_RUN` 而不是通过——否则"会动的源码"和"不会动的源码"测出来一模一样。
- 固定件的哈希在首末位姿之间必须不变，否则说明位姿作用在整机。`adversarial-whole-rotation` 就是这一条。

### `axial-retention`：被挡住才算通过

语义是**拉拔被阻止**，不是"拉得动"。测量方式：组装位姿先确认两件分离，再沿轴平移 2 mm，相交即保持件生效。

这里有个结构性取舍必须写进任务：**保持件和可抽出是互斥的。** 所以 `hinge-captured-45` 没有 `disassembly-path` 要求，schema 也会拒绝同时声明两者的任务——否则就是一个永远无法满足的 case。

`adversarial-no-cap` 是这条检查的存在理由：它零件数对、配合对、运动对、源码能摆位姿，唯独没有销头。没有这一层，"叶片能被直接拽下来"会被判成成功。

## 已知边界（不要过度宣称）

- **样本是网格采样的**，采样点之间的位姿不覆盖。`motion.steps` 和 `disassembly.steps` 决定覆盖面。
- **不是物理真实性证明**：没有打印公差、材料、载荷、疲劳。
- **`disassembly-path` 只证明沿轴平移不干涉**，不证明存在有效的装配顺序（那需要 `rigid-pose-path` 那套更重的序列求解）。
- **单关节、两零件**：每个任务只有一对配合面、一个关节。真实的 V8 是 8 组活塞-连杆、多根轴、闭环运动链——那需要多关节运动学，不是加参数能得到的。
- **`source-motion` 只验证位姿参数下的刚体一致性**，不验证参数是否覆盖了完整行程，也不验证运动是"机构的"还是"每件单独写死角度"的——后者需要多关节约束。
- **`axial-retention` 只测一个拉拔距离**，不测拉脱力、疲劳或锁舌的旋出路径。
- **移动副的行程与拆卸同向**：活塞的行程和抽出都沿 +Z，两条判据在方向上不独立。
- **隐藏集 harness 已有，独立隐藏集仍无**：`bench/assembly/hidden-run.ts` 要求 external-only 路径、frozen task-set hash 和聚合-only 报告，`bench:hidden:freeze` 负责生成 manifest；manifest 的 `family` 支持 assembly/gear/slider/l4/twin/vtwin/declaration/v8/planetary/planetary3，运行器按 family 分派 scorer；但仓库里没有任何独立隐藏任务，dev 副本只验证 harness 行为。
- **模型 baseline 只有 recorded replay**：6 条 DeepSeek v4 flash 产物在本地六任务上 6/6 PASS，但没有新鲜外部模型采样或独立隐藏集结果。
- **与产品代码耦合**：`score.ts` 直接 import `src/lib/assembly/*`。真正的公开发布需要把验证器抽成独立包。
- **`adversarial-*` 只覆盖每个家族的 1 个任务**，其余任务目前只有参考解。

## 变成正式 benchmark 还缺什么

1. 任务集从 6 条扩到 100+，并让**没看过判据的人**写参考解（防止判据被参考解反向调参）。
2. 用已实现的 hidden harness 运行**独立维护者**提供的外部任务集；目前只有 dev 副本，`independentHiddenEvaluation` 仍是 NOT_RUN。
3. 跑 6–8 个模型 × 多次采样，出新鲜 baseline 表；当前只有 6 条 recorded replay，不能替代新采样。
4. 把 `src/lib/assembly/` 抽成独立包，切断对产品内部模块的依赖。
5. 对抗集扩到 20+ 条并公开——一个能被刷的 benchmark 比没有 benchmark 更伤信誉。

## 文件

| 文件 | 职责 |
|---|---|
| [`bench.ts`](bench.ts) | 任务格式、校验、加载、状态聚合 |
| [`score.ts`](score.ts) | 渲染 → 配合测量 → 运动采样 → 拆卸采样 → 判分 |
| [`run.ts`](run.ts) | CLI、矩阵输出、`--self-check` |
| `tasks/*.json` | 冻结任务集 |
| `submissions/*/*.scad` | 参考解与作弊解 |
| `report.json` | 生成的证据记录（已 gitignore） |

`report.json` 里每条 case 都带 `provenance`（OpenSCAD 版本、后端、平台、运行时间）、`sourceSha256`、逐条 `reason` 和 `unknowns`。这些字段存在的理由和代码里的注释一样：一个不知道方法是什么的分数不是分数。
