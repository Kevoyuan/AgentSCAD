---
version: 2
name: "AgentSCAD"
description: "AI-native parametric CAD workspace. A full-bleed 3D viewport with floating instrument modules, built around one dominant action per state."
status: decided
direction: "C2 — floating instrument panel"
colors:
  # dark workspace (default)
  canvas-dark: "#141312"
  canvas-deep-dark: "#0E0D0C"
  # The field the part sits on, and the two grid weights painted into it. The viewer
  # reads these, so the largest surface has the same owner as every plate.
  field-grid-dark: "#191817"
  field-grid-strong-dark: "#242322"
  module-dark: "rgba(34,31,28,0.90)"
  module-solid-dark: "#26231F"
  inner-dark: "#211F1C"
  border-dark: "rgba(255,255,255,0.075)"
  border-strong-dark: "rgba(255,255,255,0.17)"
  foreground-dark: "#EDE8E0"
  foreground-muted-dark: "#BEB6AC"
  # The four text steps, darkest surface to quietest. Every step clears 4.5:1 on the
  # module plate, which is what section 21 requires of the dim values too.
  foreground-label-dark: "#A79E92"
  foreground-dim-dark: "#92897E"
  # light workspace
  canvas-light: "#F4F2EE"
  canvas-deep-light: "#EDE9E1"
  field-grid-light: "#E0DCD5"
  field-grid-strong-light: "#D5D2CB"
  module-light: "rgba(255,255,255,0.92)"
  border-light: "#D9D3C9"
  foreground-light: "#1B1917"
  foreground-muted-light: "#5C564D"
  foreground-label-light: "#6B6459"
  foreground-dim-light: "#7C7468"
  # semantic accents (budgeted — see Colors)
  signal: "#FF5A1F"
  signal-soft: "#FFB597"
  pass: "#7BD68A"
  warn: "#E8B84B"
  fail: "#E8583F"
  # 3D material
  model-face: "#9BA6B2"
  model-face-shaded: "#77828E"
typography:
  ui:
    fontFamily: "Geist, Geist Fallback, system-ui, -apple-system, sans-serif"
    fontSize: "12.5px"
    lineHeight: "1.5"
  mono:
    fontFamily: "'Geist Mono', Geist Mono Fallback, ui-monospace, Menlo, monospace"
    fontSize: "11px"
    lineHeight: "1.45"
  engraved:
    fontFamily: "'Geist Mono', Geist Mono Fallback, ui-monospace, Menlo, monospace"
    fontSize: "9px"
    letterSpacing: "0.16em"
rounded:
  hotspot: "3px"
  control: "4px"
  input: "6px"
  module: "9px"
  action: "999px"
spacing:
  unit: "4px"
  module-gutter: "10px"
  canvas-edge: "16px"
components: {}
---

# AgentSCAD Design System

**Status: DECIDED — Direction C2, floating instrument panel.**

The direction was chosen from three built-and-screenshotted options on 2026-09-17 and then
refined across six rounds of first-hand feedback. Everything in this document describes
the chosen design, not a menu of options. Evidence and the reviewable prototype are in
Appendix A.

## What this revision changes

| Superseded (v1 of this file) | Now |
| --- | --- |
| Docked three-pane shell: App bar + Design browser + Viewport + Inspector + Status bar | One full-bleed 3D canvas; every control is a floating module on top of it |
| Panels never overlap the model | Modules may overlap the model. The user chose maximum 3D area over guaranteed clearance |
| Resizable panel geometry persisted locally | Modules are dragged, collapsed, or hidden; positions persist |
| Fixed pipeline strip in the header | A four-lamp strip inside the canvas, only while running |
| Primary blue `#4B74FF` + measurement cyan `#55C8C1` | One expressive accent: signal orange `#FF5A1F`. Cyan is gone |
| Cool charcoal `#0B0F14` | Warm graphite `#141312` / `#1E1C19` |
| "New Design" modal with tags, model picker, template grid | One composer. The same input creates and refines |
| Build action as a separate keycap module | A circular action inside the composer |
| 3D viewport with no orientation aid | Live WebGL viewport + a 56px ViewCube with 26 selectable regions |
| "Do not use text below 11px" | Reading text stays ≥ 11px. Engraved module labels are 9px mono (see Typography) |

---

## 1. Overview

### Creative North Star

AgentSCAD is a **precision metrology bench**: a large machine surface with instrument
modules clamped onto it. The user should read the screen as *"this is a big precise
machine and I am about to look closely at the part."*

The interface is not a dashboard that happens to contain CAD, and not an AI chat product.

### Product context and register

- **Audience:** makers, mechanical designers, engineers, technical hobbyists, 3D-printing users.
- **Primary job:** describe a part → generate geometry → inspect → refine → validate → export.
- **Usage:** desktop and laptop first, long technical sessions, mouse and keyboard.
- **Register:** engineering instrument. Brand expression must never reduce task clarity.
- **Default visual mode:** a dark workshop. Light mode is a first-class citizen with the same hierarchy.

### Anti-references

AgentSCAD must not become:

- a Linear clone with purple accents;
- a generic black AI interface with neon glows;
- a card-grid SaaS dashboard;
- a KPI/observability dashboard;
- a terminal cosplay UI where everything is monospace;
- an AI chat shell where the CAD model is secondary;
- a CAD clone with permanently visible toolbars.

### Product principle

**Model first. Decision second. Evidence third. System internals last.**

Every structural rule below exists to enforce that order. The failure mode this document
exists to prevent is implementation detail leaking upward into the user's hierarchy
(see Appendix A, findings 1–4).

---

## 2. Product Model & Information Architecture

### Stop exposing `Job` as the mental model

`Job` is an execution concept. Users are creating a **Design**.

```text
Workspace
└── Design
    ├── Brief           描述
    ├── Parameters      尺寸
    ├── OpenSCAD        源码
    ├── Artifacts       产出
    ├── Checks          检验
    └── Revisions       版本
```

A **Run** is one generation, rebuild, repair or validation execution belonging to a design.
Backend objects may keep using `Job` during migration. UI copy must not.

### Preferred vocabulary

| Backend / current | UI language |
| --- | --- |
| New Job | 新零件 / New design |
| Job | 零件 / Design |
| Process / Reprocess | 生成 / 重建 |
| Delivered | 已构建 / Artifacts ready |
| Human Review | 需要你定一下 / Needs a decision |
| Validation Failed | 检验未通过 |
| SPEC | 描述 |
| PARAMS | 尺寸 |
| VALID | 检验 |
| CODE | 源码 |
| LOG | 记录 |

Action labels name the action that actually happens. Never ship a generic `Submit`, `OK`,
or `Process` where a precise verb exists.

---

## 3. Workspace Architecture

### The canvas is the application

There is no app bar, no status bar, no full-height divider, and no page chrome. The 3D
viewport is the surface of the application and it reaches all four edges of the window.

```text
┌────────────────────────────────────────────────────────────┐
│  ╭─────────╮                              ╭─────────────╮  │
│  │ 品牌/状态 │                              │ 面板密度控制 │  │
│  ╰─────────╯                              ╰─────────────╯  │
│                                                             │
│  ╭──────────╮                          ╭──────────────────╮ │
│  │ 零件槽位  │                          │ 尺寸              │ │
│  │          │        THE PART          ╰──────────────────╯ │
│  ╰──────────╯     (full-bleed 3D)      ╭──────────────────╮ │
│  ╭──────────╮                          │ 检验 / 产出 / 版本│ │
│  │ 视图 cube │                          ╰──────────────────╯ │
│  ╰──────────╯                                               │
│  ╭────────╮ ╭────────────────────────────╮                  │
│  │ 读数    │ │ 说一句话改这个零件…   (↑)  │                  │
│  ╰────────╯ ╰────────────────────────────╯                  │
└────────────────────────────────────────────────────────────┘
```

Measured effect of removing the docked shell (1440×900, `design compare` prototype):

| Shell | Part rendered at | Chrome covering the canvas |
| --- | --- | --- |
| Docked three-pane (previous) | 717 × 607 | 57.7% |
| Full-bleed, 全览 | 851 × 720 | 26.4% |
| Full-bleed, 调参 | 851 × 720 | 17.1% |
| Full-bleed, 看模型 | 936 × 792 | 9.9% |

### Floating modules

Every control is a module: a rounded, slightly translucent plate with a real drop shadow,
a draggable header, and a collapse control.

Persistent modules:

| Module | Title | Carries |
| --- | --- | --- |
| Brand | `AGENTSCAD · 零件名 · LEDs` | Identity, run state, provider and OpenSCAD availability |
| Density | `面板 全览/调参/看模型` | Density preset, layout reset, revision number |
| Slots | `零件槽位` | The design list. Not a table, not cards: numbered rows |
| Dimensions | `尺寸` | Parameter steppers. The only always-editable module |
| Checks | `检验` | Verdicts, outputs, revision indicator |
| Readout | `读数` | Bounding box, wall thickness, triangle count, artifact state |
| Composer | `说一句话改这个零件…` | The prompt line **and** the primary action |
| ViewCube | (frameless) | Orientation control, 56px |

Conditional modules: `要你定一下` (replaces `尺寸` while a decision is pending) and the
four-lamp run strip (only while generating).

### Module contract

Every module must:

1. **Drag** by its header, clamped inside the window.
2. **Collapse** to its title bar via the control in its header. A collapsed module keeps
   its position and its title.
3. **Re-stack**: pulling one module out of a column makes the modules below move up.
4. **Never clip its own content.** If content does not fit, the module scrolls or collapses.
   A cutoff control is a bug.
5. **Restore** via the layout reset control.

**One exception: the composer does not move.** It is the anchor of the layout —
fixed width, horizontally centred on the canvas, pinned to the bottom. Everything else
floats around it. A centred composer is also what makes "the composer belongs to the
part" legible; a full-width one reads as a page footer.

The module header shows the title on the left and the state on the right:

```text
尺寸                                    7 项 · 直接改
检验                                    3 / 3 通过
```

### Density levels

Three presets, one keystroke each to change, remembered per workspace:

| Level | Visible | Use |
| --- | --- | --- |
| **全览** | everything | review, tune, export |
| **调参** | dimensions + readout, checks folded to one line | heads-down parameter work |
| **看模型** | composer only | inspecting and presenting the part |

`Space` hides every module, leaving the composer. `Space` again restores the previous
state. This is the guaranteed escape hatch for "just let me see the model".

### Occlusion policy

Modules may overlap the model. This was decided deliberately: the alternative
(a model that never intersects a module) costs roughly 40% of the part's size, and the
user can always collapse, hide, or switch to 看模型.

Because of that, every module must be collapsible and `Space` must always work.
If a future module cannot be collapsed, it does not belong on the canvas.

### Z-order

```text
1  canvas            grid, measurement frame, ruler, the part
2  modules           floating plates
3  transient         menus, popovers, drag ghost
4  blocking          dialogs, command palette
```

Nothing at layer 2 may cover a control the user needs at layer 2. When two modules
overlap, the dragged one wins.

---

## 4. Viewport

The viewport is the product. Everything else is instrumentation around it.

### Camera model

A plain spherical rig — azimuth, elevation, zoom — around the part's bounding-box centre.
There is no roll, no pan-into-nowhere, and no free-fly camera.

```text
azimuth    0 = front, +90 = right, 180 = back, -90 = left
elevation  +90 = looking straight down, -90 = straight up (clamped to ±89.8)
zoom       0.45 … 2.6 of the fitted distance
up         world +Y
```

Any angle is reachable. There are no forbidden orientations and no discrete-only modes.

### Interaction contract

| Gesture | Result |
| --- | --- |
| Drag in the viewport | Orbit. The part follows the pointer |
| Drag the ViewCube | Orbit, identical convention (see below) |
| Wheel over the viewport | Zoom about the part centre |
| Click a ViewCube face / edge / corner | Animate to that standard view |

**Grab convention.** Dragging right rotates the part right; dragging down tips the top
toward the viewer. Both the viewport and the ViewCube must use the *same* sign on both
axes. Two drag surfaces that disagree is a defect, not a preference.

**No snap on release.** Releasing a drag leaves the camera exactly where the pointer let go.
Landing on a standard view is a deliberate click, never a side effect of dragging.
Snapping existed in an earlier iteration only because the part was 26 pre-rendered stills;
with a continuous viewport it is pure friction.

### ViewCube

Size: 56px cube, ~118px module footprint, bottom-left of the canvas. Small and quiet —
the part is the subject, the cube is a control.

**26 selectable regions** — 6 faces, 12 edges, 8 corners — covering every standard view:

| Region | View |
| --- | --- |
| Face | orthographic face view |
| Edge | 45° between the two adjacent faces |
| Corner | isometric of the three adjacent faces |

**Picking is by ray, not by DOM hit-testing.** Build the ray from the same `perspective`
the CSS uses, intersect it with the cube in the cube's own frame, take the entry point,
and classify each axis by how far across its half-width it lands (threshold 0.62).
This makes the middle of a face mean that face, the outer band an edge, and a silhouette
corner a corner — matching how a physical view cube behaves. Hit-testing rotated 3D
elements directly is unreliable and must not be used.

**The cube mirrors the camera, it does not own it.** It renders `rotateX(-elevation)
rotateY(-azimuth)` and is driven from the same state as the viewport, so it can never
disagree with what is on screen.

**Drag is 1:1; the ease is for commands.** The cube carries a 0.34s transform
transition so that a *clicked* standard view visibly travels there — that motion is how
the mapping is learned. While the pointer is down the transition must be off, or the
cube eases toward the pointer and reads as lag. Drag updates are coalesced to one state
update per frame (a trackpad reports at 120Hz, and each update re-renders the
workspace), and the viewer's echo of the angle we just commanded is not stored as new
state.

**Labels are honest.** An angle that lands exactly on one of the 26 stops shows that
stop's name (`等轴 · 前上右`). Any other angle says so (`自由视角 · 下`). Never imply a
stop exists when the camera is between stops.

**Geometry must derive from the element, not from constants.** The face offset is half
the cube's measured width, the pick perspective is read from computed style, and the
hotspot sizes derive from the same measurement. Hard-coded numbers that duplicate a CSS
value will drift the moment the CSS changes — that failure has already shipped once.

### Framing and lighting

- The part is framed from its bounding sphere so no orientation clips.
- The viewport uses the **same camera distance at every angle**. Orbiting never changes
  apparent size; zoom changes apparent size. This is what makes rotation read as rotation.
- Two lights ride with the camera (a key from the upper left, a fill from below right)
  so the part stays readable from every angle, plus a hemisphere term so "up" is felt.
- Normals are **crease-averaged at 38°**: fillets shade smoothly, machined edges stay
  crisp. Flat per-facet normals shatter at the terminator; naive per-vertex averaging
  rounds off the edges.
- The near and far planes hug the part. A wide near/far ratio destroys depth precision
  and makes a thin shell z-fight against its own inner wall.
- The part material is neutral machined grey. Never tint the model to match the brand.
- **The field is the canvas, not a spotlight.** Field colour, fog and grid come from the
  shell's `canvas-deep` and `field-grid` tokens. No radial glow sits behind the part: a
  zero-offset coloured halo is decoration, not depth, and it fights the part for
  attention. The lights that shape the part ride with the camera (above).

### Failure mode

If WebGL is unavailable, show the last known render plus a quiet line naming the reason.
Never show an empty viewport with no explanation.

---

## 5. Composer and the single action

The composer is the product's one input and the product's one primary action.

**Geometry: fixed 620px, horizontally centred on the canvas, 16px from the bottom edge.**
It does not stretch with the window and it cannot be dragged. A 1200px-wide field pushed
the action 900px away from the text being typed and read as a page footer rather than an
instrument control.

```text
┌──────────────────────────────────────────────────────────────┐
│ ›  说一句话改这个零件，比如「壁厚加到 2.4」              ( ↑ ) │
├──────────────────────────────────────────────────────────────┤
│ ⌘ ⏎ 生成   空格 隐藏面板   ⌘ K 指令        无需重建            │
└──────────────────────────────────────────────────────────────┘
```

### The action is a circular button inside the field

- A 34px circle at the right end of the input, not a separate module and not a large keycap.
- Symbol states: **↑** = generate / submit; **■** = stop while running.
- The label is available as the accessible name and tooltip (`生成` / `重建` / `停止` /
  `确认并生成`).

### One action per state

| State | Action | Button |
| --- | --- | --- |
| Nothing to do | — | dim |
| A prompt is typed | 生成 | lit |
| Parameters changed | 重建 | lit |
| Running | 停止 | lit, square glyph |
| A decision is pending | 确认并生成 | lit |

**Lighting rule: the action is lit only when pressing it would do something.** It is not
a permanent call to action competing with the part.

### The staleness line

The right end of the hint row always answers *"is the STL the current version?"*:

```text
无需重建
参数已改，需重建      ← turns signal-orange
渲染中 · 03 / 04
按 ⌘ ⏎ 生成新版本
面板已隐藏 · 按空格恢复
```

This line is not decoration. Ambiguity between "preview" and "rebuilt artifact" is the
single easiest way to make a CAD tool untrustworthy.

### Keyboard

`⌘ Enter` submits. **Plain Enter must not submit**: this is a single-line input in a
Chinese-language product, and an IME uses Enter to commit candidate words. No shortcut
may fire while the user is composing text.

---

## 6. Modules: what lives where

### Slots `零件槽位`

The rail carries one create action in its header (`新零件`, ⌘N). It used to exist only
in the empty state, so a workspace with designs in it had no visible way to start
another one. It sits in the header rather than the body because the body scrolls.

The design list is a numbered rail, not a table and not a card grid.

```text
01  手机壳                          ← active, signal bar on the left edge
    17 Pro Max · 可导出
02  六角螺栓 M3
    待确认
03  齿轮 模数 2
    3 天前
```

- Number, name, then one line of state. No badges, no provider name, no internal id,
  no hover-only action cluster.
- Multi-select is an explicit mode with a contextual bar. It must not look like the
  normal rail.
- `⌘ N` adds a design.

### Dimensions `尺寸`

Parameters are instrument readings, not a web form.

```text
机身
机身长          [ −   163.4   + ] mm
机身宽          [ −    78.0   + ] mm
壳体
壁厚            [ −     2.00  + ] mm
```

- Tabular figures, right-aligned, unit always visible.
- Keyboard increment and decrement; `↑`/`↓` step the focused field.
- A changed value is marked and the rebuild action lights up.
- Groups stay short. If a design has 20 parameters, group them and collapse the groups.

### Checks `检验`

Conclusions first, then telemetry.

```text
流形几何                          ■ 通过
最小壁厚 ≥ 1.20                   ■ 通过
外形 ≤ 200 mm                     ■ 通过
```

- Every verdict has a textual form. Colour is never the only signal.
- Percent readiness may appear as supporting telemetry, never as the trust signal.
- **Unimplemented and unconfigured checks are not warnings.** "Requires LLM reasoning
  (not implemented)" and "API key not configured" must not be rendered in the same amber
  alarm style as a real geometry problem. If a check cannot run, it is absent from the
  verdict list with a quiet one-line note, not a warning badge.

### Output and revisions

```text
导出 STL          2.1 MB
导出 OpenSCAD     179 行
REV 3 · 已构建     ■■■
REV 4 · 待构建     □□□
```

The revision indicator is a mechanical flip-dot pair. It is the clearest possible answer
to "which artifact am I looking at", and it is deliberately the most detailed element in
the panel.

### Readout `读数`

```text
163.4 × 78.0 × 8.8      mm
壁厚 2.00               mm
面片 1 284              已构建
```

Bounding box, the one derived dimension that matters, mesh size, artifact state.
No compile time, no internal rule ids, no "triangles: procedural".

### Brand module

Identity, the design name, and three indicator lamps: provider reachable, OpenSCAD
available, run idle/busy. That is the entire environment display. Runtime, units, engine
names and "saved" do not need three separate places to live.

The brand module also carries the only two utility entry points in the product:

```text
AGENTSCAD · 零件名 · ●●● · ⚙ 设置 · 🔔 通知
```

### Secondary surfaces

The v1 shell exposed statistics, comparison, export-all, provider setup, theme
customisation, shortcuts and the command palette as seven equal items in one
`Workspace Tools & Preferences` dropdown, plus a bell, plus a gear. DESIGN.md already
forbids that ("do not permanently expose statistics, export-all, theme customisation and
layout controls at equal emphasis") but never said where the items should go. This
section does.

**Two tiers, and only two.**

```text
Tier 1  work surfaces   modules on the canvas, about the current design
Tier 2  everything else  a sheet, a drawer, or a keystroke - never a module
```

Nothing in tier 2 may occupy canvas space, and nothing in tier 2 may hide the draft.

#### Entry points

```text
⚙  settings        brand module, right side        sheet with tabs
🔔  notifications   brand module, right side        right-hand drawer
⌘ K command palette keyboard only                   overlay
⌘ / shortcuts      keyboard only                    overlay
```

The seven-item tools menu is dissolved. Settings, notifications, the command palette and
the shortcuts sheet each get their own named entry point instead of being four rows in a
menu nobody opens.

#### Placement of every existing surface

| Surface | v1 placement | Where it belongs |
| --- | --- | --- |
| Providers / models | dialog from the tools menu | Settings sheet · **提供方** tab. Also reachable from the first-run canvas and from the brand module. Must preserve the composer draft |
| Theme / palette | dialog from the tools menu | Settings sheet · **外观** tab |
| Statistics | modal from the tools menu | No permanent entry point. Summarise in the slots rail when several designs are selected |
| Compare designs | modal from the tools menu | Contextual: appears in the slots rail action bar once 2+ designs are selected |
| Notifications + activity | popover in the app bar | Bell in the brand module → right drawer |
| Command palette / shortcuts | menu items and keys | Keys only. Never a menu row |
| Export all data | menu item | Bottom of the Settings sheet. It is a maintenance action, not a daily one |
| Case memory (记忆) | tab inside the creation modal | **Folded into composer recall.** As the user types, previously accepted briefs surface as suggestions. It is not a panel |
| Templates | tab inside the creation modal | Same: they become the three examples under the composer. Not a grid of cards |
| Research / dependencies | inspector tab | A collapsed **来源** section inside the 检验 module |
| Notes | inspector tab | Inline in the 描述 module |
| Chat | inspector tab | The composer is the chat |
| Revision history | inspector tab | The revision flip-dot in 检验 expands into the history list |
| OpenSCAD editor | inspector tab | Its own 源码 module, collapsible, and expandable to full canvas |

#### Rules for tier 2

- A sheet is dismissed with `Esc` and returns focus to the control that opened it.
- A drawer never covers the part: it slides in from the right edge inside the existing
  right gutter.
- Opening any tier-2 surface must not clear the composer, the selection, or an in-flight
  run.
- No tier-2 surface may introduce a second primary action. Statistics and comparison are
  read-only.
- If a tier-2 surface keeps being opened during normal work, that is evidence it should
  become a module. Move it, do not leave a shortcut.

---

## 7. Agent Interaction

AI is an operator inside the design, never a separate destination.

### Where it lives

The composer **is** the agent surface. There is no chat page and no assistant tab.
`⌘ /` focuses the composer from anywhere.

### Streaming states

`Idle` · `Thinking` · `Streaming` · `Complete` · `Error` · `Cancelled`.

During generation:

- Stop is always reachable — it is the composer's button, so it is always on screen;
- the previous geometry stays visible, dimmed, and labelled with its revision;
- manual scroll position is respected; auto-scroll stops when the user scrolls up;
- errors preserve the user's prompt;
- Retry never forces the user to retype a request.

### Change summaries

When the agent changes geometry, it states the change:

```text
Changed
• hole diameter 3.2 → 3.6 mm
• wall thickness unchanged

Preview updated. STL needs rebuild.
```

---

## 8. Creation Flow

There is one flow for both creating and refining, because they are the same act.

**Empty workspace**

```text
            写一句话，描述你要的零件。

  这句话会成为这个零件的来源。生成之后尺寸和检验结论
  出现在右侧悬浮模块里，直接改数字，再按生成重建。

  [装在 35 mm 导轨上的相机支架，M4 螺孔]
  [90 × 60 × 25 mm 电子外壳，壁厚 2.5]
  [模数 2、12 齿的直齿轮]
```

Three real examples, drawn from the same families the app can actually build. Clicking one
fills the composer, it does not immediately generate.

**Do not** present tags, model selection, template grids, saved memories, materials,
processes and tolerances with equal weight. Tags are metadata; they belong after creation,
not in the creation path.

**Model provider** defaults to the last healthy configured model. Provider setup is a
module or a dialog reachable from the brand module, never a forced detour through a
settings page that discards the draft.

---

## 9. First-run Experience

An empty workspace teaches by being usable.

```text
                 写一句话，描述你要的零件。

     三个真实例子（见上） · 提供方状态 · OpenSCAD 状态
```

First run must answer four things without a tutorial:

1. Can this thing generate? (provider lamp)
2. Can it render? (OpenSCAD lamp)
3. What do I type? (three real examples)
4. What happens next? (one sentence)

---

## 10. Workflow States

**Create** — the user writes a brief. Action: `生成`.

**Generate** — the viewport stays spatially stable; the previous revision remains visible.
A four-lamp strip appears at the top of the canvas: `读懂描述 · 写出 OpenSCAD · 渲染几何 · 检验`.
The action becomes `停止`.

**Inspect** — once geometry exists it is the largest object on screen. The action stays
`生成` unless parameters changed, in which case it becomes `重建`.

**Refine** — parameter or source edits preview locally. The staleness line says
`参数已改，需重建`. A local preview is never allowed to look like a rebuilt artifact.

**Validate** — verdicts appear in the `检验` module. Blocked checks answer: what failed,
what it means, whether the app can repair it, what repair will change.

**Repair** — explicit. After repair: `已应用修复 · 3 处几何变化 · 正在复检…`, and the
resulting revision is inspectable.

**Export** — enabled only for artifacts that exist. Distinguish `不能导出` from
`可以导出，但有警告` according to real product rules.

---

## 11. Colors

### Core palette

#### Dark (default)

```text
Canvas             #141312   (radial, #322E29 at the centre)
Canvas edge        #0E0D0C
Module             rgba(34,31,28,0.90)  + 16px backdrop blur
Module solid       #26231F
Inner well         #211F1C
Border             rgba(255,255,255,0.075)
Border (emphasis)  rgba(255,255,255,0.17)
Text               #EDE8E0
Muted text         #BEB6AC
Label              #948C82
Dim                #6E6760
```

#### Light

```text
Canvas             #F4F2EE
Module             rgba(255,255,255,0.92)
Border             #D9D3C9
Text               #1B1917
Muted text         #6B6459
```

### Accent roles

```text
#FF5A1F   the action, the active state, and nothing else
#FFB597   the action's softer text form (stale status, hover)
#7BD68A   verified / passed
#E8B84B   caution / needs review
#E8583F   failed / blocked / destructive
#9BA6B2   the part's material
```

### Accent budget

Per screen:

- **one** signal orange element group — the action and its immediate status;
- semantic colours only where semantic state exists;
- no rainbow icon colouring;
- no decorative gradients;
- no coloured border on every card;
- **no cyan.** The previous measurement-cyan role was removed: dimension values live in
  the mono readout and in the parameter fields, and a second expressive hue made the
  screen read as a dashboard.

Launching a state with two competing oranges (button + status line) is acceptable because
they are one object. Three is not.

---

## 12. Typography

### UI

```css
Geist, Geist Fallback, system-ui, -apple-system, sans-serif
```

### Mono

Mono is a role, not a costume. It is used for:

- numbers with units (dimensions, bounding box, tolerance);
- technical identifiers, file sizes, line counts;
- keyboard shortcuts;
- module labels.

It is never used to make ordinary navigation look technical.

### Engraved labels

Module titles and grouped field labels use a small engraved style:

```css
font-family: 'Geist Mono', monospace;
font-size: 9px;
letter-spacing: 0.16em;
color: #A79E92;
```

This is a **deliberate exception** to the old "no text below 11px" rule. The exception is
narrow: it applies to non-reading labels that name a module or a group, where the adjacent
content carries the meaning.

The rule that still holds absolutely: **no body, label, value, or instruction the user
must read to act may be below 11px.** If a 9px label is the only thing telling the user
what a control does, it is too small — that is a design bug, not a typography bug.

### Scale

```text
Design name          12.5px / 600
Module title         9px mono, engraved
Body                 12.5px / 400
Control              11.5–12.5px
Value (mono)         11–12px, tabular figures
Engraved label       9px mono
```

### Casing

Latin text is sentence case. Small engraved module labels may be uppercase because they
are a material treatment, not a sentence. Chinese does not take case.

---

## 13. Layout, Elevation & Shapes

### Layout

There is no column system. Modules take absolute positions inside a 1440×900 reference
stage and are placed against the canvas edges with a 16px gutter and a 10px gap between
stacked modules.

```text
canvas gutter     16px
module gap        10px
module padding    8–11px
composer          620px wide, centred, bottom 16px
control height    22px (stepper) · 34px (circle action) · 44px (composer field)
```

The readout module stays pinned bottom-left, independent of the composer. The two are
separate modules on the same baseline, not a row.

The stage scales to fit the window as one unit, letterboxed. Fixed-size 3D canvases must
never be laid out with reflowing CSS.

### Elevation

Every module floats, so elevation is a system, not an exception:

```css
/* floating module */
background: rgba(34,31,28,0.90);
border: 1px solid rgba(255,255,255,0.075);
box-shadow: 0 14px 30px -10px rgba(0,0,0,0.62),
            0 3px 8px rgba(0,0,0,0.34);
backdrop-filter: blur(16px) saturate(1.15);
```

A 1px inner highlight on the top edge (`inset 0 1px 0 rgba(255,255,255,0.07)`) is what
makes the plate read as physical rather than as generic glass. Dragging raises the shadow
one step.

Do not add glow. Do not nest cards. Do not give a module a shadow *and* a coloured border.

### Shapes

```text
3px     pick hotspots
4px     steppers, output buttons, small controls
6px     inputs, the composer field
9px     floating modules
999px   the circular action, status dots
```

Panels no longer meet edge to edge — that rule belonged to the docked shell.

---

## 14. Components

### Foundational states

Every interactive component needs hover, focus-visible, pressed, disabled and busy states.
Focus-visible is a 2px signal-orange ring at 30% opacity plus a solid border change —
never a browser default outline, never colour alone.

### Buttons

```text
emphasis   primary / secondary / quiet
intent     neutral / signal / danger
size       sm (26px) / md (32px) / lg (44px)
```

The circular action is a variant (`action="circle"`), not a one-off.

### Steppers

```text
[ −   163.4   + ] mm
```

22px tall, 1px border, mono value, tabular figures, right-aligned. Focus raises the border
to signal. A changed value turns the border signal-orange.

### Output buttons

```text
导出 STL          2.1 MB
```

Full-width within their module, label left, size right in dim mono, 1px border. Disabled
when the artifact does not exist.

### Verdicts

```text
流形几何                    ■ 通过
```

An 8px square in the semantic colour plus a text word. Never a bare dot.

### Dialogs, menus, toasts

- Dialogs are for genuinely blocking decisions only. Overlapping destructive choices
  belong inline in the module that owns them.
- Menus use the module surface with a stronger border.
- Toasts do not exist as a general mechanism. Persistent state belongs in a module; a
  transient confirmation is a 2s inline change, not a floating box in the corner.
- Never place a floating notice where it can cover the composer or the part.

### Empty states

An empty module states what will appear and why, in one line, in dim text. It does not
explain the architecture of the application.

```text
尺寸                     生成后出现
机身长          [ −    —    + ]
```

### Loading

Loading never changes the position or size of a module. Skeletons match the final
footprint. `preserveDrawingBuffer` on the 3D canvas is required so captures are stable.

---

## 15. Iconography

16px stroke icons, 1.9px stroke, rounded caps, drawn on a 16 grid.

Custom SVGs are used for the two action glyphs (↑ generate, ■ stop) so their weight
matches the rest of the system. Everything else comes from lucide.

Icons carry meaning or they are removed. There is no decorative icon beside a heading.

---

## 16. Motion

```text
hover / focus        100–140ms
control transition   140–180ms
camera tween         380–420ms  cubic-bezier(.32,.72,.28,1)
module show/hide     180–220ms
```

Rules learned the hard way:

- **A programmatic camera move is driven by one mechanism.** Either a CSS transition or a
  rAF tween — never both. Two mechanisms fighting produce an ease that reads as snapping.
- **An instant camera set must cancel a tween still in flight**, or the animation keeps
  overwriting the camera for the rest of its duration.
- Drag has no easing at all. The pointer is the clock.

Honor `prefers-reduced-motion`: remove the camera tween and status pulses; keep the
state change legible without animation.

---

## 17. Loading & Async Behavior

- **Preserve geometry.** During a rebuild the previous revision stays on screen, dimmed
  to 42% and labelled `第 3 版 · 上一次构建，仅供参考`.
- **Progress is staged, not a percentage.** Four lamps: `读懂描述 · 写出 OpenSCAD · 渲染几何 · 检验`.
  A percentage appears only where a stage has measurable progress.
- **No fake timings.** Never print `GENERATE ~8s` for a step whose duration is unknown.
- **Cancellation is always reachable.** It is the composer button, so it is on screen in
  every density level.
- **A first build leaves the bench occupied.** While there is no geometry yet, a small
  machined part turns over in the middle of the canvas (`GeneratingPart.tsx`): real CSS
  3D, the same technique as the ViewCube, the same material tokens as the part, no
  second WebGL context, and a held three-quarter angle under
  `prefers-reduced-motion`. It reports nothing — the four lamps are the progress
  display, and this only says the machine is working. A rebuild keeps the previous
  revision on screen instead.
- SSE payloads keep the existing contract (`data: ${JSON.stringify(payload)}\n\n`).

---

## 18. Validation & Trust

The UI must preserve the distinction between:

```text
model-provider reasoning
→ actual OpenSCAD output
→ deterministic geometry evidence
→ optional visual review
```

### Evidence hierarchy

```text
Measured result  →  check rule  →  outcome

最小壁厚
2.51 mm
目标 ≥ 2.40 mm
通过
```

Model-generated commentary must never share the visual treatment of deterministic
validation.

### Honesty rules

- Every check has one of `PASS | WARN | FAIL | SKIP | ERROR | NOT_RUN`.
- `SKIP` and `NOT_RUN` are never counted as passing and never rendered as warnings.
- A check that cannot run because a capability is missing is described in plain language,
  without an alarm colour: `本机没有配置视觉复核，已跳过`.
- Never show a rule id to a user. `R001 · Minimum Wall Thickness` is internal.
- Artifact staleness is stated once, in the composer's staleness line, not in three places.

---

## 19. Content Voice

Concise, technical, calm. Chinese UI copy follows the same rules as the English copy did.

- State what happened, then what to do.
- Never explain the application's own architecture to the user.
- Never use a status word as decoration.
- No exclamation marks, no encouragement, no apology theatre.

```text
Good  参数已改，需重建
Good  本机可打印
Bad  恭喜！您的模型已经准备好啦 🎉
Bad  WORKSPACE INITIALIZED — INSPECTOR ARCHITECTURE
```

---

## 20. Responsive Behavior

### ≥ 1280px

Full floating layout as specified. This is the reference size.

### 960–1279px

Modules shrink but keep their positions. The dimensions module drops its second
parameter group behind a disclosure. The canvas is never shrunk to make room.

### < 960px

The docked-position metaphor stops working. Switch to a stacked layout:

```text
3D viewport (fixed 45vh)
composer (pinned)
modules as full-width sheets, summoned one at a time
```

Do not compress floating modules into a grid. Do not keep five floating plates on a
tablet-sized canvas.

### Touch

Hit targets ≥ 44px, no hover-only affordances, and the ViewCube regions must be reachable
by tap. Orbit uses a single-finger drag, zoom uses pinch.

---

## 21. Accessibility

Target WCAG 2.2 AA.

Mandatory:

- semantic buttons; every icon control has an accessible name;
- keyboard access to every operation;
- visible focus (see Components);
- text alternatives for every state colour;
- sufficient contrast, including the 9px engraved labels and dim values;
- error text associated with its field;
- reduced-motion behavior;
- no hover-only discovery;
- **no drag-only operation** — module position and camera orientation both have
  non-drag equivalents (layout reset, ViewCube clicks, keyboard presets);
- logical focus restoration after overlays.

For the viewport specifically: standard views (front / back / left / right / top / bottom /
isometric), fit, and zoom must be reachable from the keyboard. A precision drag must
never be the only way to answer "show me the front".

---

## 22. Component Architecture

### Token ownership

```
src/app/globals.css             semantic CSS variables (--app-*, --signal, --pass, …)
tailwind.config.ts              maps tokens to utility names
src/components/ui/*             primitives (button, input, dialog, …)
src/components/cad/workspace/*  shell: modules, dock, ViewCube, viewport
src/components/cad/*            domain panels
```

Screen files must not invent colours. If a screen needs a colour that does not exist,
the token set is wrong.

### shadcn strategy

Keep shadcn primitives for input, dialog, select, tooltip and popover. Restyle them
through tokens, not through per-screen class overrides. Radix behaviour is worth
keeping; the visual layer is not.

### One writer per element

A state element has exactly one function that writes it. Three bugs in one session came
from the same shape: a per-state assignment followed by an unconditional one, a button
updated on input while its sibling status was not, and a duplicated function where the
later definition shadowed the new one. When adding a stateful element, grep its id and
confirm the writer count is one.

---

## 23. Existing Component Migration

| File | Action |
| --- | --- |
| `workspace/MainWorkspace.tsx` | Becomes the module host. Loses the app bar, footer, resizable panels and the persistent pipeline strip |
| `workspace/JobListPanel.tsx` | Becomes the `零件槽位` module. Loses `SearchFilterPanel`'s permanent chips and the card markup |
| `workspace/ViewerPanel.tsx` | Becomes the WebGL canvas + ViewCube. The `<img>` preview path survives only as the WebGL fallback |
| `workspace/InspectorPanel.tsx` | Splits into `尺寸`, `检验`, `产出/版本` modules |
| `workspace/JobComposer.tsx` | Collapses into the single composer: no modal, no template grid, no tag field in the primary path |
| `pipeline-visualization.tsx` | Becomes the four-lamp strip |
| `quick-actions-bar.tsx` | Deleted; the actions move into the composer and the modules |
| `footer.tsx` | Deleted; environment state lives in the brand module |
| `three-d-viewer.tsx` | Keeps the STL pipeline, gains the camera contract above |
| `job-status-page.tsx` | Renders the module layout read-only |

`job-compare.tsx`, `stats-dashboard.tsx`, `theme-panel.tsx`, `provider-settings-panel.tsx`
are secondary surfaces. They open as sheets or dialogs and are out of the main canvas.

---

## 24. Design Budgets

### Per screen

- one floating module per concern; no module that duplicates another;
- **one lit action** (`生成` / `重建` / `停止` / `确认并生成`) — the composer button;
- one signal-orange element group outside the action (a status line, at most);
- maximum five modules visible in `全览`;
- maximum one level of nested bordered container inside a module;
- no decorative gradients on product surfaces;
- no body text below 11px;
- no body-copy monospace;
- no glow;
- no uncontrolled icon rainbow.

### Per component

Every recurring component is a documented primitive variant. Do not create
`SmallBlueButton`, `ViewportBlueButton`, `InspectorBlueButton`. Create
`Button { emphasis, intent, size, action }`.

---

## 25. Migration Plan

### Implementation status (branch `codex/ui-native-shell`)

Verified against the running app with real job data, not against intentions.

**Done and screenshot-verified**

| Item | Evidence |
| --- | --- |
| Full-bleed canvas; app bar, footer, resizable group and pipeline strip removed | the part renders on the whole stage; modules float over it |
| Floating module primitive: drag, collapse, re-stack, layout reset, never clips (body scrolls) | `Module.tsx`; a module is a flex column with `overflow-hidden` and a scrolling body |
| Density presets 全览 / 调参 / 看模型 and `Space` to hide all | present and working |
| Slots rail: numbered rows `01…`, one state line, small preview only when geometry exists, utilities appear on hover **and on focus-within** | all six designs fit where three did before |
| Slots filters collapsed into one action; status moved inside it | the five permanent chips are gone |
| ViewCube: 26 regions, ray picking, mirrors the camera, no snap on release | 6 regression tests in `viewcube.test.tsx` |
| Keyboard standard views and fit (`1`–`6`, `0`, `F`), each key with exactly one owner | verified: 1→前, 2→右, 3→上, 4→后, 5→左, 6→下, 0→等轴 · 前上右, F refits |
| Composer: fixed 620px, centred, pinned, circular action, staleness line | 5-state capture |
| Settings sheet from the brand module: 提供方 / 外观 tabs + export-all | opens over the shell, never touches the draft |
| Notifications as a right-hand drawer, portalled, Esc to dismiss | 368×900 at the right edge; Esc closes |
| Brand module owns the only two utility entry points (bell, gear) | the seven-item tools dropdown is gone |
| Honesty pass on the visible surfaces: no rule ids, engine paths, builder names, compile times, raw job ids | spec panel, breadcrumb and row telemetry cleaned |
| Viewport default is calm: no bounding box or dimension lines, neutral technical lines, no auto-rotate | measurement layer is opt-in |
| 尺寸 module: real parameter steppers from the design's own schema, draft edits, undo | 7 user parameters on the delivered phone case; `$fn` filtered as an engine internal |
| 检验 module: verdict rows + outputs with real sizes + revision flip-dot pair + explicit repair | verdicts labelled 最小壁厚 / 最大外形 / 流形几何 / OpenSCAD 可编译 / 零件连成一体; STL 40 KB, SCAD 75 行 |
| 要你定一下 module: the job's own clarification question and options | 3 real interpretations on the pending design; selection feeds the composer's single action |
| 读数 module: measured mesh facts only; `—` when unknown, and a declared parameter is dimmed and prefixed 目标 | 82 × 162 × 10 mm and 壁厚 2.01 read from the validator's own messages; 面片 816 from the render log |
| Four-lamp run strip driven by real SSE steps | `readLampStates` walks the pipeline's own step names |
| Composer staleness line reflects the real artifact state | 无需重建 → 参数已改 1 项，需重建 → 无需重建 after undo |
| No second primary action: the viewport header, its action buttons and the readiness strip are gone | the composer owns the only action in every state |
| Light mode verified | 1440×900 capture; modules resolve through shell tokens in both themes |

**Fixed after review (2026-09-18)**

Found by reviewing the branch against the running app with real job data; each item
below was reproduced before it was changed.

| Item | Evidence |
| --- | --- |
| The slots rail no longer disappears below 1024px | `globals.css` dropped the docked-layout media queries that hid `.cad-left-panel`; at 1000×700 the rail renders its rows and a row is selectable |
| Every part opens from the keyboard | rows are `role="option"` + `tabIndex=0` inside a `role="listbox"` with Enter/Space activation; the hover utilities also reveal on `group-focus-within/row`, so focus never lands on an invisible control |
| 上 and 下 are reachable stops again | two bugs, both fixed: OrbitControls' polar limit was 0.96π (−82.8°), so 下 never arrived (it stopped 7° short and the cube honestly said 自由视角); the camera guard is now symmetric ±89.8° and `ViewCube.labelFor` resolves that guard to the ±90 stop. Measured: `3` → 上 at +89.8°, `6` → 下 at −89.8° |
| One owner per key | `KeyboardShortcuts.tsx` no longer writes Space, `1`–`6`, `e` or `h`; `MainWorkspace.tsx` owns Space and the camera keys |
| The plate has one definition | the hardcoded `.mod` duplicate in `globals.css` is gone; `Module.tsx` owns the plate through shell tokens |
| One focus colour | `--ring` and the input focus ring resolve to the shell signal (light `#E0512A`, dark `#FF5A1F`) instead of the old amber |
| The composer never covers 读数 | its width is `min(620px, 100vw − 456px)`: measured overlap 0px at 1440 / 1150 / 1100 / 1000 / 960, and 620px is unchanged at the reference size |
| The cube drives the part | `ViewCube`'s drag path only set the angle without bumping the viewer's command nonce, so the cube turned, the label moved and the part did not (measured: 0 of 360,000 viewport pixels changed). Both paths now share one command handler; the same measurement reads 73,861 |
| The active composer is one signal | the field had a border *and* a 2px ring in the same amber, under a row of three bordered key chips. Now: one 1px amber border, and the shortcuts are engraved text with ⌘K as the only control in that row |
| The cube tracks the pointer while dragging | the same 0.34s ease that makes a clicked view legible was also on during the drag, so the cube trailed the pointer. It is now tied to the drag state (measured 0.34s at rest → 0s while dragging → 0.34s after release), drag updates are rAF-coalesced (120 synthetic pointer moves cost 0.4ms total), and the viewer's echo of a commanded angle no longer triggers a second render per move |
| `bun run lint` is green | the notification drawer detects the client with `useSyncExternalStore` instead of `setState` in an effect |

**Not done**

| Item | Note |
| --- | --- |
| Case memory and templates folded into composer recall | they still live in the old creation modal |
| Theme panel content re-tokenised | container is new, contents still use old tokens |
| Responsive behaviour below 960px | the rail is no longer hidden, but §20's stacked layout (viewport 45vh, modules as full-width sheets summoned one at a time) is still not built |
| §20 960–1279px tuning | modules shrink and their bodies scroll (measured: 尺寸/检验 cap at 46% of the column), but the dimensions module does not yet fold its second parameter group behind a disclosure |
| Research / dependencies / notes placement per §6 | reachable from the 源码 / 记录 sheet; not yet collapsed into 检验 as a 来源 section |
| Model orientation convention (Open question 2) | still open: the ViewCube's meaning depends on the generated SCAD's axes |

### Phase 0 — Contract

Adopt this document. Capture baseline screenshots of the current docked shell. Add and
keep the viewport regression test (Appendix B) green before touching the shell.

### Phase 1 — Canvas and modules

Remove the app bar, footer, resizable panel group and the persistent pipeline strip.
Introduce the module host with drag, collapse, density presets and `Space`. The existing
panels move inside as-is, unstyled at first. **This phase delivers the largest perceived
change and should ship alone.**

### Phase 2 — Viewport

Replace the image preview with the WebGL viewport, the camera contract, and the ViewCube.
Keep the image path as the no-WebGL fallback. Land the framing and lighting rules in the
same change; a viewport that z-fights or crushes to black is worse than the image.

### Phase 3 — Composer and the action

Collapse creation into the single composer, add the circular action, move the staleness
line into the hint row, and delete the creation modal and the quick-actions bar.

### Phase 4 — Honesty pass

Remove every internal identifier from the UI: rule ids, engine paths, builder names,
compile times, `SYS:`-style status strings, and the fake "3 WARN" for unimplemented
checks. This phase is small and disproportionately improves trust.

### Phase 5 — Component convergence

Steppers, verdicts, output buttons and module plates become primitives. Delete
screen-local colour overrides.

### Phase 6 — Responsive and accessibility

Stacked layout below 960px, keyboard access to every viewport operation, focus
restoration, and a contrast pass including the engraved labels.

---

## 26. Acceptance Criteria

The redesign is not complete because it uses the new colours. It is complete when:

1. The part is the largest object on the canvas in a normal workspace.
2. A first-time user can go from an empty workspace to geometry without opening settings.
3. There is exactly one place to type and exactly one action to press in every state.
4. Every run state presents one obvious next action, and that action is lit.
5. Parameter edits clearly distinguish preview state from rebuilt artifact state.
6. Deterministic validation and model interpretation are visually distinguishable.
7. A check that cannot run is not rendered as a warning.
8. No rule id, engine name, file path or compile time is visible anywhere in the UI.
9. The 3D viewport reaches any orientation by drag and any standard orientation by click.
10. Releasing a drag never moves the camera.
11. Light and dark themes preserve the same hierarchy.
12. Every primary workflow works from the keyboard, including standard views and fit.
13. Below 960px the layout stacks rather than compressing.
14. Loading never moves or resizes a module.
15. Shared components own their visual state instead of screens overriding colour.
16. A screenshot with the logo removed is still recognisably AgentSCAD.

---

## 27. Do's and Don'ts

### Do

- Make geometry the focal point and let modules overlap it.
- Keep exactly one lit action per state.
- Make every module collapsible, and keep `Space` sacred.
- State artifact staleness once, in the composer.
- Prefer rows and readings over cards.
- Keep the camera's relationship to the part obvious at all times.
- Make the ViewCube honest about whether the camera is on a standard view.
- Derive layout maths from measured elements, not duplicated constants.

### Don't

- Reintroduce a docked chrome bar to "organise" anything.
- Turn the workspace into a KPI dashboard.
- Show internals at user hierarchy.
- Let a module clip its own content.
- Add a second expressive accent colour.
- Snap the camera on drag release.
- Use plain Enter as a submit shortcut in a Chinese-language input.
- Let two code paths write the same state element.
- Solve an information problem by adding another module.

---

## 28. Implementation Review Checklist

Before merging any screen of the new shell:

- [ ] The part is the largest object on the canvas.
- [ ] Exactly one action is lit.
- [ ] Every module is draggable, collapsible and reachable after a reset.
- [ ] `Space` hides everything except the composer, and restores it.
- [ ] The staleness line matches the actual artifact state.
- [ ] Readings use mono and tabular figures with units.
- [ ] No rule id, engine name, path or compile time is visible.
- [ ] Verdicts have a textual form, not colour alone.
- [ ] Skipped and unavailable checks are not rendered as warnings.
- [ ] Both density extremes (全览, 看模型) were checked.
- [ ] Hover, focus-visible, pressed, disabled and busy states exist.
- [ ] Keyboard access was tested, including standard views and fit.
- [ ] Reduced motion was checked.
- [ ] Empty, loading, error and success states were checked.
- [ ] Long prompts, long design names and long provider names do not break a module.
- [ ] Dark and light themes were both checked.
- [ ] 9px engraved labels are never the only thing naming a control.

---

## Appendix A — evidence from the 2026-09-17 session

Three directions were built as clickable HTML, screenshotted, and compared before any
decision:

| Direction | Basis | Outcome |
| --- | --- | --- |
| A · 大样编辑台 | Random style roll (#6 Bold Big-Type Editorial) | Not chosen |
| B · 专业零件台 | Shapr3D (Apple Design Award 2020) | Not chosen |
| C · 一体仪表台 | Teenage Engineering instrument logic | **Chosen**, then refined to C2 |

### Findings that drove the requirements above

Measured on the running app with real job data:

1. **Five competing entry points** for creating a design (app bar, rail, canvas centre,
   composer, presets). No canonical one.
2. **The clarification card replaced the model entirely**, and its third option was
   clipped by the floating composer with no scroll affordance.
3. **Internals rendered as user content**: `KERNEL: CSG PARAMETRIC`, `Engine / Path:
   manual scad apply`, `TRIANGLES: Procedural`, `COMPILE TIME 13030 ms`, `SYS: STANDBY`,
   `INSPECTOR ARCHITECTURE`, rule ids `R001/S001/V001`.
4. **Unimplemented checks rendered as amber warnings** ("requires LLM reasoning (not yet
   implemented)", "MIIMO_API_KEY is not configured") — destroying the credibility of the
   checks panel that also reports passing geometry.
5. **The same fact stated three times** (runtime toast, status bar, first-run card).
6. **Elements overlapping each other**: the runtime toast over the composer, the composer
   over the clarification options, the composer over the footer.
7. **Uppercase everywhere** in one product and sentence case in another screen.
8. **179 lines of OpenSCAD in a ~380px column**, read-only by default, clipped horizontally.
9. **One part, two visual identities**: an orange render in the list thumbnail and a grey
   model in the viewport.
10. **Light mode carried the dark mode's amber vignette.**

### Iterations after the direction was chosen

| Round | Request | Result |
| --- | --- | --- |
| C2 | "make the right panels floating, so the 3D looks bigger and the UI lighter, other parts too" | Full-bleed canvas, eight floating modules, three density levels, measured 57.7% → 26.4% chrome |
| C3 | "add a SolidWorks-style 3D cube" | 26-region ViewCube |
| C4 | "the cube must be any angle, and the panel must rotate freely like before" | Live WebGL viewport replaced the pre-rendered stills |
| C5 | "dragging is inverted and the cube is exploded" | Three root causes fixed: hard-coded face offset, mismatched pick perspective, opposite drag signs |
| C6 | "shrink the cube, reference SolidWorks" | 56px cube, minimal chrome |
| C7 | "I don't want snapping" | Snap-on-release removed; verified 0.00° drift across eight drag scenarios |
| C8 | "fold the generate button into the composer as a circle with a symbol" | Circular action inside the field; staleness line moved into the composer |

Reviewable prototype:
`~/.gstack/projects/Kevoyuan-agentscad/designs/ui-redo-20260917/direction-C2-floating-modules.html`

## Appendix B — viewport regression test

`check-viewcube.mjs` (15 checks) guards the failures that already shipped once:

- cube face offset equals half the cube's measured size;
- the pick ray's perspective equals the CSS perspective;
- viewport drag right decreases azimuth, down increases elevation;
- the cube drag uses the same signs as the viewport drag;
- releasing either drag leaves the camera where it was released;
- clicking a face still lands exactly on that standard view;
- face, edge, corner and off-cube regions resolve to the right views, with offsets scaled
  to the cube's own size so a resize cannot silently invalidate the test;
- no page errors.

### C2 module regression test

`src/components/cad/workspace/__tests__/c2-modules.test.tsx` (17 checks) guards the
module behaviours that this document requires and that are easy to regress:

- engine special variables (`$fn`, `_*`) are filtered out of 尺寸, while named technical
  parameters a design genuinely exposes are kept;
- the parameter schema falls back to parsing top-level SCAD assignments, and returns
  `null` for an empty design instead of inventing parameters;
- triangle count and the measured bounding box/wall thickness are read from persisted
  evidence (`renderLog`, the validators' own messages), and stay `null` — printed as `—` —
  when there is no evidence;
- every verdict carries a word, and a check that could not run renders hollow and dim,
  never as an alarm;
- a stepper still shows its value when disabled, and an output row with no artifact is
  disabled rather than silently clickable;
- a flow module is not absolutely positioned, which is what makes columns re-stack.

Measured on the running app at 1440×900 with the seeded session's real jobs:

| Check | Result |
| --- | --- |
| App chrome | no header, no footer, no resizable group; the stage is 1436×900 |
| Re-stacking | collapsing 尺寸 moves 检验 from y=338 to y=115 |
| Lit actions in a pending decision | exactly one: the composer's 确认并生成 |
| Density extremes | 看模型 leaves the composer and ViewCube only; 调参 folds 检验 to one line |
| Space | hides every module, keeps the composer, restores on the second press |
| Light mode | same hierarchy; modules resolve to `rgba(255,255,255,0.92)` on `#F4F2EE` |

## Open questions

1. **UI copy language.** The shipped application is English; these prototypes are Chinese.
   This document uses the Chinese strings that were reviewed. Confirm which is canonical
   before Phase 3. The C2 modules implement the Chinese copies (`尺寸`, `检验`, `读数`,
   `要你定一下`, `导出 STL`), while most other surfaces are still English — the workspace
   currently mixes the two and this is not yet resolved.
2. **Model orientation convention.** Generated SCAD has no canonical orientation: this
   phone case's Z axis is the phone's long edge, so the ViewCube's "top" shows the end
   face. Either fix orientation at generation time or normalise it before render.
3. **`assets/views/` (26 pre-rendered PNGs).** Currently unused after the WebGL port.
   Wire them as the no-WebGL fallback or delete them.
4. **Slots still open a design into the old tabs.** The 源码 / 记录 sheet reuses
   `InspectorPanel`, so `描述` / 尺寸 / 检验 / 源码 / 记录 still exist there as tabs even
   though 尺寸 and 检验 are now canvas modules. The sheet should keep only 描述, 源码 and
   记录, and 依赖 / 来源 / 笔记 should move to where §6 puts them.
