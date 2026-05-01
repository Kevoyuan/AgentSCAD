[English](./README.md) | **中文**

# AgentSCAD

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![OpenSCAD](https://img.shields.io/badge/OpenSCAD-required-blue)
![Status](https://img.shields.io/badge/status-active-green)

AgentSCAD 是一个 AI 原生的 CAD 智能体，能够将自然语言零件需求转化为经过验证的 OpenSCAD 产出物。

它采用**渐进式管线**：默认一次 LLM 调用生成结构化 CAD 意图和基于标准库的 OpenSCAD。昂贵的步骤——LLM 修复和 VLM 视觉验证——仅在失败时或用户主动触发时运行。

![AgentSCAD 系统概览](./docs/images/agentscad_overview.png)

AgentSCAD 融合了一次性结构化 CAD 生成、确定性本地验证、验证驱动修复以及用户触发的视觉细化。

## 为什么选择 AgentSCAD？

大多数 text-to-CAD 演示止步于代码生成。AgentSCAD 将 CAD 视为一条成本可控的产出物管线：

1. **一次 LLM 调用**生成结构化 CAD 意图、建模计划、验证目标和基于标准库的 OpenSCAD。
2. 从顶层 SCAD 赋值语句中提取可编辑参数。
3. 使用确定性 OpenSCAD CLI 渲染 STL 和预览图。
4. **本地确定性验证**：编译检查、网格流形、包围盒、组件数、基于欧拉示性数的孔洞计数。
5. **仅在失败时修复**：验证失败后自动进行一次 LLM 修复（带验证反馈）。
6. **用户触发的视觉修复**：仅在用户看到预览后点击"Visual Repair"时调用 VLM 视觉检查。
7. 存储编辑、产出物和习得模式以供后续任务使用。

## 演示流程

![从自然语言创建 CAD 任务，支持可复用案例记忆、模型选择和制造约束。](./docs/images/spec.png)

![AgentSCAD 的生成与修复智能体协作交付经过验证的 CAD 产出物。](./docs/images/repair.png)

![交付的 CAD 产出物可通过预览、STL 就绪状态、SCAD 源码和验证状态进行检查。](./docs/images/Example.png)

主要流程：

1. 用自然语言描述零件，并选择模型/供应商。
2. **一次性生成**：结构化 CAD 意图 + 参数化 OpenSCAD，由本地示例检索和 AgentSCAD 标准库支持。
3. 通过本地 OpenSCAD CLI 渲染 `model.stl` 和 `preview.png`。
4. 查看确定性验证结果（编译、网格、包围盒、组件数、孔洞计数）。
5. 如果验证失败：自动进行一次 LLM 修复（带验证反馈）。
6. 如果仍有视觉问题：点击 **Visual Repair** 运行 VLM 图像分析和针对性 SCAD 修复。
7. 编辑提取出的参数或 SCAD，然后重新渲染、修复或导出 STL。

### 管线架构

```
默认路径（1 次 LLM 调用）：
  提示词 → CAD JSON + SCAD → OpenSCAD 渲染 → 确定性验证 → 结果

失败路径（最多 2 次 LLM 调用）：
  验证失败 → 一次修复调用 → 重新渲染 → 结果 或 human_review

视觉路径（用户触发）：
  用户查看预览 → 点击 Visual Repair → VLM 反馈 → 修复后的 SCAD
```

### 基准测试

```bash
bun run cad:eval              # 运行所有基准测试
bun run cad:eval -- --fast    # 仅简单案例
bun run cad:eval -- --model deepseek  # 指定模型
bun run cad:eval:report       # 解析结果为 JSON
```

关键指标：编译成功率、几何通过率、修复成功率、平均每次任务 LLM 调用次数、平均延迟。

## OpenSCAD 运行时边界

AgentSCAD 默认发行包不捆绑、不链接 OpenSCAD。

AgentSCAD 仅通过 `OPENSCAD_BIN` 或用户运行环境中的 `openscad` 命令，
把 OpenSCAD 作为外部命令行渲染器调用。

安装、打包或再分发 OpenSCAD 的用户/分发者，需要自行遵守 OpenSCAD 的 GPL 许可证要求。

## 快速开始

前置要求：Node.js 20 或 22 LTS、Bun，以及 PATH 中可用的 OpenSCAD。

从 <https://openscad.org/downloads.html> 安装 OpenSCAD，确保终端中可执行 `openscad` 命令。

```bash
bun install --frozen-lockfile
test -f .env || cp .env.example .env
mkdir -p db
touch db/dev.db
bun run db:push
bun run dev:all
```

打开 `http://localhost:3000`。

`bun run dev:all` 启动本地 Next.js 应用/API。

Bun 是本仓库已验证的包管理器，因为项目提交了 `bun.lock`，测试使用 `bun test`，生产 standalone server 也通过 Bun 启动。npm 也可以用于启动开发应用：

```bash
npm install
npm run db:push
npm run dev:all
```

如果使用 npm，请不要提交生成的 `package-lock.json`，除非项目明确要切换包管理器。测试仍然需要 Bun，因为测试脚本使用的是 `bun test`。

在 Windows PowerShell 中，使用以下等效启动命令：

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
New-Item -ItemType Directory -Force db
if (!(Test-Path db/dev.db)) { New-Item -ItemType File db/dev.db }
bun install --frozen-lockfile
bun run db:push
bun run dev:all
```

## 首次运行指引

1. 使用 `bun run dev:all` 启动应用。
2. 打开 `http://localhost:3000`。
3. 创建一个新任务，例如：

```text
创建一个可壁挂的手机支架，带圆角和两个螺丝孔。
```

4. 选择已配置的模型供应商；如果只是评估 UI 和管线形态，也可以使用内置 fallback/template 路径。
5. 查看生成的预览图、STL 就绪状态、SCAD 源码、验证报告和可编辑参数。
6. 修改壁厚、螺丝孔直径等参数，重新渲染，然后导出 STL。

## 没有 API Key 能做什么？

没有付费模型 key 时，你仍然可以 clone 仓库、安装依赖、打开工作区 UI、初始化 SQLite、查看当前存在的本地产出物、编辑 SCAD/参数，并运行确定性的 OpenSCAD 渲染以及网格/制造规则验证。

LLM 驱动的 CAD 生成、修复、聊天辅助和视觉意图审核在 `.env` 或供应商设置中配置至少一个模型供应商后效果最好。视觉验证目前明确使用 `MIMO_API_KEY`；如果缺失，AgentSCAD 会把该检查标记为 skipped，而不是阻塞任务。

## 配置

模型供应商对本地探索是可选的，但对完整 AI 辅助生成/修复质量是必需的。先复制 `.env.example` 到 `.env`，再按需添加供应商。

常用变量：

| 变量 | 是否必需 | 用途 |
|---|---:|---|
| `DATABASE_URL` | 是 | Prisma 使用的 SQLite 数据库路径，默认 `file:../db/dev.db`。 |
| `MIMO_API_KEY` | 可选 | 启用 MiMo 生成 fallback 和视觉验证。 |
| `OPENROUTER_API_KEY` | 可选 | 启用 OpenRouter 模型路由。 |
| `DEEPSEEK_API_KEY` | 可选 | 启用 DeepSeek 模型路由。 |
| `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`DASHSCOPE_API_KEY` 等 | 可选 | 启用更多已配置模型供应商。 |
| `AGENTSCAD_OPENSCAD_LIBRARY_DIR` | 可选 | 覆盖托管 OpenSCAD 库目录。 |
| `OPENSCAD_LIBRARY_PATHS` | 可选 | 添加额外本地 OpenSCAD 库搜索路径。 |
| `CRON_SECRET` | 生产必需 | 保护生产环境 cron endpoint。 |
| `API_SECRET` | 生产必需 | 保护生产环境 job/chat API 路由。 |

可选 OpenSCAD 库配置：

安装已审核的 OpenSCAD 库：

```bash
bun run scad:libs:install
bun run scad:libs:check
```

使用 Bun 运行测试：

```bash
bun test
```

## 特性

- **产出物优先的 CAD 生成**：OpenSCAD 源码是唯一的事实来源；模型返回的参数 JSON 仅作为兼容性元数据和后备方案。
- **CAD 生成与修复智能体**：生成智能体创建 OpenSCAD 产出物，修复智能体修复失败的几何体、验证阻塞项和人工审核编辑。
- **验证驱动的工作流**：当验证失败时，AgentSCAD 保留已生成的 STL、预览图和 SCAD 供检查，然后将任务路由至人工审核或修复流程。
- **实时工作区更新**：Server-Sent Events 实时推送生成进度，工作区自动刷新。
- **参数化编辑**：用户可以在 schema 约束内调整提取的 CAD 参数，如壁厚、孔径或齿轮齿数。
- **基于编辑的记忆**：版本历史和编辑分析将反复出现的修正反馈到未来的生成提示词中。
- **托管 OpenSCAD 库**：BOSL2、Round-Anything、MCAD 等已审核库可安装到本地托管目录，并设有许可证门控。
- **多模型供应商支持**：运行时可通过 OpenAI、Anthropic、Google、DeepSeek、OpenRouter、智谱、通义千问、Mistral 及其他已配置的供应商路由生成请求。

## 任务示例

输入：

```text
创建一个可壁挂的手机支架，带圆角和两个螺丝孔。
```

输出：

- `model.scad`：参数化 OpenSCAD 源码，包含可编辑的顶层赋值。
- `model.stl`：渲染后的网格文件。
- `preview.png`：生成的预览图。
- 验证报告：网格、制造和视觉意图检查。
- 可编辑参数：在工作区 UI 中暴露的约束值。

AgentSCAD 以两个 CAD 智能体为核心：生成智能体创建 OpenSCAD 产出物，修复智能体修复失败的几何体、验证阻塞项或人工审核编辑。工作区聊天助手位于主生成管线之外，用于 CAD 解释、参数建议和面向用户的 SCAD 补丁。

## 仓库结构概览

| 层级 | 职责 | 关键路径 |
|---|---|---|
| 智能体工作流 | 任务状态机、重试、SSE 进度、工作区自动刷新 | `src/lib/pipeline/`、`src/app/api/jobs/[id]/process/route.ts`、`src/app/api/cron/route.ts` |
| Skills | CAD 推理契约、修复策略、验证审核、库使用策略 | `skills/scad-*`、`skills/RESOLVER.md` |
| 工具 | 确定性渲染、验证、SCAD 净化、参数提取、产出物 IO | `src/lib/tools/`、`scripts/validate_stl.py` |
| 记忆 | 任务状态、版本历史、产出物、结构化习得观测（v3.0：追加式 JSONL、管线触发写入） | `prisma/schema.prisma`、`src/lib/version-tracker.ts`、`src/lib/improvement-analyzer.ts`、`skills/scad-generation/learned-observations.jsonl` |
| 工作区 UI | CAD 视口、任务队列、参数编辑、审核面板、聊天助手 | `src/components/cad/`、`src/app/` |

## 记忆系统

AgentSCAD 使用显式的产品记忆而非不透明的聊天历史：

- **工作记忆**：当前任务状态、需求、参数、SCAD 源码、产出物、验证结果和日志。
- **情景记忆**：参数、源码和备注编辑的字段级 `JobVersion` 历史。
- **产出物记忆**：生成的 `model.scad`、`model.stl`、`preview.png` 及报告，存储于 `public/artifacts/{jobId}/`。
- **Skill 记忆**：Markdown CAD 技能、schema、库策略和进程内的技能/schema 缓存。
- **习得记忆**：结构化数值观测（v3.0），从用户编辑、验证失败和修复结果中提取。管线触发写入、追加式 JSONL、用户内容注入防护。

习得记忆仅作为提示词层面的引导，不会覆盖渲染或验证结果。

**v3.0 改进**：观测数据采用结构化数值格式（非自然语言），以追加式 JSONL 存储确保数据安全，在任务完成和验证事件时由管线自动写入。来源信任等级（user_edit > repair_success > validation_pattern）赋予用户驱动的变更更高权重。注入防护在用户 SCAD 内容进入生成提示词前进行清理。质量指标（交付率、修复率）形成闭环——系统不仅知道用户改了什么，还知道这些变更是否带来了成功的交付。

## Skills 概览

CAD 技能层将面向模型的判断保持为可编辑的 Markdown，而确定性代码负责渲染、验证、存储和流式传输。

| Skill | 职责 |
|---|---|
| `skills/scad-generation/` | 创建严格 JSON，包含摘要、兼容性参数元数据和完整的 `scad_source`。 |
| `skills/scad-repair/` | 修复损坏或失败的 OpenSCAD，同时保留设计意图和运行时契约。 |
| `skills/scad-validation-review/` | 审核渲染日志、产出物和验证结果，决定交付、修复或人工审核。 |
| `skills/scad-visual-validate/` | 将渲染预览与用户需求对比，捕捉可见的意图偏差。 |
| `skills/scad-improvement/` | 记录从用户修正中学习的编辑分析循环。 |
| `skills/scad-library-*` | 引导已审核的外部 OpenSCAD 库使用，包含运行时可用性和许可证门控。 |
| `skills/scad-chat/` | 在主生成管线之外提供工作区 CAD 辅助。 |

完整 CAD 技能图请参阅 [docs/SKILLS.md](./docs/SKILLS.md)。

## 托管 OpenSCAD 库

已审核的库目录定义在 `skills/scad-library-policy/manifest.json` 中，包含源仓库、固定 commit、检测文件、include 示例和许可证门控。

默认的托管库目录位于仓库之外：

```bash
~/.agentscad/openscad-libraries
```

安装并检查默认已审核库：

```bash
bun run scad:libs:install
bun run scad:libs:check
```

默认安装包含 BOSL2、Round-Anything 和 MCAD。GPL 库（如 NopSCADlib）默认不安装，需显式选择加入：

```bash
bun run scad:libs:install:gpl
```

生成的 SCAD 可使用 `include` 或 `use` 引用可用库，但 AgentSCAD 不会将第三方库源码复制到生成的 SCAD 中。

## 当前状态

AgentSCAD 是一个面向 AI 原生 CAD 工作流的活跃原型，专为基于 OpenSCAD 的参数化零件本地实验而设计。

当前限制：

- 生成的 CAD 在制造前应经过人工审核。
- OpenSCAD 必须本地安装。
- 视觉验证依赖已配置的模型供应商。
- 习得记忆采用保守策略，仅作为引导而非自动重训练。

## 常用命令

| 任务 | 命令 |
|---|---|
| 开发应用 | `bun run dev:all` 或 `bun run dev` |
| 开发应用别名 | `bun run dev:app` |
| 构建 | `bun run build` |
| 测试 | `bun test` 或 `bun run test` |
| 代码检查 | `bun run lint` |
| 审计依赖许可证 | `bun run license:audit` |
| 检查 OpenSCAD 库 | `bun run scad:libs:check` |
| 安装默认 OpenSCAD 库 | `bun run scad:libs:install` |
| 显式安装 GPL OpenSCAD 库 | `bun run scad:libs:install:gpl` |

已审核的第三方许可证义务记录在 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 中。更改包依赖或 OpenSCAD 库策略前请运行 `bun run license:audit`。

## 项目结构

- `/src/app/api/`：REST API、轻量级 HTTP/SSE 适配器、SCAD 应用路由。
- `/src/components/cad/`：领域专用 React 组件。
- `/src/lib/pipeline/`：CAD 任务运行时状态机。
- `/src/lib/harness/`：Skill 运行器和结构化输出规范化。
- `/src/lib/tools/`：确定性渲染、验证、库解析、净化、产出物和参数工具。
- `/src/lib/stores/`：共享持久化辅助模块。
- `/prisma/`：ORM schema 和数据库配置。
- `/skills/`：AI 模型能力、SCAD 生成/修复/库策略、使用指南和确定性技能脚本。
- `/docs/`：架构、记忆、技能和前端设计文档。

## 深入阅读

- [架构文档](./docs/ARCHITECTURE.md)
- [技能文档](./docs/SKILLS.md)
- [前端重设计计划](./docs/FRONTEND_REDESIGN_PLAN.md)
- [设计系统](./DESIGN.md)

## 许可证

MIT - 详见 [LICENSE](./LICENSE)。
