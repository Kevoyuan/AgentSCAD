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
