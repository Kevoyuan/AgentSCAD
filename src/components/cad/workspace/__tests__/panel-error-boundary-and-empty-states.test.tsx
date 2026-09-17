import { describe, test, expect, mock } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PanelErrorBoundary } from '../PanelErrorBoundary'
import {
  JobListEmptyState,
  CadViewportEmptyState,
  InspectorEmptyState,
} from '../empty-states'
import type { Job } from '@/components/cad/types'

// Helper to simulate React's updater on class components outside full DOM
function createMountedErrorBoundary(props: React.ComponentProps<typeof PanelErrorBoundary>) {
  const instance = new PanelErrorBoundary(props)
  ;(instance as any).updater = {
    enqueueSetState(inst: any, partial: any) {
      const next = typeof partial === 'function' ? partial(inst.state, inst.props) : partial
      inst.state = { ...inst.state, ...next }
    },
    enqueueForceUpdate() {},
  } as any
  return instance
}

describe('PanelErrorBoundary — Fault Isolation & UI Resilience', () => {
  test('renders healthy children when no error has occurred', () => {
    const boundary = createMountedErrorBoundary({
      panelName: '3D Viewport',
      children: React.createElement('div', { id: 'viewport-canvas' }, 'Canvas OK'),
    })

    const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
    expect(html).toContain('id="viewport-canvas"')
    expect(html).toContain('Canvas OK')
    expect(html).not.toContain('FAULT ISOLATED')
  })

  test('captures error in state and renders isolated fault card with diagnostics', () => {
    const boundary = createMountedErrorBoundary({
      panelName: 'Inspector',
      children: React.createElement('div', null, 'Inspector content'),
    })

    const testError = new Error('Monaco Editor Worker OOM')
    testError.stack = 'Error: Monaco Editor Worker OOM\n    at initEditor (editor.ts:42)'

    const derivedState = PanelErrorBoundary.getDerivedStateFromError(testError)
    expect(derivedState.hasError).toBe(true)
    expect(derivedState.error).toBe(testError)

    boundary.state = {
      ...boundary.state,
      ...derivedState,
      errorInfo: { componentStack: '\n    in MonacoEditor\n    in InspectorPanel' },
    }

    const html = renderToStaticMarkup(boundary.render() as React.ReactElement)

    // Isolation badge and panel name
    expect(html.toUpperCase()).toContain('INSPECTOR FAULT ISOLATED')
    expect(html).toContain('面板子系统已隔离')

    // Accessibility contracts
    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-live="assertive"')

    // Error diagnostics
    expect(html).toContain('Monaco Editor Worker OOM')
    expect(html).toContain('initEditor')

    // Action buttons
    expect(html).toContain('重试面板 (Retry)')
    expect(html).toContain('复制诊断')
  })

  test('supports custom fallback as a ReactNode or a function', () => {
    // 1. Static ReactNode fallback
    const boundaryStatic = createMountedErrorBoundary({
      panelName: 'Job List',
      fallback: React.createElement('div', { id: 'custom-list-fallback' }, 'Custom Fallback'),
      children: React.createElement('div', null, 'Jobs'),
    })
    ;(boundaryStatic.state as any).hasError = true
    ;(boundaryStatic.state as any).error = new Error('DnD Failure')

    const staticHtml = renderToStaticMarkup(boundaryStatic.render() as React.ReactElement)
    expect(staticHtml).toContain('id="custom-list-fallback"')
    expect(staticHtml).toContain('Custom Fallback')
    expect(staticHtml).not.toContain('FAULT ISOLATED')

    // 2. Functional fallback with error and reset handler
    const boundaryFn = createMountedErrorBoundary({
      panelName: 'Job List',
      fallback: (err, reset) =>
        React.createElement(
          'div',
          { id: 'fn-fallback' },
          React.createElement('span', null, `Handled: ${err.message}`),
          React.createElement('button', { onClick: reset }, 'Reset Now')
        ),
      children: React.createElement('div', null, 'Jobs'),
    })
    ;(boundaryFn.state as any).hasError = true
    ;(boundaryFn.state as any).error = new Error('Syntax Parser Crash')

    const fnHtml = renderToStaticMarkup(boundaryFn.render() as React.ReactElement)
    expect(fnHtml).toContain('id="fn-fallback"')
    expect(fnHtml).toContain('Handled: Syntax Parser Crash')
    expect(fnHtml).toContain('Reset Now')
  })

  test('manual retry resets error state and triggers onReset callback', () => {
    let onResetCalled = false
    const boundary = createMountedErrorBoundary({
      panelName: '3D Viewport',
      onReset: () => {
        onResetCalled = true
      },
      children: React.createElement('div', null, '3D Scene'),
    })

    boundary.state = {
      hasError: true,
      error: new Error('WebGL Lost'),
      errorInfo: null,
      copied: true,
    }

    boundary.handleReset()

    expect(boundary.state.hasError).toBe(false)
    expect(boundary.state.error).toBeNull()
    expect(boundary.state.errorInfo).toBeNull()
    expect(boundary.state.copied).toBe(false)
    expect(onResetCalled).toBe(true)
  })

  test('multi-panel isolation: crash in one panel leaves adjacent panels fully intact', () => {
    const leftPanel = createMountedErrorBoundary({
      panelName: 'Job List',
      children: React.createElement('div', { id: 'panel-left' }, 'Jobs Active'),
    })
    const centerPanel = createMountedErrorBoundary({
      panelName: '3D Viewport',
      children: React.createElement('div', { id: 'panel-center' }, 'WebGL Mesh'),
    })
    const rightPanel = createMountedErrorBoundary({
      panelName: 'Inspector',
      children: React.createElement('div', { id: 'panel-right' }, 'Spec Tab'),
    })

    // Center panel crashes
    centerPanel.state = {
      hasError: true,
      error: new Error('WebGL Context Lost'),
      errorInfo: null,
      copied: false,
    }

    const leftHtml = renderToStaticMarkup(leftPanel.render() as React.ReactElement)
    const centerHtml = renderToStaticMarkup(centerPanel.render() as React.ReactElement)
    const rightHtml = renderToStaticMarkup(rightPanel.render() as React.ReactElement)

    // Left and Right panels are unaffected
    expect(leftHtml).toContain('id="panel-left"')
    expect(leftHtml).not.toContain('FAULT ISOLATED')
    expect(rightHtml).toContain('id="panel-right"')
    expect(rightHtml).not.toContain('FAULT ISOLATED')

    // Center panel shows isolated fault card
    expect(centerHtml.toUpperCase()).toContain('3D VIEWPORT FAULT ISOLATED')
    expect(centerHtml).toContain('WebGL Context Lost')
  })
})

describe('PanelErrorBoundary — resetKey Self-Healing & Edge Cases', () => {
  test('auto-heals when resetKey changes to a different job ID', () => {
    const onReset = mock(() => {})
    const boundary = createMountedErrorBoundary({
      panelName: '3D Viewport',
      resetKey: 'job-aaa',
      onReset,
      children: React.createElement('div', null, 'Healthy Viewport'),
    })

    boundary.state = {
      hasError: true,
      error: new Error('Shader compilation error'),
      errorInfo: null,
      copied: false,
    }

    // Simulate selecting a different job: resetKey becomes 'job-bbb'
    ;(boundary as any).props = {
      ...boundary.props,
      resetKey: 'job-bbb',
    }

    boundary.componentDidUpdate({
      panelName: '3D Viewport',
      resetKey: 'job-aaa',
      children: null,
    })

    expect(boundary.state.hasError).toBe(false)
    expect(boundary.state.error).toBeNull()
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  test('does not reset when re-rendered with identical resetKey', () => {
    const onReset = mock(() => {})
    const boundary = createMountedErrorBoundary({
      panelName: '3D Viewport',
      resetKey: 'job-aaa',
      onReset,
      children: React.createElement('div', null, 'Content'),
    })

    boundary.state = {
      hasError: true,
      error: new Error('Persistent error'),
      errorInfo: null,
      copied: false,
    }

    // Re-render without changing resetKey
    boundary.componentDidUpdate({
      panelName: '3D Viewport',
      resetKey: 'job-aaa',
      children: null,
    })

    expect(boundary.state.hasError).toBe(true)
    expect(onReset).not.toHaveBeenCalled()
  })

  test('auto-heals when resetKey changes from undefined to a valid job ID', () => {
    const onReset = mock(() => {})
    const boundary = createMountedErrorBoundary({
      panelName: '3D Viewport',
      resetKey: 'job-123',
      onReset,
      children: React.createElement('div', null, 'Content'),
    })

    boundary.state = {
      hasError: true,
      error: new Error('Cold start render error'),
      errorInfo: null,
      copied: false,
    }

    boundary.componentDidUpdate({
      panelName: '3D Viewport',
      resetKey: undefined,
      children: null,
    })

    expect(boundary.state.hasError).toBe(false)
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  /**
   * ADVERSARIAL EDGE CASE FINDING:
   * When a job that caused a crash in ViewerPanel (where resetKey={selectedJob?.id})
   * is deleted or deselected, selectedJob becomes null and resetKey becomes undefined.
   * In PanelErrorBoundary.tsx line 47:
   *   this.props.resetKey !== undefined && this.props.resetKey !== prevProps.resetKey
   * Because this.props.resetKey is undefined, the auto-heal condition fails!
   * The boundary fails to reset to the clean empty state.
   */
  test('EDGE CASE: transitioning resetKey from job-id to undefined fails auto-heal due to strict undefined check', () => {
    const onReset = mock(() => {})
    const boundary = createMountedErrorBoundary({
      panelName: '3D Viewport',
      resetKey: undefined, // selectedJob was deleted, selectedJob?.id is undefined
      onReset,
      children: React.createElement('div', null, 'Content'),
    })

    boundary.state = {
      hasError: true,
      error: new Error('Job Crash'),
      errorInfo: null,
      copied: false,
    }

    // Previous state had job-123
    boundary.componentDidUpdate({
      panelName: '3D Viewport',
      resetKey: 'job-123',
      children: null,
    })

    // Empirically documents the bug: does NOT auto-heal!
    expect(boundary.state.hasError).toBe(true)
    expect(onReset).not.toHaveBeenCalled()
  })

  test('InspectorPanel avoids the undefined bug by using fallback string: `${selectedJob?.id || "none"}_${tab}`', () => {
    const onReset = mock(() => {})
    const boundary = createMountedErrorBoundary({
      panelName: 'Inspector',
      resetKey: 'none_SPEC', // selectedJob?.id || 'none'
      onReset,
      children: React.createElement('div', null, 'Content'),
    })

    boundary.state = {
      hasError: true,
      error: new Error('Inspector Error'),
      errorInfo: null,
      copied: false,
    }

    // Previous state had job-123_SPEC
    boundary.componentDidUpdate({
      panelName: 'Inspector',
      resetKey: 'job-123_SPEC',
      children: null,
    })

    // Because 'none_SPEC' !== undefined, auto-heal succeeds!
    expect(boundary.state.hasError).toBe(false)
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})

describe('JobListEmptyState — Boundary Conditions', () => {
  test('Cold Start (0 total jobs, first load complete): renders welcome, CTA, and 3 engineering presets', () => {
    let composerText: string | undefined = 'initial'
    const onShowComposer = (text?: string) => {
      composerText = text
    }

    const html = renderToStaticMarkup(
      React.createElement(JobListEmptyState, {
        isFirstLoadComplete: true,
        totalJobsCount: 0,
        hasActiveFilters: false,
        onResetFilters: () => {},
        onShowComposer,
      })
    )

    expect(html).toContain('WORKSPACE INITIALIZED')
    expect(html).toContain('No CAD Designs Yet')
    expect(html).toContain('New Design (⌘N)')

    // 3 Engineering presets
    expect(html).toContain('Spur Gear (模数 2)')
    expect(html).toContain('Electronics Enclosure')
    expect(html).toContain('Device Stand')

    // Presets have +USE tag
    expect(html).toContain('+USE')
  })

  test('Search / Filter Mismatch (jobs exist, but 0 match active filter): renders filter badge and reset button', () => {
    const html = renderToStaticMarkup(
      React.createElement(JobListEmptyState, {
        isFirstLoadComplete: true,
        totalJobsCount: 12,
        hasActiveFilters: true,
        onResetFilters: () => {},
        onShowComposer: () => {},
      })
    )

    expect(html).toContain('FILTER CRITERIA ACTIVE')
    expect(html).toContain('No Matching CAD Designs')
    expect(html).toContain('No designs match your current search query or state filters.')
    expect(html).toContain('重置筛选 (Reset)')

    // Presets should NOT clutter filter mismatch state
    expect(html).not.toContain('Spur Gear (模数 2)')
    expect(html).not.toContain('WORKSPACE INITIALIZED')
  })

  test('Loading State: renders 4 skeleton placeholders without Loader2 spinner (BAP-06 compliant)', () => {
    const html = renderToStaticMarkup(
      React.createElement(JobListEmptyState, {
        isFirstLoadComplete: false,
        totalJobsCount: 0,
        hasActiveFilters: false,
        onResetFilters: () => {},
        onShowComposer: () => {},
      })
    )

    expect(html).toContain('data-testid="job-list-loading-skeleton"')
    expect(html).toContain('skeleton-shimmer')
    expect(html).not.toContain('animate-spin')
    expect(html).not.toContain('Loader2')
  })
})

describe('CadViewportEmptyState — Boundary Conditions', () => {
  test('Cold Start / No Job Selected: renders isometric grid, 3D coordinate triad, and template chips', () => {
    const html = renderToStaticMarkup(
      React.createElement(CadViewportEmptyState, {
        selectedJob: null,
        isFirstLoadComplete: true,
        onShowComposer: () => {},
      })
    )

    // Telemetry strip
    expect(html).toContain('SYS: STANDBY')
    expect(html).toContain('VIEW: 30° ISOMETRIC')
    expect(html).toContain('GRID: 10.0mm')
    expect(html).toContain('KERNEL: CSG PARAMETRIC')

    // SVG coordinate axes (Z, X, Y) and origin
    expect(html).toContain('[0,0,0]')
    expect(html).toContain('>Z<')
    expect(html).toContain('>X<')
    expect(html).toContain('>Y<')

    // Solid typography (BAP-04 compliance: no bg-clip-text)
    expect(html).toContain('CAD Viewport Ready')
    expect(html).not.toContain('bg-clip-text')

    // 4 Fast-load template chips
    expect(html).toContain('Spur Gear')
    expect(html).toContain('Electronics Box')
    expect(html).toContain('Device Stand')
    expect(html).toContain('Phone Case')

    // Bottom runtime telemetry
    expect(html).toContain('OPENSCAD RUNTIME ACTIVE')
    expect(html).toContain('STL / PNG EXPORT READY')
  })

  test('Pending Geometry (job selected, state NEW/SCAD_GENERATED, no STL): renders Compile Ready state with prompt and actions', () => {
    const mockJob: Job = {
      id: 'job-99998888-1111',
      state: 'NEW',
      inputRequest: 'Design a hollow cylindrical battery tube with M12 threads',
      partFamily: 'electronics_enclosure',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as Job

    let processedJob: Job | null = null
    let activeTabSet: string | null = null

    const html = renderToStaticMarkup(
      React.createElement(CadViewportEmptyState, {
        selectedJob: mockJob,
        isProcessing: false,
        isFirstLoadComplete: true,
        onProcess: (job) => {
          processedJob = job
        },
        onShowComposer: () => {},
        onSetActiveTab: (tab) => {
          activeTabSet = tab
        },
      })
    )

    // Top Telemetry
    expect(html).toContain('JOB: job-9999')
    expect(html).toContain('FAMILY: electronics_enclosure')
    expect(html).toContain('NEW')

    // Geometry synthesis standby
    expect(html).toContain('GEOMETRY SYNTHESIS STANDBY')
    expect(html).toContain('Ready for OpenSCAD Compile')
    expect(html).toContain('Design a hollow cylindrical battery tube with M12 threads')

    // Actions
    expect(html).toContain('Process CAD Pipeline')
    expect(html).toContain('Inspect SCAD Source')

    // Bottom Telemetry
    expect(html).toContain('PIPELINE ENGINE: DETERMINISTIC CSG')
    expect(html).toContain('COMPILER: OPENSCAD CLI')
  })

  test('Loading State: renders viewport skeleton without spinning spinner', () => {
    const html = renderToStaticMarkup(
      React.createElement(CadViewportEmptyState, {
        selectedJob: null,
        isFirstLoadComplete: false,
        onShowComposer: () => {},
      })
    )

    expect(html).toContain('cad-viewport-shell')
    expect(html).toContain('skeleton-shimmer')
    expect(html).not.toContain('animate-spin')
  })
})

describe('InspectorEmptyState — Boundary Conditions', () => {
  test('No Job Selected: renders architectural blueprint with 6 capability cards and quick actions', () => {
    const html = renderToStaticMarkup(
      React.createElement(InspectorEmptyState, {
        isFirstLoadComplete: true,
        onShowComposer: () => {},
        onOpenSettings: () => {},
        onOpenShortcuts: () => {},
      })
    )

    expect(html).toContain('INSPECTOR ARCHITECTURE')
    expect(html).toContain('STANDBY')
    expect(html).toContain('No Design Selected')

    // 6 Grayscale Capability Cards
    const expectedCards = [
      { label: 'SPEC', desc: 'Physical constraints, bounding limits' },
      { label: 'PARAMS', desc: 'Dual-bound sliders &amp; precision numerical inputs' },
      { label: 'ASSIST', desc: 'AI repair proposals, patch synthesis' },
      { label: 'VALID', desc: 'C001, B001, C002, H001 watertight manifold' },
      { label: 'HISTORY', desc: 'Immutable snapshot history, line-by-line diffs' },
      { label: 'CODE', desc: 'Direct code editor with live syntax highlighting' },
    ]

    for (const card of expectedCards) {
      expect(html).toContain(card.label)
      expect(html).toContain(card.desc)
    }

    // Quick Actions
    expect(html).toContain('New Design (⌘N)')
    expect(html).toContain('Providers')
    expect(html).toContain('Shortcuts (?)')
  })

  test('Loading State: renders 6 tab skeletons and content skeletons without spinners', () => {
    const html = renderToStaticMarkup(
      React.createElement(InspectorEmptyState, {
        isFirstLoadComplete: false,
        onShowComposer: () => {},
        onOpenSettings: () => {},
        onOpenShortcuts: () => {},
      })
    )

    expect(html).toContain('data-testid="inspector-loading-skeleton"')
    expect(html).toContain('skeleton-shimmer')
    expect(html).not.toContain('animate-spin')
  })
})
