import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/*
 * Regressions found by reviewing the C2 shell against the running app with real
 * job data (2026-09-18). Each one is a defect that shipped and that a behavioural
 * test would not have caught: two of them are "the code is right but a leftover
 * rule from the old docked layout still wins", and one is "two components both
 * believe they own the same key".
 */

const root = resolve(__dirname, '../../../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf-8')

describe('shell regressions', () => {
  const globals = read('src/app/globals.css')

  test('nothing hides the slots rail or the inspector below 1024px', () => {
    // The docked three-column layout is gone (DESIGN.md section 3). While the old
    // media queries lived on, `.cad-left-panel` still matched the rail inside its
    // floating module at <=1023px: the plate stayed, kept its count badge, and
    // rendered an empty body, so no part could be selected at all.
    expect(globals).not.toMatch(/\.cad-left-panel\s*\{[^}]*display:\s*none/)
    expect(globals).not.toMatch(/\.cad-inspector-panel\s*\{[^}]*display:\s*none/)
  })

  test('the module plate has a single definition', () => {
    // The plate is owned by Module.tsx through shell tokens. A second, hardcoded
    // copy in CSS is what DESIGN.md section 22 forbids ("one writer per element")
    // and it is what made light mode disagree with dark.
    expect(globals).not.toContain('background: rgba(34, 31, 28, 0.90)')

    const plate = read('src/components/cad/workspace/Module.tsx')
    expect(plate).toContain('background: \'var(--shell-module)\'')
    expect(plate).toContain('border: \'1px solid var(--shell-border)\'')
  })

  test('the focus colour is the shell signal, not the old amber', () => {
    // `--ring` is what shadcn focus-visible rings resolve to; the input rule uses it
    // too, so both stay on the shell accent in either theme.
    expect(globals).not.toContain('--ring: #F59E0B')
    expect(globals).toContain('box-shadow: 0 0 0 2px var(--ring)')
  })

  test('Space and the digits have exactly one owner', () => {
    const shortcuts = read('src/components/cad/workspace/KeyboardShortcuts.tsx')
    const shell = read('src/components/cad/workspace/MainWorkspace.tsx')

    // The shell owns Space and the camera keys (DESIGN.md section 4, section 21).
    expect(shell).toContain("e.code === 'Space'")
    expect(shell).toContain('const VIEW_KEYS')

    // Nothing else may write them, and the retired inspector-tab bindings are gone.
    expect(shortcuts).not.toContain("e.key === ' '")
    expect(shortcuts).not.toContain('tabMap')
    expect(shortcuts).not.toMatch(/onSetActiveTab/)
  })

  test('a part row is reachable and activatable from the keyboard', () => {
    const row = read('src/components/cad/sortable-job-card.tsx')
    const list = read('src/components/cad/workspace/JobListPanel.tsx')

    // The row is the only way to open a part, so it is a real option: focusable,
    // announced, and activated with Enter or Space.
    expect(row).toContain('role="option"')
    expect(row).toContain('tabIndex={0}')
    expect(row).toContain("e.key !== 'Enter' && e.key !== ' '")
    expect(list).toContain('role="listbox"')

    // Utilities that live on hover must also appear when focus is inside the row,
    // otherwise tabbing lands on an invisible control (DESIGN.md section 21).
    expect(row).toContain('group-focus-within/row:opacity-100')
  })

  test('读数 never dresses a declared parameter as a measurement', () => {
    const readout = read('src/components/cad/workspace/ReadoutModule.tsx')

    // Measured wins; a declared value is dimmed and prefixed 目标; no evidence at all
    // still prints a dash (DESIGN.md section 18, evidence hierarchy).
    expect(readout).toContain("boxIsMeasured ? '' : '目标 '")
    expect(readout).toContain("wallIsMeasured ? '壁厚' : '目标 壁厚'")
    expect(readout).toContain('isDim: !box || !boxIsMeasured')
  })

  test('the cube drives the part through one command path', () => {
    const shell = read('src/components/cad/workspace/MainWorkspace.tsx')

    // A click asks for a standard view, a drag asks for a free angle, and both must
    // reach the viewer. The viewer applies a command only when the nonce changes, so
    // the drag path needs the bump too - without it the cube turned, the label moved,
    // and the part did not move at all (0 of 360,000 viewport pixels changed).
    expect(shell).toContain('const applyViewCommand =')
    expect(shell).toMatch(/applyViewCommand[\s\S]{0,220}setViewNonce\(v => v \+ 1\)/)
    expect(shell).toContain('onChange={applyViewCommand}')
    expect(shell).toContain('onCommand={applyViewCommand}')
  })

  test('dragging the cube is not eased and not per-event', () => {
    const cube = read('src/components/cad/workspace/ViewCube.tsx')
    const shell = read('src/components/cad/workspace/MainWorkspace.tsx')

    // The 0.34s eased transition is for a commanded view (watching the cube travel to
    // a standard angle is how the mapping is learned). On while dragging it makes the
    // cube trail the pointer, which is the lag the C5 iteration removed from the
    // prototype - so it is tied to the drag state.
    expect(cube).toContain("transition: isDragging ? 'none' : 'transform .34s")

    // One update per frame, not one per pointer event: a trackpad reports at 120Hz and
    // each update re-renders the workspace.
    expect(cube).toContain('requestAnimationFrame(apply)')
    expect(cube).toContain('cancelAnimationFrame')

    // The viewer echoes the camera we just commanded; storing that echo as a fresh
    // object re-rendered the workspace a second time per move.
    expect(shell).toContain('const handleViewChange =')
    expect(shell).toContain('prev.azimuth - next.azimuth + 540')
  })

  test('the active composer is a border, not a border plus a ring plus three chips', () => {
    const shell = read('src/components/cad/workspace/MainWorkspace.tsx')

    expect(shell).toContain('focus-within:border-[var(--shell-signal)]')
    expect(shell).not.toContain('focus-within:ring-2')
    // The shortcuts stay, as engraved text: only ⌘K is a control in that row.
    expect(shell).toContain('⌘⏎ 生成')
    expect(shell).toContain('空格 隐藏面板')
  })

  test('a first build leaves a part on the bench', () => {
    const emptyStates = read('src/components/cad/workspace/empty-states.tsx')
    const part = read('src/components/cad/workspace/GeneratingPart.tsx')

    // DESIGN.md section 17: the loader claims nothing, it only says the machine is
    // working - the four lamps remain the progress display.
    expect(emptyStates).toContain('GeneratingPart')
    expect(emptyStates).toContain('正在生成几何…')
    expect(part).toContain('--shell-part-face')
    expect(part).toContain("role=\"presentation\"")

    // A loader that only moves is invisible under reduced motion, so the animation
    // has to have a still equivalent (DESIGN.md section 21) - and that override has to
    // come *after* the animation rule, or the cascade wins and the part keeps turning.
    const animationAt = globals.indexOf('animation: partTumble')
    const overrideAt = globals.indexOf('.part-tumble {', animationAt + 1)
    expect(animationAt).toBeGreaterThan(-1)
    expect(overrideAt).toBeGreaterThan(animationAt)
    expect(globals.slice(overrideAt, overrideAt + 200)).toContain('animation: none')
  })
})
