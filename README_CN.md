[English](./README.md) | **中文**

# AgentSCAD

![CI](https://github.com/Kevoyuan/AgentSCAD/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![OpenSCAD](https://img.shields.io/badge/OpenSCAD-required-blue)
![Status](https://img.shields.io/badge/status-active-green)

AgentSCAD 是一个全栈 AI CAD 工作区：把自然语言零件需求转成可编辑的 OpenSCAD、渲染后的 STL/PNG 产物，以及带验证结果的任务流程。

它采用**渐进式管线**：默认一次 LLM 调用生成结构化 CAD 意图和基于库的 OpenSCAD。成本更高的步骤，例如 LLM 修复和 VLM 视觉验证，只在验证失败或用户主动触发时运行。

![AgentSCAD 系统概览](./docs/images/agentscad_overview.png)

## 演示流程

![从自然语言创建 CAD 任务，支持可复用案例记忆、模型选择和制造约束。](./docs/images/spec.png)

![AgentSCAD 的生成与修复智能体协作交付经过验证的 CAD 产出物。](./docs/images/repair.png)

![交付的 CAD 产出物可通过预览、STL 就绪状态、SCAD 源码和验证状态进行检查。](./docs/images/Example.png)

## 给评审者的 60 秒概览

- AgentSCAD 将自然语言 CAD 请求转成参数化 `model.scad`、渲染后的 `model.stl`、`preview.png`、验证结果和持久化任务历史。
- 它不只是 text-to-code 演示：应用会保存任务、提取可编辑参数、调用 OpenSCAD 渲染、执行网格/制造约束验证，并且只在失败时尝试修复。
- 没有 API Key 时，仍可打开工作区 UI、初始化 SQLite、查看本地产物、编辑 SCAD/参数，并在 OpenSCAD 可用时运行确定性渲染/验证。
- 配置模型供应商 Key 后，可启用完整 LLM CAD 生成、自动修复、聊天辅助和用户触发的视觉修复。
- 预期产物位于 `public/artifacts/{jobId}/`，工作区中会展示 SCAD 源码、STL 就绪状态、PNG 预览、验证状态和版本历史。
- 代码评审可从 `src/lib/pipeline/execute-cad-job.ts`、`src/lib/tools/`、`src/components/cad/`、`src/app/api/`、`prisma/schema.prisma` 和 `skills/` 开始。

## 快速开始

### 方案 A：Docker Compose

Docker Compose 是最快启动生产构建 Web 应用和 SQLite 工作区的方式：

```bash
cp .env.example .env
mkdir -p db public/artifacts
docker compose up --build
```

打开 [http://localhost:3000](http://localhost:3000)。

Docker 说明：

- `docker-compose.yml` 会在启动应用前初始化 Prisma SQLite schema。
- Docker 镜像**不捆绑 OpenSCAD**。这样可以保持 GPL 运行时边界清晰，但渲染/导出流程需要容器内存在 `openscad` 可执行文件，或使用安装了 OpenSCAD 的自定义镜像。
- 如果容器内没有 OpenSCAD，Docker 仍适合评审 UI、持久化、任务流程和 API，但确定性渲染会在配置 OpenSCAD 前失败。

### 方案 B：本地开发

前置要求：Node.js 20 或 22 LTS、Bun，以及 PATH 中可用的 OpenSCAD。

从 <https://openscad.org/downloads.html> 安装 OpenSCAD，并确认终端中可以运行 `openscad`。

```bash
bun install --frozen-lockfile
test -f .env || cp .env.example .env
mkdir -p db
touch db/dev.db
bun run db:push
bun run dev:all
```

打开 [http://localhost:3000](http://localhost:3000)。

`bun run dev:all` 当前会在 3000 端口启动本地 Next.js 应用/API。Bun 是本仓库已验证的包管理器，因为仓库提交了 `bun.lock`，测试使用 `bun test`，生产 standalone server 也通过 Bun 启动。

<details>
<summary>Windows PowerShell 设置</summary>

```powershell
bun install --frozen-lockfile
if (!(Test-Path .env)) { Copy-Item .env.example .env }
New-Item -ItemType Directory -Force db
if (!(Test-Path db/dev.db)) { New-Item -ItemType File db/dev.db }
bun run db:push
bun run dev:all
```

</details>

### npm 后备方式

npm 可以运行开发应用，但测试脚本仍需要 Bun：

```bash
npm install
npm run db:push
npm run dev:all
```

如果使用 npm，请不要提交生成的 `package-lock.json`，除非项目明确切换包管理器。

## 首次运行指引

1. 使用 Docker Compose 或 `bun run dev:all` 启动应用。
2. 打开 [http://localhost:3000](http://localhost:3000)。
3. 创建一个新任务，例如：

```text
创建一个可壁挂的手机支架，带圆角和两个螺丝孔。
```

4. 选择已配置的模型供应商；如果只是评估 UI 和管线形态，也可以使用内置 fallback/template 路径。
5. 查看预览图、STL 就绪状态、SCAD 源码、验证报告和可编辑参数。
6. 修改壁厚、螺丝孔直径等参数，重新渲染，然后导出 STL。

## 预期结果

创建并处理任务后，你应该看到：

- 生成的 `model.scad`
- 渲染后的 `model.stl`
- 渲染后的 `preview.png`
- 验证状态和报告
- 从 SCAD 顶层赋值中提取出的可编辑参数
- 任务历史 / 版本信息
- 在任务状态支持时可用的修复、视觉修复、重新渲染或导出操作

没有 API Key 时，仍可检查 UI、初始化数据库、编辑 SCAD/参数、查看已有本地产物，并在 OpenSCAD 可用时运行确定性渲染/验证。如果模型生成失败或没有可用供应商，管线会对支持的零件类型退回到模板化参数生成，而不是声称具备完整 LLM 质量。

## 没有 API Key 能做什么？

### 无需 API Key

- 打开工作区 UI
- 使用 Prisma 初始化 SQLite
- 查看已有/本地产物
- 编辑 SCAD 和提取出的参数
- 在已安装 OpenSCAD 且 `OPENSCAD_BIN` 或 `openscad` 可用时运行渲染
- 在存在 STL 后运行确定性网格/制造验证
- LLM 不可用时使用 fallback/template CAD 生成路径

### 需要模型供应商 Key

- 完整质量的 LLM CAD 生成
- 验证失败后的自动 LLM 修复
- 超出本地 fallback 响应的聊天辅助
- 使用支持视觉的已配置模型进行用户触发的视觉修复 / VLM 审核

普通管线默认跳过视觉验证，除非用户显式请求。视觉供应商缺失或不可用时，AgentSCAD 会把它视为不确定，而不是阻塞式通过。

## 试试这个示例任务

```text
创建一个可壁挂的手机支架，带圆角和两个螺丝孔。
```

预期产物：

- `model.scad`
- `model.stl`
- `preview.png`
- 验证报告
- 可编辑参数

已知限制：没有供应商 Key 时，生成几何可能来自模板 fallback 路径。它适合评估工作流、产物和确定性检查，但不能替代对模型驱动 CAD 生成质量的评审。

## 特性

- **产出物优先的 CAD 生成**：OpenSCAD 源码是事实来源；模型返回的参数 JSON 仅作为兼容性元数据和后备方案。
- **CAD 生成与修复智能体**：生成智能体创建 OpenSCAD 产物，修复智能体修复失败几何、验证阻塞项和人工审核编辑。
- **验证驱动工作流**：AgentSCAD 保留生成的 STL、预览图和 SCAD 供检查，然后将失败任务路由至修复或人工审核。
- **成本可控默认路径**：正常路径一次生成调用，仅失败时进行一次修复，视觉修复仅在用户触发时运行。
- **实时工作区更新**：Server-Sent Events 实时推送生成进度，工作区自动刷新。
- **参数化编辑**：用户可在 schema 约束内调整壁厚、孔径、齿轮齿数等 CAD 参数。
- **持久化任务/版本/产物流程**：任务状态、字段级编辑、生成产物和报告都会持久化。
- **托管 OpenSCAD 库**：BOSL2、Round-Anything、MCAD 等已审核库可安装到本地托管目录，并设有许可证门控。
- **多模型供应商支持**：可通过 OpenAI、Anthropic、Google、DeepSeek、OpenRouter、智谱、通义千问、Mistral 及其他已配置供应商路由生成请求。

## 30 秒架构

```text
用户请求
  -> CAD 意图 + OpenSCAD 生成
  -> OpenSCAD 渲染
  -> 确定性验证
  -> 产物交付

失败路径：
验证反馈
  -> 一次修复尝试
  -> 重新渲染
  -> 交付或人工审核

视觉路径：
用户查看预览
  -> 点击 Visual Repair
  -> VLM 反馈
  -> 定向 SCAD 修复
```

## 给作品集评审者

重点区域：

- 全栈工作区：`src/app`、`src/components/cad`
- CAD 生成管线：`src/lib/pipeline`
- OpenSCAD 渲染和验证工具：`src/lib/tools`、`scripts/validate_stl.py`
- 任务/版本持久化：`prisma/schema.prisma`
- Skill 系统：`skills/`
- API/SSE 路由：`src/app/api`

## 配置

模型供应商对本地探索是可选的，但对完整 AI 辅助生成/修复质量是必需的。先复制 `.env.example` 到 `.env`，再按需添加供应商。

| 变量 | 是否必需 | 用途 |
|---|---:|---|
| `DATABASE_URL` | 是 | Prisma 使用的 SQLite 数据库路径，`.env.example` 默认 `file:../db/dev.db`。 |
| `OPENSCAD_BIN` | 可选 | 外部 OpenSCAD CLI 路径，默认 `openscad`。 |
| `MIMO_API_KEY` | 可选 | 启用 MiMo 生成 fallback，以及支持时的 MiMo 视觉验证。 |
| `OPENROUTER_API_KEY` | 可选 | 启用 OpenRouter 模型路由。 |
| `DEEPSEEK_API_KEY` | 可选 | 启用 DeepSeek 模型路由。 |
| `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`DASHSCOPE_API_KEY` 等 | 可选 | 启用更多已配置模型供应商。 |
| `AGENTSCAD_OPENSCAD_LIBRARY_DIR` | 可选 | 覆盖托管 OpenSCAD 库目录。 |
| `OPENSCAD_LIBRARY_PATHS` | 可选 | 添加额外本地 OpenSCAD 库搜索路径。 |
| `CRON_SECRET` | 生产必需 | 保护生产环境 cron endpoint。 |
| `API_SECRET` | 生产必需 | 保护生产环境 job/chat API 路由。 |

可选安装已审核 OpenSCAD 库：

```bash
bun run scad:libs:install
bun run scad:libs:check
```

## 测试

运行核心检查：

```bash
bun run lint
bun run typecheck
bun run test:unit
bun run build
```

本地运行 OpenSCAD 集成检查：

```bash
OPENSCAD_BIN=openscad bun run test:openscad
```

如果没有安装 OpenSCAD，请先安装，并确认 `openscad` 在 PATH 中可用。

Linux：

```bash
sudo apt-get update
sudo apt-get install -y openscad
```

macOS 可从 <https://openscad.org/downloads.html> 安装 OpenSCAD；如果可执行文件不在 PATH 中，请设置 `OPENSCAD_BIN`。

Windows 请安装 OpenSCAD；如果不在 PATH 中，请将 `OPENSCAD_BIN` 设置为可执行文件路径。

测试分类：

- 单元测试：不依赖 OpenSCAD，不依赖外部模型 API，适合每个 PR。
- OpenSCAD 集成测试：需要 OpenSCAD，可能会渲染文件系统产物。
- 模型/API 测试：默认应被 mock，不应在 CI 中要求付费供应商 Key。

## CI 策略

AgentSCAD 使用两层 CI。

### Core CI

Core CI 在 pull request、push 到 `main` 时运行，也可以手动触发。它检查不依赖系统级 CAD 工具的应用质量：

- 依赖安装
- Prisma / SQLite 初始化
- lint
- 类型检查
- 使用 mock 或确定性依赖的单元测试
- Next.js 构建

这个 job 是严格的：失败会让 workflow 失败。

### OpenSCAD 集成检查

渲染和网格验证依赖外部 OpenSCAD CLI。它们与 Core CI 分离，因为 OpenSCAD 是系统级 CAD 依赖，不同环境的渲染行为可能不同。

OpenSCAD 集成检查覆盖：

- SCAD 到 STL 渲染
- 预览图生成
- 需要 OpenSCAD 可执行文件的渲染管线 smoke test

这些检查可以在本地安装 OpenSCAD 后运行，也可以通过可选的手动/定时 GitHub Actions job 运行。GitHub Actions 中的 OpenSCAD job 是非阻塞的，因此核心应用质量仍是必需信号。

## 故障排查

| 问题 | 原因 | 解决方法 |
|---|---|---|
| `openscad` not found | OpenSCAD 未安装或不在 PATH 中 | 安装 OpenSCAD；如果可执行文件不叫 `openscad`，设置 `OPENSCAD_BIN` |
| Prisma/database error | SQLite DB 或 schema 未初始化 | 运行 `mkdir -p db`、`touch db/dev.db`、`bun run db:push` |
| 没有 AI 生成 | 缺少供应商 Key，或供应商调用失败 | 在 `.env` 中添加至少一个模型供应商 Key；支持形状仍可能走 fallback/template |
| Visual Repair 不可用 | 选择的任务模型不支持视觉，或缺少视觉供应商凭证 | 切换到支持视觉的已配置模型，并添加所需供应商 Key |
| Visual validation skipped | 普通管线默认不运行视觉检查 | 将 skipped 视为不确定；配置供应商后用 Visual Repair 主动检查 |
| Docker 端口冲突 | 3000 端口已被占用 | 停止已有进程，或修改 Compose 端口映射 |
| Docker 渲染失败 | Docker 镜像不捆绑 OpenSCAD | 使用安装了 OpenSCAD 的自定义镜像，或改用本地开发并安装 OpenSCAD |
| Bun command missing | 未安装 Bun | 安装 Bun；或仅开发运行时使用上面的 npm 后备方式 |
| Windows shell commands fail | 在 PowerShell 中粘贴了 Bash 命令 | 使用上方 Windows PowerShell 设置块 |

## OpenSCAD 运行时边界

AgentSCAD 默认发行包不捆绑、不链接 OpenSCAD。

AgentSCAD 仅通过 `OPENSCAD_BIN` 或用户运行环境中的 `openscad` 命令，把 OpenSCAD 作为外部命令行渲染器调用。

安装、打包或再分发 OpenSCAD 的用户/分发者，需要自行遵守 OpenSCAD 的 GPL 许可证要求。

## 为什么选择 AgentSCAD？

大多数 text-to-CAD 演示止步于代码生成。AgentSCAD 将 CAD 视为一条成本可控的产出物管线：

1. **一次 LLM 调用**生成结构化 CAD 意图、建模计划、验证目标和基于库的 OpenSCAD。
2. 从顶层 SCAD 赋值中提取可编辑参数。
3. 使用确定性 OpenSCAD CLI 渲染 STL 和预览图。
4. **本地确定性验证**：编译检查、网格流形、包围盒、组件数、基于欧拉示性数的孔洞计数。
5. **仅在失败时修复**：验证失败后自动进行一次 LLM 修复。
6. **用户触发的视觉修复**：仅在用户看到预览并点击 "Visual Repair" 后调用 VLM 视觉检查。
7. 存储编辑、产物和习得模式，以用于后续任务。

## 基准测试

```bash
bun run cad:eval         # 运行全部基准
bun run cad:eval:fast    # 仅简单案例
bun run cad:eval -- --model deepseek  # 指定模型
bun run cad:eval:report  # 解析结果为 JSON
```

关键指标：编译成功率、几何通过率、修复成功率、平均每次任务 LLM 调用次数、平均延迟。

## 仓库结构概览

| 层级 | 职责 | 关键路径 |
|---|---|---|
| 智能体工作流 | 任务状态机、重试、SSE 进度、工作区自动刷新 | `src/lib/pipeline/`、`src/app/api/jobs/[id]/process/route.ts`、`src/app/api/cron/route.ts` |
| Skills | CAD 推理契约、修复策略、验证审核、库使用策略 | `skills/scad-*`、`skills/RESOLVER.md` |
| 工具 | 确定性渲染、验证、SCAD 净化、参数提取、产物 IO | `src/lib/tools/`、`scripts/validate_stl.py` |
| 记忆 | 任务状态、版本历史、产物、结构化习得观测 | `prisma/schema.prisma`、`src/lib/version-tracker.ts`、`src/lib/improvement-analyzer.ts`、`skills/scad-generation/learned-observations.jsonl` |
| 工作区 UI | CAD 视口、任务队列、参数编辑、审核面板、聊天助手 | `src/components/cad/`、`src/app/` |

## 记忆系统

AgentSCAD 使用显式的产品记忆而非不透明聊天历史：

- **工作记忆**：当前任务状态、需求、参数、SCAD 源码、产物、验证结果和日志。
- **情景记忆**：参数、源码和备注编辑的字段级 `JobVersion` 历史。
- **产物记忆**：生成的 `model.scad`、`model.stl`、`preview.png` 及报告，存储于 `public/artifacts/{jobId}/`。
- **Skill 记忆**：Markdown CAD 技能、schema、库策略和进程内技能/schema 缓存。
- **习得记忆**：从用户编辑、验证失败和修复结果中提取的结构化数值观测；管线触发写入，追加式 JSONL，并对用户内容做提示词注入防护。

习得记忆仅作为提示词层面的引导，不会覆盖渲染或验证结果。

**v3.0 改进**：观测数据采用结构化数值格式，以追加式 JSONL 存储，在任务完成和验证事件时由管线自动写入。来源信任等级（`user_edit > repair_success > validation_pattern`）赋予用户驱动变更更高权重。质量指标如交付率和修复率形成反馈闭环。

## Skills 概览

CAD 技能层将面向模型的判断保持为可编辑 Markdown，而确定性代码负责渲染、验证、存储和流式传输。

| Skill | 职责 |
|---|---|
| `skills/scad-generation/` | 创建严格 JSON，包含摘要、兼容性参数元数据和完整 `scad_source`。 |
| `skills/scad-repair/` | 修复损坏或失败的 OpenSCAD，同时保留设计意图和运行时契约。 |
| `skills/scad-validation-review/` | 审核渲染日志、产物和验证结果，决定交付、修复或人工审核。 |
| `skills/scad-visual-validate/` | 将渲染预览与用户需求对比，捕捉可见意图偏差。 |
| `skills/scad-improvement/` | 记录从用户修正中学习的编辑分析循环。 |
| `skills/scad-library-*` | 引导已审核外部 OpenSCAD 库使用，包含运行时可用性和许可证门控。 |
| `skills/scad-chat/` | 在主生成管线之外提供工作区 CAD 辅助。 |

完整 CAD 技能图请参阅 [docs/SKILLS.md](./docs/SKILLS.md)。

## 托管 OpenSCAD 库

已审核的库目录定义在 `skills/scad-library-policy/manifest.json` 中，包含源仓库、固定 commit、检测文件、include 示例和许可证门控。

默认托管库目录位于仓库之外：

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
- 本地渲染需要应用运行环境中可用的 OpenSCAD。
- Docker 镜像有意不捆绑 OpenSCAD。
- 视觉修复依赖已配置的、支持视觉的模型供应商。
- 习得记忆采用保守策略，仅作为引导而非自动重训练。

## 常用命令

| 任务 | 命令 |
|---|---|
| 开发应用 | `bun run dev:all` 或 `bun run dev` |
| 开发应用别名 | `bun run dev:app` |
| 构建 | `bun run build` |
| 启动生产服务器 | `bun run start` |
| 核心单元测试 | `bun run test` 或 `bun run test:unit` |
| OpenSCAD 集成测试 | `OPENSCAD_BIN=openscad bun run test:openscad` |
| 类型检查 | `bun run typecheck` |
| 代码检查 | `bun run lint` |
| 审计依赖许可证 | `bun run license:audit` |
| 检查 OpenSCAD 库 | `bun run scad:libs:check` |
| 安装默认 OpenSCAD 库 | `bun run scad:libs:install` |
| 显式安装 GPL OpenSCAD 库 | `bun run scad:libs:install:gpl` |
| 同步 DB schema 到 SQLite | `bun run db:push` |
| 生成 Prisma client | `bun run db:generate` |
| 运行 DB migrations | `bun run db:migrate` |
| 重置 DB | `bun run db:reset` |
| 运行全部 CAD benchmark | `bun run cad:eval` |
| 仅运行简单 benchmark | `bun run cad:eval:fast` |
| 输出 benchmark JSON 报告 | `bun run cad:eval:report` |

已审核的第三方许可证义务记录在 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 中。更改包依赖或 OpenSCAD 库策略前请运行 `bun run license:audit`。

## 项目结构

- `/src/app/api/`：REST API、轻量 HTTP/SSE 适配器、SCAD 应用路由。
- `/src/components/cad/`：领域专用 React 组件。
- `/src/lib/pipeline/`：CAD 任务运行时状态机。
- `/src/lib/harness/`：Skill runner 和结构化输出规范化。
- `/src/lib/tools/`：确定性渲染、验证、库解析、净化、产物和参数工具。
- `/src/lib/stores/`：共享持久化辅助模块。
- `/prisma/`：ORM schema 和数据库配置。
- `/skills/`：AI 模型能力、SCAD 生成/修复/库策略、使用指南和确定性技能脚本。
- `/docs/`：架构、记忆、技能和前端设计文档。

## 深入阅读

- [架构文档](./docs/ARCHITECTURE.md)
- [技能文档](./docs/SKILLS.md)

## 许可证

MIT - 详见 [LICENSE](./LICENSE)。
