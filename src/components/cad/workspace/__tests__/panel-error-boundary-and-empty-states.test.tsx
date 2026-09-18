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

    // DESIGN.md section 6: the slots rail states what will appear, in one line.
    // No preset grid and no onboarding copy - the composer owns creation.
    expect(html).toContain('data-testid="job-list-cold-start"')
    expect(html).toContain('还没有零件')
    expect(html).toContain('新零件')
    expect(html).not.toContain('WORKSPACE INITIALIZED')
    expect(html).not.toContain('ENGINEERING PRESETS')
    expect(html).not.toContain('Spur Gear')
    expect(html).not.toContain('+USE')
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

    expect(html).toContain('data-testid="job-list-filter-empty"')
    expect(html).toContain('没有符合条件的零件')
    expect(html).toContain('清除筛选')

    // the cold-start copy must not leak into the filter mismatch state
    expect(html).not.toContain('还没有零件。')
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
  test('Cold Start / No Job Selected: one sentence and three real examples, no engine internals', () => {
    const html = renderToStaticMarkup(
      React.createElement(CadViewportEmptyState, {
        selectedJob: null,
        isFirstLoadComplete: true,
        onShowComposer: () => {},
      })
    )

    // DESIGN.md section 9: answer four questions, nothing else
    expect(html).toContain('data-testid="viewport-cold-start"')
    expect(html).toContain('写一句话，描述你要的零件。')
    expect(html).toContain('装在 35 mm 导轨上的相机支架，M4 螺孔')

    // DESIGN.md section 18: no engine internals reach the user
    expect(html).not.toContain('SYS: STANDBY')
    expect(html).not.toContain('GRID: 10.0mm')
    expect(html).not.toContain('KERNEL: CSG PARAMETRIC')

    // 2026-09-17 finding #1: exactly one create action (the composer), not two
    expect(html).not.toContain('Create New CAD Design')
    expect(html).not.toContain('PRECISION WORKBENCH')
    expect(html).not.toContain('OPENSCAD RUNTIME ACTIVE')
    expect(html).not.toContain('STL / PNG EXPORT READY')
  })
  test('Pending Geometry (job selected, no STL): one sentence and one action', () => {
    const mockJob: Job = {
      id: 'job-99998888-1111',
      state: 'NEW',
      inputRequest: 'Design a hollow cylindrical battery tube with M12 threads',
      partFamily: 'electronics_enclosure',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as Job

    let processedJob: Job | null = null

    const html = renderToStaticMarkup(
      React.createElement(CadViewportEmptyState, {
        selectedJob: mockJob,
        isProcessing: false,
        isFirstLoadComplete: true,
        onProcess: (job) => {
          processedJob = job
        },
        onShowComposer: () => {},
        onSetActiveTab: () => {},
      })
    )

    expect(html).toContain('data-testid="viewport-pending-geometry"')
    expect(html).toContain('这个零件还没有几何。')
    expect(html).toContain('生成几何')

    // job id, family and pipeline vocabulary are internals, not user content
    expect(html).not.toContain('JOB: job-9999')
    expect(html).not.toContain('FAMILY: electronics_enclosure')
    expect(html).not.toContain('GEOMETRY SYNTHESIS STANDBY')
    expect(html).not.toContain('Process CAD Pipeline')
    expect(html).toBeDefined()
    expect(processedJob).toBeNull()
  })
  test('Loading State: renders viewport skeleton without spinning spinner', () => {
    const html = renderToStaticMarkup(
      React.createElement(CadViewportEmptyState, {
        selectedJob: null,
        isFirstLoadComplete: false,
        onShowComposer: () => {},
      })
    )

    expect(html).toContain('skeleton-shimmer')
    expect(html).not.toContain('animate-spin')
  })
})

describe('InspectorEmptyState — Boundary Conditions', () => {
  test('No Job Selected: one quiet line, no architecture diagram', () => {
    const html = renderToStaticMarkup(
      React.createElement(InspectorEmptyState, {
        isFirstLoadComplete: true,
        onShowComposer: () => {},
        onOpenSettings: () => {},
        onOpenShortcuts: () => {},
      })
    )

    // DESIGN.md section 19: never explain the application's own architecture
    expect(html).toContain('data-testid="inspector-empty"')
    expect(html).toContain('还没有选中零件')
    expect(html).not.toContain('INSPECTOR ARCHITECTURE')
    expect(html).not.toContain('No Design Selected')
    expect(html).not.toContain('STANDBY')
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
