**English** | [中文](./README_CN.md)

<p align="center">
  <img src="./public/logo.png" width="100" height="100" style="border-radius: 20%;" alt="AgentSCAD Logo" />
</p>

<h1 align="center">AgentSCAD</h1>

<p align="center">
  <strong>AI-Native Parametric CAD Workspace — Generate Editable 3D Models & Physical Checks from Natural Language</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" />
  <img src="https://img.shields.io/badge/Next.js-16-black" alt="Next.js" />
  <img src="https://img.shields.io/badge/OpenSCAD-Native_%7C_WASM-blue" alt="OpenSCAD" />
  <img src="https://img.shields.io/badge/Design-Floating_Instruments-orange" alt="Floating Instruments" />
  <img src="https://img.shields.io/badge/Status-Active-green" alt="Status" />
</p>

---

AgentSCAD is a **local-first, open-source AI parametric CAD workspace**. Built like a precision metrology instrument bench, it features a full-bleed 3D viewport and floating instrument modules. Type a single natural-language sentence to generate editable OpenSCAD code, real-time 3D rendered geometry, deterministic physical validation metrics, and 3D-printable STL artifacts.

**Live Demo:** [https://agentscad.vercel.app](https://agentscad.vercel.app)

---

## 📸 Overview

![AgentSCAD Full-Bleed 3D Viewport and Floating Instruments](./docs/images/agentscad_overview.png)

> **Precision Metrology Instrument Design**:
> - **Full-Bleed 3D Viewport**: Immersive real-time WebGL rendering with zero docked-sidebar clutter.
> - **Floating Instrument Modules**: Draggable, collapsible plates for parameter steppers, manufacturing checks, and physical readouts.
> - **Solid 56px ViewCube**: 26 clickable standard orientation zones (faces, edges, corners) mirroring camera rotation.
> - **Single Centred Composer**: One unified prompt field with one dominant action (`Generate`, `Rebuild`, or `Stop`).

---

## ⚡ Quick Start (3 Minutes)

### 1. Launch AgentSCAD

Run locally using **Bun** or **Docker Compose**:

```bash
# Clone the repository
git clone https://github.com/Kevoyuan/AgentSCAD.git
cd AgentSCAD

# Install dependencies and initialize SQLite schema
bun install
bun run db:push

# Start the dev server
bun run dev
```

> **Or using Docker Compose:**
> ```bash
> cp .env.example .env
> docker compose up --build
> ```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 2. Configure Your LLM Provider

Click the **Settings gear (⚙️)** in the top-left status module:

![Provider Settings](./docs/images/providers.png)

- Select a preset (e.g. **DeepSeek**, **OpenAI**, **OpenRouter**, **Anthropic**, **Gemini**, or local models).
- Paste your API key, click **Test**, then click **Save**.
- *Keys are saved locally in `.agentscad/` or in encrypted browser-session cookies.*

### 3. Generate Your First CAD Model

Type your part description in the bottom input bar:

```text
Create a wall-mountable phone holder with rounded corners and two screw holes.
```

Press `⌘ Enter` (or click the orange circle button `↑`). AgentSCAD automatically:
1. **Understands Intent**: Extracts dimensions, tolerances, and mechanical constraints;
2. **Generates OpenSCAD Code**: Writes clean, parametric OpenSCAD source code;
3. **Renders Real Geometry**: Invokes OpenSCAD (Native CLI or pinned WebAssembly) to generate mesh & STL;
4. **Performs Deterministic Checks**: Validates manifoldness, minimum wall thickness, and outer bounds.

---

## 🎯 Key Capabilities

### 1. Instant Parameter Tuning (Steppers)

Once generated, the right floating module exposes extracted dimensions. Increment or decrement parameters (wall thickness, hole diameter, width/height) and rebuild instantly:

| Parameter Tuning (调参) | Focus View (看模型) |
| :---: | :---: |
| ![Parameter Tuning](./docs/images/tune_parameters.png) | ![Focus View](./docs/images/focus_model.png) |

### 2. Intent Disambiguation ("Needs Decision")

When a natural language description contains mechanical ambiguity, AgentSCAD halts before rendering and presents options for you to decide, ensuring engineering precision:

<p align="center">
  <img src="./docs/images/human_review.png" width="85%" alt="Human Review and Decision" />
</p>

### 3. Fast New Design Creator (`⌘ N`)

Click `＋ New Design` on the rail to open the quick composer, with built-in material, manufacturing, and tolerance presets:

<p align="center">
  <img src="./docs/images/create_design.png" width="85%" alt="New Design Modal" />
</p>

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `⌘ Enter` | Submit prompt / Rebuild model |
| `Space` | **Toggle all floating modules** (instant switch to clean 3D focus view) |
| `⌘ N` | Create a new design |
| `1` – `6` | Standard views: Front (`1`), Right (`2`), Top (`3`), Back (`4`), Left (`5`), Bottom (`6`) |
| `0` | Default isometric view |
| `F` | Fit model to viewport |
| `⌘ K` | Open command palette |

---

## 🛠️ Architecture & Principles

AgentSCAD strictly follows: **"LLMs write code; deterministic tools govern geometry facts."**

- **OpenSCAD Geometry Authority**: Native OpenSCAD CLI for local development; pinned official OpenSCAD WebAssembly (WASM) runtime for zero-install serverless setups.
- **Measurable Physical Checks**: Python / Trimesh inspects actual STL geometry for manifold topology, bounding boxes, wall thickness, and hole connectivity.
- **Local-First Persistence**: SQLite stores revisions and parameter history locally; artifacts are saved directly on disk with complete export capabilities.

---

## 📋 Common Commands

| Task | Command |
| :--- | :--- |
| Dev server | `bun run dev` |
| Build for production | `bun run build` |
| Start production server | `bun run start` |
| Unit tests | `bun run test` |
| Test WASM runtime | `bun run test:wasm` |
| Push database schema | `bun run db:push` |
| Reset database | `bun run db:reset` |
| Run CAD eval benchmark | `bun run cad:eval:fast` |

---

## 📚 Deeper Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Development and CI](./docs/DEVELOPMENT.md)
- [Benchmarking](./docs/BENCHMARK.md)
- [OpenSCAD Runtime & Libraries](./docs/OPENSCAD_LIBRARIES.md)
- [Design System (DESIGN.md)](./DESIGN.md)
- [Changelog](./CHANGELOG.md)

---

## 📄 License

Distributed under the [MIT License](./LICENSE).
