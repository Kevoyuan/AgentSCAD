# L5b V8 shared-pin/packaging carrier（4 共享销，8 缸）

这是 V8 方向的相位/封装阶梯：**8 个活塞-连杆、4 个 90° 相位组、两排 ±45°**，每个相位组一个**共享曲柄销、每销两连杆**。曲柄件是四个独立的盘/销，**没有主轴**；frame 只是一块底板，没有缸体、轴承或点火顺序。它不是完整曲轴 V8，但比每缸独立销更接近 V8 的共享销布局。

## 任务

`tasks/v8-phase-8.json`：

- 曲柄半径 8 mm、连杆 28 mm、半角 45°；
- 4 个站位 y = -30 / -10 / 10 / 30，相位 0 / 90 / 180 / 270；
- 两排 bank y = station ± 3；
- 4 个共享曲柄销、每销两连杆；8 根连杆、8 个滑块、18 个实例（frame、crank、8 rods、8 sliders）；
- 五个输入角 0/90/180/270/360°；
- 滑块中心容差 0.1 mm。

评分器真实重渲染 18 个实例：

- 8 个滑块中心与 4 个相位组的共享闭合公式比较；
- 每角 153 对实例网格，共 **765 次** BVH 碰撞；
- 规范三角形哈希确认 18 实例分别可导出；
- 源码每角重新执行，静态或错误相位不能通过。

## 当前结果

```
bun run bench:v8:check
SELF-CHECK OK: 1 reference(s) pass, 4 adversarial submission(s) rejected.
```

| 提交 | 结果 |
|---|---|
| `reference` | **PASS 4/4**；18 实例；765 次碰撞全分离；位置误差 **0.0000 mm** |
| `adversarial-phase` | FAIL 2/4；相位组全改为 0°，误差 11.3137 mm |
| `adversarial-static` | FAIL 2/4；不随角运动，误差 11.3137 mm |
| `adversarial-crank-radius` | FAIL 2/4；曲柄 9 mm，误差 0.8625 mm，碰撞仍分离 |
| `adversarial-collision` | FAIL 1/4；右滑块移到左 bank，误差 6.0000 mm 且碰撞失败 |

参考在 0° 时八个滑块的相位组分别为 0/90/180/270；同一组左右 bank 的轴向位置相同、x 相反，y 分为 station±3。

## 隐藏集

隐藏 manifest 的 family 新增 `v8`；外部 dev 副本 `hidden-v8-shared-dev [v8]` 为 `1 task / 1 case`、reference PASS、`layers 4/4`、`independentHiddenEvaluation=NOT_RUN`。这仍只是开发副本，不是独立隐藏评估。

## 边界

- **四个共享曲柄销，但曲柄件是四个不连通的盘/销、没有主轴**；不是完整曲轴 V8，不能称为可制造曲轴。
- **frame 只是底板**；没有缸体/导管/轴承/曲轴箱，不评分 frame 连通性。
- 只测五个离散角、网格包围盒位置和 765 次离散碰撞；不测连续运动、负载、润滑、摩擦、磨损、点火/配气或实物功能。
- 已加入 `bench:all` 与 hidden family；完整共享曲轴 V8 仍未开始。
