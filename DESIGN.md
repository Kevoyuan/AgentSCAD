---
version: alpha
name: "AgentSCAD"
description: "AI-native parametric CAD workspace inspired by precision metrology instruments: model-first, evidence-aware, compact, calm, and engineered for long technical sessions."
colors:
  background-dark: "#0A0D10"
  surface-dark: "#12161C"
  surface-muted-dark: "#181C23"
  background-light: "#F4F6F8"
  surface-light: "#FFFFFF"
  surface-muted-light: "#EDF1F5"
  foreground-dark: "#F8FAFC"
  foreground-light: "#111820"
  foreground-muted-dark: "#94A3B8"
  foreground-muted-light: "#607080"
  primary: "#F59E0B"
  primary-hover: "#FBBF24"
  measure: "#10B981"
  success: "#10B981"
  warning: "#F59E0B"
  danger: "#E25B5B"
  border-dark: "rgba(255, 255, 255, 0.09)"
  border-light: "#D5DDE6"
  focus: "#F59E0B"
typography:
  sans:
    fontFamily: "Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "14px"
    lineHeight: "1.5"
  mono:
    fontFamily: "Geist Mono, 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"
    fontSize: "12px"
    lineHeight: "1.5"
rounded:
  DEFAULT: "0.5rem"
  sm: "0.3125rem"
  md: "0.5rem"
  lg: "0.75rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  2xl: "2rem"
components:
  button: {}
  icon-button: {}
  input: {}
  select: {}
  tabs: {}
  sidebar-row: {}
  inspector-section: {}
  viewport-toolbar: {}
  status-badge: {}
  dialog: {}
  sheet: {}
  toast: {}
  tooltip: {}
  empty-state: {}
  progress: {}
---

# AgentSCAD Design System

**Status: PROPOSED — comprehensive product/UI redesign**

> AgentSCAD should feel like a precision engineering instrument with an AI operator built into it—not a dashboard that happens to contain CAD. The model is the hero, engineering decisions are the hierarchy, and agent/pipeline evidence appears exactly when it helps the user decide what to do next.

## Overview

### Creative North Star

The visual world is a **precision metrology bench**: CNC inspection equipment, optical comparators, technical drawing overlays, calibrated controls, measurement rails, machined surfaces, restrained indicator lights, and dense-but-legible engineering software.

The UI should communicate:

**“This tool understands geometry, preserves evidence, and gives me control.”**

It should not communicate:

**“This is another AI chat product.”**

### Product context and register

- **Primary audience:** makers, mechanical designers, engineers, technical hobbyists, 3D-printing users, and developers comfortable with parametric CAD.
- **Primary job:** describe a part → generate geometry → inspect → refine → validate → export.
- **Secondary job:** inspect OpenSCAD, understand failures, repair geometry, compare iterations, and review deterministic evidence.
- **Usage scene:** desktop/laptop first; long technical sessions; mouse + keyboard; frequent comparison of model, parameters, validation and source.
- **Register:** product / engineering tool. Brand expression must never reduce task clarity.
- **Default density:** compact but not cramped.
- **Default visual mode:** dark workspace is the creative benchmark; light mode remains first-class.
- **Memorable signature:** a restrained **metrology layer**—measurement cyan, coordinate ticks, dimension rails and validation markers—used only where they communicate actual geometry or engineering state.
- **Restraint:** lists, settings, forms, history and dialogs remain quiet and familiar.

### Anti-references

AgentSCAD must not become:

- a Linear clone with purple accents everywhere;
- a generic black AI interface with neon glows;
- a crypto/observability dashboard full of metrics;
- a card-grid SaaS dashboard;
- a terminal cosplay UI with monospace text everywhere;
- an AI-chat shell where the CAD model feels secondary;
- a CAD clone overloaded with permanently visible toolbars.

### Product principle

**Model first. Decision second. Evidence third. System internals last.**

The visual hierarchy must follow that order.

---

## Product Model & Information Architecture

### 1. Stop exposing `Job` as the main mental model

`Job` is an execution concept. Users are trying to create a **Design**.

Use the following user-facing hierarchy:

```text
Workspace
└── Design
    ├── Brief
    ├── Parameters
    ├── OpenSCAD
    ├── Artifacts
    ├── Validation
    └── Revisions / Runs
```

A **Run** is a generation, rebuild, repair or validation execution belonging to a design.

Backend/domain objects may continue to use `Job` during migration. UI copy should not expose backend terminology unnecessarily.

### Preferred vocabulary

| Current concept | Preferred UI language |
| --- | --- |
| New Job | New Design |
| Job | Design |
| Process | Generate / Rebuild |
| Reprocess | Rebuild |
| Delivered | Artifacts ready |
| Human Review | Needs review |
| Validation Failed | Validation blocked |
| SPEC | Brief |
| PARAMS | Parameters |
| VALID | Checks |
| CODE | OpenSCAD |
| LOG | Activity |
| Export All Data | Export workspace data |

Action labels describe the action that actually happens.

Never use generic buttons such as `Submit`, `OK`, or `Process` where a precise verb exists.

---

## Workspace Architecture

### Desktop shell

The default desktop workspace uses three purposeful regions:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ App bar                                                             │
├──────────────┬────────────────────────────────────┬──────────────────┤
│              │                                    │                  │
│ Design       │                                    │ Inspector        │
│ browser      │          3D VIEWPORT               │                  │
│              │                                    │ Brief            │
│ Search       │                                    │ Parameters       │
│ Designs      │                                    │ Checks           │
│ Revisions    │                                    │ OpenSCAD         │
│              │                                    │ History          │
│              │                                    │                  │
├──────────────┴────────────────────────────────────┴──────────────────┤
│ Status bar                                                           │
└──────────────────────────────────────────────────────────────────────┘
```

Default desktop proportions at 1440px:

```text
Design browser     224–260px
Viewport           remaining width, minimum 52%
Inspector          320–400px
Status bar         24–28px
App bar            42–46px
```

The viewport must remain the largest visual object.

### App bar

The app bar is not a dashboard.

Left:

```text
AgentSCAD / Design name
```

Center, when useful:

```text
run state · contextual progress
```

Right:

```text
layout
command palette
notifications
settings
New Design
```

Do not permanently expose statistics, export-all, theme customization, telemetry, compare tools, pipeline internals and layout controls at equal emphasis.

Secondary utilities belong in menus or command palette.

### Remove the persistent pipeline from the main header

Pipeline state remains important but should become:

- a compact run-state indicator while idle;
- a progress strip or activity popover while generating;
- an expandable Activity drawer for detailed events.

Example:

```text
Generating geometry · 3 / 5
██████████████░░░░
```

Clicking it opens detailed execution evidence.

The pipeline must explain progress without becoming the product's primary navigation.

---

## Design Browser

The left panel represents **designs**, not telemetry.

Each row contains only the information required to identify and resume work:

```text
[thumbnail/status]  Wall phone holder
                    120 × 80 × 32 mm
                    Needs review · 8m
```

Optional secondary metadata appears on hover/focus or in the inspector.

### Row anatomy

Primary:

- design name / shortened brief;
- status;
- modification time.

Secondary:

- key dimensions;
- revision indicator;
- tiny model thumbnail when available.

Avoid:

- multiple badges;
- provider name;
- generation path;
- internal IDs;
- persistent action icon clusters.

### Search and filters

Search is always immediately available.

Filters open from one filter action rather than permanently consuming vertical space.

Committed state may include:

```text
query
status
part family
sort
```

Clear-search button appears whenever search contains text.

### Multi-select

Multi-select is an explicit mode.

When active, a contextual toolbar replaces normal list controls:

```text
3 selected          Rebuild     Archive/Delete     Clear
```

Selection must not visually compete with the currently open design.

### Reordering

If drag-and-drop remains supported, provide an equivalent menu/keyboard action.

Never make drag the only way to reorder.

---

## Viewport

The viewport is the visual anchor of AgentSCAD.

### Base treatment

Dark:

```text
#0B0F14 → #0E1319 viewport field
```

Light:

```text
#F4F6F8 → #F8FAFC viewport field
```

A technical grid may appear at low contrast but must fade as visual density increases.

Grid is functional atmosphere, not decoration.

### 3D geometry

Default geometry should use neutral machined-material tones.

Use accent colors for meaning:

```text
Primary blue   selected geometry / active operation
Measure cyan   measurements / dimensions / guides
Green          passed checks
Amber          caution / uncertain review
Red            failing geometry / blockers
```

Never tint the entire model simply to match the brand.

### Viewport toolbar

Viewport-native controls float within the canvas.

Example:

```text
Fit · Front · Perspective · Measure
```

A second contextual cluster can contain:

```text
Generate / Rebuild
Export
More
```

Toolbar groups use quiet translucent surfaces, thin borders and limited elevation.

### Metadata

Do not reserve two permanent header rows above the 3D model for:

- timestamps;
- builder name;
- generation path;
- artifact availability;
- family labels;
- readiness score.

Show the design name and essential state only.

Technical metadata moves to the inspector or Activity view.

---

## Inspector

The inspector answers:

**“What can I change or understand about this design right now?”**

It must not behave like a second dashboard.

### Persistent modes

Keep at most five persistent inspector destinations:

```text
Design
Parameters
Checks
OpenSCAD
History
```

`Assistant` becomes a contextual Agent drawer rather than a permanent peer tab.

Research/dependencies become sections of Design or History.

### Design

Contains:

- original brief;
- interpreted intent;
- part family;
- relevant manufacturing assumptions;
- editable design notes;
- dependencies only when applicable.

### Parameters

Parameters must feel like CAD controls, not a generic web form.

Recommended row:

```text
Wall thickness
[ 2.50 ] mm       ─────●────────
```

Rules:

- numeric values aligned using tabular figures;
- unit always visible;
- keyboard increment/decrement;
- optional slider only when a safe bounded range is known;
- changed values visibly marked;
- `Reset` appears only after modification;
- preview changes may be local;
- generated STL is explicitly marked stale after geometry-changing edits.

### Checks

Replace score-first presentation with engineering conclusions.

Hierarchy:

```text
Ready to export
2 warnings

✓ Mesh is manifold
✓ Wall thickness ≥ target
! Visual intent has not been reviewed
```

Percent readiness may exist as supporting telemetry but must not be the main trust signal.

The user needs blockers, warnings and evidence—not a gamified score.

### OpenSCAD

Code editor receives a dedicated mode.

Requirements:

- syntax highlighting;
- line numbers;
- dirty-state indicator;
- `Apply & Preview`;
- `Revert`;
- explicit stale-artifact state;
- search;
- keyboard-first operation.

Do not silently overwrite manually edited source after an Agent repair.

### History

History combines:

- revisions;
- generation runs;
- repairs;
- parameter edits;
- validation events;
- exports.

User-level events come first.

Provider/tool telemetry is progressively disclosed.

---

## Agent Interaction

AI is an operator within the design—not a separate destination.

### Agent drawer

Open using:

```text
Ask Agent
⌘ /
```

or an equivalent keyboard shortcut.

Desktop:

```text
bottom drawer or inspector overlay
```

Narrow screens:

```text
full-height sheet
```

The drawer retains the current design context.

Example prompts:

```text
Make the screw holes 0.4 mm wider.
Why did wall-thickness validation fail?
Reduce material without weakening the mounting tabs.
```

### Streaming

Streaming states:

```text
Idle
Thinking / tool execution
Streaming
Complete
Error
Cancelled
```

During generation:

- Stop is always available;
- partial content remains visually distinct from committed output;
- manual scroll position is respected;
- auto-scroll stops when the user scrolls upward;
- errors preserve the user's prompt;
- Retry never forces the user to retype a request.

Agent responses proposing geometry changes must summarize the change before or immediately after applying it.

Example:

```text
Changed
• hole diameter 3.2 → 3.6 mm
• wall thickness unchanged

Preview updated. STL needs rebuild.
```

---

## Creation Flow

The current “everything in one modal” pattern should be replaced by progressive disclosure.

### New Design — primary flow

Opening `New Design` presents one dominant question:

```text
What do you want to make?

┌─────────────────────────────────────────────┐
│ Describe the part, dimensions and use...   │
│                                             │
│                                             │
└─────────────────────────────────────────────┘

[Add constraints]                  Generate
```

Below the input, show at most three useful examples/recent prompts.

Do not initially present tags, model settings, template grids, memories, materials, processes and tolerances with equal weight.

### Constraints

`Add constraints` expands structured optional controls:

```text
Dimensions
Material
Manufacturing process
Tolerance / clearance
```

These controls add structured context instead of simply appending unexplained comma-separated text.

### Model/provider

The generation model defaults to the last healthy configured model.

Model selection belongs in an Advanced section unless the user has multiple providers and routinely switches.

If no provider exists:

```text
A model provider is required to generate new geometry.

Connect provider
```

Opening provider setup must preserve the draft.

After successful configuration, return directly to the composer.

Do not force first-time users through:

```text
Composer → Settings → Providers → Save → close settings → reopen Composer
```

### Tags

Tags are metadata, not generation requirements.

Move them out of the primary creation path.

Users can add them after creation or under Advanced.

---

## First-run Experience

An empty workspace should teach the workflow in context.

Do not show a dashboard tutorial.

Preferred state:

```text
             [simple 3D / coordinate visual]

             Describe your first part

Turn a short engineering brief into editable OpenSCAD,
real geometry and validation evidence.

[Create first design]

Provider: Not connected → Connect provider
OpenSCAD: Ready / Needs setup
```

First run should answer:

1. Can AgentSCAD generate?
2. Is OpenSCAD available?
3. What should I type?
4. What happens after I generate?

---

## Workflow States

### Create

User writes a design brief.

Primary action:

```text
Generate
```

### Generate

Viewport stays spatially stable.

Show:

```text
Interpreting brief
Generating OpenSCAD
Rendering geometry
Running checks
```

Detailed logs remain optional.

### Inspect

Once usable geometry exists, the viewport immediately becomes primary.

Primary action becomes contextual:

```text
Rebuild
```

only when changes require it.

### Refine

Parameter or source edits preview locally when possible.

Persistent state communicates:

```text
Preview changed
STL is from revision 3
```

Never allow users to mistake a local preview for a rebuilt artifact.

### Validate

Checks appear next to the artifact they validate.

Blocked checks must answer:

```text
What failed?
What does that mean?
Can AgentSCAD repair it?
What will repair change?
```

### Repair

Repair is explicit.

After automated repair:

```text
Repair applied
3 geometry changes
Revalidation running…
```

Users must be able to inspect the resulting revision.

### Export

Export is enabled only for artifacts that actually exist.

If warnings remain, distinguish:

```text
Blocked from export
```

from:

```text
Export allowed with warnings
```

according to real product rules.

---

## Colors

### Core palette

The expressive palette is intentionally narrow.

#### Dark

```text
Background       #0B0F14
Surface          #121820
Raised surface   #19222D
Border           #2B3643
Text             #F3F6F8
Muted text       #98A6B5
```

#### Light

```text
Background       #F4F6F8
Surface          #FFFFFF
Raised surface   #EDF1F5
Border           #D5DDE6
Text             #111820
Muted text       #607080
```

### Accent roles

```text
#4B74FF   primary action / selection
#55C8C1   geometry measurement / dimensional information
#2EB67D   successful verification
#D99A34   caution / needs review
#E25B5B   destructive / blocked / failed
```

Primary blue and measurement cyan have different meanings and must not be used interchangeably.

### Accent budget

Per region:

- one primary expressive accent;
- semantic colors only when semantic state exists;
- no rainbow icon coloring;
- no decorative gradients on ordinary UI;
- no colored border around every card.

---

## Typography

### Sans

Use Geist as the primary UI typeface where the current runtime already provides it.

Fallback:

```css
Geist, Inter, ui-sans-serif, system-ui, sans-serif
```

### Mono

Mono is reserved for technical content:

- OpenSCAD;
- dimensions;
- coordinates;
- timestamps when compact;
- IDs;
- model/tool telemetry;
- keyboard shortcuts.

Do not use monospace simply to make UI appear “technical.”

### Scale

Recommended desktop scale:

```text
Design title      16px / 600
Panel title       14px / 600
Body              14px / 400
Control           13px / 500
Secondary         12px / 400
Technical meta    11–12px mono
```

Persistent UI text smaller than 11px is prohibited.

### Casing

Use sentence case:

```text
Validation checks
New design
Rebuild model
```

Avoid pervasive:

```text
VALIDATION CHECKS
NEW DESIGN
REBUILD MODEL
```

Uppercase may be used for extremely short technical notation where conventional.

---

## Layout

### Density

AgentSCAD is a technical productivity tool, so controls may be denser than a marketing product.

Density must come from efficient spacing, not tiny text.

Typical desktop control heights:

```text
Compact toolbar     30–32px
Standard control    34–36px
Primary composer    40px+
```

Touch layouts increase hit targets.

### Panels

Every panel owns its own scrolling.

Do not solve viewport layout using accidental parent `overflow: hidden` chains that prevent legitimate panel scrolling.

Resizable panel geometry may be persisted locally.

### Layout presets

Support:

```text
Standard
Viewport focus
Code
```

Example:

**Standard**

```text
Browser | Viewport | Inspector
```

**Viewport focus**

```text
Viewport | Inspector
```

**Code**

```text
Viewport | OpenSCAD
```

User-controlled resizing remains available.

---

## Elevation & Depth

The product is nearly flat.

Hierarchy is created by:

1. surface tone;
2. border;
3. spacing;
4. typography;
5. only then shadow.

### Shadows

Use shadows for floating elements only:

- dialogs;
- command palette;
- menus;
- floating viewport toolbar;
- temporary sheets.

Static panels should not look like floating cards.

Avoid:

- huge soft shadows;
- glow;
- inset-glass everywhere;
- stacked card-on-card elevation.

### Glass

Translucency is allowed only over the 3D viewport where spatial context remains useful.

It is not the universal component style.

---

## Shapes

Use a compact industrial radius language.

```text
5px   compact buttons, tags, small controls
8px   normal inputs, menus, toolbars
12px  dialogs, sheets, major floating surfaces
999px status dots/pills only when semantics justify them
```

Avoid turning every container into a large rounded rectangle.

Panels normally meet edge-to-edge.

---

## Components

### Foundational states

Every interactive component must define:

```text
default
hover
focus-visible
pressed
selected
disabled
busy
error where applicable
```

Focus must remain clearly visible in both themes.

### Buttons

Two axes define buttons.

**Emphasis**

```text
solid
outline
ghost
```

**Intent**

```text
primary
neutral
success
warning
danger
```

Only one high-emphasis primary action should normally exist within a task region.

Examples:

```text
Generate           primary / solid
Export STL         primary / solid when ready
OpenSCAD           neutral / ghost
Cancel run         warning / outline
Delete design      danger / ghost
Delete permanently danger / solid only in confirmation
```

Busy state must not change button dimensions.

### Icon buttons

Icon-only actions require:

- accessible name;
- tooltip;
- visible hover;
- visible focus;
- consistent 30–32px desktop geometry.

Text labels are preferred for unfamiliar engineering actions.

### Status

Status badge style is compact and semantic.

Use:

```text
● Generating
✓ Ready
! Needs review
× Blocked
```

Do not communicate status through color alone.

### Cards

Cards are not the default layout primitive.

Use open panels, rows, inspector sections and canvas regions first.

Cards are appropriate for:

- templates;
- optional examples;
- comparison objects;
- disconnected entities.

Never nest card inside card inside card.

### Inputs

Fields use semantic shared primitives.

Every field includes:

- real label;
- useful unit or hint;
- focus-visible state;
- inline validation;
- preserved user value after failure.

Validation should say how to fix the field.

### Select

Do not custom-style native `<select>` when popup appearance is meant to be part of the product system.

Use the maintained accessible Select primitive for product-controlled menus.

### Dialogs

Dialogs contain one decision.

Use dialogs for:

- destructive confirmation;
- compact critical workflows;
- command palette.

Do not use a giant dialog as a substitute for application navigation.

Complex workflows use Sheet or an in-workspace surface.

### Toasts

Toasts acknowledge completed actions.

Examples:

```text
STL downloaded
Provider connected
Revision restored
```

Critical validation information must not exist only in a toast.

### Empty states

Empty states answer:

```text
What is this?
Why is it empty?
What can I do?
```

Use a single primary action.

No decorative floating animation is required.

---

## Iconography

Use Lucide consistently unless a CAD-specific custom icon is needed.

Rules:

- common stroke weight;
- no random icon colors;
- 14–16px for compact chrome;
- 16–18px for labeled actions;
- 20px+ only for illustrative states.

If a CAD operation cannot be communicated accurately with a generic Lucide icon, create one deliberate CAD-specific SVG rather than choosing an unrelated metaphor.

---

## Motion

Motion communicates state.

Recommended durations:

```text
hover/focus        100–140ms
control transition 140–180ms
popover/dialog     160–220ms
panel transition   180–260ms
```

Preferred easing:

```css
cubic-bezier(.2, .8, .2, 1)
```

Avoid:

- constant floating;
- decorative pulsing;
- badge shaking;
- animation merely because data changed.

Pulsing may be used only for a genuinely live operation and should remain subtle.

Honor `prefers-reduced-motion`.

Reduced motion removes:

- movement-based entrances;
- repeated status pulses;
- unnecessary transforms.

State changes must remain understandable without animation.

---

## Loading & Async Behavior

### Preserve geometry

Never blank the full workspace while switching data.

Where possible:

```text
existing content
+ local progress overlay
```

is preferred to:

```text
empty panel
+ giant skeleton
```

### Loading indicators

Use a compact product-owned spinner/progress treatment for unknown durations.

Use skeletons only when the final geometry is predictable.

### Pipeline / SSE events

Streaming run events form a chronological Activity feed.

Each event contains:

```text
time
operation
state
human-readable message
optional technical detail
```

Technical detail is collapsed by default.

### Cancellation

Long model operations expose `Stop`.

After cancellation:

```text
Run stopped
No geometry changes were committed.
```

or the technically accurate equivalent.

Never imply rollback if the backend cannot guarantee it.

---

## Validation & Trust

AgentSCAD has an important distinction between:

- model-provider reasoning;
- actual OpenSCAD output;
- deterministic geometry evidence;
- optional visual review.

The UI must preserve that distinction.

### Evidence hierarchy

Prefer:

```text
Measured result
→ check rule
→ outcome
→ source/tool
```

Example:

```text
Wall thickness
2.51 mm
Target ≥ 2.40 mm
Passed
```

Avoid presenting model-generated commentary with the same visual treatment as deterministic validation.

### Readiness

Use labels such as:

```text
Ready to export
Needs review
Blocked
Not yet verified
```

A percentage may support these labels but never replaces the evidence.

---

## Content Voice

Voice is concise, technical and calm.

Use active verbs.

Good:

```text
Rebuild STL
Review 2 blockers
Connect provider
Apply changes
Restore revision
```

Avoid:

```text
Let's get started!
Something went wrong :(
AI magic
Enhance
Process
Proceed
```

Use “AI” only where knowing that AI is involved helps the user understand trust, cost, latency or behavior.

Prefer `Refine brief` over `AI Enhance`.

---

## Responsive Behavior

### ≥ 1280px

Full three-panel workspace.

```text
Browser | Viewport | Inspector
```

### 960–1279px

Browser may collapse to rail.

Inspector remains 300–340px.

```text
Viewport | Inspector
```

Design browser opens as an overlay/sidebar when required.

### < 960px

Do not attempt to shrink three desktop panels beside each other.

Use:

```text
Viewport
+
bottom navigation / contextual sheets
```

Primary sections:

```text
Model
Design
Checks
Code
```

### < 640px

New Design becomes full-screen.

Inspector becomes a bottom sheet or full-screen secondary surface.

Toolbars collapse lower-priority actions into `More`.

The viewport remains usable for orbit, zoom and fit.

---

## Accessibility

Target WCAG 2.2 AA.

Mandatory:

- semantic buttons and links;
- keyboard access to every operation;
- visible focus;
- accessible labels on icon controls;
- text alternatives for state;
- sufficient contrast;
- error text associated with fields;
- reduced-motion behavior;
- no hover-only feature discovery;
- no drag-only operations;
- logical focus restoration after overlays;
- stable layout at 200% zoom where practical.

3D navigation actions such as `Fit`, standard views and reset must be available without requiring precise pointer gestures.

---

## Component Architecture

The redesign should strengthen shared primitives rather than adding more screen-local Tailwind styling.

### Token ownership

`DESIGN.md` defines product intent and normative semantic values.

Runtime mapping should converge on:

```text
DESIGN.md
   ↓
src/app/globals.css
   ↓
semantic Tailwind variables
   ↓
src/components/ui/*
   ↓
CAD business components
```

Do not maintain separate competing color systems indefinitely.

The existing `--app-*` and `--cad-*` layers should gradually converge into semantic roles such as:

```text
--background
--surface
--surface-raised
--foreground
--muted-foreground
--border
--primary
--measure
--success
--warning
--danger
--focus-ring
```

Temporary compatibility aliases are acceptable during migration.

### shadcn strategy

Use shadcn/Radix as primitives, not as the design identity.

Prefer shared variants over repetitive screen-level overrides.

Examples:

```text
Button
Badge
Alert
Empty
Dialog
Sheet
Tabs
Tooltip
Select
Command
ScrollArea
Resizable
```

Product-specific behavior belongs in business components composed from those primitives.

---

## Existing Component Migration

### `MainWorkspace.tsx`

Reduce it to composition and shared workflow state.

Extract:

```text
AppBar
DesignBrowser
ViewportWorkspace
Inspector
AgentDrawer
StatusBar
RunActivity
```

The shell should not own dozens of dialog-specific presentation details.

### `JobListPanel.tsx`

Evolve toward:

```text
DesignBrowser
```

Preserve backend job IDs if required, but change the user-facing object model.

### `ViewerPanel.tsx`

Evolve toward:

```text
ViewportWorkspace
```

Move non-essential metadata out of the permanent viewport header.

Replace the current combination of metadata header + quick actions + readiness strip with:

```text
minimal title/state
viewport
contextual toolbar
compact validation summary
```

### `InspectorPanel.tsx`

Reduce navigation complexity.

Target:

```text
Design
Parameters
Checks
OpenSCAD
History
```

Move Agent interaction out of the permanent tab strip.

### `JobComposer.tsx`

Evolve toward:

```text
DesignComposer
```

Primary interaction:

```text
brief → optional constraints → generate
```

Provider/model, tags, templates and memory use progressive disclosure.

### `PipelineVisualization`

Evolve toward:

```text
RunProgress
```

Compact by default; detailed evidence on demand.

### `QuickActionsBar`

Replace with contextual actions attached to the viewport or relevant inspector section.

Actions that are unavailable should normally disappear or explain why they are unavailable, rather than creating a toolbar full of disabled controls.

### `Footer`

Replace dashboard metrics with a quiet engineering status bar.

Possible content:

```text
mm
OpenSCAD WASM
Model: …
Saved
Revision 4
```

Statistics and benchmarking belong in a dedicated tool surface.

---

## Status Bar

The bottom status bar communicates environment rather than KPIs.

Possible desktop layout:

```text
mm  ·  OpenSCAD WASM  ·  Provider healthy     Saved · Revision 4
```

Only show items relevant to the active workspace.

Avoid permanent:

```text
run count
success percentage
version
export CTA
```

unless there is a clear operational reason.

---

## Keyboard Model

Keyboard operation is a first-class feature.

Suggested vocabulary:

```text
⌘K       Command palette
⌘N       New design
⌘B       Toggle design browser
⌘I       Toggle inspector
⌘/       Ask Agent
⌘Enter   Generate / apply contextual primary action
F        Fit model
1        Front
2        Right
3        Top
Esc      Close current overlay / cancel temporary mode
```

Shortcuts must not trigger while a user is composing text with an IME.

Avoid single-key shortcuts when focus is inside an editable surface.

---

## Design Budgets

These rules prevent future visual drift.

### Per screen

- maximum one dominant primary CTA per task region;
- maximum one expressive accent plus semantic state colors;
- maximum five permanent inspector modes;
- maximum one level of nested bordered container;
- maximum one floating viewport toolbar per edge;
- no decorative gradients on standard product surfaces;
- no permanent UI text below 11px;
- no body-copy monospace;
- no shadow on ordinary static panels;
- no uncontrolled icon rainbow.

### Per component

Every recurring component must use a shared primitive or a documented business variant.

Do not create:

```text
BlueButton
SmallBlueButton
ViewportBlueButton
InspectorBlueButton
```

Create:

```text
Button
  emphasis
  intent
  size
```

---

## Migration Plan

### Phase 0 — Contract

Create and adopt:

```text
DESIGN.md
UX-CONTRACT.md
```

Define semantic token ownership and capture baseline screenshots.

Do not begin by changing every screen independently.

### Phase 1 — Workspace hierarchy

Redesign:

```text
App bar
Design browser
Viewport
Inspector
Status bar
```

This phase delivers the largest perceived quality improvement.

### Phase 2 — Creation & onboarding

Redesign:

```text
New Design
provider onboarding
first-run empty state
```

Remove settings detours from the primary flow.

### Phase 3 — Engineering workflow

Redesign:

```text
Parameters
OpenSCAD
validation
repair
export
history
```

Normalize all loading, failure, stale-artifact and success states.

### Phase 4 — Agent experience

Build the contextual Agent drawer.

Normalize:

```text
streaming
tool activity
stop
retry
apply changes
change summaries
```

### Phase 5 — Component convergence

Reduce screen-local styling.

Consolidate:

```text
tokens
buttons
inputs
status
alerts
empty states
dialogs
toolbars
scrollbars
focus behavior
```

### Phase 6 — Responsive & accessibility

Verify:

```text
1440px
1280px
1024px
768px
390px
200% zoom
keyboard-only
reduced motion
light mode
dark mode
```

---

## Acceptance Criteria

The redesign is not complete merely because all screens use the new colors.

It is complete when:

1. The 3D model is the strongest visual object in a normal design workspace.
2. A first-time user can understand how to connect a provider and create a design without hunting through Settings.
3. Persistent navigation uses user concepts rather than backend execution terminology.
4. Every run state presents one obvious next engineering action.
5. Parameter edits clearly distinguish preview state from rebuilt artifact state.
6. Deterministic validation and AI-generated interpretation are visually distinguishable.
7. Errors explain both the failure and the recovery action.
8. Agent streaming can be stopped and recovered without losing the user's request.
9. Light and dark themes preserve the same semantic hierarchy.
10. All primary workflows work with keyboard navigation.
11. Narrow screens no longer attempt to compress all three desktop panes side-by-side.
12. Loading never causes major controls or panels to jump.
13. Shared components own visual state instead of screen-local color overrides.
14. Ordinary static panels do not rely on excessive cards or shadows for hierarchy.
15. Product screenshots are recognizable as AgentSCAD even with the logo hidden.

---

## Do's and Don'ts

### Do

- Make geometry the focal point.
- Treat measurement cyan as a functional CAD language.
- Surface one contextual next action.
- Preserve engineering evidence.
- Use progressive disclosure for implementation detail.
- Prefer open panels and rows over card collections.
- Use technical density without microscopic typography.
- Make stale previews/artifacts impossible to misunderstand.
- Keep Agent behavior contextual to the active design.

### Don't

- Turn AgentSCAD into a chat app.
- Turn the workspace into a KPI dashboard.
- Expose every backend state at equal hierarchy.
- Use purple/blue accents on every interactive element.
- Add glows simply to imply AI.
- use monospace for ordinary navigation.
- Keep six to eight tiny permanent tabs when information can be grouped.
- Show a readiness percentage without the evidence behind it.
- hide important actions only behind hover.
- solve information architecture problems by adding another card.

---

## Implementation Review Checklist

Before merging any redesigned screen:

- [ ] The screen follows the model-first hierarchy.
- [ ] There is no more than one dominant primary action per task region.
- [ ] All visible status colors have a textual/icon equivalent.
- [ ] Typography follows sans vs mono role rules.
- [ ] No persistent UI text is below 11px.
- [ ] Static panels do not use unnecessary shadow.
- [ ] New colors come from semantic runtime tokens.
- [ ] Both dark and light themes were checked.
- [ ] Hover, focus-visible, pressed, disabled and busy states exist.
- [ ] Keyboard interaction was tested.
- [ ] Reduced motion was checked.
- [ ] Empty, loading, error and success states were checked.
- [ ] Geometry-changing edits communicate stale artifact state.
- [ ] AI output is not visually confused with deterministic evidence.
- [ ] Narrow viewport behavior was tested.
- [ ] Long prompts, long filenames and long provider/model names do not break layout.
- [ ] Dialog/sheet focus restores to the invoking control.
- [ ] Icon-only controls have accessible names.
- [ ] A user can identify the next action without reading pipeline internals.
/huashu-design 
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-09-17T10:23:12+02:00.

The user has mentioned some items in the form @[ITEM]. Here is extra information about the items that were mentioned by the user, in the order that they appear:

/huashu-design is a [Slash Command]:
<SKILL>The user requested you read and use the "huashu-design" skill. The path to the skill file is:
/Users/kevinsyuan/.agents/skills/huashu-design/SKILL.md</SKILL>
</ADDITIONAL_METADATA>