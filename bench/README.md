# 装配阶梯：AgentSCAD 的目标 benchmark

这份文档定义的不是"再做一个评测脚本"，而是一个**产品可以对着它进化的目标**。

区别在于：评分型 benchmark 告诉你现在几分；目标型 benchmark 必须让**每一次分数变化都直接指向该修哪个子系统**。前者可以是一个数，后者必须是一个向量。

---

## 1. 现状诊断：指标是布尔的，所以它没有梯度

历史试验记录里的 `measuredCore` 语义是：

```ts
const measured = evidence.filter((item) => item.id !== "intent-preserved");
if (measured.some((item) => item.status !== "PASS")) return { passed: false };
```

这套代码后来在远端被重构掉了（`generation-trial.ts` 已无此导出），所以本 benchmark 把它就地实现为 `deliveryGate()`，**不再 import 被测系统**——一个 import 被测方的 benchmark 会随被测方重构而失效，也就无法给历史打分。

**所有非 intent 证据全 PASS 才算通过。** 这在语义上是对的——交付就要全过。但把它当作唯一进度指标，会产生一个致命后果：

| 候选 | 非 intent 证据 | measuredCore |
|---|---|---|
| 14/15 PASS，1 项 NOT_RUN | 差一项 | **0** |
| 0/15 PASS，渲染就失败 | 全失败 | **0** |

两者得分相同。于是连续多轮试验的摘要是"measured-core 仍为 0"，而真实进展不可见。

**实测数据**（`.agentscad/experiments/paid-deepseek-assembly-*/report.json`，35 个批次 / 35 个有证据的任务尝试）：

- `measuredCorePassed === true` 的尝试数：**0**
- 最接近的候选：`aVlhoH / guided-gated-hinge-v1`，非 intent 证据 **14 PASS / 1 NOT_RUN（`unresolved-axial-retention`）**
- 按层归并后的层覆盖率分布：1.0、0.875、0.625、0.625、0.556、0.5、0.444 …

> 边界：这 35 次尝试跨越多套任务集，提示、解析器和判据在期间改过版本，**不能当作同条件可比序列**。这里只用来说明"二值指标丢失了排序信息"，不构成任何成功率结论。

关键结论：**产品已经能产出 14/15 的候选，但指标告诉你还是 0。** 一个恒为 0 的指标不是严格，是没有信息量。

---

## 2. 设计

### 2.1 两个量，不是一个

| 量 | 定义 | 用途 |
|---|---|---|
| **gate** | 所有 required 层 PASS（= 现在的 measuredCore） | 交付判定。不过就是不能交给用户 |
| **coverage** | 通过层数 / 已测层数 | 进度指标。这才是驱动进化的那个数 |

gate 保留不动，它守的是正确性。coverage 是新增的，它守的是"有没有在进步"。

**`NOT_RUN` 永远不计入 PASS。** 没测就是没测，覆盖率不因未测而膨胀——分母是已测层数，未测层单独列出。

### 2.2 任务阶梯

对齐 [FUNCTIONAL_ASSEMBLY_PLAN.md](../docs/FUNCTIONAL_ASSEMBLY_PLAN.md) 的里程碑，不另起一套：

| 级 | 任务 | 机制复杂度 | 对应里程碑 | 现状 |
|---|---|---|---|---|
| L1 | 两件转动副（铰链，松/紧） | 1 关节、2 零件 | M3 | `bench/assembly` 已有 |
| L2 | 两件移动副（活塞-缸筒） | 1 关节、2 零件 | M3 | `bench/assembly` 已有 |
| L2.5 | 外啮合齿轮对（12/24 齿） | 1 传动副、2 零件 | M5 / A10 | `bench/gear` 已有 |
| L3 | 单缸曲柄滑块（4 件基础夹具） | 4 关节闭环、4 零件 | M4 | `bench/slider` 已有；6 件保持版本属 A08 |
| L3.5 | 带偏心保持键的滑块（5 件） | 4 关节 + 保持键、5 零件 | M4 | `bench/slider` keyed 已有；6 件导向版本属 A08 |
| L4 | 带保持件的多关节 | 4 关节、7 零件 / 9 实例 | M4 | 有原创夹具，A001 已 PASS（研究者辅助） |
| L5 | V8 横截面（两缸）→ 完整 V8 | 8 组运动链 | M6 | 未开始 |

**阶梯的意义**：L5 过不去不代表 L3 不存在。有了分级，即使整体停在 L3，分数也能告诉你卡在哪一层。

齿轮对是阶梯上的独立家族：它不测孔轴配合或插拔，而测实际重渲染的齿数、节圆估计、中心距与转向比值；命令和边界见 [`gear/README.md`](gear/README.md)。单缸曲柄滑块也独立成 [`slider/README.md`](slider/README.md)：五个输入角、真实重渲染的四件、圆周/杆长/轴漂移/全件碰撞。

### 2.3 层判据

每层是 `PASS | FAIL | ERROR | SKIP | NOT_RUN` 之一。层内取**最坏**状态：一个 PASS 旁边放一个 FAIL 不会变成 PASS。

| 层 | 证据 id | 掉分时该修什么 |
|---|---|---|
| `compile` | `compile` | SCAD 编译 |
| `parts-identity` | `distinct-exported-parts`、`measured-part-identity` | 选择器、分件策略 |
| `topology` | `part-connectivity` | 布尔运算、壁厚、连通性 |
| `joint-frames` | `measured-joint-frames` | 轴线声明、坐标变换 |
| `fit` | `diametral-clearance` | 孔轴尺寸、公差 |
| `retention` | `axial-retention`、`unresolved-axial-retention` | 保持件与锁舌 |
| `assembly-path` | `assembly-path` | 插入路径、避让 |
| `disassembly-path` | `disassembly-path` | 拆卸顺序 |
| `rigid-motion` | `rigid-motion`、`sampled-motion`、`motion-range-deg`、`motion-range-negative-end`、`motion-range-positive-end` | 运动学、碰撞 |
| `source-motion` | `source-motion` | SCAD 参数化、位姿选择器 |
| `reconstruction` | `assembly-reconstruction` | 导出与重装、预算 |

**层不是存储分类法的镜像。** 产品在 `verification-types.ts` 里另有 12 个存储层；这里每层存在的唯一理由是**它有一个别人没有的修复目标**。所以三个证据 id 故意不归层：`intent-preserved`（产品自述无独立审计）、`declared-connection-type` 与 `declared-translation-probes`（声明前置条件，失败时下游全是 `NOT_RUN`，已经反映过了）、`repair-preservation`（属于修复轴，不属于被评的几何）。未归层的 id 会在报告里列出来，不会静默丢弃。

### 2.4 缺口类型：测不出来 ≠ 做不出来

这张表比覆盖率重要。同一层连续掉分，原因可能是模型做不出来，也可能是**根本没有检查**——把两者混为一谈，路线图就会去修错的东西。

| 诊断 | 判据 | 该做什么 |
|---|---|---|
| `healthy` | 通过率 ≥ 75% | 不动 |
| `capability-gap` | FAIL 占多数 | 修生成 |
| `measurement-gap` | `NOT_RUN` 压过 PASS+FAIL | 补检查 |
| `undetermined` | `ERROR` 压过 PASS+FAIL | **去读 finding 原文** |
| `unobserved` | 完全没有证据 | 接检查 |

`ERROR` 故意不并入任何一边。实测中同一个 `diametral-clearance: ERROR` 既可能是「the bore could not be measured: 1015 rays missed the solid」（模型没做出孔，属能力缺口），也可能是「reconstruction budget 15000 ms 耗尽」（属工具缺口），状态本身分不出来。硬猜会误导。

### 2.5 双轴

产品不是一个单次生成器，是一个 `生成 → 验证 → 修复` 的循环。只测一次生成，奖励的是基础模型；测修复，奖励的才是 harness。

| 轴 | 测什么 | 数据来源 |
|---|---|---|
| **A：一次生成** | `coverage` 是多少 | 首次尝试的层覆盖率 |
| **B：证据驱动修复** | 给失败层和实测数字，修几轮、花多少、涨几层 | `attempts`、`calls`、每轮的 coverage 增量 |

B 轴的关键指标不是"最后过没过"，而是**每元人民币买到的层覆盖率增量**。你的试验记录里已经有 `calls` 和费用，这一栏现在就能算。

一个 harness 变好，应该在 A 轴上持平、在 B 轴上变陡。

---

## 3. 为什么不能拿"V8 全过"当唯一目标

三条理由，都来自实测：

1. **它是 0 或 1，而现在是长期的 0。** 35 次尝试 0 通过。一个永远读 0 的指标无法区分任何两次改动的优劣。
2. **它把已经发生的进展藏起来了。** 最好的候选是 14/15，指标报 0。
3. **它不告诉你去哪。** "V8 失败"不指向任何子系统；"joint-frames 42%、assembly-path 8%"指向得很清楚。

V8 仍然是**终点**，只是不能是**刻度**。

---

## 4. 现在能跑什么

```bash
bun run bench:ladder          # 给历史试验报告打分（不调模型、不渲染、零花费）
bun run bench:ladder --json out.json
bun run bench:assembly:check  # 几何评测自检：参考解全过、作弊解全被拦
bun test bench/               # 层模型与任务格式的单测
```

2026-11-18 在 `continue/local-assembly-2026-11-18` 复跑：`SELF-CHECK OK: 6 reference(s) pass, 8 adversarial submission(s) rejected.` 这只证明公开自检未退化，不证明隐藏集、模型能力或物理功能。

### 4.1 已记录模型 baseline（replay）

`bench/assembly` 现在有 6 条 `model-deepseek-v4-flash` 提交，原样取自 `main` 的 PR #64 记录；在本分支重评分：

| task | status | cover | measured clearance |
|---|---|---|---|
| `hinge-45-loose` | PASS | 6/6 | 0.392–0.407 |
| `hinge-60-wide` | PASS | 6/6 | 0.492–0.507 |
| `hinge-90-tight` | PASS | 6/6 | 0.247–0.253 |
| `hinge-captured-45` | PASS | 6/6 | 0.397–0.403 |
| `piston-bore-30` | PASS | 6/6 | 0.387–0.412 |
| `piston-bore-45` | PASS | 6/6 | 0.247–0.253 |

这 6 条全部通过公开任务，和原记录的 6/6 一致。**边界**：它是已记录产物的 **replay**，不是新的外部模型调用；没有新花费，也没有独立隐藏集。原 run 的 0.391 CNY 与英文提示/输出契约属于 `main` 的记录，不能当作本分支的新测量。6/6 也说明这组公开任务对该模型已经饱和，不能用来区分模型能力。

### 4.2 隐藏集 harness

`bench/assembly/hidden-run.ts` 提供 external hidden split 的运行器，但**仓库里没有任何隐藏任务**。隐藏集必须放在仓库之外：

```
<outside-repo>/hidden.json
<outside-repo>/tasks/*.json
<outside-repo>/submissions/<task-id>/*.scad
```

`hidden.json` 声明 `id`、`frozenAt`、`maintainer`、`independent` 和 `taskSetSha256`。运行器会：

- 拒绝仓库内路径（即使是 gitignored 的目录）；
- 从 validated task 定义重算 SHA-256，与 manifest 不符就拒绝；
- 只写聚合报告：task ID、case 计数、layer 计数；**不复制 prompt、源码、sourcePath 或逐案测量**；
- `independent: false` 时 `independentHiddenEvaluation = NOT_RUN`；`--require-independent` 以退出码 2 失败；
- `independent: true` 也只记为 `DECLARED_NOT_VERIFIED`：harness 能验证路径和哈希，不能验证谁编写/扣留了任务。

```bash
bun run bench:hidden -- --hidden /outside/repo/hidden --json /outside/repo/report.json --self-check
```

开发冒烟（一个公开任务加一条反例的副本，manifest `independent:false`）：`1 task / 2 case`，1 reference PASS、1 adversarial rejected，`independentHiddenEvaluation=NOT_RUN`；加 `--require-independent` 退出 2。这次运行只证明路径、哈希、聚合和 fail-closed，不证明独立隐藏评估。

### 实测：35 个真实批次 / 55 个候选

```
层                 通过    失败    错误    未跑    缺证    通过率   缺口类型    修什么
compile           0     1     0     0     29    0.0%    做不出来    SCAD 编译
parts-identity    26    3     0     1     0     86.7%   正常        选择器与分件策略
topology          16    5     0     6     3     59.3%   做不出来    布尔运算、壁厚、连通性
joint-frames      8     0     20    0     2     28.6%   待查 ERROR  轴线声明与坐标变换
fit               8     0     20    2     0     26.7%   待查 ERROR  孔轴尺寸与公差
retention         0     3     0     23    4     0.0%    缺检查      保持件与锁舌
assembly-path     3     19    1     3     4     11.5%   做不出来    插入路径与避让
disassembly-path  3     22    3     1     1     10.3%   做不出来    拆卸顺序
rigid-motion      1     23    1     5     0     3.3%    做不出来    运动学与碰撞
source-motion     0     3     0     16    11    0.0%    缺检查      SCAD 参数化与位姿选择器
reconstruction    8     2     5     13    2     28.6%   缺检查      导出重装与预算
```

这张表读出来的结论，和"模型不行"完全不是一回事：

- **`parts-identity` 86.7% 已经基本解决**，继续往这里投入是浪费。
- **`rigid-motion` 3.3%、`assembly-path` 11.5%、`disassembly-path` 10.3% 是真能力缺口**，且它们在阶梯上的位置靠后——这正是当前该攻的地方。
- **`retention` 和 `source-motion` 是 0% 但 `NOT_RUN` 占绝对多数**：不是模型做不到，是**没有测量**。在这两层上谈模型能力是伪命题。
- **`joint-frames` / `fit` 的 20 次 ERROR 需要逐条读 finding** 才能归类，所以标为「待查」，不猜。

最好的真实候选：`guided-gated-hinge-v1`，**8/9 层通过**，gate 未过（唯一缺口是 `retention: NOT_RUN`）。这就是那个被 "measured-core = 0" 藏起来的进展。

注意这张表用的是**产品试验记录**，而 `bench/assembly` 是另一条链。benchmark 能测 `retention` 和 `source-motion`，而且判分器现在已经产出这两类证据（见 §5）；但这张表是接线前的记录，不会回溯变成 PASS。要观察变化，必须用同一任务集重新跑 trial，并保留新记录。**让指标变好的是接线，不是文档。**

> 这 35 个批次横跨 12 个任务集版本，提示与判据期间都改过，**只能看形状，不能比高低**。报告里会自动带这条警告。

## 5. 落地顺序

- [x] **layer scorer**：`bench/layers.ts` + `bench/ladder-report.ts`，跑在已有批次上
- [x] **`bench/assembly` 接层计数**：每个 case 报告 `cover 4/4`，与 trial 共用同一个 `scoreEvidence`
- [x] **齿轮对家族**：`bench/gear` 已有 12/24 外啮合任务、reference 与 5 条反例；`bun run bench:gear:check` → `SELF-CHECK OK: 1 reference(s) pass, 5 adversarial submission(s) rejected`。它只测有限输入角的齿数/节圆/中心距/转向比值，不测齿面接触、侧隙或承载
- [x] **L3 基础曲柄滑块家族**：`bench/slider` 已有 4 件夹具（曲柄半径 8 mm、杆长 28 mm、5 个输入角）；`bun run bench:slider --task slider-crank-8-28 --self-check` → `SELF-CHECK OK: 1 reference(s) pass, 7 adversarial submission(s) rejected`。只覆盖列出的角度和 4 件基础夹具；6 件保持/导向版本（A08）仍属产品工作
- [x] **L3.5 五件保持键滑块**：`bench/slider` 的 `slider-crank-keyed-8-28` 增加偏心键、正确/错误拆卸计划和 `disassembly-path` 断言；`bun run bench:slider --task slider-crank-keyed-8-28 --self-check` → `SELF-CHECK OK: 1 reference(s) pass, 4 adversarial submission(s) rejected`。`adversarial-key-out-of-way` 只让错误顺序不再被挡住，运动/轮廓仍 PASS，评分器单独拒绝该层；6 件导向/保持版本（A08）仍属产品工作；`bun run bench:slider:check` 同时跑基础与 keyed 任务 → `SELF-CHECK OK: 2 reference(s) pass, 11 adversarial submission(s) rejected`
- [x] **补 `retention` 与 `source-motion` 的检查**：`bench/assembly` 里已落地（`hinge-captured-45` 的轴向拉拔、5 个任务的位姿重渲染）
- [x] **把这两个检查接进产品判分器**：`judge-assembly` 现在把派生合同作为 trial attribution gate 传给 `prepareAssembly`，并产出 `rigid-motion`、`source-motion`、`motion-range-*`、`axial-retention`、`assembly-path`、`disassembly-path`。前提是候选声明包含 `motions[].sourceInput`（参数 + 每个实例的 pose selector）和 `translationProbes`；缺声明仍为 `NOT_RUN`。`intent-preserved` 仍为 `NOT_RUN`，`passed` 不是用户确认或验收。证据：`bun test scripts/eval/judge-evidence.test.ts` 7 PASS；`bun test src/lib/tools/__tests__/pipeline-assembly.openscad.test.ts` 5 PASS（原生 OpenSCAD，研究者辅助控制件在 measured assertions 上 PASS，intent 保持 NOT_RUN）；定向判分脚本对同一控制件输出 `sampled-motion`/`rigid-motion`/`source-motion`/`axial-retention`/`assembly-path`/`disassembly-path` PASS。历史层表不因接线回溯。
- [x] **已记录模型 baseline replay**：6 条 DeepSeek v4 flash 产物原样导入并重评分，6/6 PASS；见 §4.1。这是 replay，不是新调用
- [x] **隐藏集 harness**：external-only 路径、frozen task-set hash、聚合-only 报告和 `--require-independent` fail-closed 已实现，并用 dev 副本冒烟；见 §4.2。**没有**任何独立隐藏任务
- [ ] **独立隐藏集 + 新鲜外部模型 baseline**：隐藏任务维护者、unpublished split 和至少一次新模型采样仍未发生；当前 `bench/assembly` 任务集与参考解都在仓库里
- [ ] **L5 两缸横截面**（2–3 周）：验证阶梯能延伸到 V8 而不重写判据

## 6. 防退化

- **隐藏集**：公开任务集用于开发，隐藏集用于报告。只公开后者不及格的样本，防止针对性修补。
- **对抗集**：每个家族至少 1 条"形状对、数值错"和 1 条"全对但不形成关节"。`bench/assembly` 里已有 4 条，这是最便宜也最有效的防线。
- **判据不改追溯**：阈值在测量后不得回调；需要新阈值时新增版本并保留旧版回归（这条你已经在 [ASSEMBLY_EVIDENCE_LOG.md](../docs/ASSEMBLY_EVIDENCE_LOG.md) 里立了规矩）。
- **coverage 不能靠删层涨**：分母冻结在任务定义里，任务版本变更必须留档。

## 7. 这份设计不承诺什么

- 不承诺 V8 能自主生成。当前自主 gate 通过数是 0。
- 不承诺覆盖率等于产品质量。coverage 只覆盖**已实现的判据**，未实现的层不是"通过"，是"不在分母里"。
- 不承诺跨批次可比。任务集、提示和判据都在演进，历史数字只能看形状，不能看高低。
