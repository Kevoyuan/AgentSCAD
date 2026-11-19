# 齿轮对基准（gear pair）

这是公开装配基准的**传动家族**，不是六个两件式装配任务的又一个参数变体。

六个装配任务问「两件能否配合、转动、拆开」；齿轮对问的是另一个可机器判定的问题：

> 输入源码在声明的中心距上，是否真的让两个齿轮按**实测齿数比**反向转动？

齿数、齿顶/齿根/节圆估计、中心通孔轴与中心、标记朝向和中心距都由 `src/lib/assembly/gear-marker.ts` 从实际渲染的 STL 三角形测量。任务只提供输入角和容差，模型不声明自己的齿数、比值或中心距。

## 为什么单独一个目录

`bench/assembly` 的 scorer 契约是「一个关节、孔轴配合、插拔/运动采样」。把一个传动任务塞进同一个 scorer 会改变那个 scorer 的契约，历史数字就不可比了。这里复用同一套 evidence/layer 语言，但有自己的任务格式、scorer 和自检命令。

## 运行

```bash
bun run bench:gear            # 跑所有齿轮任务和提交
bun run bench:gear:check      # 自检：reference 必须 PASS，adversarial 不能 PASS
bun run bench:gear --task gear-12-24 --submission reference --verbose
```

需要本机 `openscad`；没有模型调用。输出 `bench/gear/report.json`。

## 任务格式

见 [`tasks/gear-12-24.json`](tasks/gear-12-24.json)。任务声明：

- `parts`：两件，各自的 `agentscad_part` 选择器；
- `pinionPartId` / `wheelPartId`；
- `axisDirection`：两轮公共轴；
- `pinion` / `wheel`：中心种子和**期望齿数**；
- `ratio`：期望传动比（负号表示反向），必须与声明的齿数一致；
- `centerDistanceMm`：期望中心距，必须与声明的两个中心一致；
- `pose`：源码参数名、输入角列表、角度/比值/中心距容差；
- `requirements`：本 scorer 能观测的断言：`distinct-exported-parts` 和 `rigid-motion`。

输入角列表必须包含 0°（装配位姿），并且任务校验会拒绝任何自身不一致的任务。

## 提交格式

一个目录一个任务，一个 `.scad` 文件一个提交。文件必须：

1. 通过 `agentscad_part` 选择 `pinion_pose` / `wheel_pose`；
2. 通过任务声明的 `pose.parameter`（这里是 `input_deg`）重新渲染；
3. 两件在同一个装配坐标系里，各自有中心通孔和齿顶之外的索引标记。

`reference.scad` 是原创直边全齿高样例；`adversarial-*` 每条只破坏一个事实：

| 提交 | 破坏的事实 | 实测结果 |
|---|---|---|
| `adversarial-same-direction` | 从动轮同向 | 比值 `+0.5`，FAIL |
| `adversarial-wrong-ratio` | 从动轮转 0.4 倍 | 比值 `−0.4`，FAIL |
| `adversarial-static-pinion` | 销轮不随输入转 | 标记不跟随，FAIL |
| `adversarial-wrong-centre` | 中心距从 36 改成 37 | 实测中心距 37，FAIL |
| `adversarial-no-marker` | 删掉索引标记 | 没有朝向证据，NOT_RUN |

## 当前结果

```
task        submission                  status  cover  parts  teeth  ratio    centre
gear-12-24  adversarial-no-marker       NOT_RUN 1/2    PASS   12/24  —        —
gear-12-24  adversarial-same-direction  FAIL    1/2    PASS   12/24  +0.500   36.000
gear-12-24  adversarial-static-pinion   FAIL    1/2    PASS   12/24  −0.500   36.000
gear-12-24  adversarial-wrong-centre    FAIL    1/2    PASS   12/24  −0.500   37.000
gear-12-24  adversarial-wrong-ratio     FAIL    1/2    PASS   12/24  −0.400   36.000
gear-12-24  reference                   PASS    2/2    PASS   12/24  −0.500   36.000
```

`SELF-CHECK OK: 1 reference(s) pass, 5 adversarial submission(s) rejected.` 测量链的解析核对：12/24 齿、节圆估计 11.978 / 23.989 mm、中心距 36.000 mm、比值 −0.500000，与源声明一致。

## 边界

- 直边全齿高演示件，**不是渐开线**；没有齿面接触、侧隙、重合度、承载、效率、磨损或制造公差证据。
- 只测 8 个输入角；角与角之间、连续运动、反向间隙没有证据。
- 节圆半径是「齿顶/齿根 + 标准全齿高」估计；标记和通孔是测量特征，不证明任意生成零件中它们就是用户意图的特征。
- 不做逐件 ZIP、装配声明、拆卸顺序或产品端到端；这是几何/scorer 证据，不是实物或用户验收。
- 公开任务集；没有隐藏集或外部模型 baseline。隐藏集与 L5 多缸仍按主基准的落地顺序推进。
