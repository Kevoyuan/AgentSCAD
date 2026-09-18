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
})
