[English](./README.md) | **中文**

<p align="center">
  <img src="./public/logo.png" width="120" height="120" style="border-radius: 20%;" alt="AgentSCAD Logo" />
</p>

<h1 align="center">AgentSCAD</h1>

<p align="center">
  <strong>全栈 AI CAD 工作区 —— 自然语言生成可编辑 3D 模型</strong>
</p>

<p align="center">
  <img src="https://github.com/Kevoyuan/AgentSCAD/actions/workflows/ci.yml/badge.svg" alt="CI" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" />
  <img src="https://img.shields.io/badge/Next.js-16-black" alt="Next.js" />
  <img src="https://img.shields.io/badge/OpenSCAD-required-blue" alt="OpenSCAD" />
  <img src="https://img.shields.io/badge/status-active-green" alt="Status" />
</p>

AgentSCAD 是一个本地优先、开源的参数化 CAD Web App。运行项目，在浏览器里添加你自己的模型供应商/API Key，就能把自然语言需求转成可编辑的 OpenSCAD、真实渲染的 STL/PNG 产物和验证证据。

**在线体验 (Live Demo):** [https://agentscad.vercel.app](https://agentscad.vercel.app)

它没有账户系统。本地模式下，任务保存在 SQLite，产物保存在本地文件系统，供应商设置保存在本地 `.agentscad/` 目录。OpenSCAD 是核心 CAD 执行引擎：LLM 负责理解需求并编写或修复 SCAD，原生或 WASM OpenSCAD 负责生成真实几何；确定性验证器检查可测量的网格/制造事实，可选视觉模型再对照请求检查预览。

![AgentSCAD 系统概览](./docs/images/agentscad_overview.png)

> 这张图表达目标产品闭环。当前 runtime 中，视觉检查需要用户主动触发；`DELIVERED` 只表示产物可用，不表示用户已经接受；学习型 prompt memory 仍是本地实验能力。准确边界见[架构](./docs/ARCHITECTURE.md)、[基准测试](./docs/BENCHMARK.md)和[记忆系统](./docs/MEMORY.md)。

## 演示流程

![从自然语言创建 CAD 任务，支持可复用案例记忆、模型选择和制造约束。](./docs/images/spec.png)

![AgentSCAD 的生成与修复智能体协作交付经过验证的 CAD 产出物。](./docs/images/repair.png)

![交付的 CAD 产出物可通过预览、STL 就绪状态、SCAD 源码和验证状态进行检查。](./docs/images/Example.png)

![为 20 多种 LLM 供应商配置 Key 和推荐模型，包括 OpenAI、Anthropic、Gemini、DeepSeek、OpenRouter 及本地模型。](./docs/images/providers.png)


## 60 秒概览

- AgentSCAD 将自然语言 CAD 请求转成 `model.scad`、`model.stl`、`preview.png`、验证结果和本地任务历史。
- 自带 Key 是正常产品路径：**Settings → Providers → Test → Save**，然后使用已配置模型创建任务。
- OpenSCAD 始终是几何事实来源。本地可使用原生 CLI；serverless 或显式 WASM 模式使用经过校验和固定的官方 OpenSCAD WASM CLI。
- LLM 负责理解、SCAD 生成、修复、聊天和可选视觉检查；确定性工具负责渲染、产物 IO、参数提取及可测量的网格/制造规则。
- 没有供应商 Key 时，UI 和确定性 CAD 工具仍可运行，四个已知零件族还有模板 fallback；这仅用于诊断和本地探索，不代表 AI CAD 质量。
- 代码入口：`src/lib/pipeline/execute-cad-job.ts`、`src/lib/tools/`、`src/components/cad/`、`src/app/api/`、`prisma/schema.prisma` 和 `skills/`。

## 前置条件

在开始前，需要安装以下三个工具：

| 工具 | 用途 | 安装方式 |
|---|---|---|
| **Node.js 20 或 22 LTS** | Next.js 应用运行时 | [nodejs.org](https://nodejs.org) |
| **Bun** | 包管理器和脚本执行 | `curl -fsSL https://bun.sh/install \| bash` |
| **OpenSCAD 执行后端** | 编译 SCAD 并渲染真实 STL/PNG | 安装[原生 CLI](https://openscad.org/downloads.html)，或使用已验证的 WASM 后端 |

> [!IMPORTANT]
> OpenSCAD 是核心 runtime 依赖，不是可选验证器。本地原生模式解析 `OPENSCAD_BIN` 或 `openscad`；serverless 和 `AGENTSCAD_OPENSCAD_BACKEND=wasm` 使用经过校验和固定的官方 OpenSCAD WebAssembly CLI。

## 快速开始

### 方案 A：Docker Compose

Docker Compose 可启动生产构建 Web 应用和 SQLite 工作区：

```bash
cp .env.example .env
mkdir -p db public/artifacts
docker compose up --build
```

打开 [http://localhost:3000](http://localhost:3000)。

Docker 会在启动应用前初始化 Prisma SQLite schema，并默认使用镜像中经过
验证的 OpenSCAD WASM 后端。只有在镜像中另行提供了可用的原生
`OPENSCAD_BIN` 时，才应设置 `AGENTSCAD_OPENSCAD_BACKEND=native`。

### 方案 B：本地开发

前置要求：Node.js 20 或 22 LTS、Bun，以及 PATH 中可用的 OpenSCAD（参见上方[前置条件](#前置条件)）。

```bash
bun install --frozen-lockfile
test -f .env || cp .env.example .env
mkdir -p db
touch db/dev.db
bun run db:push
bun run doctor
bun run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

然后打开 **Settings → Providers**，选择预设或自定义 OpenAI-compatible endpoint，粘贴你自己的 API Key，选择模型，点击 **Test** 和 **Save**。本地开发会把配置写入本机 `.agentscad/providers.json`；不要在多人共享的本地实例里保存私密 Key。

Windows 设置和完整命令见 [开发与 CI](./docs/DEVELOPMENT.md)。

### 方案 C：Vercel MVP

如果目标是尽快在线可用，Vercel 主站不需要 Docker。

1. 在 Vercel 导入这个仓库。
2. 添加 Vercel Postgres、Neon 或 Supabase Postgres，并设置 `DATABASE_URL`。
3. 保留 `vercel.json` 中的默认构建命令：

```bash
bun run build
```

4. 运行 `openssl rand -base64 48` 生成供应商设置加密密钥，把它以 `PROVIDER_SETTINGS_SECRET` 保存到 **Vercel Project Settings → Environment Variables**，然后重新部署。
5. 在在线工作区打开 **Settings → Providers**，输入供应商 Key，测试连接后点击 **Save**。
6. 公开部署不要配置共享的模型供应商 Key。未设置 `API_SECRET` 时，AgentSCAD 会忽略环境变量中的供应商凭据，每位访客需通过加密的浏览器会话设置提供自己的 Key。只有私有管理部署才应同时设置 `API_SECRET` 与环境供应商 Key。
7. 添加 Vercel Blob 和 `BLOB_READ_WRITE_TOKEN`。Serverless 渲染使用它持久化
   STL/PNG，并在所有部署实例之间执行统一的渲染容量限制。

这个 MVP 支持在线工作区、任务历史、SCAD 生成/编辑和聊天。通过供应商设置保存的 Key 会加密存入 HttpOnly 浏览器会话 Cookie，不会与其他访客共享，也不会写入 Vercel 的只读文件系统或数据库。在共享设备上离开前请点击 **Clear keys**；浏览器恢复会话的行为各不相同，因此仅关闭网页标签并不能保证凭据已清除。Vercel 使用官方 OpenSCAD WebAssembly CLI 渲染 STL，并从网格创建 PNG 预览。每个渲染子进程都不会收到应用密钥，只能看到一个新的空工作目录，同时受明确的 JavaScript/WASM 内存、运行时间、输出大小和 Blob 全局每分钟 20 次渲染启动上限约束。

## 首次运行指引

1. 使用 Docker Compose 或 `bun run dev` 启动应用（`dev:all` 当前只是兼容别名）。
2. 打开 [http://localhost:3000](http://localhost:3000)。
3. 在 **Settings → Providers** 添加并测试你自己的供应商/API Key。
4. 创建一个新任务，例如：

```text
创建一个可壁挂的手机支架，带圆角和两个螺丝孔。
```

5. 选择刚配置的模型。
6. 查看预览图、STL 就绪状态、SCAD 源码、验证报告和可编辑参数。
7. 修改壁厚、螺丝孔直径等参数，重新渲染，然后导出 STL。

## 预期结果

创建并处理任务后，你应该看到：

- 生成的 `model.scad`
- 渲染后的 `model.stl`
- 渲染后的 `preview.png`
- 验证状态和报告
- 从 SCAD 顶层赋值中提取出的可编辑参数
- 任务历史 / 版本信息
- 在任务状态支持时可用的修复、视觉修复、重新渲染或导出操作

没有供应商 Key 时，仍可检查 UI、初始化数据库、编辑 SCAD/参数、查看本地产物并运行确定性渲染/验证。如果模型生成失败，当前管线只会对支持的零件族退回模板化参数生成；事件流会把这条路径标记为 `generating_mock`。

## 供应商 Key 边界

### 无需供应商 Key

- 打开工作区 UI
- 使用 Prisma 初始化 SQLite
- 查看已有/本地产物
- 编辑 SCAD 和提取出的参数
- 在已安装 OpenSCAD 且 `OPENSCAD_BIN` 或 `openscad` 可用时运行渲染
- 在存在 STL 后运行确定性网格/制造验证
- LLM 不可用时使用有限的 fallback/template CAD 生成路径

### 需要可用供应商/模型

- 完整质量的 LLM CAD 生成
- 验证失败后的自动 LLM 修复
- 超出本地 fallback 响应的聊天辅助
- 使用支持视觉的已配置模型进行用户触发的视觉修复 / VLM 审核

普通管线默认跳过视觉验证，除非用户显式请求。视觉供应商缺失或不可用时，delivery readiness 会把它视为不确定，不会把它当成“设计符合请求”的证据。

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
- **成本可控默认路径**：先执行确定性 intake；索引未知的请求才增加一次短 intake 调用；仅失败时进行一次修复；视觉修复仅在用户触发时运行。
- **确定性 CAD 工具链**：OpenSCAD 渲染 STL/PNG，Python/trimesh 检查渲染后的网格。
- **参数化编辑**：提取出的 SCAD 赋值会变成带约束的可编辑参数。
- **本地优先工作流**：默认自托管体验使用本地 SQLite、本地产物和本地供应商配置；任务状态与版本历史可跨刷新保留。
- **多供应商模型路由**：可通过 MiMo、OpenRouter、DeepSeek、OpenAI-compatible endpoints 和本地 fallback 路径生成。
- **浏览器会话级供应商配置**：Vercel 访客可以在当前浏览器会话中加密保存供应商 Key，并通过 **Clear keys** 立即清除。

## 30 秒架构

```text
用户请求 + 已选供应商
  -> 确定性意图索引
  -> 仅索引未知时执行受限 LLM intake
  -> 有歧义时由用户明确选择
  -> LLM 结构化意图 + 完整 OpenSCAD
  -> 原生/WASM OpenSCAD 编译与渲染
  -> 确定性几何/制造验证
  -> 产物可用（不等于用户自动接受）

失败路径：
验证反馈
  -> 一次修复尝试
  -> 重新渲染
  -> 交付或人工审核

可选视觉路径：
用户查看预览
  -> 点击 Visual Repair
  -> VLM 反馈
  -> 定向 SCAD 修复
```

## 代码导览

重点区域：

- 全栈工作区：`src/app`、`src/components/cad`
- CAD 生成管线：`src/lib/pipeline`
- OpenSCAD 渲染和验证工具：`src/lib/tools`、`scripts/validate_stl.py`
- 任务/版本持久化：`prisma/schema.prisma`
- Skill 系统：`skills/`
- API/SSE 路由：`src/app/api`

## 当前状态 / 限制

- 生成的 CAD 在制造前应经过人工审核。
- Intake 会先检查确定性本地索引，再对索引未知的请求执行一次受限 LLM intake。无论是已知歧义还是经过校验的模型发现歧义，都会在生成/渲染前停止、持久化 2–4 个选项，并只在用户明确确认后继续。对于 `行星发动机模型`，零成本索引会区分“行星推进巨型发动机”和“行星齿轮电机”。完整可编辑的设计 brief/约束编辑器仍在开发中。
- `DELIVERED` 表示 SCAD/STL/PNG 可用且关键确定性检查没有阻塞，不证明语义匹配，也不表示用户已经接受。
- 本地原生渲染需要通过 `OPENSCAD_BIN` 或 `openscad` 访问 OpenSCAD；
  `AGENTSCAD_OPENSCAD_BACKEND=wasm` 可选择已验证的 WASM 后端。
- OpenSCAD WASM 仍是单独执行的 GPL 程序。精确源码、校验和与再分发义务见
  [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
- 完整 LLM 生成、修复、聊天辅助和视觉修复需要配置供应商 Key。
- Core CI 运行单元/构建检查和固定版本的 WASM 集成；原生 OpenSCAD 集成仍是单独的定时/手动任务。离线 benchmark 不能作为几何证据；`cad:eval:render` 只证明其明确列出的真实编译/STL/bbox/PNG 事实。见[基准测试](./docs/BENCHMARK.md)。

## 深入阅读

- [架构文档](./docs/ARCHITECTURE.md)
- [开发与 CI](./docs/DEVELOPMENT.md)
- [基准测试](./docs/BENCHMARK.md)
- [记忆系统](./docs/MEMORY.md)
- [Skills](./docs/SKILLS.md)
- [OpenSCAD 运行时和库](./docs/OPENSCAD_LIBRARIES.md)
- [故障排查](./docs/TROUBLESHOOTING.md)
- [参与贡献](./CONTRIBUTING.md)
- [更新日志](./CHANGELOG.md)

## 许可证

MIT - 详见 [LICENSE](./LICENSE)。
