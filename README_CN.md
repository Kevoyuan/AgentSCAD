[English](./README.md) | **中文**

# AgentSCAD

![CI](https://github.com/Kevoyuan/AgentSCAD/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![OpenSCAD](https://img.shields.io/badge/OpenSCAD-required-blue)
![Status](https://img.shields.io/badge/status-active-green)

AgentSCAD 是一个全栈 AI CAD 工作区：把自然语言零件需求转成可编辑的 OpenSCAD、渲染后的 STL/PNG 产物，以及带验证结果的任务流程。

它采用渐进式管线：默认一次 LLM 调用生成结构化 CAD 意图和 OpenSCAD；只有验证失败才自动修复，视觉修复只在用户主动触发时运行。

![AgentSCAD 系统概览](./docs/images/agentscad_overview.png)

## 演示流程

![从自然语言创建 CAD 任务，支持可复用案例记忆、模型选择和制造约束。](./docs/images/spec.png)

![AgentSCAD 的生成与修复智能体协作交付经过验证的 CAD 产出物。](./docs/images/repair.png)

![交付的 CAD 产出物可通过预览、STL 就绪状态、SCAD 源码和验证状态进行检查。](./docs/images/Example.png)

## 给评审者的 60 秒概览

- AgentSCAD 将自然语言 CAD 请求转成 `model.scad`、`model.stl`、`preview.png`、验证结果和持久化任务历史。
- 它不只是 text-to-code 演示：应用会保存任务、提取可编辑参数、调用 OpenSCAD 渲染、执行网格/制造约束验证，并且只在失败时尝试修复。
- 没有 API Key 时，仍可打开工作区 UI、初始化 SQLite、查看本地产物、编辑 SCAD/参数，并在 OpenSCAD 可用时运行确定性渲染/验证。
- 配置模型供应商 Key 后，可启用完整 LLM CAD 生成、自动修复、聊天辅助和用户触发的视觉修复。
- 代码评审可从 `src/lib/pipeline/execute-cad-job.ts`、`src/lib/tools/`、`src/components/cad/`、`src/app/api/`、`prisma/schema.prisma` 和 `skills/` 开始。

## 快速开始

### 方案 A：Docker Compose

Docker Compose 可启动生产构建 Web 应用和 SQLite 工作区：

```bash
cp .env.example .env
mkdir -p db public/artifacts
docker compose up --build
```

打开 [http://localhost:3000](http://localhost:3000)。

Docker 会在启动应用前初始化 Prisma SQLite schema。镜像有意**不捆绑 OpenSCAD**，因此它适合评审 UI、API、持久化和工作流；如果要渲染 CAD，需要在自定义镜像中提供 OpenSCAD。

### 方案 B：本地开发

前置要求：Node.js 20 或 22 LTS、Bun，以及 PATH 中可用的 OpenSCAD。

```bash
bun install --frozen-lockfile
test -f .env || cp .env.example .env
mkdir -p db
touch db/dev.db
bun run db:push
bun run dev:all
```

打开 [http://localhost:3000](http://localhost:3000)。

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

没有 API Key 时，仍可检查 UI、初始化数据库、编辑 SCAD/参数、查看已有本地产物，并在 OpenSCAD 可用时运行确定性渲染/验证。如果模型生成失败或没有可用供应商，管线会对支持的零件类型退回到模板化参数生成。

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

没有供应商 Key 时，生成几何可能来自模板 fallback 路径。它仍适合评估工作流、产物和确定性检查，但不能替代对模型驱动 CAD 质量的评审。

## 特性

- **产物优先的 CAD 生成**：OpenSCAD 源码是事实来源。
- **成本可控默认路径**：正常路径一次生成调用，仅失败时进行一次修复，视觉修复仅在用户触发时运行。
- **确定性 CAD 工具链**：OpenSCAD 渲染 STL/PNG，Python/trimesh 检查渲染后的网格。
- **参数化编辑**：提取出的 SCAD 赋值会变成带约束的可编辑参数。
- **持久化工作流**：任务状态、版本历史、产物、验证结果和日志都会持久化。
- **多供应商模型路由**：可通过 MiMo、OpenRouter、DeepSeek、OpenAI-compatible endpoints 和本地 fallback 路径生成。

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

## 当前状态 / 限制

- 生成的 CAD 在制造前应经过人工审核。
- 本地渲染需要 OpenSCAD 可通过 `OPENSCAD_BIN` 或 `openscad` 访问。
- Docker 镜像有意不捆绑 OpenSCAD。
- 完整 LLM 生成、修复、聊天辅助和视觉修复需要配置供应商 Key。
- Core CI 是严格的，并且不要求 OpenSCAD；OpenSCAD 渲染检查单独运行。见 [开发与 CI](./docs/DEVELOPMENT.md)。

## 项目结构

- `src/app`、`src/app/api`：Next.js 应用壳和 API/SSE 路由。
- `src/components/cad`：CAD 工作区 UI。
- `src/lib/pipeline`：CAD 任务状态机。
- `src/lib/tools`：OpenSCAD 渲染、验证、产物 IO、SCAD 净化、参数提取。
- `src/lib/repair`：自动修复和视觉修复控制器。
- `prisma/schema.prisma`：任务和版本持久化。
- `skills`：面向模型的 CAD 生成、修复、验证和库策略。
- `cad_knowledge`、`openscad_lib`：本地示例、模式和 OpenSCAD helper modules。

## 深入阅读

- [架构文档](./docs/ARCHITECTURE.md)
- [开发与 CI](./docs/DEVELOPMENT.md)
- [基准测试](./docs/BENCHMARK.md)
- [记忆系统](./docs/MEMORY.md)
- [Skills](./docs/SKILLS.md)
- [OpenSCAD 运行时和库](./docs/OPENSCAD_LIBRARIES.md)
- [故障排查](./docs/TROUBLESHOOTING.md)

## 许可证

MIT - 详见 [LICENSE](./LICENSE)。
