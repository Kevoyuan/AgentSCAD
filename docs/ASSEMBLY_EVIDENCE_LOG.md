# 装配证据日志

## 2026-10-29 · 合同快照绑定增量

`prepareAssembly` 新增可选 `contractSnapshot`，渲染前校验并复制合同，在报告保存语义哈希、修订号、请求哈希和请求匹配结果。请求按现有抽取规则去除首尾空白后比较。请求不匹配时，即使调用方传入 `evidenceCurrent: true`，通过结论仍降级为 NOT_RUN。绑定本身不证明用户确认，也不证明传入的配合阈值来自该合同。试验判定入口已传入派生合同快照。

本轮验证：全量单元测试 809 PASS / 3 SKIP / 0 FAIL；类型检查通过；最终局部测试 19 PASS / 0 FAIL。新增反例验证错误请求覆盖调用方的有效声明，并验证渲染期间修改原合同不会改写报告所绑定的版本。尚未接通所有生产调用方；未传快照时 binding 为 null，不能宣称已完成生产端证据追溯。

本文件只记录**已执行**的实验、绑定到具体输入的结果，以及仍然未执行的项目。它不是计划，也不把计划当成结果。
计划与目标见 [`FUNCTIONAL_ASSEMBLY_PLAN.md`](./FUNCTIONAL_ASSEMBLY_PLAN.md)。

记录规则：

- 每条记录必须写明输入（源码、声明、合同版本）、方法、工具、覆盖范围和原始数值。
- `PASS` 只覆盖该条断言在该方法、该覆盖范围内的结论。
- 未执行的层写 `NOT_RUN`，不写“基本可用”。
- 阈值在测量后不得回调；需要新阈值时新增合同版本并保留旧版回归。

---

## 2026-10-29 · E2：铰链实际几何配合测量

### 输入

| 项目 | 值 |
|---|---|
| 样例源码 | `benchmarks/assembly/axial_hinge.scad`（原创，两件式可抽离铰链） |
| 装配声明 | `scripts/eval/assembly-fixtures/axial-hinge.spec.json` |
| 合同 v1 | `scripts/eval/assembly-fixtures/hinge-contract.json`（直径间隙 0.1–0.3 mm） |
| 合同 v2 | `scripts/eval/assembly-fixtures/hinge-contract-v2.json`（直径间隙 0.35–0.45 mm） |
| 渲染器 | 本机 OpenSCAD，`$fn = 64`，逐件选择器 `fixed` / `moving` |
| 测量工具 | `src/lib/geometry/stl-mesh.ts`、`src/lib/geometry/cylindrical-feature.ts`、`src/lib/assembly/fit-measurement.ts` |
| 入口 | `bun run cad:eval:fit` |

### 方法

1. 对每个零件沿声明轴线取 3 个轴向截面（重叠区 20% / 50% / 80%，即 z = 3 / 6 / 9 mm）。
2. 每个截面用 1440 条射线从种子轴向外求最近交点，得到径向轮廓。
3. 用一次谐波迭代把种子中心修正到实测中心（残差 ≤ 1e-6 mm）。
4. 由内切/外接半径比反解多边形边数，再用理想正多边形残差判定该截面是否真的是圆柱面；椭圆、台阶、锥度会被拒绝，而不是给出一个看似合理的直径。
5. 圆柱面是离散多边形，因此直径是一个区间：内切直径（一定能通过的最大销）与外接直径（一定能容纳的最小孔）。
6. 配合间隙 = [孔内切 − 轴外接, 孔外接 − 轴内切]。

测量值不包含打印公差；打印公差属于实物层，不能折进网格测量。

### 实测结果

| 项目 | 实测值 |
|---|---|
| 孔（活动叶片）直径 | 6.400002 – 6.407718 mm，64 边形，形状残差 9.7e-7 mm |
| 轴（固定叶片）直径 | 5.992775 – 6.000000 mm，64 边形 |
| 直径间隙区间 | **0.400002 – 0.414944 mm** |
| 实测轴线相对声明轴线偏移 | 0.000 mm（三个截面均为 0） |
| 孔轴与轴轴夹角 | 0.000° |
| 两轴横向偏移 | 0.000 mm |

### 合同比较

| 合同 | 区间 | 结果 | 原因 |
|---|---|---|---|
| v1 | 0.1–0.3 mm | **FAIL** | 实测 0.400–0.415 mm 整体在区间之外 |
| v2 | 0.35–0.45 mm | PASS | 实测区间整体在区间之内 |

这正是计划 P1 预判的冲突：样例按“名义直径间隙 0.4 mm”设计，而 v1 合同写的是 0.1–0.3 mm。**没有修改 v1 的阈值**；v2 是新增的、明确标注为“按设计值记录”的回归合同，用于防止后续改动悄悄改变配合。v1 仍然对当前样例失败，并有测试锁住这一点。

v2 合同整体门仍然不通过：`intent-preserved`、`distinct-exported-parts`、`disassembly-path`、`sampled-motion`、`physical-assembly` 均无观测，保持 `NOT_RUN`。

### 这条证据证明了什么

- 实际渲染出的两个零件中，孔是一个 64 边形柱面，内切直径 6.400 mm、外接直径 6.408 mm；轴是一个 64 边形柱面，直径 5.993–6.000 mm。
- 声明轴线确实穿过实测孔/轴中心，偏差在 1e-6 mm 量级（这是对“声明位置”的检验，不是对身份的检验）。
- 在上述方法和采样点上，直径间隙是 0.400–0.415 mm，与 v1 合同不符。

### 这条证据不能证明什么

- 不能证明这两个网格就是用户想要的零件；选择器身份仍未测量。
- 不能证明打印后仍是这个尺寸；FDM 收缩、挤出宽度、装配公差都未测量。
- 不能证明能装、能拆、能转；插拔路径、整个 −45°…+45° 区间的运动与碰撞都未执行。
- 不能证明“孔”这个角色判断正确；角色由调用方声明，网格本身无法区分孔与轴（错误声明会得到负间隙并失败，但这只是间接检查）。
- 只覆盖 3 个轴向截面；其他高度未测量。
- 不覆盖同轴度、圆柱度、表面粗糙度、圆角与倒角。

### 复现

```bash
bun run cad:eval:fit benchmarks/assembly/axial_hinge.scad \
  --spec scripts/eval/assembly-fixtures/axial-hinge.spec.json \
  --connection hinge --bore-instance moving-instance \
  --min 0.35 --max 0.45

bun run test:openscad   # 含上述测量的自动断言
```

---

## 2026-10-29 · E0/E1：基线与反例

| 实验 | 结果 | 证据位置 |
|---|---|---|
| 全量单元测试（注入 trimesh 环境） | 661 pass / 0 fail | 本次运行 |
| 原生 OpenSCAD 集成测试 | 5 pass / 0 fail | `bun run test:openscad` |
| 选择器被忽略 | 两个选择器得到同一网格 → `identity: FAIL`，不产出零件包 | `assembly-hinge.openscad.test.ts`、`assembly-bundle.test.ts` |
| 合法重复实例 | 同一零件定义复用多次仍计为多个实例，不误判为重复零件 | `prepare-assembly.test.ts` |
| 声明修订 | 只追加，保留最近 20 条；保存冲突返回 409 | `assembly-route.test.ts` |
| 净化器破坏内嵌声明 | 已修复（先掩码注释与字符串再替换） | `preservation.test.ts` |

以上只证明这些断言在对应输入上成立，不证明真实模型生成会遵守装配协议。

---

## 仍未执行（按计划顺序）

| 项 | 状态 | 阻塞原因 |
|---|---|---|
| 需求合同（M1） | 未实现 | 需要结构化捕获中英文功能意图并冻结 |
| 插拔路径与净空（M3） | NOT_RUN | 需要路径采样与窄相碰撞 |
| 全角度区间运动与碰撞（M3） | NOT_RUN | 需要多姿态实际求值与碰撞检测 |
| 错误驱动的修复闭环（M3） | NOT_RUN | 需要把实测失败反馈给修复器并验证不丢件 |
| 单缸曲柄连杆（M4） | 未开始 | 依赖 M3 的通用工具 |
| 螺纹/齿轮（M5）、V8（M6） | 未开始 | 依赖 M3/M4 |
| 实物打印与装拆（M7） | NOT_RUN | 需要预算、材料与独立测试人员 |
| 真实模型生成成功率（E4） | NOT_RUN | 需要付费调用预算与冻结任务集 |

---

## 2026-10-29 · M1：需求合同（第一步）

### 做了什么

把"用户说了什么"冻结成机器可读、可追溯到原句的必需断言，与"模型声明了什么"（`AssemblySpec`）、"工具测到了什么"（`Observation`）分开。

| 文件 | 作用 |
|---|---|
| `src/lib/requirements/requirement-contract.ts` | schema（意图、目标层级、断言、未知项、假设）、规范化哈希、范围过滤、过期判定 |
| `src/lib/requirements/extract-requirements.ts` | 中英文确定性抽取；只把明确陈述变成断言，其余变成待回答问题 |
| `src/lib/requirements/contract-bridge.ts` | 合同 → 六层断言；合同 → `fitRequirements` |
| `src/app/api/jobs/[id]/requirements/route.ts` | 从 `inputRequest` 派生，只读，`confirmed: false` |

### 抽取规则（可审计，不含模型调用）

- **意图**：多缸 > 曲柄连杆 > 齿轮 > 螺纹 > 铰链 > 装配 > 单件，按特异性优先。
- **数量**：`两个零件` / `两件式` / `two-part` → `distinct-exported-parts`；`八个活塞` 不算零件数，只记为未知。
- **可拆**：`可拆/拆卸/抽离/removable/detachable` → `disassembly-path`；`不可拆/non-removable` 取反。
- **运动**：`±45°` / `-45 到 45 度` → `motion-range-deg`；只说"能转"则只要求运动，范围记为未知。
- **间隙**：`0.1 到 0.3 mm` / `0.2±0.05 mm` → 区间断言；只给单值或"小一点" → 未知，**不生成断言**。
- **单位**：出现英寸 → 未知（要求换算确认），不静默换算。
- **工艺/材料**：只记录，不生成数字断言；打印类请求追加"方向/机器/切片参数未给出"。
- **机构缺口**：铰链 → 轴向保持方式；螺纹 → 螺距/旋向；齿轮 → 模数/齿数/压力角；多缸 → 缸数/V 角/曲柄相位。

每条非默认断言都带 `statement`（原句子串），可逐条回查；哈希覆盖语义而不含捕获时间，因此同一请求总是得到同一个合同哈希。

### 端到端结果（真实 OpenSCAD）

请求："做一个两件式铰链，直径间隙 0.35 到 0.45 mm，能转 ±45°，可拆，3D 打印"

| 步骤 | 结果 |
|---|---|
| 合同派生 | 意图 `revolute-hinge`；断言含 parts=2、clearance 0.35–0.45、disassembly、motion、motion-range −45…45 |
| 声明读取 | `boreInstanceId: moving-instance`（本轮新增可选字段） |
| 合同 → 配合要求 | 自动取到 `hinge` 连接与孔侧实例，无需调用方猜角色 |
| 实测 | 直径间隙 0.400–0.415 mm → **assembly: PASS** |
| 运动 | **NOT_RUN**：同一请求要求的运动与拆装仍未测量 |

### 这条证据证明了什么

- 自然语言里的数量、可拆、角度范围、间隙区间可以被稳定抽取成断言，且能驱动真实测量得到 PASS/FAIL。
- 不可量化的愿望不会变成数字：只给单值或模糊描述时，合同里没有断言，只有问题。

### 这条证据不能证明什么

- 抽取规则只覆盖当前写死的模式；未见过的新表述会落回"单件 + 未知"，不会误判为已满足。
- 合同**未持久化**、**未经用户确认**；`confirmed: false`，因此不能拿它宣称需求已冻结。
- 没有 UI：用户仍看不到断言列表，也无法逐条确认或修改。
- 修复闭环、插拔路径、运动测量仍未实现，整体门不可能通过。
- 抽取器是规则系统，不是语义理解；同义词遗漏会导致断言缺失（表现为门不通过，而不是假通过）。

### 验证

`687 pass / 0 fail`（112 文件）、`test:openscad 6 pass / 0 fail`、`eslint .`、`tsc --noEmit`、`git diff --check` 全通过。

---

## 2026-10-29 · M1：合同持久化、确认与门禁（第二步）

### 做了什么

把上一步"只读、未确认"的合同变成**可确认、可编辑、可审计、过期可判定**的记录，并让未确认的合同无法产出 PASS。

| 文件 | 作用 |
|---|---|
| `src/lib/requirements/requirement-contract.ts` | 新增 `normalizeConfirmedContract`（确认规则）与 `RequirementContractError` |
| `src/lib/requirements/requirement-contract-record.ts` | `JobVersion` 当前指针 + 只追加修订（上限 20）；读取、确认、历史 |
| `src/app/api/jobs/[id]/requirements/route.ts` | GET 返回合同与 stale 状态；PUT 确认/编辑，乐观并发 |
| `src/lib/assembly/prepare-assembly.ts` | `contractGate`：未确认时把所有 PASS 降级为 NOT_RUN，FAIL/ERROR 不动 |
| `src/lib/assembly/assembly-bundle.ts` | README 写明合同状态；修掉一处会把降级后的 identity 重新写成 PASS 的覆盖 |
| `src/components/cad/workspace/RequirementContract.tsx` | 断言列表、未知项、豁免勾选、层级切换、确认按钮 |

### 确认时强制执行的规则

确认是合同变成约束的那一刻，也是最容易被无意削弱的一刻，因此三条规则在服务端执行、不由客户端声明：

1. **必需断言不能消失**。删掉一条会被拒绝；只能保留该条并置 `required: false` / `applicable: false`，即**记录豁免**而不是抹去要求。
2. **来源重新计算，不信任客户端**。与重新派生结果不同的条目一律标为 `confirmed`（人改的）；请求里没说过的话永远不能标成 `request`。
3. **层不可改**。层决定哪类证据有资格判定该条；把 `physical` 改成 `assembly` 会降低门槛却不改变任何可见数字。

另外：合同只能存到它派生自的请求文本上（服务端比对 `requestSha256`），因此不能替用户没写过的文字确认合同。

### 状态与并发

| 场景 | `confirmed` | `stale` | `evidenceCurrent` |
|---|---|---|---|
| 从未确认 | false | false | false |
| 已确认、请求未变 | true | false | true |
| 已确认、请求已改 | false | true | false（附 `previousContract` 供比对） |
| 存储行不可读 | false | false | false（可再次确认覆盖，修订记录 `replacedUnreadable: true`） |

`expectedContractSha256` 比较的是**已存储确认**的哈希，而不是当前生效合同的哈希；两者在 stale 时不同，客户端回传 `confirmedContractSha256` 才不会误覆盖别处的确认。

### 门禁行为（实测）

同一份真实测量（0.400–0.415 mm，合同 0.35–0.45）：

| 合同状态 | `evidence.assembly` | `fits[0].measuredStatus` |
|---|---|---|
| `evidenceCurrent: true` | **PASS** | PASS |
| `evidenceCurrent: false` | **NOT_RUN** | PASS（数字保留） |
| 未传 `contractGate` | PASS | PASS，`contract.evidenceCurrent: null` |

降级是单向的：只把 PASS 变成 NOT_RUN，从不把 FAIL/ERROR 变轻，也从不把 NOT_RUN 变成 PASS。未传门禁时记 `null` 而不是 `false`——"没问过"和"没通过"不是一回事。

### 这条证据证明了什么

- 需求合同可以被用户确认、编辑、豁免，并留下只追加的修订历史；请求改动后旧合同自动失效。
- 未确认的合同**无法**产出 PASS，即使测量本身通过；测量数字与判定分离，数字不丢。
- 并发确认会冲突而不是静默覆盖。

### 这条证据不能证明什么

- 确认只说明"要按什么判定"，不证明任何东西可用；拆装、运动仍未测量。
- 抽取仍是规则系统，同义词遗漏会让断言缺失（表现为门不通过）。
- `contractGate` 由调用方传入，本层不校验调用方是否真的查过记录；真正的绑定要等修复闭环把合同哈希写进证据。
- UI 只覆盖确认/豁免/层级，不覆盖逐条改数值。

### 验证

`712 pass / 0 fail`（114 文件）、`test:openscad 6 pass / 0 fail`、`eslint .`、`tsc --noEmit`、`git diff --check` 全通过。

---

## 2026-10-29 · M3：三角相交与 BVH 碰撞（第一步）

### 做了什么

`src/lib/geometry/mesh-collision.ts`：原创三角—三角相交、AABB BVH、位姿变换与包含判定。没有任何第三方 CAD 代码。

| 能力 | 实现 |
|---|---|
| BVH | 按三角形质心做中位数分割，最长轴优先，索引破平局 → 同一网格总是同一棵树 |
| 位姿 | BVH 只在局部坐标建一次；位姿只变换节点包围盒（变换后包围盒的包围盒，恒为超集）与候选三角形顶点 |
| 三角相交 | 平面符号 + 交线区间重叠；共面走 2D 分离轴（6 条边法线） |
| 包含判定 | 射线奇偶（Möller–Trumbore），5 个不共面的方向，模糊票丢弃，清晰票少于 2 或相互矛盾 → `UNKNOWN` |
| 预算 | `maxPairTests` 用尽 → `UNKNOWN` + `budgetExhausted`，**不**报 SEPARATED |

### 三种状态与 blocked

| 状态 | 含义 | `blocked` |
|---|---|---|
| `INTERSECT` | 找到一对相交三角形，附三角形编号与交点 | true |
| `CONTAINED` | 表面不相交，但一个网格整体落在另一个实体内部（模型没开孔） | true |
| `SEPARATED` | 所有重叠节点对都已检查，无相交且互不包含 | false |
| `UNKNOWN` | 预算耗尽或探针无法判定 | **true**（未知不当安全） |

`CONTAINED` 是这一步最有价值的部分：只做表面相交会漏掉"轴嵌在实体里、孔根本没打穿"这种最典型的失败，并给出假 SEPARATED。

### 真实网格结果（原创两件式铰链）

| 场景 | 三角形 | 状态 | 检查的三角形对 | 耗时 |
|---|---|---|---|---|
| 声明位姿（间隙 0.400–0.415 mm） | 272 / 536 | **SEPARATED** | 20 983 | 14.4 ms |
| 活动叶片沿 y 平移 0.1 mm（< 0.200 mm 径向间隙） | 同上 | SEPARATED | 21 239 | 61.6 ms |
| 平移 0.25 mm（> 0.200 mm 径向间隙） | 同上 | **INTERSECT** | 4 884 | 11.8 ms |
| 平移 0.5 / 1.0 mm | 同上 | INTERSECT | 833 / 24 | < 1 ms |

碰撞阈值与实测间隙在同一处翻转（0.1 通过、0.25 干涉），两个独立方法互相印证；测试里用的是 `clearanceMm.min / 2` 而不是写死的数字，所以改了模型会一起变。

### 这条证据证明了什么

- 包围盒重叠不会被当成碰撞：BVH 只做剪枝，结论必须由三角形相交给出。
- 预算耗尽是 `UNKNOWN`，不会被当成"没碰撞"。
- 表面不相交但整体嵌入会被识别为 `CONTAINED`。
- 碰撞判定的翻转点与实测间隙一致（0.1 mm 通过 / 0.25 mm 干涉）。

### 这条证据不能证明什么

- **接触与穿透不可区分**：面贴面、零间隙接触都报 `INTERSECT`。要允许接触必须由调用方显式声明，不能靠阈值猜。
- **只测单一姿态**。插拔路径、全角度运动仍未采样，这是下一步。
- 共面判定用 `epsilonMm` 作为容差；极小特征（< 1 µm）在 float32 STL 里本来就没有意义。
- `CONTAINED` 依赖网格封闭；不封闭网格会得到 `UNKNOWN`（不会得到 SEPARATED）。
- 未在 V8 级网格（十万级三角形）上测过性能。

### 验证

`733 pass / 0 fail`（115 文件）、`test:openscad 6 pass / 0 fail`、`eslint .`、`tsc --noEmit` 全通过。

---

## 2026-10-29 · M3：插拔路径与运动采样（第二步）

### 做了什么

`src/lib/assembly/path-and-motion.ts`：沿关节轴滑出采样 + 按声明范围旋转采样，每一步用上一步的 BVH 碰撞判定。

| 检查 | 覆盖 | 判定 |
|---|---|---|
| `checkDisassemblyPath` | 两个方向（+轴/−轴）各采样 N 个偏移，距离由所有实例沿轴的包围盒跨度推出，不用猜 | 任一方向全程无干涉 → PASS |
| `checkMotionRange` | 声明范围内等距采样 N 个角度（含端点） | 全部无干涉 → PASS |

状态映射是保守的：任一位姿 `INTERSECT`/`CONTAINED` → FAIL（附首次阻挡的偏移/角度与冲突对）；任一位姿 `UNKNOWN` 而其余全清 → **NOT_RUN**，不报 PASS。

### 一处语义修正：`motion-range-deg` 改成下界

"能转 ±45°"是**下限**，不是"运动必须待在 −45…45 区间内"。原来的 `range` 建模会让"转得更多"变成失败，与请求相反。因此：

- 合同新增 `expected.kind: "atLeast"`；`±45°` → `{ kind: "atLeast", min: 45, unit: "deg" }`。
- 比较器对下界用**悲观端**（`value − uncertainty`）比较，不确定度不能买到通过。
- 观测值是"采样到且无干涉的最大 |角度|"，所以声明 ±30° 的模型对 ±45° 的合同会 FAIL，这正是要抓的"模型没做到"。

v1/v2 冻结合同只用 `range`，哈希与判定不受影响。

### 真实铰链结果（原创两件式样例，64 面）

| 检查 | 状态 | 覆盖 | 位姿 | 三角形对 |
|---|---|---|---|---|
| 插拔路径 | **PASS** | 24 个偏移 × 0.696 mm，共 16.000 mm，方向 +z | 24 | 355 694 |
| 运动范围 | **PASS** | 24 个角度 × 3.913°，覆盖 −45°…45° | 24 | 732 153 |
| 合计耗时 | 310 ms | | | |

负例（证明不是空过）：

| 场景 | 结果 |
|---|---|
| 出轴端上方加一块盖板 | 路径仍 PASS，`clearDirection: -1`（另一端能出来）——这是正确答案 |
| 两端各加一块盖板 | **FAIL**，首次阻挡在 1.739 mm，点名 `moving-instance` 与 `cap-instance` |
| 转子样例声明 ±45° | 运动 PASS |
| 同一转子声明 ±180° | **FAIL**，阻挡角度 \|θ\| > 120°（配重在 180° 处） |

### 端到端验收（同一请求跑通 L1–L4）

请求："做一个两件式铰链，直径间隙 0.35 到 0.45 mm，能转 ±45°，可拆，3D 打印"

| 层 | 断言 | 状态 | 依据 |
|---|---|---|---|
| L1 意图 | `intent-preserved` | PASS | 声明意图与确认合同一致（仅声明比较） |
| L2 零件 | `distinct-exported-parts` = 2 | PASS | 两个不同的零件产物哈希 |
| L3 装配 | `diametral-clearance` 0.35–0.45 | PASS | 实测 0.400–0.415 mm |
| L3 装配 | `disassembly-path` | PASS | 16 步滑出无干涉 |
| L4 运动 | `sampled-motion` | PASS | 16 个角度无干涉 |
| L4 运动 | `motion-range-deg` ≥ 45° | PASS | 采样到 45° 且无干涉 |
| L5 实物 | — | NOT_RUN | 未打印、未测试 |

`gate_passed: true`。同一批测量在合同未确认时，装配层与运动层都降级为 NOT_RUN。

### 这条证据证明了什么

- 在**采样的**位姿上，两件式铰链沿轴可抽出、在 ±45° 内可转动、且不与对方干涉。
- 声明范围之外的旋转不会被误判：同一几何在 ±45° PASS、±180° FAIL。
- 路径与运动的 PASS 必须由真实三角相交给出；预算耗尽或探针不确定 → NOT_RUN。
- 自然语言里的"可拆"与"±45°"确实驱动了这两项测量，而不是只驱动间隙。

### 这条证据不能证明什么

- **只在采样点成立**。偏移步长 0.696 mm、角度步长 3.913°，比这更窄的阻挡可能整个落在两个采样之间。覆盖率写在证据里，但覆盖率不等于安全。
- 路径是**沿声明轴的直线**。真实装配可能需要倾斜、旋转或双手操作，都没有建模。
- 运动是几何转动。力矩、摩擦、间隙、自锁、装配顺序、外部轴向保持（样例明确声明需要外部限位）都未建模。
- `allowedContact` 一旦声明，冲突会被记为"容忍"而不是阻挡；数量会写进理由，但这确实是调用方可以放宽的口子。
- `intent-preserved` 的观测是声明比较，不是几何测量；它证明模型保留了意图，不证明意图可制造。

### 验证

`757 pass / 0 fail`（116 文件）、`test:openscad 6 pass / 0 fail`、`eslint .`、`tsc --noEmit` 全通过。

## 2026-10-29 · M4：修复闭环（实测失败 → 修复输入 → 重新测量）

### 做了什么

新增 `src/lib/assembly/repair-findings.ts`：

- `collectAssemblyFindings` 只从**实测过的 FAIL** 生成 finding。没测过的层（`NOT_RUN`）不产生 finding——修一个猜测比不修更糟。
- 每条 finding 带数字：`measured`（实测区间）、`required`（要求区间）、`atMm` / `atDeg`（阻挡发生的位置）、`instanceIds`、`connectionId`。
- 数字按单位固定精度（mm 3 位、deg 2 位）。原始浮点 `0.3922945346154689–0.4072240255454096` 对模型和人都不是信息。
- 合同未确认时 finding **照常产生**：门禁只会收回 PASS，从不会软化 FAIL。但提示里会标注"这个区间不是已确认合同给的，当作临时值"。
- `buildAssemblyRepairPrompt` 把不变量写在**回复之前**：不许删零件/实例/连接、不许缩小声明范围、不许换 bore 侧、不许改需求、修不了就明说并保持源码不变。
- `assertRepairPreservesAssembly` 事后核对，一次返回**全部**违规而不是第一条：`part-removed`、`instance-removed`、`connection-removed`、`connection-changed`、`range-shrunk`、`bore-changed`、`requirement-relaxed`、`invalid`。

新增 `src/lib/assembly/repair-loop.ts`：

```
measure(初始源码) → 收集 findings → 无失败则停
  → 组装提示 → propose(提示) → 源码未变则停（no-progress）
  → measure(新源码) → 守卫核对声明 → 违规则停并保留上一个候选
  → 收集 findings → 无失败则停，否则下一轮
```

三条设计约束：

1. **测量闭包全程唯一**。修复拿不到测量，所以不可能靠"改检查"通过。
2. **提案先过守卫再测量**。删掉 bore 比加宽 bore 快，所以先拒绝而不是先奖励。
3. **停止原因必须上报**：`no-findings` / `attempt-budget` / `invariant-violated` / `no-progress` / `repair-failed`，没有一种叫"完成"。预算默认 2 次、硬上限 5 次。

`RepairInput` 新增可选 `assemblyFindings`，`buildRepairPrompt` 在有 finding 时插入"## Measured Assembly Failures"段（含同一组不变量）；没有 finding 时提示逐字不变。

### 真实几何上的闭环（原生 OpenSCAD）

原创夹具：圆形底座 + 止挡柱（半径 15 mm、60° 方向），摆臂长 20.5 mm，声明 ±180°。

| 轮次 | 源码 | 运动 | 装配 | findings | 守卫 |
|---|---|---|---|---|---|
| 0 | 摆臂 20.5 mm | **FAIL**，阻挡在 39.13° | PASS | 1 条 motion | — |
| 1 | 摆臂 5.5 mm（同一夹具，只改臂长） | **PASS** | PASS | 0 | 通过，声明未变 |

- 提示里出现的是 `blocked at 39.13°`、`required: -180.00–180.00 deg` 和不变量原文，不是"运动有问题"。
- 两轮 `scadSha256` 不同；最终 `evidence.physical` 仍是 `NOT_RUN`。
- 39.13° 不是写死的：24 个采样角从 −180° 起每 15.65° 一个，第一个落进止挡可及范围的就是它。

### 反例（证明守卫不是摆设）

| 场景 | 结果 |
|---|---|
| 修复把 pin 零件删掉 | `invariant-violated`，违规码 `part-removed` + `instance-removed`，最终候选仍是原源码 |
| 修复把 ±45° 改成 ±10° 使运动"通过" | `invariant-violated`，违规码 `range-shrunk`——**测量已经 PASS，仍被拒绝** |
| 修复原样返回源码 | `no-progress`，不重复测量 |
| 修复返回空串 / 抛错 / 渲染失败 | `repair-failed`，保留上一个测成功的候选 |
| 预算 99 次 | 实际只发 5 次提案（硬上限） |

### 这条证据证明了什么

- 实测失败能变成**带数字的修复输入**，模型拿到的是 `measured` / `required` / 位置，不是形容词。
- 修复后**重新测量**，最终结论来自第二轮测量而不是修复的自述。
- 通过"删零件 / 缩范围 / 换 bore 侧 / 改需求"换来的通过会被拒绝，即使测量结果本身是 PASS。
- 循环的每种退出都有名字和理由；没有"跑完了"这种含糊状态。

### 这条证据不能证明什么

- 闭环里的 `propose` 在真实几何测试中是**确定性的替身**，不是模型。模型能否按这些数字改对，属于下一阶段（真实生成试验），未测。
- 只跑了一轮修复。两次以上的收敛行为、以及"越修越差"的情况没有测。
- 守卫只核对**声明**（零件/实例/连接/范围/bore 侧/合同下界），不核对几何是否仍然满足用户没写进合同的意图。
- 生产管线尚未在生成后自动调用这个循环：它需要模型调用预算门禁，属于真实生成试验的前置条件。
- 仍是采样证据：39.13° 这个数字依赖 24 个采样点。

### 验证

`794 pass / 0 fail`（122 文件，4 skip）、`test:openscad 8 pass / 1 skip / 0 fail`、`eslint .`、`tsc --noEmit` 全通过。

## 2026-10-29 · E4 骨架：冻结任务集与预算门禁（真实模型调用仍未启动）

### 为什么先做门禁而不是先跑

计划里 E4 的要求是"先冻结少量任务、模型、重试次数及金额上限，再启动付费调用"。所以这一轮只交付**能花钱之前必须存在的东西**：任务集、预算算术、停止条件、判定函数。真实模型调用没有发生。

### 交付了什么

| 文件 | 作用 |
|---|---|
| `scripts/eval/assembly-generation/tasks.json` | 冻结任务集：4 条原创中文请求 + 每条允许的修复次数 + 预期失败形态 |
| `scripts/eval/generation-trial.ts` | 计划 / 回放 / 付费三模式，预算算术与停止条件，报告格式 |
| `scripts/eval/judge-assembly.ts` | 一条 (请求, 源码) → 逐断言判定；回放与将来的付费路径共用 |
| `scripts/eval/assembly-generation/replay/hinge-axial-45.json` | 一份记录源码，用来证明整条链路能跑通且不花钱 |

任务集带 `taskSetSha256`（对 canonical JSON 求哈希）。改了任何一条提示词而没重新冻结 → 加载直接失败，因为"对着一个悄悄变过的集合算出的通过率"不是测量。

### 预算算术（实测输出）

```
$ bun run cad:eval:trial --plan --price 0.002
  tasks: 4, worst case 13 calls / $0.0260 at $0.002/call
  stop: stops before call 14
  stop: stops before spending $0.0260
  stop: stops after 2 consecutive tasks that fail every attempt
  stop: stops if the derived contract cannot be evaluated (no observations)
  contract provenance: derived (no user confirmed anything in this run)
  spent: 0 calls / $0.0000 of $0.0260 and 13 calls
  0 passed, 0 failed, 4 not run (stopped: not-started)
  pass rate: not measured; 4 task(s) were never judged
```

最坏情况 = `Σ(1 + 该任务的修复次数)` = 13 次。天花板低于最坏情况时**在第一次调用之前**拒绝，而不是跑到一半发现不够——半截试验比不开始更糟：

```
$ bun run cad:eval:trial --plan --price 0.02 --max-usd 0.05
  The cost ceiling ($0.05) cannot cover the worst case ($0.1000 for 5 calls at $0.02/call).
```

`--run` 需要同时满足：`AGENTSCAD_ALLOW_PAID=1`、`--max-calls`、`--max-usd`、`--price`、`--model`。缺任何一项退出码 2，一次调用都不发：

```
$ bun scripts/eval/generation-trial.ts --run --model test
  --run makes paid model calls and AGENTSCAD_ALLOW_PAID is not set to 1. Use --plan or --replay to run without spending.
  exit=2
```

### 回放模式（整条链路，零花费）

```
$ bun run cad:eval:trial:replay
  [PASS] hinge-axial-45 — 1 generation(s), passed
    intent-preserved: PASS
    distinct-exported-parts: PASS
    disassembly-path: PASS
    sampled-motion: PASS
    motion-range-deg: PASS
    diametral-clearance: PASS
  [NOT_RUN] hinge-axial-90-tight — No recorded source ... so this task was not replayed.
  [NOT_RUN] hinge-with-stop-60 — 同上
  [NOT_RUN] hinge-flush-30 — 同上
  1 passed, 0 failed, 3 not run
  pass rate: 100% of 1 judged; 3 task(s) were never judged
```

三个 `NOT_RUN` 是刻意的：没有记录的源码就不判，而不是拿一份手写夹具冒充模型输出。报告把"判了几条"和"通过率"分开写，避免 `1/1` 被读成 `1/4`。

### 判定函数的一个关键决定

`judge-assembly.ts` **不传 `contractGate`**。传 `evidenceCurrent: false` 会让所有 PASS 降级为 NOT_RUN，试验就永远无法区分"模型不行"和"合同没确认"；传 `true` 则是伪造用户确认。所以让它保持 `null`（"没问过"），并在报告里写死 `contractProvenance: "derived"`：这里的通过率含义是**"满足了对请求的机器解读"**，比"满足了用户需求"弱一档。

### 这条证据证明了什么

- 任务集是冻结的，改一个字就会拒绝加载。
- 预算在最坏情况上被检查，而不是在消耗过程中被发现。
- 没有授权就没有调用；授权缺失、天花板缺失、单价缺失、模型缺失都会在解析阶段退出。
- 判定链路（提取声明 → 派生合同 → 渲染 → 测量 → 逐断言判定 → finding）在真实 OpenSCAD 上跑通，且与是否付费无关。

### 这条证据不能证明什么

- **没有任何模型被调用**。这轮产出的通过率是 1/1 的手写夹具，不是模型的成绩，不能引用为成功率。
- 付费适配器还没接。`--run` 目前直接拒绝，不会走到模型。
- 任务集只有 4 条，全部是铰链类；滑动/螺栓类任务因为运动采样还不支持非转动副而没进集合。
- 判定用的是派生合同，不是用户确认的合同；结论只能说到"机器解读"这一层。
- 回放只有 1 条记录，其余 3 条没有任何模型输出可回放。

### 验证

`816 pass / 0 fail`（123 文件，4 skip）、`test:openscad 8 pass / 1 skip / 0 fail`、`eslint .`、`tsc --noEmit` 全通过。

## 2026-10-29 · E3：单缸曲柄连杆的多姿态实测（M4 第一批）

### 做了什么

原有链路 `sampleSliderCrankSource` 已经能渲染 9 个角度、逐角度比对销轴位置、并对四个零件的六对做碰撞检查。它缺三件事，这一轮补上：

| 新增 | 为什么不能靠已有检查代替 |
|---|---|
| 从销轨迹**拟合**曲柄圆心与半径（Kåsa 最小二乘） | 原来直接把测点交给 `checkSliderCrank`，而后者假定曲柄中心在 (0,0)。半径从未被测过，声明值改了也不会被发现 |
| 跨姿态**连杆长度恒定性** | 原来每个姿态各测各的，连杆"每帧变长"可以每帧都自洽 |
| 双截面**销轴平行度** | 原来只切一个 Y 截面，销轴倾斜或绕错轴时，单个截面可能刚好仍给出圆 |

新增 `src/lib/assembly/slider-crank-motion.ts`：`fitCircleXZ` 与 `measureSliderCrankMotion`。测量顺序是：逐姿态切网格 → 拟合曲柄圆 → **用拟合中心平移后再**与解析式比较 → 检查连杆长度与销轴平行度。没有任何一步读取 SCAD 变量。

接进 `sampleSliderCrankSource` 后，报告新增 `motion` 段，`status` 也把 `motion` 的 FAIL/ERROR 计入（`NOT_RUN` 不计，因为单角度负例本来就不足三个姿态）。

### 实测数字（`bun scripts/eval/measure-slider-crank.ts`）

夹具 `benchmarks/assembly/slider_crank.scad`，9 个角度（0°–360°，45° 步长），每姿态 3 个零件、2 个 Y 截面（y=2.3 与 y=3.3）：

| 项目 | 实测 |
|---|---|
| 曲柄半径（拟合） | **7.999999535878422 mm** |
| 拟合残差（最大） | **2.29e-8 mm** |
| 连杆长度 | **27.999999236 – 27.999999642 mm** |
| 连杆长度跨姿态极差 | **4.06e-7 mm** |
| 销轴双截面漂移 | **0 mm** |
| 位置闭环最大误差 | < 0.02 mm（冻结容差） |
| 碰撞（9 姿态 × 6 对） | PASS |
| 实物 | NOT_RUN（无试样） |

曲柄半径与连杆长度都不是写死的：它们由渲染网格的截面轮廓反算，与声明的 8 / 28 相差不到 5e-7 mm。

### 负例（证明检查不是空过）

| 注入 | 结果 |
|---|---|
| 加一个从未被读取的 `unused_label = 42`，并把 `$fn` 从 64 改成 48 | **PASS**，半径仍 8.00——检查不读源码变量，也不被网格细分影响 |
| `crank_radius = 9`（声明仍要求 8） | **FAIL**，实测半径 9.00，理由写「traces a circle of 9」 |
| 曲柄改成绕 +X 转（`rotate([motion_angle,0,0])`） | **不是 PASS**：销轴离开 Y 截面，轮廓计数为 0 |
| 把 `sin(motion_angle)`/`cos(motion_angle)` 全部替换成 0（假动画） | **FAIL** |
| `rod_angle = 0`（连杆不随动） | **FAIL**，coupling error > 1 mm |
| 曲柄整体平移 1 mm | 碰撞 **FAIL** |
| 删掉机架上的轴承孔 | 关键点仍 PASS，但碰撞 **FAIL**——正确的位置不能掩盖缺失的孔 |

### 这条证据证明了什么

- 0–360° 内 9 个姿态的位置关系与解析解一致，容差 0.02 mm；曲柄半径与连杆长度是从**实际网格**反测的，不是复述声明。
- 所测姿态与截面上的连杆孔心距极差为 4e-7 mm；不能据此证明整个零件形状跨姿态不变或受载后刚性。
- 两个相距 1 mm 的截面给出相同圆心（漂移 0）；未测中间及其他高度的形状，不能据此证明整轴平行度。
- 采样不是空过：假动画、错半径、错轴、连杆不随动、缺孔、整体平移六种注入全部被拒。
- 碰撞检查在 9 个姿态 × 6 对上通过，且缺孔负例会让它失败。

### 这条证据不能证明什么

- **可装拆未测**。夹具没有装配声明，也没有定义拆卸顺序；轴向取出依赖"外部轴向挡圈"，而挡圈不在模型里。`disassembly-path` 对这个机构仍是 `NOT_RUN`。
- 只有 9 个姿态，45° 步长。两个采样角之间的干涉或越界没有覆盖；0° 与 360° 是同一位置，实际独立姿态是 8 个。
- 碰撞只在采样姿态上判定，不覆盖连续运动；接触与穿透不可区分。
- 机架的轴承孔位置没有单独测量，只通过"曲柄轴与机架碰撞"间接约束。整机小范围平移（小于 0.2 mm 间隙）不在覆盖内。
- 不含载荷、摩擦、间隙引起的死点、打印公差与实物功能；L5 仍 `NOT_RUN`。
- 夹具的四个零件由同一个 SCAD 源生成，选择器是否正确仍只由 `part-identity-check` 的弱判据支撑。

### 验证

`840 pass / 4 skip / 0 fail`（126 文件）、`test:openscad 14 pass / 1 skip / 0 fail`（4 文件，143 s）、`eslint .`、`tsc --noEmit` 全通过。

## 2026-10-30 · 必需测量未完成时不得报告成功

**观察到的缺陷**：`sampleSliderCrankSource` 把跨姿态检查的 `NOT_RUN` 排除在汇总外；CLI 只对 FAIL/ERROR 返回非零。单个正确姿态因此能让总报告与命令返回成功，尽管运动尚未验证。此外，缺孔案例原本关键点 PASS、碰撞 FAIL，但顶层仍为 PASS。

**修复**：新增 `measurement-status.ts` 汇总必需检查，保留独立 `landmarkStatus`，总状态包含关键点、跨姿态、碰撞。已知 FAIL 优先，其次 ERROR；任何必需 NOT_RUN 都不产生 PASS。CLI 仅 PASS 返回 0，FAIL 返回 1，ERROR/NOT_RUN 返回 2。实物仍独立 NOT_RUN，不在数字采样通过声明内。零距离/非有限双截面探针被拒；不均匀角度列表不再伪报平均等步长。未请求双截面时，文字不再声称销轴平行。

**真实本地运行（没有模型调用）**：

- `bun run cad:eval:slider-crank`：退出码 0，总报告/跨姿态/碰撞 PASS。9 姿态，36 个 STL；拟合半径 7.999999535878422 mm，残差 2.2920520592606408e-8 mm，所测孔心距极差 4.0635367071217843e-7 mm。原始产物：`.agentscad/experiments/slider-crank-PJ0qtT/`，含 `source.scad`、`setup.json`、逐姿态逐件 STL 和 `report.json`。
- 同一源码、角度仅 `[0]`：总报告/跨姿态 NOT_RUN，碰撞 PASS，**退出码 2**。原始产物：`.agentscad/experiments/slider-crank-Pd4yhG/`。复现：`bun scripts/eval/measure-slider-crank.ts .agentscad/experiments/slider-crank-Pd4yhG/source.scad .agentscad/experiments/slider-crank-Pd4yhG/setup.json`。

**边界**：这些是手写原创夹具的数字证据，不是模型生成成功率。孔心距跨姿态一致不证明零件其他区域不变形；两个截面圆心对齐不证明整根销轴平行。未执行连续碰撞、单缸装拆、受载功能或制造实测。原始目录被 gitignore，本地可复核，尚不是外部独立审查交付包；运行器/测量器版本未完整封存，不能宣称跨机器严格复现。

**本轮最终检查**：`bun run test` 为 827 PASS / 3 SKIP / 0 FAIL（122 文件）；单缸原生 OpenSCAD 测试为 7 PASS / 0 FAIL（137.77 s），覆盖正常九姿态、细分变化、错半径、错轴、假运动/错连杆/平移、缺孔与单姿态不足；`bun x tsc --noEmit`、`bun run lint`、`git diff --check` 均退出 0。本轮未重跑全部原生铰链/WASM 套件；上文历史计数不得当作本轮结果。

## 2026-10-30 · E3 补充：按顺序拆卸单缸四件夹具

新增原创 `src/lib/assembly/disassembly-sequence.ts`，输入为已在同一装配坐标系中的实例网格及明确的逐件直线移出方案。它不会自动搜索顺序。每一步只在全部采样位置无干涉、且终点包围盒已离开剩余装配整体包围盒后，才把该件从剩余场景中移除；失败之后的步骤为 NOT_RUN。缺件、重复移除、遗漏实例、非有限采样及超预算方案被拒。无“允许接触”豁免。网格和方案哈希记录在报告中。

运行 `bun scripts/eval/check-slider-crank-disassembly.ts`（本地 OpenSCAD，无模型调用）：

- 原始目录 `.agentscad/experiments/slider-crank-disassembly-qCepzu/`：完整源码、渲染参数（`motion_angle=0`、`agentscad_pose=true`）、四件 STL 和正反例报告。
- 方案 `scripts/eval/assembly-fixtures/slider-crank-disassembly.json`：滑块 → 连杆 → 曲柄，每件沿 +Y 移动 20 mm，81 个位置，步长 0.25 mm。三步均 PASS，最后只剩机架。
- 改成连杆 → 滑块 → 曲柄：连杆在第 5 个采样位置（移出 1 mm）与滑块相交，FAIL；后两步 NOT_RUN。没有通过提前删除挡路零件来伪造顺序可行。
- 正例与负例使用同一批网格，仅交换顺序。独立工具可读取四件 STL，并重放报告中的平移位置；首个失败断言可由连杆与滑块在 `[0,1,0]` 偏移时无交叠的独立结果推翻。

**证据限制**：仅覆盖这份手写四件夹具的指定姿态、顺序、平移方向和采样点；不证明所有路径不可行或连续路径无碰撞。每步成功后假定零件被搬到外部存放区，搬运路线、重力支承与工具可达性未验证。包围盒终点条件保守，可能拒绝真实可行但仍在总体包围盒内的移出；这不是通用路径搜索器。反向装配在相同几何样点上无碰撞是可逆刚体平移的推论，不是手工装配实测。**仍无轴向保持件，不能把这次通过称为完整功能装配体验收；M4 仍未完成。**

本批验证：普通测试 830 PASS / 3 SKIP / 0 FAIL（123 文件）；新增单缸原生拆卸顺序测试 1 PASS / 7 未选中 / 0 FAIL（未重复运行既有七项运动测试）；类型检查、lint 与 diff 空白检查均通过。局部单测曾因构造的挡板与底座恰好接触而先触发碰撞，已调整测试夹具间隙，让“终点未移出”的负例真正测到目标条件；生产阈值没有为测试修改。

## 2026-10-30 · E3 补充：可拆横销的保持作用与修订证据

原创五件候选 `benchmarks/assembly/slider_crank_keyed.scad` 为偏心销增加横向通孔和独立横销。四件基线不变。完整条件、尺寸和复现命令见同目录 `slider_crank_keyed.md`。运动测量器增加命名附件，逐姿态实际渲染并纳入全部零件对碰撞；附件不能覆盖或复用原有测量角色。

**首版失败**：销头半径 1.2，装配时已接触/穿入连杆。拆卸在第一个位置失败，目录 `.agentscad/experiments/slider-crank-disassembly-AxRTQy/`；九姿态运动测点 PASS 但碰撞 FAIL，目录 `.agentscad/experiments/slider-crank-iFITDf/`。这是几何设计问题，保留源码与原始网格，没有放宽检查条件。

**修订结果**：仅把销头半径改为 0.8，原冻结运动容差和采样步长不变。

- 九姿态（实际八个不同角位置）重新渲染五件，90 个零件对/姿态组合全部无干涉；关键点和跨姿态运动 PASS。目录 `.agentscad/experiments/slider-crank-Mrkc8v/`，45 个 STL、源码、配置、报告。源码 SHA256 `58f774fe6a55fcb6f0a704088c9579cbcbce9a438d75b3a30b7a81e67c394a50`。
- 横销 → 滑块 → 连杆 → 曲柄的指定拆卸顺序通过，步长 0.25 mm。先拆滑块、保留横销再拆连杆，连杆移动 0.25 mm 时被横销挡住，FAIL；后续 NOT_RUN。目录 `.agentscad/experiments/slider-crank-disassembly-gBmWHv/`。正反例同一批网格，只改变顺序。

**判断与边界**：已证明该候选在指定样点的几何保持及解除效果。未证明横销自身防脱、主轴保持、完整导向、手动使用或制造可行性。附件完整性来自冻结配置，未与生产装配合同联动；不能把配置漏件视为已验证整机。保持件配合尚无独立截面测量，销头承载/打印强度未测。M4 未完成。

本批检查：普通测试 831 PASS / 3 SKIP / 0 FAIL（124 文件）；新增横销原生回归 1 PASS / 8 未选中 / 0 FAIL（四姿态及同批网格正反拆卸），另有上述独立九姿态 CLI 实验。类型检查曾发现负例数组的 TypeScript 联合类型推导问题，补显式类型后通过，相关单测复跑通过。lint 与 diff 空白检查通过；未重新跑全套原生/WASM 测试，没有模型付费调用或实物试验。

## 2026-10-30 · M2/M4 接口：保持件进入装配声明与制造坐标包

`slider_crank_keyed.scad` 现嵌入正式 V1 装配声明：五件身份、连接意图、0° 位姿、四步拆卸、保持/工艺未知项。原几何未改。新增 `removalSequenceFromSpec`，从经过 schema 验证的声明派生直线路径：拒绝遗漏实例、起点不等于装配位姿、转动或多段路径，而不是悄悄简化。冻结拆卸侧文件与声明派生结果有一致性回归。

新增原创 `reconstructed-mesh-check.ts`：刚体变换导出三角面，与重新渲染姿态寻找一一顶点对应（容差 1e-4 mm）。全体三角面有对应才 PASS。边界超差 FAIL；同边界但三角剖分/几何无法对应是 NOT_RUN，不能借包围盒相同放行；超预算也是 NOT_RUN。它不检查面朝向、流形或内部拓扑，不提供一般的重剖分表面等价证明。

**实际运行**：`bun scripts/eval/check-keyed-export.ts`，退出 0。目录 `.agentscad/experiments/keyed-export-o23YNa/` 保留源码、实际 ZIP、五件装配姿态 STL、报告。检查读取的是 ZIP 内 STL 与 manifest，不是构建器内存里的原对象：

| 件 | 一一对应三角面 | 最大顶点偏差 mm |
|---|---:|---:|
| frame | 320 | 0 |
| crank | 1072 | 0 |
| rod | 780 | 0.0000019073486328125 |
| slider | 268 | 0.0000019073486328125 |
| eccentric_key | 508 | 0 |

五件重建 PASS；连杆位姿 Z 偏移 1 mm 的注入 FAIL（边界差 1 mm）；正式声明派生的顺序在实际姿态网格上拆卸 PASS。ZIP 没有用户确认合同，门禁仍未确认，重建报告未回写成产品功能 PASS。此次运行不是生成模型试验，也不是独立 CAD 内核复核。

**最低复核材料与反例**：ZIP、源码、五个 posed STL 和报告足以在独立网格工具中复核 0° 重建坐标。若任一变换后表面到对应 posed 表面的距离超过 1e-4 mm，则推翻该件重建结论。独立工具复核目前未执行。M4 的保持/导向缺口未因增加清单而解决，不能勾选完成。

本批验证：普通测试 836 PASS / 3 SKIP / 0 FAIL（125 文件）；真实 ZIP 重建及声明派生拆卸实验退出 0。类型检查、lint、diff 空白检查通过（测试中的联合返回值字段访问补类型收窄后复查，五项局部测试复跑通过）。既有九姿态运动、全套原生/WASM、浏览器和实物测试本批未重跑，不能把历史结果改标为本批执行。

## 2026-10-30 · E3 导向实体与可解除约束

新增原创六件候选 `slider_crank_guided.scad`，前导向件不是声明为 fixed 的悬空板，而是被机架侧通道捕获、沿 +Z 可移出的实体件。后唇边与侧轨一体，前件独立导出。正式声明包含第六件及先行取出的路径，未知项仍列向上锁止、横销防脱、主轴保持和实物条件。

新增 `translation-probe.ts`，检查指定障碍物集合下的采样刚体平移。期望阻挡时，必须先确认初始姿态无碰撞、后续有阻挡，才能 PASS；初始穿透不能伪装成保持作用，UNKNOWN 不放行。它不是自由度求解器，也不把被移除的邻件当作仍存在。

实测材料和详细复现见 `benchmarks/assembly/slider_crank_guided.md`：

- 当前运动、拆卸、导出三组源码哈希完全一致：`6fdd428079a8b09258cc2f822de043f0b899d992386ac7fa2c6f817cba5d8531`。
- 运动目录 `slider-crank-v4GK0s`：9 姿态，六件，135 个零件对/姿态组合无采样干涉，原运动测量 PASS。
- 拆卸目录 `slider-crank-disassembly-hUOUfq`：前导向件 → 横销 → 滑块 → 连杆 → 曲柄 PASS；不先取前件，滑块 +Y 0.5 mm 处与前件相交，FAIL。
- 同目录 `guide-probes.json`：隔离导向副的 ±X/±Y 平移会被挡住，Z 工作行程 16 mm 采样畅通；移除前件后 +Y 恢复畅通。前件自身 ±Y/-Z 受机架阻挡，+Z 可退出。没有证明角向约束、重力稳定性或完整机构自由度。
- 导出目录 `keyed-export-GL8cFQ`：六件 ZIP 重建 PASS，声明驱动拆卸 PASS，连杆位姿偏移负例 FAIL；合同未确认保持原状。

**真实失败与根因**：第一版路径最后仍只移曲柄 20 mm，虽未发现采样碰撞，但曲柄尾端未离开增厚机架的总体包围盒，工具返回 FAIL。保留目录 `slider-crank-disassembly-VrigIb`。修改的是实际计划移出距离（24 mm）及声明，不是降低终点判据。该保守判据失败不等于证明物理上无法取出。

**未完成**：此六件候选仍没有横销防脱、主轴轴向保持、前件向上锁止；平移阻挡不能替代角向/受载约束。所有实物、连续碰撞和外部独立复核未执行。M4 未完成。

导向批最终检查：839 PASS / 3 SKIP / 0 FAIL；新增原生导向回归 1 PASS / 9 未选中 / 0 FAIL；类型检查、lint、diff 检查通过。

## 2026-10-30 · 主轴保持与重复零件制造数量

原创 `slider_crank_shaft_keyed.scad` 在六件导向候选上加入主轴后侧横销。新增的是实例，不是新的制造零件：六种零件、七实例，同一横销 STL 制造两根。`prepareAssembly` 从实例列表派生 `quantity`，ZIP README 明示数量，防止制造时少打一根。新增重复零件导出回归。

`translation-probe.ts` 增加随主体一起移动的 `companions`。只用“轴撞上不动的销”会测到错误边界；本实验检查轴+销共同相对机架平移。组内刚性是假定条件，不是该工具验证的事实；整机初始/运动碰撞另行检查。

**实际运行**（源 SHA256 `df09abbf19c3bdebeeca8a4d0474faddcbcaa326ec463ca7d06bbe3dcaf8972b`）：

- `slider-crank-disassembly-D6WkMM`：正确顺序拆卸 PASS，保留主轴横销先取曲柄 FAIL。`shaft-retention.json`：整组 +Y 0.2 mm 被主轴横销与机架相交挡住，-Y 2 mm 被曲柄肩部挡住（0.05 mm 采样）；取掉横销后 +Y 3 mm 全部采样点清楚。
- `slider-crank-QjcBee`：九姿态、七实例、每姿态 21 对碰撞通过，原闭环与跨姿态测量通过。九个角含重复的0°/360°，不能当作九个独立位置。
- `keyed-export-3Ej20K`：实际 ZIP 六个 STL、七实例、横销数量 2；七实例逐面重建 PASS，连杆位姿偏移反例 FAIL，声明驱动拆卸 PASS。源版本与运动相同。

保持判据的独立反例是：在相同网格/位姿下，轴+销整组沿报告偏移没有碰到机架；制造数量的反例是 ZIP 有两个横销设计文件却未声明复用，或实例/数量不一致。最低材料均已保留；外部独立几何工具和工程师复核未执行。

**未完成条件不变**：两根横销自身防脱、前件向上锁止、组内刚性/角向约束、工艺与实物功能未证明；旋转横销的重力方向会变化，不能借静态朝向假定全周期不脱出。M4 未完成。

主轴批最终检查：普通测试 841 PASS / 3 SKIP / 0 FAIL（126 文件）；新增原生主轴/复用横销回归 1 PASS / 10 未选中 / 0 FAIL；类型检查、lint 与 diff 空白检查通过。原生九姿态与实际导出另由上述 CLI 完成，没有运行付费模型、浏览器或实物试验。

## 2026-10-30 · 旧关节采样器两种假通过的复现与修复

推进保持结构前复查 `path-and-motion.ts`，取得两个明确的运行反例：

1. `steps=NaN`：原 `Math.max(2, Math.trunc(...))` 仍为 NaN，采样循环一次不执行，但路径返回 PASS。修改前回归实际收到 PASS，期望 ERROR，测试失败。现在在加载网格前验证采样数必须为 2–4096 的整数；非有限值、0/1、分数与超限均 ERROR。碰撞精度参数也要求有限正数且不超过0.1 mm，三角对预算为1–2000000整数；不再暗中截断输入。
2. `maxPairTests=1` 且两件被声明允许接触：碰撞器正确返回 UNKNOWN，但上层将 `blocked=true` 的 UNKNOWN 当成可豁免接触，最终运动返回 PASS。修改前回归实际收到 PASS，期望 NOT_RUN，测试失败。现在只有已判定的接触/穿透可进入既有豁免逻辑；UNKNOWN 不可豁免，路径/运动保持 NOT_RUN。

这些是代码与运行同时支持的事实，不是对 CAD 内核的猜测。修复没有改变几何或公差以迎合例子。现有允许接触规则仍以整对零件豁免为限，不是精确接触面/穿透深度模型；本次仅堵住未知结果被放行的漏洞。

**证据保留**：`.agentscad/experiments/sampling-guard-h829bq9g/` 包含两个修改前失败日志、修改后30项局部测试日志、真实原生铰链结果、全量测试摘要、当前相关源码/测试快照与文件校验和。

**最终验证**：局部30 PASS；普通测试854 PASS / 3 SKIP / 0 FAIL（126文件）；真实原生铰链7 PASS / 0 FAIL，含已知失败的修复后重测；类型检查、lint、diff检查均通过。本批没有执行新锁止机构、完整单缸运动、浏览器、付费生成或实物试验。M4/M5等完整目标状态不因采样器修复而提升。

## 2026-10-30 · 多段刚体路径与先顶起再转动的卡口

新增原创 `rigid-pose-path.ts`，验证显式累计刚体位姿，保留全部姿态与哈希。复用装配schema的刚体校验；相邻平移/转动步长先检查后执行，纯静态路径拒绝（包括非零角度重复矩阵，避免acos舍入误差伪造运动）。未知碰撞为NOT_RUN；初始穿透失败；可要求终点完全移出。旧直线操作适配器没有放宽为猜测旋转路径。

两件原创夹具先建立基线，再增加侧面限位，实际渲染后测量：

- `quarter-turn-1xnSOh`：无转动限位的卡口，先转90°再拔与反向装入通过，直拔和只转45°失败。
- `quarter-turn-9PzhLN`：限位版，先+Z顶起1 mm、旋转-90°、沿-Z移至-12 mm，共116位姿，通过；逆序装入也通过。最大相邻原点位移0.1494252874 mm、方向变化5°。
- 同一限位网格的三种负例：直拔在-Z 1.05 mm失败；不顶起直接转在10°失败；只转45°后回落至+Z约0.70115 mm失败。失败位置不是起始穿透。

原始目录均保留源码、渲染参数、销/套STL、正反路径完整矩阵与报告；详情与复现见 `benchmarks/assembly/quarter_turn_capture.md`。这是工具/机制原型的实测证据，未验证预紧、摩擦、防松或实物，也尚未集成到单缸。没有用新增演示件数量替代M4退出条件；下一步必须把合适的锁止约束接入实际连接及产品检查。

本批最终验证：普通测试857 PASS / 3 SKIP / 0 FAIL（127文件）；新增原生卡口回归1 PASS / 11未选中 / 0 FAIL，覆盖正确装拆和三个非起始碰撞的错误路径；类型检查、lint、diff空白检查通过。未重跑全部单缸原生/WASM、浏览器、付费生成或实物试验。

## 2026-10-31 · 声明拆卸接入生产导出：原始测量与合同结论分开

**改动**（`rigid-pose-path.ts`、`declared-pose-disassembly.ts`、`prepare-assembly.ts`、装配路由/面板）：

- `manifest.declaredDisassembly` 不再保留未受门禁约束的 `status`。它现在与 `fits` 同一约定：`status`/`reason` 是合同门禁后的结论，`measuredStatus`/`measuredReason` 才是几何实际说了什么。此前未确认合同下该字段可为 PASS，而 `evidence.disassembly` 是 NOT_RUN，读错字段就会把未确认的测量当成产品结论。
- 采样前先判定无法采样的声明：两端点旋转超过步长、或平移所需采样数超过 4096，都直接 ERROR 并点名操作 ID。原先这两种情况靠后续"跳步超限"通用报错兜底，用户看不出该改哪里；超预算时也不会退化成只查两端点。
- 时间预算改为真正的总预算：`checkRigidPosePath` 增加 `budgetMs`，计时从函数入口开始（含 STL 解析与 BVH 构建），`checkDeclaredPoseDisassembly` 把剩余预算逐操作下传。此前每个操作各自 5 秒，总时长可达 5 秒×操作数，且 BVH 构建不计时。
- 装配 GET/PUT 的 `evidence` 映射和 `AssemblyDetails` 证据列表补上 `disassembly` 层（中文"拆卸路径"）。此前 ZIP 清单有该层，API 与界面没有。

**真实导出运行**（`bun scripts/eval/check-declared-export.ts`，原生 OpenSCAD 2021.01，无模型调用）：目录 `.agentscad/experiments/declared-export-4Aat8H/`，含源码、三个实际 ZIP 与 `report.json`。

| 运行 | `evidence.disassembly` | `declaredDisassembly.status` | `measuredStatus` | ZIP README |
|---|---|---|---|---|
| 已确认合同 | PASS | PASS | PASS | `- disassembly: PASS — Every declared removal passed at its sampled poses` |
| 未确认合同 | NOT_RUN | NOT_RUN | **PASS** | `NOT CONFIRMED` + 同时写出"测量本身通过" |
| 反序拆卸（曲柄先拆） | FAIL | FAIL | FAIL | `- disassembly: FAIL — The declared removal sequence is not verified` |

反序负例的实际失败点：曲柄移出第 2 个采样位置即与 `eccentric_key` 相交，`blockedAt.obstacleId = eccentric_key`，后续操作 NOT_RUN。同一批网格、同一源码，只改声明顺序；没有提前删除挡路零件来伪造顺序可行。直接调用检查器耗时 1548 ms（7 实例、6 次拆卸、0.25 mm 步长），预算 5000 ms。

**可推翻条件**：若在相同 ZIP 与源码下，任一操作的采样位姿实际无交叠却被判 FAIL，或存在交叠却判 PASS，则上表结论不成立。三个 ZIP 与 `report.json` 足以在独立网格工具中重放。

**边界与未完成**：

- "已确认合同"是门禁标志，不是真实用户确认。本批没有任何用户操作确认记录，也没有付费模型调用。
- 反序负例使用修改后的声明（操作顺序反转），其 `specificationSha256` 与原内嵌声明不同；它是可推翻的反例，不是冻结案例。
- 仍是离散采样：步长只覆盖已测位姿，不证明帧间无干涉；`requireSeparatedEnd` 只要求终点离开剩余件总体包围盒。
- 检查器在请求线程内同步运行。1548 ms 已经会阻塞事件循环，上限 5 秒；没有后台任务、没有中途取消（同步段无法投递 abort）。装配规模继续增大时需要独立任务或分片。
- 界面证据列表仍恒为 NOT_RUN：导出时算出的证据只写进 ZIP 与响应头，没有持久化到作业记录。用户看不到"上次导出通过了拆卸路径"，这是已知缺口，不是已实现功能。
- M4 的保持/导向缺口不变，实物 L5 仍 NOT_RUN。

本批验证：普通测试 869 PASS / 3 SKIP / 0 FAIL（128 文件）；新增覆盖：超长平移与两端点旋转的明确拒绝、总预算与非法预算、门禁前后 `status`/`measuredStatus` 分离、阻挡路径不被门禁软化、ZIP 清单与 README 的三态、真实 API 请求的 `disassembly=NOT_RUN` → 确认后 `=PASS` 响应头。`bun x tsc --noEmit`、`bun run lint`、`git diff --check` 均通过。未重跑全套原生/WASM、浏览器端到端、付费生成或实物试验。

## 2026-10-31 · 横销与导向件的刚性可释放锁止（M4 保持件）

**改动**（`benchmarks/assembly/slider_crank_shaft_keyed.scad`、`scripts/eval/build-keyed-declaration.py`、`check-declared-export.ts`、`check-keyed-export.ts`、`slider-crank.openscad.test.ts`）：

- 横销增加四分之一转锁舌：锁舌 1.7 × 0.5 × 0.4 mm，位于销轴的环形槽（r=1.05、轴向 1.0–1.5 mm）内；曲柄的销孔在 +X 侧开 0.6 × 1.8 mm 入口槽。直拔时锁舌长轴沿 Y，卡在槽壁；绕自身 X 轴转 90° 后长轴转到 Z，才能通过入口槽。
- 新增 `guide_lock` 零件与两个实例：轴 r=0.5 mm、锁舌 2.4 × 0.3 × 0.5 mm。前导向件左右侧板各开 r=0.7 mm 通孔（x=±9.1, z=40）；机架外侧通道壁开 1.4 × 2.8 mm 通槽。锁定位下锁舌长轴沿 X、卡在壁内侧；绕自身 Y 轴转 90° 后长轴转到 Z，才能通过槽并沿 +Y 退出 5 mm。
- 导向件侧板由 5.3 mm 加宽到 5.7 mm（x 到 ±10.2），锁销孔中心到板边 1.1 mm、孔边到板边 0.4 mm；机架外形不变，只在两侧外壁开槽。
- 声明从 6 零件/7 实例改为 7 零件/9 实例；操作顺序改为右锁 → 左锁 → 导向件 → 主轴横销 → 偏心横销 → 滑块 → 连杆 → 曲柄。锁销的局部坐标系取锁定位（锁舌水平），实例只做平移，这样 ZIP 重建可以逐三角面比对；释放路径从 0° 转到 −90°。
- `check-keyed-export.ts` 的声明拆卸改用 ZIP 内的局部 STL 调用 `checkDeclaredPoseDisassembly`，不再用只支持平移的 `removalSequenceFromSpec`；`check-declared-export.ts` 的负例改为"先拆导向件"和"锁销直拔"，不再用反序。
- 运动测量配置把两根锁销加入附件；九姿态每姿态 10 个零件、45 对碰撞。

**真实运行**（原生 OpenSCAD，无模型调用）：

| 实验 | 目录 | 结果 |
|---|---|---|
| 声明拆卸正例（8 操作、792 采样位姿） | — | PASS，直接检查 2589–3174 ms / 5000 ms |
| 确认合同导出 | `declared-export-pb8SaQ/` | `evidence.disassembly=PASS`，ZIP 七零件（`eccentric_key:2`、`guide_lock:2`）、九实例 |
| 未确认合同导出 | 同上 | `NOT_RUN`，`measuredStatus=PASS`，README 同时写出"测量本身通过" |
| 先拆导向件 | 同上 | FAIL，第 1 位姿 `guide_lock_right` 相交 |
| 右锁销直拔 | 同上 | FAIL，第 1 位姿 `frame` 相交 |
| 横销直拔（两根） | `slider-crank-keyed-straight-withdrawal.json` | FAIL，第 1 位姿 `crank` 相交 |
| 偏心横销单独直拔 | `slider-crank-keyed-eccentric-straight.json` | FAIL，第 1 位姿 `crank` 相交 |
| ZIP 重建（9 实例） | `keyed-export-zVW4TK/` | 9/9 PASS，最大顶点差 1.98e-6 mm；错位 1 mm 负例 FAIL；ZIP 局部网格重跑声明拆卸 PASS |
| 九姿态运动（10 零件/姿态） | `slider-crank-o4zHCT/` | PASS，45 对碰撞；曲柄 7.9999995 mm、连杆 28 mm、销轴漂移 0 |
| 主轴孔配合（3 截面） | — | 孔 4.394701–4.400000 mm、轴 3.995182–4.000000 mm、间隙 0.394701–0.404817 mm、轴线 0/0 |

ZIP SHA256：确认包 `07ce75fbee2233980b50e7bca285f71a584f39fb58c984e873164a86e78fbcd4`，重建包 `b75b55f38318a09cf1393068c1e8136a89a2f2cfbee6936a34a0ee29db5c6a29`。源码 SHA256 `9e3f74e79cadcc2fad9357061918f176504dbb65453cc6a63c316466198575e9`（含内嵌声明，重新生成会变）。

**可推翻条件**：若在相同源码与 ZIP 下，横销直拔的采样位姿实际无交叠却被判 FAIL、或转 90° 后的路径存在交叠却被判 PASS；或导向件在两根锁销都在位时 +Z 实际畅通、锁销直拔实际不碰壁、转 90° 后 +Y 实际不通，则上表结论不成立。四个负例 JSON、ZIP 与 `report.json` 足以在独立网格工具中重放。

**边界与未完成**：

- 只有几何阻挡，没有力。锁舌/锁销的强度、手力、磨损、振动、自锁、预紧、公差与 FDM 收缩都未验证；导向锁的 0.05 mm 侧隙与 0.2 mm 孔轴间隙是网格值。
- 锁销的锁舌只在槽两侧各约 0.4–0.5 mm 的宽度上压住壁的内表面；壁厚 1.2 mm，槽靠通道内侧只留 0.4 mm 边距、靠外侧留 1.6 mm。壁的局部强度、锁舌根部应力集中未验证。两根锁销是同一零件，但双手能否同时够到两侧未验证。
- 仍是离散采样：5° / 0.25 mm 步长只覆盖已测位姿，不证明帧间无干涉；锁舌转动的连续扫掠体积没有单独证明。
- 运动证据只覆盖九个输入角、两个截面；连续运动、载荷、摩擦与实物功能未验证。
- 本批没有用户确认记录，也没有付费模型调用；"已确认合同"只是门禁标志。
- M4 仍不能标完成：实物 L5、连续运动、完整自然语言产品闭环、M5/M6/M7/M8、独立隐藏集都未完成。

本批验证：普通测试 869 PASS / 3 SKIP / 0 FAIL（128 文件）；原生单缸测试 14 PASS / 0 FAIL（含新增"导向锁必须先转再拔"正反例）；`bun x tsc --noEmit`、`bun run lint`、`git diff --check` 均通过。未重跑全套 WASM、浏览器端到端、付费生成或实物试验。

## 2026-10-31 · 螺纹副（M5 第一步）：螺距、旋向与每转推进量

**新增**：`benchmarks/assembly/threaded_fastener.scad`（原创方形牙型螺旋副，两件）、`src/lib/assembly/thread-geometry.ts`、`src/lib/assembly/thread-motion.ts`、`src/lib/tools/thread-measurement.ts`、`scripts/eval/check-threaded-fastener.ts`、`scripts/eval/assembly-fixtures/threaded-fastener-geometry.json`、`benchmarks/assembly/threaded_fastener.md`。

螺纹参数：螺距 1.5 mm、大径 10.0 mm、小径 8.2 mm、牙厚 0.75 mm、螺纹段 18 mm、螺母厚 6 mm、单边径向与轴向间隙 0.15 mm。牙型是方形，不是 ISO 公制牙型。

**测量方法**（不读源码变量，只读渲染网格）：

- 两个螺纹半径来自螺纹窗口内顶点半径直方图的两个最强峰（相隔 ≥ 0.3 mm），各用峰内顶点均值细化；半径小于最大半径一半的顶点按端面扇心排除。
- 螺距与旋向来自**牙顶带的相位**：沿轴按 0.2 mm 分箱，每箱取顶点方向的圆均值并按上一箱解卷绕，再对箱高做直线拟合；`pitch = 360 / |斜率|`，斜率符号为旋向。外螺纹取大径带，内螺纹取小径带。
- 推进量来自多个转角重执行源码得到的网格：螺母轴向位置取最低顶点，朝向取六角角点的六重圆均值（模 60°），螺栓位置与朝向作对照。
- 每个位姿另做两件整网格的三角相交检测：推进正确不等于牙不互相啃入。

**真实运行**（原生 OpenSCAD，无模型调用）：目录 `.agentscad/experiments/threaded-fastener-jeYSbU/`，源码 SHA256 `ed4cb69d77027f8bc065e6c0f82466cb5b1b72cc6686d7921e185f7e8ce776b0`，配置 SHA256 `75369727b9c0e5e6ace1d9e7396ee3f46dcd8b366a67cc2e40bbd33d47d1c109`。

| 实验 | 结果 |
|---|---|
| 外螺纹几何 | PASS，螺距 1.500000 mm、右旋、大径 9.999977 mm、小径 8.199978 mm，90 相位箱，残差 0.00° |
| 内螺纹几何 | PASS，螺距 1.500081 mm、右旋、大径 10.296617 mm、小径 8.499976 mm，27 相位箱，残差 0.47° |
| 每转推进（9 位姿 / 2 转） | PASS，1.500000 mm/转、右旋，相对恒定导程残差 0.000000 mm，朝向散布 0.000°，螺栓漂移 0.000 mm |
| 位姿啮合（9 位姿） | PASS，9/9 `SEPARATED`，每次 554k–582k 三角对 |
| 负例：声明左旋 | FAIL（`right-hand, not left-hand`） |
| 负例：声明螺距 1.25 mm | FAIL（`1.5000 mm, not 1.25 +/- 0.01 mm`） |
| 负例：`plain-bore` 光孔螺母 | NOT_RUN（只找到 1 个半径总体） |
| 负例：`spin-only` 只转不升 | FAIL（`0.0000 mm per turn`） |

落座高度 0.60 mm 由碰撞扫描测出：把渲染好的螺母沿轴平移，无碰撞带 0.46–0.74 mm（宽 0.28 mm = 2 × 0.15 mm），中心即 0.60 mm，与 `pitch − 牙厚 − 间隙` 一致。扫描同时暴露了初版把 OpenSCAD 正扭转当成右手（实际为顺时针，得到左手牙），左手牙在 45°/90° 位姿相交；改正扭转符号后全位姿分离。

**可推翻条件**：若同一源码在同一 OpenSCAD 版本下重跑，牙顶带相位拟合得不到 1.500 mm，或 45°/90° 位姿出现三角相交而检查器仍判 PASS，或四个负例之一被判 PASS，则上表不成立。`report.json` 与 20 个原始 STL 足以在独立工具中重放。

**边界与未完成**：

- 只有几何，没有力学：无拧紧扭矩、预紧力、轴向承载、抗拔、防松、摩擦、磨损与疲劳。方形牙型不是自锁牙型。
- 只有 9 个采样转角；位姿之间与连续扫掠没有证据。螺母只从 0.60 mm 升到 3.60 mm（2 转），**没有走到脱出螺纹段**，"可完全旋出"未证明。
- 没有内嵌装配声明、ZIP、逐件重建、拆卸顺序或装配证据层。
- 螺栓的六角头与杆是两个在 z = 0 相接的壳体：`union()` 在本机需约 22 s 且不改变被测量特征，因此保留双壳并在此记录。
- 网格离散：杆 12 层/mm、螺母 16 层/mm，牙顶弦高误差约 0.076 / 0.043 mm；顶点本身在名义半径上，故半径与相位测量不受影响，但有效径向间隙会被吃掉一部分。
- 无实物：0.15 mm 单边间隙与 0.28 mm 落座带都是网格值，FDM 层厚与收缩足以吃掉这个量级。M5 的齿轮/行星级、M6/M7/M8 均未开始。

本批验证：普通测试 886 PASS / 3 SKIP / 0 FAIL（130 文件，新增 `thread-geometry.test.ts` 8 条与 `thread-motion.test.ts` 9 条）；`bun x tsc --noEmit`、`bun run lint` 通过。未重跑原生 OpenSCAD 测试套件、WASM、浏览器端到端、付费生成或实物试验。

## 2026-11-03 · 螺纹副声明、分别导出与零位姿重建

`benchmarks/assembly/threaded_fastener.scad` 加入 V1 装配声明：bolt/nut 两件、两实例、bolt 固定、screw 连接 pitchMm=1.5。螺母局部网格在源码中已包含 0.6 mm 的原点偏移，零位姿的实例变换是单位矩阵。schema V1 无 hand 字段，未知项明确标示旋向无法在此声明；没有伪造装拆操作或制造条件。原先 2026-10-31 的九姿态证据与源码快照未更改，其哈希仍只对应旧源码。

`bun scripts/eval/check-threaded-export.ts` 真实本地原生运行：ZIP 含两件 STL，解包后按清单将局部网格定位，与单独重渲染零姿态逐三角面核对：bolt 11304 面、nut 3290 面全部匹配，最大顶点偏差 0 mm；故意将 nut 位姿 Z 偏移 1 mm，FAIL。目录 `.agentscad/experiments/thread-export-Capive/` 保存新源码、ZIP、两件姿态网格与报告。源码 SHA256 `8b039197196d073b90d0492f09cdf36e0f26180fa94c573e9b1d35b62fc50b5a`，ZIP SHA256 `6fec2ed98c0ccd8fc8e9d04db59162177e34649711804b5d995de04b61ac63d1`。无确认需求合同，ZIP 中包括拆卸与实物在内的所有证据层保持 NOT_RUN。

该证据不证明完整旋出、任何实际旋向合同、物理可制造、流形或分离的零件可完成装配。螺栓为两个相接壳体；切片软件是否能正确处理未知，历史文本已撤回未经实测的切片结论。独立复核可读取 ZIP 与姿态 STL 检查表面；任一表面偏离超过 1e-4 mm 即可推翻重建结果。独立工具尚未执行。声明结构测试1 PASS，TypeScript检查通过。

## 2026-11-03 · 螺纹长程验证前发现的证据缺口

对此前九姿态的运动测量做独立反例审查，发现两个可复现限制：六角外轮廓只确定到模 60°，故错误转角与正确转角可能具有相同读数；原螺栓固定性只覆盖底面 Z 和模 60° 朝向，不能排除螺栓 X/Y 漂移。**因此上文的运动 PASS 只能表示旧方法下的位置/模 60° 对照通过，不能证明真实完整角度关系或螺栓三维固定。** 外/内牙形静态测量和已采样碰撞结果不因此自动失效，但各有其原有覆盖边界。

预先冻结 12 转、90° 步长、轴向净距 0.1 mm 的长程实验后，发现旧脱出检查只要求采样范围达到 12 转，未限制实际首次脱出时刻；另有非同轴物体可在 Z 向越过但不代表螺纹脱出。最初实验 `.agentscad/experiments/thread-exit-cv1iex/` 在仅完成 0°、90°、180° 渲染后因上述判据缺陷主动终止（退出130），保存中间网格，无最终报告；状态 NOT_RUN，不得算成功或失败率。随后按设计值先行冻结首次轴向分离在 11.5–12 转（18 mm 螺纹、起点 0.6 mm、净距 0.1 mm、导程1.5 mm/转），新增初始 XY 包围盒投影重叠与过早脱出负例；这仍不能替代同轴度或牙面啮合实测。实际脱出是否通过尚未验证。

### 2026-11-03 路径预算、导出可复现性及螺纹误判修正

- 独立审查复现最终姿态碰撞计算超时后仍可 PASS；现于每次非阻挡碰撞和最终返回后复核预算，序列完成后再复核总预算，超时 NOT_RUN，已观测碰撞仍 FAIL。同步 BVH 构建和单次窄相调用不可抢占，预算是结果门禁，不是硬运行时间上限。模拟时钟与原生卡口均已测试。
- 固定相同源码、合同、拆卸声明、网格与 ZIP 时间，旧归档 6 次得到 6 个不同哈希；原因是动态 elapsedMs/剩余预算写入 manifest。归档去除动态耗时，保留总预算及状态；含真实操作的重复构建连续10次字节一致，预算耗尽负例仍 NOT_RUN。不同状态当然允许不同 ZIP。
- 螺纹角度由实际内轮廓单截面径向第一谐波辅助，已对真实 90° 命令/实际 30° 的重新渲染负例测得 60° 差异并 FAIL；真实螺栓网格 X 平移4 mm 的负例 FAIL。原始 `.agentscad/experiments/thread-phase-c13ZuJ/`。相位观测模 360°、仅单截面且总不确定度未标定；不能断言真实连续旋转圈数。螺母偏心注入只能说明该具体反例可检出，不能推广为轴线测量。
- `sampleThreadedFastener` 增加渲染前合同和角度预检；错误输入不会先做几十次高成本渲染。加了单独 `coaxiality: NOT_RUN` 必需层：既有相位、外框、采样碰撞均不能代替螺纹轴测量，因而总状态保守为 NOT_RUN，实际已知失败仍为 FAIL。
- 旧 12 转实验在修正脱出范围前主动终止，详见上一节。新版 `.agentscad/experiments/thread-exit-Q5psOX/` 正运行，直到完成并检查报告前都是 NOT_RUN；采样跨合同边界为 NOT_RUN。首次采样脱出点只能界定一个采样区间，不能证明期间没有越界后返回。脚本保存部分源码和参数；OpenSCAD 版本写在启动日志标准错误并另存 `version-from-startup-stderr.txt`，主 provenance 中空字符串不是完整版本记录。

### 同轴探索的保守边界

新增隔离原型 `thread-axis-prototype.ts`：在三个以上网格截面上对候选圆弧做原创圆拟合并估计两条轴。输入半径窗口与最少点/角覆盖等条件预先固定；无独立校准误差界时一律返回 NOT_RUN，不参与主流程门禁。`bun scripts/eval/explore-thread-axis.ts` 在先前同一夹具的90°/270°网格上进行离线开发样本复核，原始输入哈希、截面设置、注入算法、源码快照和结果保存在 `.agentscad/experiments/thread-axis-holdout-ibuCp4/`。原件中心距估计约0.0209/0.0339 mm，注入0.4 mm侧移后估计约0.4206/0.4314 mm，注入斜率0.1后的夹角估计约5.755/5.687°。这些样本来自同一夹具，不是独立隐藏集；观测大注入不建立小误差上界，也不能证明识别的曲线就是所要求的真实孔轴。全部比较为 NOT_RUN，不放宽阈值。

### 螺旋拆卸声明的现有架构缺口

对照当前代码，交接里“49 个 90° waypoint 可直接复用现有拆卸检查、无需 schema 变化”的说法不成立：`AssemblySpecSchema` 每个操作最多 200 个 waypoint，而 `checkDeclaredPoseDisassembly` 默认相邻转角最多 5.001°。12 转以 5° 采样至少需要 865 个位姿；49 个 90° 位姿会被现有门禁拒绝。把门禁直接放宽到 90° 会扩大未覆盖区间，不可当成与原标准等价的通过。

可考虑用有界参数化螺旋轨迹或外部绑定轨迹文件表达密集路径，再由确定性工具展开；也可明确声明并单独评估较粗采样。如何与原有 V1 声明、哈希、固定碰撞预算和产品端兼容尚未决定。即使把初始刚体网格按解析轨迹旋转平移，也只能证明该假定刚体在采样姿态的数字碰撞情况，不能替代对生成源码每个中间姿态的真实重渲染或连续扫掠证据。

额外实际复核：对此前保存的真实螺栓/螺母 0° 网格，使用通用碰撞器默认的 200,000 三角对预算，结果为 UNKNOWN（检查 200,001 对后停止），不是 SEPARATED；原螺纹实验使用 4,000,000 上限才完成该姿态检查。因此即便解决 waypoint 数量，直接套用当前通用路径默认碰撞预算也不能得到已验证的螺旋拆卸。提高预算会增加 CPU 开销，必须明确报告方法、预算和超时，不得把 UNKNOWN 转成通过。

原创 `src/lib/assembly/screw-path.ts` 已提供不依赖特定零件的参数化螺旋刚体位姿展开：世界轴、左右旋、导程、起止角和最大步长明确，12 转/5° 产生 865 个累计位姿，最多 4096；对反向、偏心轴、任意轴、非法输入和预算有 7 项局部测试。该原型不执行碰撞或实物检查，二者均明确 NOT_RUN；尚未接入 V1 声明或产品流程，不能声称已解决上面的 waypoint/预算问题。

### 2026-11-03 · 修订后 12 转真实渲染结果

本地 49 个姿态的实验已结束，约 743 秒（按保留的源码快照和报告文件修改时间之差估计，非精确计时），无模型调用：`.agentscad/experiments/thread-exit-Q5psOX/`。源码 SHA256 `8b039197196d073b90d0492f09cdf36e0f26180fa94c573e9b1d35b62fc50b5a`，规范化合同 SHA256 `8765ba9db1fc018de223ae59a3fbc9ebc03b934c00e3eaa799f2eb78fef60b61`。源码、冻结合同、各姿态实际渲染的两件 STL、部分验证器快照、报告与短行程负例均保留。运行时 OpenSCAD 将版本写至标准错误，原始启动输出另存为 `version-from-startup-stderr.txt`；provenance 主字段为空，快照并不包含全部传递依赖，不能声称环境已完整封存。

- 0°–4320°，每 90° 实际重新渲染两件；49/49 个姿态 `SEPARATED`（不是连续扫掠）。外/内牙形子检查、采样推进与单截面相位子检查 PASS；估计推进 1.5 mm/命令转，采样相位误差 0°，相位总不确定度未标定、角度模360°。
- 4140°（11.5 转）螺母最低点 17.8500004 mm，未超过螺栓顶部 18 mm 加净距 0.1 mm；4230°（11.75 转）螺母最低点 18.2250004 mm，超过该阈值。轴向子检查 PASS，报告的**采样转变区间为 11.5–11.75 转**，不证明区间内连续轨迹或首次真实脱出时刻。
- 只取前 2 转却要求覆盖 12 转的负例 FAIL。原子碰撞预算最高消耗 609,923 三角对；工具对 UNKNOWN 不放行。
- 初始与退出前的 XY 包围盒投影重叠只是必要条件，不证明同轴或牙面真实啮合。独立 `coaxiality` 仍 NOT_RUN，故总状态 **NOT_RUN，命令退出 2**；未测物理、自锁、摩擦、制造公差或连续运动。不得把轴向子检查 PASS 表述为功能螺纹副或 M5 完成。

本轮最终软件验证：`bun run test` 914 PASS / 3 SKIP / 0 FAIL（135 文件）；螺旋路径、螺纹运动、退出判据及预检定向 29 PASS；类型检查、lint 与 diff 空白检查通过。真实螺纹 49 姿态实验及零位姿 ZIP 如上，未执行全套 WASM、浏览器、付费模型、独立隐藏评估或实物制造。本轮新增螺旋路径原型仅生成位姿，未改变 schema、产品端或碰撞默认预算。

## 2026-11-04 · 螺旋拆卸声明、轴线特征身份与碰撞壳回归（补记）

> **补记说明**：本节记录的实验与代码改动发生在 2026-11-04 00:05–00:09，当时既未写入本日志，也未更新交接文档；交接文档与本节之前的日志都停在 2026-11-03 18:26。以下只复述各实验目录里实际保存的报告字段与哈希，不追认当时没有做的验证。目录均在 `.agentscad/experiments/`（被 gitignore），换机器复核需依赖本节留下的哈希。

### 声明层：旋向与密集螺旋轨迹

`src/lib/assembly/assembly-spec.ts` 在 `operation` 上新增**可选** `screwTrajectory`（`axis`、`hand: right|left`、`leadMm > 0`、`startAngleDeg`、`endAngleDeg`），要求 `waypoints` 为空且起止角不同；因为可选，旧声明的规范化形式与哈希不变。`src/lib/assembly/declared-pose-disassembly.ts` 将其展开为理想刚体位姿序列，`src/lib/assembly/assembly-bundle.ts` 在 ZIP 内写入规范声明 `specification.json`，由 `manifest.specificationSha256` 绑定其字节。

**`connection` 仍然没有 `hand` 字段**：旋向现在只能在拆卸操作的轨迹里声明，不能由连接声明。交接 §7 P1 第 4 点「旋向不可声明」应据此修订为「连接层不可声明、操作层可声明」，不是当作已完全解决。

`bun scripts/eval/check-threaded-screw-export.ts` 原生运行，目录 `.agentscad/experiments/screw-declaration-export-O82rWp/` 与 `screw-declaration-export-Yvpuka/`：

- 源码 SHA256 `8b039197196d073b90d0492f09cdf36e0f26180fa94c573e9b1d35b62fc50b5a`，规范声明 SHA256 `50d79e798ab799a729ed2fe54f9342d78d6bd6f95881adc5f43c4bb0ed34d135`。ZIP SHA256 前者 `7d57888b19c602673a6311fb0255c1e421936ec80fea4812214c312c4a1e1408`、后者 `6759abf64aefdc7555bbf0c908c4c59fdab54b35b04bdd258ad63036a443bbf2`；两次运行之间代码有改动（前一份 `backend` 为空、后一份为 `native`），**两个 ZIP 哈希不能拿来证明可复现性或不可复现性**。
- `spec.json` 的 `remove_nut` 操作声明 12 转（0°→4320°）、`hand: right`、`leadMm: 1.5`。展开为 5° 采样、`translationStepMm ≈ 0.0208333`、`rotationStepDeg ≈ 5.0000`，`posesSha256 = 4f7cb1a7032387930c1677533cfaba3afdd1cd0f122bafcf50cf91be043bce97`，两份报告一致。
- **拆卸结果为 NOT_RUN。** `disassembly.status = NOT_RUN`，`method = declared-dense-pose-disassembly/v1`，`budgetMs = 5000`；`results[0].path.status = NOT_RUN`，`posesEvaluated = 1`，原文理由 `Stopped after 200000 triangle-pair tests without finding an intersection; separation is not proven.`。即默认 200,000 三角对预算在**第 1 个位姿**耗尽，其余位姿未评估；`remainingInstanceIds` 仍为 `["bolt","nut"]`。
- `evidence` 六层（identity / geometry / assembly / disassembly / motion / physical）全部 NOT_RUN，`physical: NOT_RUN`。覆盖原文：`Native per-part render; ideal sampled path only. No thread engagement, continuous path or physical function is verified.`

这证明「声明能表达 12 转螺旋拆卸、展开的位姿可哈希」，**不证明**拆卸可行、牙面啮合、连续轨迹或任何实物能力。

### 碰撞壳回归：旧证据在足够预算下重算

`bun scripts/eval/check-collision-shell-regression.ts` 两次离线重算，目录 `collision-shell-recheck-1793747329266/` 与 `collision-shell-recheck-1793747371971/`，各保存 `collision-source.ts`、`script.ts`、`report.json`；碰撞源码 SHA256 分别为 `8c984246f150b53389b325e2eaf2d43f1aee77e5ef49ceec0c1bfe61719ca176` 与 `0c5a1b9db9ab7559c6e51d428dc74fadc9c6a3474068b6b011e85da62a5a8ffb`（两次之间源码不同）。每次 374 行：thread 49、slider 324、quarter-turn 1，**374/374 `SEPARATED`**，测试三角对 0–609,923，`budgetExhausted = 0`。

这与 2026-11-03 记录的「真实螺纹 0° 网格在通用 200,000 预算下为 UNKNOWN」不矛盾：本次用的是足够预算。它复核的是**已保存 STL 之间的三角相交**，不是重新渲染、连续扫掠或牙面啮合。

### 轴测量：解析样本与特征身份反例

新增 `scripts/eval/assembly-fixtures/thread-axis-experiments.md`、两份冻结合同（`thread-axis-analytic-protocol.json`、`thread-axis-decoy-protocol.json`）及三个脚本。每次运行把协议、算法/脚本源码与 STL 一并写入目录并留哈希。

- **解析样本** `thread-axis-analytic-afZcbd/` 与 `thread-axis-analytic-iRyjUB/`：同一协议 SHA256 `67cd808ab155054380a1f21517345b56451d0a85383e5aebacf766cb5d589180`、同一算法 SHA256 `88ea28e2a28b58ff49bd9e467528f2a9f40ea5d513464f65ed740e5d5cdd9a09`，脚本哈希不同（后者为修订后重跑）。4 个多边形棱柱样本中 3 个可测，在**仅适用于本实验、运行前冻结**的界（offset 0.05 mm / angle 0.5°）内最大位置误差 0.00319 mm、角度误差 0.185°；半径超出窗口的样本无估计。**所有比较均为 NOT_RUN**，理由 `Exploratory axis comparison has no calibrated error bound`。样本是棱柱不是螺纹，不构成泛化或不确定度界。
- **特征身份反例** `thread-axis-decoy-yphCRx/`：构造孔心在 (0.5, 0) mm、外轮廓心在 (0, 0) 的环形件，目标特征是孔。圆拟合在约 357° 覆盖与毫米级以下径向残差下仍拟合到**外轮廓**：拟合轴距孔心 0.49974 mm、距外轮廓心 0.00029 mm。STL 边入射检查为 768 三角、无异常边或退化三角；系统 Python 无 `trimesh`，独立工具未运行。`fit.status = NOT_RUN`。**结论**：拟合良好不等于识别了目标特征；生产同轴度验证还需特征绑定与经标定的测量不确定度。

### 本轮边界

- 螺纹副总状态仍为 **NOT_RUN**（独立同轴度未校准），2026-11-03 的 49 姿态结论没有因此升级为 PASS。
- 螺旋拆卸仍 NOT_RUN（预算在第 1 位姿耗尽）；`screwTrajectory` 只生成理想刚体位姿，碰撞与实物均 NOT_RUN。
- 两个轴线实验都不产出装配结论；decoy 是**否定性**证据，不能反过来当作「同轴度已解决」。
- 没有付费模型调用、没有实物、没有连续扫掠、没有对每个中间位姿真实重渲染。

### 2026-11-04 · 基线恢复（本日核对与修正）

本日核对交接文档时发现基线不再干净：`bun test` 为 936 PASS / 4 SKIP / **8 FAIL**（140 文件），而 2026-11-03 记录是 914 / 3 / 0。8 条失败都是 11-04 收紧证据门禁后测试期望未同步，按证据语义修正，**没有放宽任何产品门禁**：

- 7 条（`src/lib/assembly/path-and-motion.test.ts`、`src/lib/assembly/repair-findings.test.ts`）：rotor 夹具的轮毂（外径 5 mm）与径向臂（从 x = 4 mm 起）包围盒重叠，`mesh-collision.ts` 的 `classifyContainment` 对同网格内重叠壳界返回 `UNKNOWN`，`evaluatePose` 归为 UNDECIDED，路径/运动检查降级 NOT_RUN。把夹具的臂移到轮毂外径之外（x = 5.1 mm）使两个闭合壳的界严格分离，恢复原有的 PASS 正例覆盖；同时新增 2 条负例，用原来的重叠壳网格断言 `checkDisassemblyPath` 与 `checkMotionRange` 必须返回 NOT_RUN，把「UNKNOWN 绝不当 clearance」固化成回归测试。
- 1 条（`src/app/api/__tests__/assembly-bundle-route.test.ts`）：ZIP 新增 `specification.json`，同步文件列表，并补 `manifest.specificationSha256` 与该文件字节的哈希绑定断言（与 `assembly-bundle.test.ts` 已有的断言一致）。

**产品限制（不是测试问题，需单列）**：`closedShellSamples` 把「同一网格内包围盒重叠的多个闭合壳」判为 UNKNOWN。真实的轮毂+臂、螺栓头+杆这类连通多壳零件都会落入这一类，其路径/运动证据会保守地变成 NOT_RUN。本次只调整测试夹具，**没有改这条规则**；要不要支持连通多壳的可靠包含判定，需要独立设计与校准，不能靠放宽阈值解决。螺栓本来就有「两个相接壳体」的已知缺陷（见 2026-10-31 节），这一限制与之叠加。

修正后本日验证：`bun test` **946 PASS / 4 SKIP / 0 FAIL**（950 测试 / 140 文件）、`bun x tsc --noEmit` 通过、`bun run lint` 通过、`git diff --check` 干净。未重跑原生 OpenSCAD 全套、WASM 全套、浏览器端到端、付费生成或实物试验；上文所有实验结论仍按其各自边界有效。


## 2026-11-06 Workspace reconciliation after reset

Current git reflog records a reset to 891f802. Tracked implementations differ from previously tested archives while newer untracked tests and API files remain. Earlier green logs describe the earlier source versions. Current verification reproduced visual recovery failure, then restored claim ownership, call counting and shared source preservation. The focused seven-file suite passes 45 tests. The source guard also protects grounded instance and operation identities.

Restored 12 clean tracked source files from retained-station-probe-SSeylZ and paid-deepseek-assembly-6SuXtv archives, preserving originals and exact source hashes in .agentscad/experiments/reset-reconcile-8rs_yshh/restoration.json. This restoration is incomplete. Latest full run is 930 PASS, 3 SKIP, 28 FAIL, 1 ERROR across 961 tests. Typecheck reports missing interfaces in the retained evaluator, thread prototype, export-lock token and provider settings. Test fixture changes for actual bore voids, contact semantics and new gating also need reconciliation. Logs are retained beside the restoration manifest.

Next restore evaluator and provider interfaces, export-lock token contract, then reconcile archived fixture regressions without weakening product checks. Run the resulting full suite and native affected cases. User authorized commits at appropriate milestones. Commit a coherent verified stage with its evidence, then record its hash in the handoff. Full functional assembly goal remains active. No new paid model requests.


## 2026-11-06 · 版本恢复阶段完成验证并准备提交

当前版本已恢复导出证据接口、模型预算参数、局部孔轴材料角色、实测关节帧、零件连通性、重装一致性和显式装配路径依赖。两批源码恢复前文件保存在 .agentscad/experiments/reset-reconcile-8rs_yshh。新增未跟踪研究代码与回归也纳入此阶段版本，后续可通过Git复核。

恢复旧测试时保留较强的产品检查。实心bore正例改真实tube，交换孔轴角色返回ERROR。仅局部配合通过而缺重装、帧或完整序列时，整体仍NOT_RUN，独立fits测量保留PASS。接触字符串缺区域证据时不能豁免碰撞。闭合多壳并集查询已有正例，宽范围干涉及预算耗尽负例继续阻挡通过。导出路由fake CLI的all改为包围全部零件的测试包围盒，重装几何质量须由真实OpenSCAD测试另验。

真实原生铰链的完整数字合同测试使用单独版本的显式装拆声明，以declaredPathObservation和有符号motionRangeObservations取证。原始空操作声明保留。一次迁移重复提供motion-range-deg使观察器拒绝，移除重复后完成重跑。修复闭环的局部测量测试补充真实整机渲染后再要求assembly PASS。

最终全单元966 PASS /3 SKIP /0 FAIL，969测试、146文件、33.66秒。受影响原生铰链与重装11 PASS /0 FAIL，33.82秒。typecheck、lint和diff检查通过。当前测试数对应恢复后的实际文件，历史1000 PASS仅适用于历史版本，当前尚未复原全部历史新增用例。日志归档上述恢复目录。模型调用0，累计付费上界继续为1.701554 CNY。

本阶段提供可提交的代码恢复与回归。浏览器九层展示、完整WASM、完整原生、生产构建部署、自动生成流水线的完整装配反馈、特征定位、多关节/V8、独立隐藏评估和实物退出条件仍待验收。用户授权适时提交，此阶段检查已完成。完整目标active。


## 2026-11-06 · 正常验证与装配修复反馈接通

新增 src/lib/validation/assembly-validation.ts，validateRenderedArtifacts在普通网格验证后执行A001。有效声明实际渲染选择器、检查逐件连通性、整机重装、单铰链配合/实测帧、显式操作与采样运动。请求明确独立多件或装拆而声明缺失/非法时FAIL。已有声明可保留测量，用户需求缺确认时通过的子测量降为NOT_RUN。自动检查上限八实例，其余NOT_RUN；多关节自动配合绑定仍待实现。单零件且无装配声明时保留原路径。

A001保存sourceSha256和完整manifest至原validationResults，并随现有artifact版本链存储。该快照包括合同绑定和原始测量，本阶段尚未把自动流水线记录接到独立检查receipt的CURRENT/STALE读取协议。长时间检查期间需求变化的原子复核仍需完善。

测得FAIL进入既有一次自动修复。ERROR/NOT_RUN只保留为待检查证据。初次及修复后的A001非PASS，流水线交付前转HUMAN_REVIEW，保存源码/产物/检查。手动修复和视觉修复同样根据A001未解决状态保留人工检查。确定性测量FAIL、工具不可用与缺确认在报告中保留各自状态。修复器接收A001的具体失败原因，后续重新执行验证。

整机C002多表面在有效声明下转NOT_RUN，逐件完整性由A001检查；明确expected_component_count仍严格核对。此改动避免自动修复把合法独立件合成一体。闭合边连通检查、离散路径与理想运动的既有适用域继续有效。

测试覆盖单零件无额外装配调用、缺声明和非法声明、未确认测量暂停且不花修复调用、实际失败修复一次而重测NOT_RUN继续暂停，以及视觉PASS但装配待查仍HUMAN_REVIEW。流水线模型与渲染在状态测试中采用mock。新增原生测试直接复用实际铰链SCAD，通过正常验证适配器渲染并测得装配/拆卸/配合原始PASS，确认标志false使最终NOT_RUN。浏览器自然语言生成端到端、隐藏评估及实物尚待执行。

最终全单元971 PASS /3 SKIP /0 FAIL（974测试、147文件、38.78秒）。新增原生1 PASS，10.90秒。最终typecheck/lint退出0，diff通过。最初新增重依赖导入影响pipeline隔离mock，改为低依赖证据状态判断后通过。归档 .agentscad/experiments/pipeline-assembly-validation-n1ydsbur/index.json，源码运行后快照。模型调用0，累计费用上界1.701554 CNY。完整M0–M8目标继续active。

下一步完善需求确认后复核流程及原子版本绑定，给模型修复提供完整装配声明格式指引，再验证同一真实失败件能否依据数值反馈保留功能地修复。特征定位、接触域、实际SCAD运动、保持防脱、多关节/V8、实物与独立隐藏评估仍待完成。


## 2026-11-06 Confirmation response and shared visual repair mutex

Visual repair now holds claimAssemblyExport's shared execution lock, renews it every 20 seconds, checks it before writing results and releases it in finally. Requirement storage already refuses jobs with __execution_lock. Request-level processing-state and updatedAt checks already rejected common concurrent confirmations. This change extends storage-layer mutex protection to visual repair. The earlier suggestion of an observed request-level confirmation vulnerability was an inference and was not established.

An isolated SQLite regression attempts requirement confirmation inside the mocked visual repair callback. Storage rejects it while locked. A concurrent visual repair POST returns 409 without more model calls. On completion the lock count is zero, and fresh requirement confirmation succeeds. Two mocked model calls increment the job counter from 7 to 9. Existing preflight failure and replaced-owner negatives still pass.

Requirements PUT now returns derived and derivedSha256, matching the response shape consumed by ContractView. API regression checks derived assertions and request hash. Browser describeAssertions needs derived.requirements. Current browser interaction was not rerun.

Final unit suite passes 971 tests with 3 skips, 974 tests across 147 files in 33.05 seconds. Typecheck, lint and diff checks pass. Sources and logs are archived at .agentscad/experiments/confirmation-visual-lock-ez71r7cr/index.json after execution. No new paid calls. Accumulated cost upper bound remains 1.701554 CNY. Geometry, native and WASM validation were not repeated in this route-only change.

Automatic A001 evidence is retained with artifact versions. Dedicated CURRENT/STALE report integration, confirmation-to-recheck UI, real model repair, multi-joint/V8 and manufacturing/function acceptance remain open. Full M0-M8 goal is active.

## 2026-11-06 · 确认需求后的浏览器复核与报告下载

新增 AssemblyVerification 界面，提供确定性检查、九层证据、保存时间、明细折叠和报告下载。GET/POST 绑定当前源码与声明哈希，旧版本、缺失或不可用报告均显示未检查。执行 ERROR 也会屏蔽通过状态。请求序号避免较早 GET 覆盖较新的 POST，切换任务和版本时取消旧请求。中文标签已补齐。

实际浏览器发现待审任务点击检查收到409。根因是专用检查接口复用了仅允许DELIVERED的导出守卫。守卫现在接受服务端指定的verification用途，允许HUMAN_REVIEW检查。导出默认条件继续单独核对。真实SQLite回归覆盖待审检查能取得锁、默认导出被拒、结束后释放锁。

原始归档为 `.agentscad/experiments/assembly-recheck-ui-4eep9yd4/index.json`。独立SQLite、localhost:3139、gstack无头Chromium和原生OpenSCAD执行。任务由浏览器同源API创建，测试脚本仅将原创手写铰链及显式装拆声明放入隔离任务并真实渲染预览和STL。浏览器实际点击确认需求、检查和下载，操作发生于HUMAN_REVIEW状态。模型调用计数为0，验收账本无事件。本例支持产品操作验证，模型生成与实物功能仍待验收。

首次检查5552ms，identity/reconstruction/jointFrames/assembly/assemblyPath/disassembly/motion通过，geometry及physical为NOT_RUN。刷新并重新选中任务后ID及哈希相同。报告下载按钮产生的Blob经观察解析，ID、记录ID和哈希均与存储报告一致。首次下载观察过早得到null，最终改为等待Blob解析后核对，两个过程均保留。

通过浏览器同源需求API将间隙改为0.1–0.3mm，旧报告变STALE，原记录与哈希保持，界面九层均显示未检查。此变更通过API执行，确认后编辑需求的界面尚待实现。实际点击重查耗时5773ms，配合FAIL，其余已测层各自保存结果。报告及DOM分别保存在current-report、reload-api、download-final、stale-report、stale-dom、failed-fit-report与failed-fit-dom文件中。

浏览器核验状态为DONE_WITH_CONCERNS。控制台有WebGL上下文初始化错误，以及修复前检查接口的409，原文保存在console-errors.txt。已查看的截图中模型及九层面板可见，3D交互尚未独立验证。截图current.png、failed-fit.png及evidence-visible.png均已人工式视觉查看。没有将控制台标为全干净。

最终单元973 PASS /3 SKIP /0 FAIL，976测试、148文件、35.32秒。清理隔离Next生成产物后typecheck和lint退出0，diff通过。最初lint扫描临时生成JS产生错误，删除本轮独有构建目录后重跑通过。隔离服务停止，专用浏览器标签关闭，tsconfig临时条目已清除。保留数据库、源码、报告和运行后工具快照，尚无异地备份。

本轮模型费用0，累计保守上界1.701554 CNY。完整M0–M8目标active。下一步统一自动A001记录与专用CURRENT/STALE报告，复核真实模型修复、多关节与手动V8，随后按工艺条件进行独立制造及功能验收。

## 2026-11-06 · 保留失败件的有界模型修复与独立几何复核

对原付费候选 `paid-deepseek-assembly-6SuXtv/hinge-explicit-assembly-45-1.scad` 用当前检查器免费重测，并先冻结源码、反馈和直接工具快照。基线及协议保存在 `.agentscad/experiments/seeded-hinge-baseline-rjvl7pz1/`。单任务只允许一次新调用，源码和反馈哈希、原始请求以及任务集哈希均在准入时核对。候选必须保留有效装配声明及已有零件、连接、范围、固定实例和操作身份，拒绝结果和完整回复仍留档。

沿同一28 CNY账本实际调用一次，归档 `.agentscad/experiments/paid-deepseek-assembly-0QCJR3/`。返回模型名为deepseek-flash。5021输入、10602输出tokens按高峰未命中上界计0.094858 CNY，累计17条请求记录的保守上界为1.796412 CNY，其中包含先前计费不确定请求的全额预留。账本为TERMINAL，临时密钥已删除。余额前后均显示31.9，不能从显示精度推断本次免费。官方当日价格及旧模型别名映射见 https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ 。

模型保留两件、关节、范围及操作身份，并把装配和拆卸路径各从5个位姿扩展到105个位姿，最大间距0.25mm。检查器现在能运行这两条路径，但都在装配零位发生INTERSECT并标FAIL。装配检查按逆序进行，所报初始位姿对应原装配路径的终点。运动在-45度报告相交FAIL。固定件连通性FAIL，整体重装超时NOT_RUN，默认配合/关节帧在-12mm截面ERROR。身份选择器PASS仅表明产物不同及范围检查，不能覆盖这些失败。用户验收和实物均NOT_RUN。

独立Python标准库脚本 `scripts/eval/audit-retained-hinge-repair.py` 按冻结哈希读取两次生成的二进制STL，核对有限坐标、三角形面积和有向边，并以独立顶点图和立体角采样复核零位。原固定件两分量间X方向空区间约1.700001mm，修复稿仍为两分量、空区间约1.1999998mm。原活动件轴心[0,0,0]为OUTSIDE，修复稿该点在活动件和固定件中均为INSIDE；远点[100,100,100]对所有网格均为OUTSIDE。源码中活动件桥接块在孔的局部difference之后union，提供了孔被重新填实的具体解释。该复核限于冻结网格、单位变换和数值采样，不是完整自交、连续运动、柔性或实物证明。审计协议是在读取修复源码后、执行独立审计前制定，因此不是盲评。

在局部孔筒范围预先选择[-5.5,0,5.5]mm进行只读对照，修复稿轴可测而孔在0mm截面仍ERROR，轮廓与圆柱不符。归档 `.agentscad/experiments/retained-station-probe-wA4Ndj/`，直接工具运行前后哈希一致。这与独立轴心材料采样相互支持，但不是自动特征定位或整个配合长度的证明。

修复反馈现包含部件局部空区间的轴、端点和宽度；不得把该宽度称作已测的任意两实体最近距离。新回归保留端部可测、中间被堵的反例。生成与修复技能新增最终布尔顺序、桥接重叠和保持肩通路的推理提示，并说明直线位移可用两端点由检查器采样。这些提示在本次模型调用完成后加入，尚无证据证明它们能让模型修复成功。单个公开开发案例不构成模型成功率或更换CAD内核的依据。

最终单元976 PASS /3 SKIP /0 FAIL，979测试、149文件、30.24秒；typecheck、lint和diff检查通过。Python审计、源码、原始SCAD/STL、协议、费用和请求/回复均保存在本机忽略目录，未封存全部传递依赖或异地备份。本次使用有界评估脚本经产品模型路由调用，尚未在浏览器完整自然语言生成与修复链路中复现。完整M0–M8目标继续active。

## 2026-11-06 · 装配声明指导进入正常修复

代码检查发现正常 `runRepair` 原先只加载修复技能；对于缺失或损坏装配声明的 A001 FAIL，提示提供失败信息，却没有生成技能中的声明格式与选择器约定。现在对 A001、已有声明或可识别的装配请求，在修复系统提示中加入生成技能内有界的同一段装配格式，不引入生成阶段的输出格式。单件请求不增加该段。缺失声明时既有保护器无法比较旧的有效声明；新声明依旧必须重新渲染和验证，不能因模型写出声明而认定完成。

另发现两种生成提示均未说明 `boreInstanceId`：对孔轴侧已知的转动连接，该字段可让现有验证器尝试铰链及配合测量；不知道时应省略，不能填 null。补充此字段并更正制造条件中 `notes` 是字符串数组。声明字段不构成几何或实物通过的证据。修复提示也不再声称所有列出的几何约束均由声明保护器自动拒绝。

隔离模拟模型的真实 `runRepair` 入口已检查 A001 缺声明及装配编译修复得到格式，普通单件修复不增加格式；技能解析测试检查标记完整和两种生成入口均包含孔侧字段。完整单元回归977 PASS / 3 SKIP / 0 FAIL，980测试、149文件、31.42秒；typecheck、lint与diff检查通过。没有新的付费调用或物理测试，也没有证据表明提示改动能修好保留的失败铰链。预算累计保守上界仍为1.796412 CNY。

## 2026-11-06 · 生产修复提示实测与轴向保持假通过

对同一原始失败铰链先运行实际 A001 检查：固定件分离空区间 1.700001 mm、−45°干涉为 FAIL，孔轴测量、装拆路径为 ERROR，重装为 NOT_RUN；需求未经过用户确认。随后调用一次实际 `runRepair`，传入这条 A001 结果，并通过可注入的完成器使用临时 DeepSeek provider、65536 输出 token 上限和既有28元账本；未调用浏览器或完整 `executeCadJob`，没有传入其他常规验证结果。调用前冻结源码、实际反馈与部分直接工具，先模拟验证恰好调用一次；这些快照不是完整可复现环境。运行档案在 `.agentscad/experiments/product-hinge-repair-rNS2JA/`。

非流式请求约324秒，返回 `deepseek-flash`，8018 输入、62949 输出 token，其中56334为推理 token。按官方高峰未命中价格记 0.519628 元，账本18条记录的累计保守上限 2.316040 元，状态 TERMINAL，临时密钥已删除。模型回复包含 `END_AGENTSCAD */` 而不是要求的 `END_AGENTSCAD_ASSEMBLY */`，故产品保护器拒绝了候选，实验保留原源码，未修改产品数据库；原回复没有进入产品几何验证。原始回复和被拒源码分别存档，未将手工改动当作模型输出。

为定位根因，仅在诊断副本中更正一次结束标记，所得声明通过解析和既有身份保护，再重新渲染：两个零件的有限连通检查、三处截面的 0.400–0.425 mm 直径间隙、指定范围内的理想刚体采样运动和单姿态重装均 PASS；声明的两条装拆路径因远端位姿仍在障碍包围范围内而 FAIL。独立 Python 有向边与顶点图检查确认两个冻结 STL 各一个封闭连通表面，在 z=−4.8、0、4.8 mm 轴心上固定件为 INSIDE、活动件为 OUTSIDE，远点对照均为 OUTSIDE。采样点在查看回复和报告后选定，并非盲评；没有证明完整无自交、连续运动或制造功能。

第二个诊断副本仅将直线装拆路径端点由 −10.8 mm 扩展到 −16.25 mm，并保留两个端点由检查器采样。旧离线评估因此返回 `passed: true`，但模型明确表示没有正向轴向锁止，原请求又要求说明使用中的保持方式；合同也已有 `axial-retention` 未知项。这是可复现的假通过，不能解释为满足功能或实物要求。该修改既不是模型回复，也不是用户接受的设计。修复后对同一哈希 `ddac66bfe7127e1d05d5828dee1d651fd22546925d63fe2cf2eb406db9560746` 重评：已测层维持各自结果，总评 `passed: false`，新增 `unresolved-axial-retention NOT_RUN`。实际 A001 对该诊断件重查也为 NOT_RUN，包含轴向保持未知项；此项同样受未确认合同影响。

评估器现将目标层内未知项列为 NOT_RUN 并阻止总评通过；A001 不让未知项或尚无实现的确认要求被记作通过，同时保留已有 FAIL 和 ERROR。A001 的零件身份检查尚不比较用户要求的零件数量，碰撞采样尚不比较用户要求的角度端点；虽然特定铰链能测量配合，A001 尚未逐项确保每个配合要求确实完成对应测量，因此这些要求均明确为 NOT_RUN。意图层不属于 A001 的评估范围。确认合同不能静默删除或修改派生未知项，须保留或以同 ID 的明确要求/豁免记录；旧记录若无该记录则重新暴露派生未知项。专用检查和导出清单新增“需求条件是否明确”，PASS 仅表示已记录条件没有目标层内的空缺，不代表任何几何或实物已验证。验证器指纹涵盖该规则，新检查产生的新报告与旧报告分开。当前界面只能展示未知项，尚无完整的未知项回答、豁免或轴向保持实测交互。

本实验结果仍无法证明模型自主生成可保持、可拆卸且实物可用的铰链；CAD 内核更换亦无充分依据。完整目标和独立实测仍未完成。

最终完整单元测试983 PASS / 3 SKIP / 0 FAIL（986项、149文件、27.69秒），typecheck、lint和diff检查通过；原生 OpenSCAD 产品验证集成测试1 PASS。首次完整回归有一项旧界面测试仍断言九层，实际新增需求层后为十层，更新该断言后重跑通过。离线 `cad:eval:fast` 的5个意图/检索案例通过，模型和 OpenSCAD 均为 NOT_RUN，不能作为几何质量证据。

## 2026-11-06 · A001 逐项比较与自动运动采样边界

A001 现在保存各项要求与结果：生成的独立零件设计数量基于实际选择器导出和身份检查；运动正负端点与已通过的理想刚体采样区间比较；直径间隙只接受目标单关节的实测区间、采样站点及合同上下限。缺少匹配测量、身份或已确认合同，保持 NOT_RUN；跨越公差边界为 ERROR；不符合数量或声明采样覆盖不足为 FAIL。角度 FAIL 说明已声明并采样的范围不足，不证明实体有物理止挡。各测量明确保留范围与局限，不能证明零件语义身份、连续无碰撞、源码控制参数带动几何或打印后功能。需求格式与标准检查语义不相符时不自动认作已测。

另发现自动采样默认将连接的 b 侧作为运动件，但合同允许 b 侧为固定件，复杂连接也可能有多个随动体。自动推导现只覆盖恰有两个实例、一个转动连接、a 侧明确固定的情况；其他情形的自动运动为 NOT_RUN，不再旋转可能固定的零件。生产验证与离线模型评估共用此规则；显式传入运动体的低层工具仍需调用方自己承担运动关系建模。未来需要实现适当的符号约定、运动组和多关节求解，不能把这项保守限制当作最终能力。

使用仓库原创铰链与原生 OpenSCAD 的集成测试，隔离模拟用户确认（未写数据库）：两种独立设计、±45°、0.35–0.45 mm 要求的相应数字断言 PASS，轴向保持未知仍使 A001 为 NOT_RUN；将要求改为三种设计及±60°，数量和两个角度端点均 FAIL。固定在 b 侧的反例使离线采样为 NOT_RUN。对上一轮人工修改结束标记及路径的诊断件另行只读复查（归档 `product-hinge-repair-rNS2JA/recheck-assertions.json`，模拟确认，无用户验收）：两种设计、−45°至45°的24个理想位姿、3个轴向站点的0.399999–0.425297 mm配合断言 PASS，保持条件仍 NOT_RUN，整体 A001 NOT_RUN。这不是模型原始输出或物理测试。

本轮完整单元测试986 PASS / 3 SKIP / 0 FAIL（989项、151文件、33.02秒），原生 OpenSCAD 集成测试3 PASS，typecheck、lint与diff检查通过。本轮无新增模型调用，累计保守费用上限仍 2.316040 CNY。完整功能装配目标依然未完成。

## 2026-11-06 · 保持条件可记录并进入模型上下文

此前确认需求后无法再次进入编辑，轴向保持条件只能查看；且生成、编译修复、验证修复和视觉修复未读取确认的合同。现在可重新编辑，明确记录保持条件或豁免，也可恢复为未回答。条件为用户数据，不是验证事实；对无测量实现的保持要求，A001 仍为 NOT_RUN。当前界面仅为轴向保持增加定向输入，不涵盖一般工艺、载荷、运动组的完整合同编辑。

仅当前请求的已确认合同及其哈希可进入生成和修复提示；过期或未确认的合同不冒充已确认，损坏的已存合同阻止生成或修复并要求重新确认。合同变化使原计划指纹失效，不能复用旧计划。视觉修复的文本修复阶段获得确认条件，图像分析仍只判断可见内容。模型遵循这些条件、修复成功和实物功能均未通过此改动证明。

需求合同改变时，保存事务将旧 A001 标记 NOT_RUN 并保留先前状态和消息，同时清除旧质量汇总；同哈希重新确认不会使新结果失效。界面在保存成功后立即隐藏当前旧 A001 并重新获取专用报告。真实隔离 SQLite API 测试覆盖初次确认、条件变更、重复确认、原证据保留和其他验证结果不受影响；模拟模型的管线测试覆盖确认文本进入生成与修复，未调用真实模型。首次完整回归因旧管线测试数据库替身缺少新增的读取接口失败，补齐替身后通过。

完整单元测试992 PASS / 3 SKIP / 0 FAIL（995项、154文件、26.81秒），typecheck、lint及diff检查通过。以上为本地自动测试；浏览器交互和实物测试尚待另行记录。本轮无新增模型费用。

## 2026-11-07 · 保持条件浏览器保存及旧证据失效复核

对提交 `795f4ea` 使用独立SQLite和localhost:3147无头浏览器实测。归档 `.gstack/qa-reports/retention-qa-8qNPP1/index.json`。测试任务通过浏览器同源API创建，原创手写铰链源码及用于失效测试的合成A001 PASS写入本轮数据库；初始PASS不是几何证据。浏览器填写并回读10N条件后点击记录和确认，API及数据库保存成功，旧A001通过从界面消失。随后通过“修改需求”先保存15N，再保存20N。专用检查实际完成后报告为CURRENT，修改20N后同一旧报告变为STALE，十层结果均为NOT_RUN；刷新后第三次修订及20N条件仍保存。数据库旧A001为NOT_RUN，保留原PASS状态与消息。截图condition-visible.png已查看，显示20N条件。

本轮界面测试为DONE_WITH_CONCERNS：首次用Bun直接启动Next时Prisma外部模块加载失败，改用Node启动隔离服务后成功；首次检查曾返回409，后续点击检查200且完成，最初冲突原因尚未确认。跨会话浏览器重启导致原会话消失，本轮另建第二个隔离任务，两个测试任务均留在专用数据库。没有调用模型、记录用户验收或做实物保持力测试。服务和本轮浏览器标签已关闭，仅本轮生成目录已清理，tsconfig恢复原内容。证据为本机档案，非完整封装或异地备份。

## 2026-11-07 · 原创两件式可逆轴向阻挡样件

新增 `benchmarks/assembly/bayonet_retention.scad` 与说明，以及原生 OpenSCAD 回归 `retention-release.openscad.test.ts`，加入 `test:openscad`。这是手写原创工具验证样件，不是模型生成成功案例，也未接入 A001 的保持力判定。两个选择器分别导出支承和转子，并在共同参考系还原总装；实际网格身份及有限连通检查通过。工作角−45°至45°以5°采样，无碰撞；参考姿态向±Z各探测4mm、步长0.125mm，首次接触均在±1mm。直接拔出声明为可通行时检查FAIL；先转至90°再向+Z移动4mm的51个位姿路径通过，终点包围盒完全分离。逆序装配为刚体几何的推论，本轮没有另行执行反向路径检查。

矩形投影的独立解析下界为6*cos45°=4.243mm，大于2.6mm槽宽；90°时2×6mm凸耳可通过2.6×6.6mm名义开口。首次INTERSECT可能只是接触，不能单凭该标记宣称体积穿透；因此另在±1.125mm位移选取严格内部见证点。既有标准库Python有向边/顶点图和立体角方法对两对变换对应点均分类INSIDE，支持这两个指定位移有内部重叠。点在查看原创源码后解析选择，非盲评，不替代连续碰撞或独立工程师审查。源码、分件STL、哈希、路径报告、独立协议及结果留在 `.agentscad/experiments/rigid-retention-2026-11-07/`；源码SHA256为c83449dcedd38d634cd2f8f0fa1339adeb75890ddd45dbdc3b3ef1416291c876。该档案仅本机且未完整封装环境。

样件缺少防止误转到解锁角度的定位或机械限位；没有测量保持力、应力、摩擦、磨损、材料或实际制造偏差。故指定10N/20N保持力和实物功能仍NOT_RUN，不能由几何阻挡升级为通过。生成/修复技能补充工作姿态与释放姿态、完整释放路线及误解锁未知项的区分，本轮未用付费模型验证这些提示效果。无新增模型调用，费用累计保守上限仍2.316040 CNY。完整M0–M8目标继续active。

最终普通回归992 PASS /3 SKIP /0 FAIL（995项154文件，27.53秒），原生套件23 PASS /1 SKIP /0 FAIL（24项5文件，186.23秒）。原生制造配合/布尔回归因Python网格依赖不可用跳过，渲染用例中的Python网格断言亦未执行；不计为网格或制造通过。typecheck、lint及diff检查通过。

## 2026-11-07 · 保持探测覆盖指定工作位姿及解锁反例

此前 `checkTranslationProbe` 从输入网格默认位置探测，不能直接对局部导出网格指定旋转后的工作姿态。现v2支持共同的运动件/随动件初始刚体变换，以及各障碍的独立刚体变换；探测位移明确为世界坐标，以平移左乘初始姿态，不把世界轴误当局部轴。报告保存实际矩阵，非刚体矩阵和不存在障碍的变换被拒绝。缺省仍为单位变换，保持原调用行为；仍只是在显式给定位姿上探测，不自动辨认真实关节、工作范围或防误解锁机制，也未让A001的载荷保持要求变成PASS。

同一原创bayonet样件对19个−45°..45°工作姿态逐一做±Z探测，38次均PASS，含有效无碰撞起点与后续阻挡；在90°把保持作为期望则FAIL，把可抽出作为期望则PASS。反向51位姿装配本轮实际执行并PASS，补充上一轮仅有逆序推论的证据。归档 `.agentscad/experiments/placed-retention-2026-11-07/` 保存原源码、两个STL、完整38条探测与反例/反向路径报告；原始源码未变。结论只覆盖列举的理想刚体采样姿态，不能证明中间位姿无意外释放、自然约束用户始终留在工作区间、防误转或指定载荷保持。物理仍NOT_RUN，无新模型调用。

普通回归994 PASS /3 SKIP /0 FAIL（997项154文件，27.73秒）；定向单元与原生样件复查7 PASS。初次typecheck发现新增测试的数组/元组断言类型不匹配，修正测试类型表达后typecheck通过；lint及diff检查通过。未重复整套原生/制造、浏览器、真实模型或实物试验。该开发样件不作为模型生成成绩，完整目标仍active。

## 2026-11-07 · 显式几何探测进入产品验证及修复证据

装配V1声明新增可选 `translationProbes`：ID、单一运动实例、明确世界初始刚体位姿、世界位移、2–65采样点与blocked/clear期望，最多64项。旧声明不增加默认字段，保持原规范哈希；拒绝未知/固定运动实例、非法姿态、零位移及重复ID。`checkDeclaredTranslationProbes` 对其余所有实例采用各自声明位姿，不允许挑选忽略障碍；缺购入件网格为NOT_RUN。仅支持2–8实例、总4096样本/障碍组合，合计5秒预算。低层探测增加期限，晚返回的同步工作不冒充及时完成或PASS；它不能被强制中断，故这不是严格CPU抢占保证。

`prepareAssembly`（生产检查/导出的共用准备函数）自动运行这些可选声明，将原始测量和确认门控后的总项/子项保存在manifest；有声明时其结果进入assembly层，FAIL不因未确认而降为NOT_RUN。没有声明不改变旧装配层的行为，也不默认为保持已验证。A001现有assembly选择可接收失败，修复findings携带探测ID、实例、世界位移、采样数和预期结果；声明保护器拒绝删除或修改原探测，防止通过缩短位移、减采样或改blocked为clear消除失败。新工具加入验证器指纹。两种生成指导说明该可选格式和限制，尚无真实模型遵循格式或修复成功的证据。

真实原生网格集成复用原创bayonet的三个实际选择器产物，通过共用准备函数执行38次工作探测；raw measuredStatus PASS，但未确认合同使顶层及每个子项status NOT_RUN。把90°、+Z释放姿态标成blocked，得到探测FAIL与assembly FAIL，physical仍NOT_RUN。初次反例错误取用了−Z方向，那里上手柄确实继续阻挡，故得到实测通过、门控NOT_RUN；纠正为设计的+Z释放方向后重新执行，不能把该初次结果解释成工具漏检。归档 `.agentscad/experiments/declared-probes-2026-11-07/` 包含原SCAD、三个STL、正/负声明、完整manifest、执行脚本和直接工具快照，未保存完整传递环境；声明由测试手工构造，并不在原fixture源码里，不是完整自然语言管线或浏览器任务。

这些探测不绑定或证明用户完整工作范围，不证明源码参数实际驱动位姿、连续无碰撞、耦合运动组、防误解锁、接触载荷或物理功能。A001的轴向保持要求仍无自动资格断言，保持NOT_RUN；不能把几何实验期望值当作用户验收。普通回归999 PASS /3 SKIP /0 FAIL（1002项155文件，27.52秒），定向真实原生集成1 PASS（96断言，5.40秒），typecheck、lint及diff通过。未重复整套原生/WASM、制造、浏览器或付费模型实验，无新增模型费用；完整目标active。

## 2026-11-07 · 离线总评补齐声明探测门控

准备真实生成实验时发现：产品A001已通过assembly层接收声明探测结果，但离线 `judgeAssemblyCandidate` 的总评只显式组合旧测量层，没有检查新增translationProbes。它能产生修复finding却仍可能将总评记为通过。现仅在存在声明探测时把其聚合状态加入必过条件和证据列表，缺测为NOT_RUN；无声明不额外宣称保持已验证。不可用结果也进入反馈，不伪造几何失败。

原生反例以原创axial_hinge为基线，请求只含两件铰链和0.35–0.45mm间隙：现有相应数字检查总评PASS；加入向+Z抽出30mm却要求blocked的错误探测后，总评FAIL，declared-translation-probes FAIL。这证明新增实验不能被其余通过覆盖；不证明该基线具备原用户要求的保持或实物功能。单元1000 PASS /3 SKIP /0 FAIL（1003项155文件，26.49秒），定向原生1 PASS，typecheck/lint/diff通过。

另冻结开发任务 `scripts/eval/assembly-generation/service-release-hinge-v1.json`，SHA256 81b4fd42702608fd7fe9f1fde218510f3dccef000cb2057102f80f102cd03381。要求两件连通体、±45°工作、防直接误转到释放角、有意释放和完整装拆及几何探测；FDM材料、机器、载荷和寿命明确未知。先用该提示派生合同，确认当前提取器未为“先释放再转到解锁角”创建独立可执行断言，故必须另行复核，不能将总体几何检查等同完整意图保存。预算上限仍28元，此实验最多两次调用，原累计保守上限2.316040元，新增最大预留1.448576元。协议 `.agentscad/experiments/service-release-protocol-2026-11-07.json` 在调用前保存。实际模型结果及最终费用另记；该任务不是隐藏集，不构成成功率估计。

## 2026-11-07 · 同提示思考模式实验及请求适配根因

高思考模式真实调用归档 `paid-deepseek-assembly-wiqHnf`：约数分钟后以LLM_OUTPUT_TRUNCATED结束，2940输入、65536输出token，输出全部为reasoning token，未取得完整SCAD。没有做几何检查或修复调用；错误、usage、请求和直接工具快照留档，codeUnchangedDuringRun为true。本轮保守费用0.530168元，累计2.846208元。此证据不能说明几何设计可行或不可行，也不是更换CAD内核的依据。

依据当日[官方思考模式文档](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)，DeepSeek OpenAI格式使用独立thinking开关，effort只控制low/high/max。检查发现配置provider路径此前只发reasoning_effort:none，旧测试也断言了该错误契约，故不能仅凭实验的non-thinking标签证明实际关闭。现对deepseek类型及官方api.deepseek.com发送thinking.disabled并省略none effort；显式low/high/max发送enabled及对应effort，其他兼容provider的语义保持。未指定effort则保留原默认。模型路由、调用计数和重试策略未改变。定向provider测试9 PASS，完整回归1001 PASS /3 SKIP /0 FAIL（1004项155文件，29.15秒），typecheck/lint/diff通过。

在首批已知用量且TERMINAL后另冻结自适应对照协议 `service-release-nonthinking-protocol-2026-11-07/protocol.json`，不是自动重发或隐藏集。请求提示字节相同，仅明确关闭思考，最多两次、额外预留1.448576元。实际请求体通过本轮预加载记录器保存（不保存headers），证实thinking.disabled、无reasoning_effort、stream:true、65536 cap；首次预加载因相对路径无法解析在联网前失败，改绝对路径后才启动。归档 `paid-deepseek-assembly-qCokPk`：初稿2915/3426、修复6387/3928输入/输出token，返回deepseek-flash，两稿reasoningCharacters均0。官方[价格/版本说明](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)将请求的旧deepseek-v4-flash路由到V4.1-Flash-1017，不能称测试了已下线原版本。直接工具在运行中未变。

两稿声明都被schema拒绝，未进入几何：operations的四个位姿把平移放进最后一行；boreInstanceId为字面量a而非base1。`schema-issues-0/1.json`保留具体路径。两稿均未给出要求的translationProbes；没有修改原稿或将手工更正当生成成功。当前通用“声明不匹配”反馈没有指出字段，修复重复相同错误；生成指导中的“设为a或b”亦有误导字面量的风险，需修正。报告的hardStopOvertravel因旧关键词启发式错误标SKIP，本请求明确适用却未执行，应解释为NOT_RUN，原报告保留不覆盖。两次费用上界合计0.077436元，授权账本21条、TERMINAL、累计2.923644元；余额变化含时延/其他归属不明扣款，不用来替代按usage的保守记账。临时凭据已清除。原生制造、SCAD驱动关系、防误转、物理及用户验收均NOT_RUN。完整目标继续active。

## 2026-11-07 · 声明格式错误进入具体修复反馈

针对上述原始失败，`extractEmbeddedAssemblySpec` 现在返回最多8条schema错误的字段路径及有界消息，超出时保留省略数；仍拒绝原始错误，未自动修改模型声明。矩阵和孔侧反例测试覆盖具体位置及大量错误时的长度限制。两种生成指导明确boreInstanceId取a/b字段中实际实例ID（例如base1），不是字面量a，并给出行主序+12mm Z位移的完整矩阵，最后一行保持[0,0,0,1]。这些指导和反馈在两次失败后才修改，不能声称对先前修复有效。

对两份未改原稿做仅解析重放，`schema-feedback-current-0/1.json`现精确列出四个位姿路径及connections.0.boreInstanceId；没有执行渲染或几何，也未做第三批付费实验。离线runner不再凭关键词缺失将限位越程标SKIP，一律明确该检查/适用性未执行为NOT_RUN。原付费报告未覆盖，status-correction.json作补充订正。最终单元1002 PASS /3 SKIP /0 FAIL（1005项155文件，28.50秒），typecheck、lint及diff通过；本轮新增模型费用保守上界0.607604元，累计2.923644元，21条账本TERMINAL且无active占用。下一项最有信息价值的实验是给同一未改失败稿提供具体schema反馈并测试实际修复，再检查所有原需求及遗漏的探测；不是把格式修好当作功能完成。

## 2026-11-07 · 具体格式反馈的真实修复与原始几何诊断

原seed工具只接受有效声明，不能将上一轮实际非法声明直接作为修复输入。现增加显式assembly-schema模式，要求原稿哈希、反馈哈希、当前精确schema诊断及单任务单调用同时匹配，缺失/畸形输入不能借此冒充格式错误；正常种子规则不放宽。该模式明确记录原声明保留守卫NOT_RUN，因为原声明无效，不能声称已自动比较全合同。嵌入声明解析器也纳入验证器指纹。冻结 `service-release-schema-repair-v1.json`（640caeda693a43be676fdac93da04ddd2fbd7d7a84bb436c9ca7321b5ed3203c），原提示不变，最多一次新修复。协议/具体反馈位于 `service-release-schema-seed-2026-11-07/`，原稿89c62810718941b1716e55156b3006210d3d1b0ab6b20f696a0655917132bea4未先改动；额外反馈指出原请求的探测缺失及应保留的库存，没有伪造几何测量。

实际调用归档 `paid-deepseek-assembly-59yfbi`，经产品完成器而非完整executeCadJob/浏览器。实际无headers请求体证实关闭思考，返回deepseek-flash、7182输入/3622输出token，reasoningCharacters为0；保守费用0.043340元。模型纠正了boreInstanceId为base1，但四个位姿仍将平移写在最后一行，且仍无translationProbes；声明被拒，产品几何NOT_RUN。声明层逐项对照确认两种part、两个instance、单connection及两个operation的ID均保留，但这不是全合同或几何保留证明。新候选源码a79f0a4fd5225fcae1df8aea6269e24d70d30c700a084b7ee9e3023f224cefe8，未做手工修正。直接工具在运行中未变，账本22条TERMINAL，累计2.966984元，无自动再调用。

为避免把全部失败归结为声明格式，对同一未改SCAD做独立的有界诊断，协议在渲染前保存，选择器取自源码，默认work_angle_deg=0、release_mode=false。OpenSCAD 2021.01原生分别渲染base、flap、all；有限identity PASS，base闭合边连通PASS，但flap的闭合表面证明NOT_RUN。独立Python计数定位唯一问题边：x=3、z=0、y=−4.5..4.5，四个三角面共边，不能按合格流形交付。两件默认位置BVH报告三角面相交；不能仅凭INTERSECT称体积穿透，故另存明确标注的诊断副本，仅将根调用换为原两个模块的intersection，模块和参数不改。原生交集含1164三角面、三个闭合表面分量；它的connectivity FAIL仅因这个诊断交集分离，不能说原零件有三个实体。

查看源码后解析选择[3.6,6,0]mm见证点：保持环名义半径4mm大于支承孔3.2mm，处于支承实体范围。独立标准库Python有向边/立体角审计对诊断交集该点为INSIDE、[100,100,100]为OUTSIDE，支持指定位置有实体重叠，而非仅允许接触。该检查依赖同一OpenSCAD生成的诊断交集，不是独立CAD内核重建；点不是盲选，也不证明完整无自交、其他姿态或物理功能。档案 `service-release-raw-geometry-2026-11-07/` 保存原SCAD/STL、诊断副本/交集、协议、报告及runtime。没有将该副本当模型输出或修好后的设计。

原始生成失败稿另以完全相同字节冻结为 `scripts/eval/assembly-fixtures/failures/controlled-release-hinge-2026-11-07.scad`，附说明而不改写其模型注释。原生回归检查它的schema非法、selector身份可用但flap闭合证明不可用、默认相交，防止这些事实被成功编译或identity掩盖。该回归通过表示缺陷被检测，不是候选合格；文件不进入检索示例。最终单元1002 PASS /3 SKIP /0 FAIL（1005项155文件，38.07秒），定向原生2 PASS（101断言，37.83秒），typecheck/lint/diff通过。完整装拆、源驱动运动、防误转、指定工艺实物与用户验收仍NOT_RUN。下一步应将格式错误和安全可独立执行的分件诊断同时送入修复，保留未测层；不应只反复增加生成调用或把声明修好当作功能完成。完整M0–M8目标active。

## 2026-11-07 · 非法声明的分件诊断进入正常修复证据链

此前完整声明解析失败便直接返回，正常A001和离线评估无法把实际分件缺陷同时交给修复。新增只用于诊断的有界layout子schema，复用完整schema的part/instance及刚体变换定义，只接受V1/mm/右手系、最多8种零件及2–8实例、唯一ID/选择器及存在的零件引用。嵌入注释词法解析复用同一路径，畸形/重复/伪装注释不能绕过。连接、操作、子装配关系及需求未被该子集验证，不自动填充或更正它们，也不使完整schema转为有效。

`diagnoseAssemblySource` 使用原源码和安全选择器渲染，检查实际返回库存/哈希，以每件50000面上限做有限闭合边检查和声明位姿下的两两碰撞。购入件缺网格明确列出，不近似为无障碍。没有总装网格时只给selector distinctness，不将其称完整身份或重构证明。30秒总渲染期限、5秒几何期限及每对100000三角查询预算限制新增成本；同步工作不能严格抢占，晚返回保留为未完成。报告是带source/layout哈希的原始诊断，不包含通过的装配资格。INTERSECT明示可能是接触，不能据此随意移除合法接触或称体积穿透。

A001非法声明仍为关键FAIL，将有界诊断文字和assemblyDiagnostics原始记录一并返回；诊断失败或缺材料不抹去已有声明FAIL。现有修复因此获得同一条失败中的具体schema及几何线索，无须改路由/状态/计数契约。离线judge同样保持passed:false、正式evidence为空，诊断单独记录；付费runner可另存诊断STL和JSON。新工具纳入验证器指纹。有限连通检查另保存最多4条缺陷边例子、入射数及方向余额，判据保持不变；该实际案例定位到x=3、z=0、y=−4.5..4.5的4面共边，不再只给笼统“非流形”。

原生集成以未改失败稿实际运行A001和judge，确认两者均保留schema失败，同时报告活动件闭合证明NOT_RUN、默认base1/flap1 INTERSECT；原生测试1 PASS（12断言，13.55秒）。另用原始完整任务提示做两入口重放，归档 `.agentscad/experiments/invalid-assembly-feedback-2026-11-07/` 的协议、A001、judge、诊断JSON、两个STL和直接工具快照，仍不构成完整executeCadJob/浏览器或用户确认。单元1006 PASS /3 SKIP /0 FAIL（1009项156文件，30.10秒），typecheck/lint/diff通过。危险选择器、坏位姿/引用、哈希错误、购入缺件、预算和取消均有反例；无几何或实物总通过。此阶段重放无模型调用，费用上界仍2.966984元，完整目标active。

## 2026-11-07 · 联合反馈修复把零宽连接变成断连

提交646e8ac后，冻结 `service-release-geometry-seed-2026-11-07/protocol.json`，使用同一未改a79f0a4f…原稿、原始请求以及新工具实际schema/闭合边/声明位姿反馈，最多一次非思考修复，预留0.724288元；不是自动重复请求或隐藏测评。实际运行 `paid-deepseek-assembly-Q9EXkr`：deepseek-flash、7136输入/3536输出token、reasoningCharacters为0，实际无headers请求体含thinking.disabled。codeUnchangedDuringRun为true，完成器计数1次。保守费用0.042560元，累计3.009544元；23条授权账本TERMINAL、无active占用，临时凭据已清除。

新源码e3d43ca75383551a4b134f2d5f7d1776b14dbea77b4b77290e2bdfad84f19bf3仍有四个非法平移矩阵且缺translationProbes，总评false，完整几何/功能未验证。新自动诊断无需手改声明即保存两个原生STL：base有限闭合检查PASS；flap从原来的非流形NOT_RUN变成明确分离FAIL，X=4.000000至4.3999996185mm的空区间将所声明单零件分成两组，默认base1/flap1仍INTERSECT。本次新稿只有表面相交观察，上一稿诊断交集的体积证明不自动外推。声明选择器不同不代表正确身份或功能。

源码diff显示模型把连接臂起点移至collar_r+0.4，却在注释中称“positive overlap margin”；这实际上是材料分离，注释无法证明连接。独立标准库Python有向边/顶点图审计复核同一新flap STL（6156486145765dcd370e4f7b49ee48152b207e8e3ab13e8d7f798e7646040ff6）闭合表面及相同0.3999996185mm的X分离证书。四个表面分量不能直接解释成四个零件，嵌套孔腔可能贡献表面；空区间才支持至少两组分离的判断。协议在读取原生结果后冻结，非盲评、不标定误差或实物功能。原请求/回复、原新稿、两个STL、诊断、判定、费用和直接工具快照均在本机档案，非完整封装。

诊断摘要现在同时给出part-local分离轴、两端点及宽度，明确不是两个配合零件之间的间隙；修复技能补充同一制造件的正材料连接与运动件配合间隙的区别。这些改动在该模型回复后加入，尚无模型改善证据。`feedback-with-separation-interval.json`只是同一新报告的反馈重放，没有再次付费。新增两盒分离反例验证数字进入反馈；首次测试用错mergeStl的参数形式导致类型/单元失败，改正后完整重跑。最终1007 PASS /3 SKIP /0 FAIL（1010项156文件，30.02秒），typecheck/lint/diff通过。未新增整套原生/WASM、浏览器或实物验收；当前数字证据不能证明可装拆并按条件工作，完整M0–M8目标保持active。

## 2026-11-07 · 顺序刚体操作由确定性适配器构造位姿

连续真实修复重复把平移写入矩阵最后一行，故新增可选 `rigidTrajectory` 而不更正旧稿或更换CAD内核。操作声明包含至多32个非零世界平移/绕轴旋转stage，始终以实例已声明装配位姿为正向起点。拆卸必须明确forward；装配必须明确reverse，遍历同一正向stage路线的反序，外部起点由已声明路线终点定义。非空waypoints、screwTrajectory不能同时使用该格式，方向与action不符会拒绝。旧声明不增加默认字段，规范哈希保持；旧非法矩阵仍拒绝。顺序刚体stage不替代同时旋转推进的螺纹轨迹。

适配器保留操作顺序、世界轴、右手正负角及完整转数，不从两个旋转端点猜插值。按现有0.25mm/5.001°边界（调用方设置仍显式记录）展开，旋转时以实例原点到轴的垂距及弧长同时控制平移采样；累计最多4096位姿，整序列仍受现有pair/时间预算限制。超预算返回未执行，不降为只查端点。原stage声明、装配锚点、采样数和展开位姿hash单独记录，实际位姿仍进入既有碰撞/库存/完全分离检查。装配反查场景库存及顺序规则保留，未新增物理可逆、连续碰撞或SCAD参数耦合证明。实例本身的初始transform仍需有效，适配器不解决全部定位或机构推理问题。

解析位置/顺序、偏轴旋转、反向路线、−720°完整两圈、混用/方向错误及预算有单元反例；现有中途障碍、库存及装配顺序仍能阻止通过。原生原创bayonet手写样件使用rotate90°再+Z4mm两stage及显式逆装配，raw装拆均PASS，因未确认合同两层verdict仍NOT_RUN；先平移再旋转时装拆均FAIL。定向原生1 PASS（102断言，10.71秒）只是工具验证，不是模型设计成功。另档案 `.agentscad/experiments/rigid-trajectory-native-2026-11-07/` 保存原源码、STL、原始正/负spec及manifest展开记录。该fixture源码不含测试构造的声明，亦无机械防误解锁资格。

两种生成指导加入格式和局限，验证器指纹纳入新适配器。完整单元1012 PASS /3 SKIP /0 FAIL（1015项157文件，31.12秒），typecheck/lint/diff通过。此阶段无模型调用，费用上界仍3.009544元；完整M0–M8仍active。

## 2026-11-07 · 模型采用新路径格式，但原稿受输出污染及几何缺陷阻断

提交2365ce3后冻结 `service-release-trajectory-seed-2026-11-07/protocol.json`，以未改e3d43ca7…原稿、同一用户提示、精确schema及实际空区间/相交反馈，明确要求采用可选rigidTrajectory，最多一次新修复。是自适应公开开发实验，不是随机对照或隐藏集；初次无付费dryrun在协议尚未写完时ENOENT，写完后重新校验通过，没有因此发模型请求。实际调用 `paid-deepseek-assembly-4UuxDe` 返回deepseek-flash、7351输入/3466输出token、reasoningCharacters为0；原请求体无headers留存，直接工具运行中未变，调用计数1次。保守费用0.042430元，24条账本TERMINAL，累计3.051974元，无active占用，临时凭据清除。

原始源码065818868bc75d1e3bf7d300c43596e4c88ff7b68f21c6f77abc5dde0ed58305确实采用forward/reverse刚体stages，完整schema有效；这次不再是旧矩阵末行错误。仍缺translationProbes，模型在assumptions/unknowns中明确声明没有超出+45°的机械止挡/互锁；这只是模型声明，不是独立证明，但不足以满足用户要求。源码末尾出现三行DSML关闭标记（未放在注释/字符串），OpenSCAD在280行语法错误。原候选没有编译通过，离线runner将测量阶段记为ERROR/judge-failed；可观察事实是该候选编译失败，不应解释为CAD运行环境不可用或几何验证失败。原回复、源码及错误均保留，未将标记自动删掉或将格式采纳称作模型成功。

另在 `trajectory-tag-diagnostic-2026-11-07/` 存协议和人工诊断副本，仅删除这三行已观察的尾部关闭标记并归一化末尾换行，几何/声明未修改，原新哈希均存档。该副本不是模型原稿或验收设计。它通过语法后实际运行既有数字judge：新stage展开为504个位姿（hash abc0b78c0b4c0963f8f80d15fbec19432375aeef6a3330a45ae8312c333ad883），装拆均因起始相交FAIL，工作运动在−45°干涉FAIL。base有限闭合PASS，flap多个闭合表面无空区间证书为NOT_RUN，不推断多个实体。轴/孔配合和帧测量ERROR（−12mm站点不包围声明轴），这是特征测量不可用，不等于已测间隙超差。重构15秒超预算NOT_RUN，不等于位姿不匹配；没有扩大预算或放宽精度来换通过。identity有限PASS不等于完整意图保存；intent-preserved仅检查连接类型，缺探测和机械释放条件没有因此被验证。保持未知项、物理和用户验收均未通过。

原生手写样件仍只证明适配器正/负路线按声明执行；本次真实调用仅证明模型在这一案例能采用格式，不能证明其工程设计成功或该格式提高总体成功率。尾部协议污染的拒绝/分类及几何修复仍需后续处理，完整M0–M8目标保持active。本节只补证据，无额外模型调用或产品代码改动。

## 2026-11-07 · 编译拒绝进入候选失败及具体修复反馈

离线judge现在复用产品既有源码错误分类器。渲染或分件准备返回已知parser/CGAL/源码策略错误时，记录compile FAIL，并把后续适用必需项列为NOT_RUN。运行环境、容量、完整性及超时异常继续由原测量异常路径报告，维持停止该次评估的行为。文件保存回调位于编译分类范围之外，保存失败仍可识别为证据执行故障。

编译反馈增加已观察DSML标记的位置。检测器复用SCAD注释/字符串遮罩，保留换行，覆盖未闭合注释情形，最多列8个位置并保留总数。编译器拒绝候选后才附加说明，原始错误保留为cause。正常编译验证、原生STL及WASM分支接入同一反馈函数，既有超时类型和运行故障对象保留。源码原文保存在既有产物及修复历史中。两个辅助源文件加入验证器指纹。

实际重放上一轮原始06581886…源码，正常validateGeneratedScadSource和离线judge都取得原生语法拒绝及尾部三行标记位置。源文件哈希在重放前后相同，compile FAIL，后续必需项NOT_RUN。档案 `.agentscad/experiments/compile-classification-replay-2026-11-07/` 保存协议、编译错误、判定及完整性记录。旧付费报告保留原内容，新重放记录分类修正。本轮模型调用0次，累计费用保守上限仍3.051974元。

单元反例覆盖注释/字符串内标记、未闭合注释、8条位置上限、重复附注及运行故障对象保持。原生回归对有效铰链追加协议标记，验证compile FAIL及后续NOT_RUN，另保留错误保持声明反例。最终1013 PASS /3 SKIP /0 FAIL（1016项157文件，32.64秒），定向原生1 PASS（7断言，11.46秒），typecheck/lint/diff通过。WASM专用、浏览器完整流程及真实模型修复效果待验证。装拆、运动、配合及机械释放的既有缺陷仍需解决，完整M0–M8目标active。

## 2026-11-07 · 具体编译反馈的真实修复可编译，默认几何仍相互占据

冻结 `service-release-compile-seed-2026-11-07/protocol.json`，将原始06581886…编译失败稿、5908a89取得的原生编译反馈及单独标注来源的人工诊断副本结果绑定。原请求保持，最多一次新调用。原声明有效，既有零件/实例/连接/范围/操作保留守卫在真实评估前执行。几何诊断副本的哈希和处理过程进入反馈，原稿先前的编译失败也一并保留。

实际调用归档 `paid-deepseek-assembly-lucJ5e`。deepseek-flash返回7731输入/3983输出token，reasoningCharacters为0，计数1次，直接工具运行中未变。请求体无headers保存。按当日[官方高峰价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)计算本轮保守上限0.047326元，25条账本TERMINAL、累计3.099300元，无active占用，临时凭据清除。本轮执行真实修复和独立几何复核，代码回归沿用5908a89记录。

新原稿e2c73a62bc35f81f711a938d9abb218a69195520c97c37163b7a77f1a1690402清除了尾部标记，实际完成编译及分件渲染，进入完整数字judge，原始源码未做手工清理。声明守卫通过，另存guard-replay.json复核已有不变量。装拆都在起始相交FAIL，−45°运动FAIL。配合/帧仍ERROR，−12mm站点轮廓不符合圆柱测量域，重构15秒超预算NOT_RUN。base有限闭合PASS，flap多个闭合表面无分离证书NOT_RUN。原请求的translationProbes仍缺失，模型明确声明未建模+45到+115°之间的机械止挡/互锁。有限identity与声明类型检查的PASS覆盖范围保留，完整任务仍false，实物/用户验收NOT_RUN。

独立标准库Python直接审计这次原始产物的两个STL，点[3.6,7,0]均分类INSIDE，远点[100,100,100]均OUTSIDE。base哈希bd60a8ac8f479f4385444995bc3ef824756f0a665aa5e81e4199abcbee9ff22a，flap哈希f651092847af8fe6738fe125c6577fc09498fca368ab2dedd8ca89548908e0f6，与manifest匹配。源码把直径8mm保持环放在直径6.4mm孔段内，点位选择与这一局部半径矛盾对应。此复核使用声明的单位装配位姿及闭合有向网格，点在查看源码/原生结果后选择，非盲评。完整无自交、数值误差界及物理功能仍需单独证据。协议和报告存于该运行目录的independent-overlap文件。

这次观测将阻断点从尾部语法污染推进到实际几何和未满足的机械释放要求。连续整稿修复仍重复孔轴角色/保持环容纳空间矛盾，并遗漏要求，后续应验证机械方案推导与代码生成分阶段或有针对性的局部修复，保留同一原始要求和独立测量。该路径效果尚待实验。完整M0–M8目标保持active。

## 2026-11-07 · 代码生成前机械提案仍未解决释放结构

现有 `src/lib/planning/generation-plan.ts` 是确定性需求检查点，`modeling_plan` 与 `design_rationale` 初始化为空，并非已批准的机械设计方案。本轮单独进行一次提案实验，未接入产品自动规划阶段。原创实验程序及费用异常模拟保存在 `.agentscad/experiments/mechanical-brief-protocol-2026-11-07/`，模拟成功/网络失败两种结算路径，未改真实账本。实际提案请求、回复、协议与审查保存在 `.agentscad/experiments/mechanical-brief-zp16VE/`，只要求机械方案，未生成SCAD。

实际返回deepseek-flash，456输入/1426输出token，1次计量调用，本轮保守费用0.012320元。26条调用费用逐项求和与accountedCny一致，累计3.111620元，授权上限28元。COMPLETED仅表示回复完成。提案提出7.6/8.0mm轴孔及10.5/10.9mm保持环/接收腔，两处名义直径差均0.4mm，尚无几何测量。防误释放结构明确标为UNRESOLVED，却同时断言单独旋转不能到释放角，结构支持未建立。

阅回复后冻结解析审查协议，人工转录尺寸，非盲评。在单个24°缺口是固定20°凸块唯一通道且轴向持续重叠的假设下，可用相对转角仅4°，不足所需90°工作范围；该假设下缺口至少需110°。提案所述下环与凸块轴向重叠0.8mm。缺口相位、精确拓扑及文中替代方案未统一，故这是条件性反例，不能推广成所有两件机构不可行。review.json决定REVISE_BEFORE_CODE，几何、实物、用户验收均NOT_RUN。没有据此再付费生成整稿或将提案算作工程成功。

下一步优先冻结一致的保持/独立释放机构方案，独立核算工作范围、保持与释放条件，再进入SCAD及真实几何验证。本轮仅归档实验事实，未改生产代码或重新运行完整代码回归。完整M0–M8目标继续进行。

## 2026-11-07 · 连接声明不再冒充完整意图保留

静态追踪 `scripts/eval/judge-assembly.ts` 发现，intent-preserved观测曾在找到匹配连接类型后无条件设为MEASURED/true。已有真实生成失败稿的原始报告确实将此项记PASS，即使探测遗漏、机械释放未实现。连接类型与完整请求覆盖范围不等价，原报告范围文字未阻止汇总将其当作意图通过。

现在保留独立的declared-connection-type PASS，完整intent-preserved为NOT_RUN，理由及修复反馈明确要求独立需求覆盖审查。其他几何检查继续执行并保留各自结论。默认合同要求完整意图，因此当前自动judge不会仅凭声明给出整任务PASS；尚无独立完整语义审查实现。未改生产A001、请求提取器、用户确认合同、模型路由或几何判据，也未补成释放条件的几何验证。新增连接类型项只说明声明类型匹配。

原生回归使用原创铰链，确认其现有几何证据均PASS时，完整意图仍NOT_RUN；添加错误保持探测仍独立FAIL；混入协议标记仍compile FAIL、后续NOT_RUN。1 PASS、11断言、13.02秒。完整测试1013 PASS/3 SKIP/0 FAIL，1016项157文件、35.47秒；typecheck/lint/diff通过。未执行完整WASM或浏览器产品流程。

另以原字节重放真实生成候选e2c73a62…，档案 `.agentscad/experiments/intent-coverage-replay-2026-11-07/` 保存协议、原源码与工具哈希、完整判定。原报告intent-preserved PASS，新报告NOT_RUN，连接类型PASS；原有装拆/运动FAIL及配合ERROR、重构NOT_RUN保留。原源码哈希未变，零模型调用，累计费用上界仍3.111620/28元。本轮提升评估可信度，机械设计能力本身尚待改进，完整M0–M8继续进行。

## 2026-11-07 · 原创两件式导向及独立轴向释放几何对照

新增手写原创 `benchmarks/assembly/gated_bayonet_hinge.scad`，源码SHA256 d19f5fe52f0fdf99705f830f571a3400b282f3e120a59ef3e00dde9ed5ecf67b。原有无转角挡块的bayonet样件保持原样。新样件包含带下导向孔、保持板及两个悬伸转动挡块的support，和一体轴、下横榫、上盘与手柄的rotor。两种制造选择器输出局部完整网格，另有明确的rotor_pose运动视图。没有新增第三方几何或依赖，未接入生成模板或计为模型成功。

所选理想工作姿态为轴向偏移0、角度−45到45°；独立释放先沿Z下移0.9mm，旋转90°，再上移10.9mm至净+10mm。下移使手柄最高面4.1mm低于挡块最低面4.2mm，同时上盘最低面3.1mm仍高于保持板顶面3mm。名义可用轴向窗口−1到−0.8mm，仅0.2mm宽，所选位置两侧各0.1mm余量。这些是理想几何尺寸，不是制造公差或防意外下移/稳定保持的实证。

最终源码真实原生渲染及现有工具检查：两制造件有限连通PASS；有限身份检查PASS；19个工作角度的运动采样PASS，38次双向轴向阻挡探测PASS且起点无相交；从0°直接正/反向转到±90°均FAIL，在第10个间隔（±50°样本）检出表面相交；下移、旋转、抽出的69姿态路径及其逆序装配PASS。额外正交证明在60°时选取世界点[2.4,4.156921938…,4.5]，对support世界网格及逆变换后的rotor局部网格均为INSIDE，远点均OUTSIDE，支持该指定姿态真实实体重叠。下移0.9后的对应局部点[4.8,0,5.4]为OUTSIDE。独立标准库Python沿用已提交的有向边/立体角审计工具，选点在设计/结果之后，非盲评；不证明全局无自交、全部SE(3)绕行、连续运动或物理功能。

下导向区三个指定截面Z=−1.75/−1.5/−1.25mm的实际网格孔轴测量MEASURED，直径间隙区间0.3948598212到0.4042835041mm，落在0.35到0.45mm内，所测轴偏移/夹角均0。覆盖范围仅这三个截面，不推为完整机构配合或打印精度。源运动视图以90°及−0.9mm重新求值并保存STL，包围盒符合该输入；没有执行整条源码驱动轨迹的逐帧重构。

现有prepareAssembly入口以真实网格检查手写三stage声明，装拆measured PASS；先旋转再下移的错误顺序装拆measured FAIL。未确认合同下顶层装拆及physical仍NOT_RUN。声明由测试构造，未嵌入SCAD，连接为空的通用路径测试和另行构造的导向孔轴测量分开，不能据此称产品已自动识别完整关节。原始初稿档案gated-hinge-2026-11-07保留；最终档案 `.agentscad/experiments/gated-hinge-final-2026-11-07/` 有同字节源码、STL、协议、完整路径/探测、配合、源码视图及独立复核脚本/报告。

新增原生回归最终1 PASS（97断言、17.68秒），完整普通测试1013 PASS/3 SKIP/0 FAIL（1016项157文件、33.41秒），typecheck/lint/diff通过。首次新增测试误读TriangleMesh为triangles字段，在复用meshBounds后重跑通过。未跑完整WASM、全部原生套件、浏览器端到端、打印、载荷、寿命或验收。没有新增模型调用，费用上界仍3.111620/28元。

本轮提供了可重复的“独立轴向位移解除转动阻挡”的数字正/负对照。防误操作（含重力/振动导致下移）、保持力、工艺误差、严格关节自由度及全配置空间仍缺证据。最有价值的后续是以原始功能要求验证模型能否推导并生成一致方案，将关键需求/探测遗漏列为独立缺陷，再验证模型产物；不能直接以本手写样件替代自主生成或全M0–M8验收。

## 2026-11-07 · 区域规划真实生成与跨代码块声明丢失根因

规划技能新增通用接口区域表、服务/释放包络、间隙不等式及非空释放区间指导，要求说明未释放路线的阻挡表面、释放变化及完整逆装配，保留明确要求的实验；两种正常生成入口的提示注入回归通过。提交ee9a858。没有把手写样件或第三方CAD源码送入模型，也没有新增固定产品模板。指导对工程成功率的改善仍未证实。

冻结 `.agentscad/experiments/region-planning-generation-2026-11-07/protocol.json`，原任务提示及taskSet hash640caeda…不变，新生成一次、maxRepairs=0、预留0.724288元。实际请求wire-0保留且无headers，thinking.disabled和新指导确实注入，未包含gated样件源码。运行目录paid-deepseek-assembly-YjhbtT返回deepseek-flash，3531输入/2656输出tokens、reasoningCharacters0、finishReason stop，调用计数1。按当日[官方高峰价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)保守记账0.028310元，27条账本TERMINAL累计3.139930元，无active占用，临时凭据已清理。codeUnchangedDuringRun true。初次启动命令因清理语句的工具策略在进程创建前被拒，未调用API；改用受保护临时文件及finally删除后才完成唯一实际调用。没有自动再试或付费修复。

原回复包含两个scad fence，第一个是完整独立AGENTSCAD_ASSEMBLY_V1注释，第二个是几何。旧extractOpenScadCodeFromText只取最后一块，原保存稿因此丢失声明，judge报告无声明。这是实际提取损失，不能归因于模型没输出声明。原回复、旧提取稿及原判定保持原样。

现在只在恰好一个完整独立声明注释与一个可识别scad/openscad/无语言SCAD块时保留两者，声明原字节前置，几何块字节不改。畸形/重复/另一份内嵌声明、多份候选或存在将被丢弃的外部声明时明确CadGenerationFormatError，不猜选关系或合并多份几何。无声明的普通多代码块仍沿用最后候选选择。无效schema内容保留，交给后续验证而不自动更正。正常normalizeGenerationResult的双段解析曾有另一处直接取最后块，新增回归实际发现后将其统一经过相同提取入口。声明仍是未受信的候选元数据，不是几何或功能证据。

真实原回复经两个正常解析入口重放，声明有效且得到相同完整源码e60fa3f3…，几何块与旧保存稿字节一致；replay/extraction-integrity.json记录。实际OpenSCAD判定compile FAIL：Current top level object is empty，后续必需几何NOT_RUN。模型定义generated_part但未调用，输出finishReason stop，不能称传输截断。原声明缺translationProbes，源码姿态用rotate([0,0,0])常量，未因新提示获得完整功能实现。

仅另存手工诊断副本，明确只附加generated_part()根调用，原提取稿和模型输出不改。该副本真实分件后hub有限连通PASS，shaft_leaf FAIL，Y=−8到−6mm空区间将同件分为两组。装拆均因初始相交FAIL；运动NOT_RUN（固定件在connection.b，不符合当前自动运动取样支持条件），配合/帧ERROR（所取截面跨槽径差2.51mm，不属于单圆柱），重构15秒超预算NOT_RUN。有限身份PASS不扩展成完整意图。独立标准库Python复核同一诊断STL，确认2mm分离区间；[0,−10,0]在hub及shaft_leaf均INSIDE、远点OUTSIDE，支持该指定默认姿态真实实体重叠。点阅源码/原生结果后选择，非盲评，完整实体有效性及物理功能仍未认证。所有原STL、声明、协议、源码/回复哈希及独立脚本/报告在region-planning-generation-2026-11-07/replay下。手工副本不计模型生成成功。

最终普通测试1017 PASS/3 SKIP/0 FAIL（1020项157文件，29.93秒），typecheck/lint/diff通过；定向解析及提示测试19 PASS，新增覆盖两种顺序、无语言块、无效schema保留、重复/缺几何/多候选及正常解析入口。首轮新测试暴露normalize入口仍丢声明，修复后重跑。实际原生编译和诊断重放已执行，未重跑完整原生/WASM或浏览器产品端到端。该公开自适应单例既不能证明总体成功率提高，也不能代替独立隐藏集、实物或用户验收。

下一步应以可审查的机械方案及局部真实反馈验证生成/修复能否补齐入口、同件连接、阻挡和释放几何，同时明确保留原任务的探测要求。单纯继续整稿生成或把声明恢复称工程成功缺乏支持。完整M0–M8目标继续进行。

## 2026-11-08 · 人工方案辅助生成及两项坐标错误的四组因果对照

本轮隔离“方案选择”和“文字方案实现”两个问题。在原始任务后追加依据本仓库原创gated样件写出的自然语言区域/装拆方案，未提供SCAD示例或第三方CAD源码。请求明确保留全部原要求、材料/工艺未知及防意外下移的证据缺口。输入属于人工方案辅助实现实验，不能计为自主设计成绩。协议和原文字方案在 `.agentscad/experiments/guided-gated-generation-2026-11-07/`，taskSet hash33ef4ddb…，maxCalls=1、maxRepairs=0、预留0.724288元；下导向孔Z=−1.75/−1.5/−1.25三个截面在调用前冻结。

真实调用paid-deepseek-assembly-NxuLSm在2026-11-07T22:59:31.300Z开始，试验含生成与一次judge共42806ms，跨柏林日期到11-08；后续人工诊断耗时另计。deepseek-flash返回4595输入/2853输出token，finishReason stop、reasoningCharacters0、计数1。实际wire含thinking.disabled，无headers；用户消息无SCAD fence，保留完整人工方案。codeUnchangedDuringRun true，费用保守上界0.032014元，28条账本TERMINAL累计3.171944元，无active占用，临时凭据清理。未再调用或付费修复。

模型原稿44ef9bc63e487059222980fccbf846821c1c028ce8477fbad34f03a5fa166999声明有效，真实编译并分件，两个制造件有限连通PASS，有限身份PASS；装拆初始相交FAIL、−45°工作运动FAIL。未提供明确要求的translationProbes。自动配合/帧ERROR，因为默认采样落在下板以外，重构15秒超预算NOT_RUN；这些不可用结果不解释为已测公差超差或已证位姿错误。任务仍FAIL，physical/用户验收NOT_RUN。正常源码具有实际入口及姿态参数，这一改善不足以通过功能任务。

静态线索有两个明确坐标错误。annular_sector接收z0却只使用z1−z0挤出高度，缺少沿Z的起始位置平移。下板孔的切削圆柱放在Z=0，未贯穿Z=−2到−1的下板。四组诊断均保留原稿，仅对这两个位置做显式、唯一锚点的局部反事实修改，原声明及其他几何不动。原稿和仅修扇形高度的版本，预定孔截面均ERROR，中心INSIDE而bore应OUTSIDE，工作/直接旋转/装拆均被干涉阻挡。仅修孔高度后，三个截面的直径间隙MEASURED为0.3987187229到0.4010673877mm，工作及装拆采样PASS，但直接转到90°也PASS，缺少所要求的未释放旋转阻挡。两处均修后，工作19姿态、69姿态释放及逆装配PASS，直接转到90°FAIL。未放宽几何阈值或修改原要求。

独立标准库Python对四组真实网格做有向边与立体角检查。原稿及仅修挡块时，[0,0,−1.5]在固定件及转子均INSIDE，支持此处实际实体穿透；修孔后该点对固定件变OUTSIDE。世界点[2.4,4.156921938…,4.5]在原/仅修孔的固定件为OUTSIDE，在修挡块的两组为INSIDE；对应60°转子局部点[4.8,0,4.5]为INSIDE。远点均OUTSIDE。点在读取源码/原生结果后选定，非盲评，不证明全局无自交、所有SE(3)路径、承载或物理功能。诊断目录保留四源码、原生STL、路径/配合、协议、哈希及独立脚本/报告。人工修正版本始终单独归档，不冒充模型成功或产品模板。

另对两处修正的诊断源码做四个输入姿态的真实重新求值，人工绑定hinge_angle/axial_offset并明确关闭show_angle_clamp。局部导出独立放置后与总装源码视图比较，参考姿态三角面对应PASS，制造件在改变视图参数后仍保持局部坐标PASS；45°工作、90°/−0.9mm释放及90°/+10mm抽出三种视图因剖分不同，既有严格对应工具返回NOT_RUN，没有转为通过或称确定几何不一致。四个视图也不覆盖完整源码驱动轨迹。源码运动关系的完整独立几何验证仍是缺口。

原模型SCAD按字节冻结到 `scripts/eval/assembly-fixtures/failures/guided-gated-hinge-2026-11-08.scad`，附说明，未进入检索示例。原生回归锁定哈希、有效声明及缺探测，实际渲染原稿/仅修孔/两处修正，验证连通PASS不能掩盖填实导向孔、装拆PASS不能代替独立释放约束。最终原生定向1 PASS（29断言、36.35秒），普通1017 PASS/3 SKIP/0 FAIL（1020项157文件、41.03秒），typecheck/lint/diff通过。新增测试初次typecheck暴露空数组推断never[]，显式结果类型后重跑。未执行全部原生/WASM、浏览器产品端到端或实物。

本单例支持局部坐标实现错误对这些几何失败有因果贡献，不证明整类模型无法实现方案。下一步高信息实验是把同一原稿、预定截面和两项局部测量反馈送入受限修复，检查模型产物能否保留原声明并补齐要求的探测及真实几何；应同时验证局部修复面，避免再次丢失完整实现。自主方案推导、完整意图/源码运动证据、多关节/V8、物理与隐藏独立验收仍缺，完整M0–M8继续进行。
