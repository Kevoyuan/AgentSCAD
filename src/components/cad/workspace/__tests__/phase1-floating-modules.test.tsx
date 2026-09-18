import { describe, test, expect } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Module } from '../Module'

describe('Phase 1: Floating Module System (DESIGN.md section 13)', () => {
  test('renders floating plate with exact section 13 visual elevation tokens', () => {
    const html = renderToStaticMarkup(
      <Module id="test-mod" title="测试模块" badge="就绪">
        <div>Module Content</div>
      </Module>
    )

    // Check id and data-module attribute
    expect(html).toContain('id="test-mod"')
    expect(html).toContain('data-module="test-mod"')

    // DESIGN.md section 13 + section 11: the plate resolves through shell tokens
    // so the same component renders correctly in both themes. Asserting the token
    // is deliberately stronger than asserting the dark literal - the literal is
    // exactly what made light mode impossible.
    expect(html).toContain('background:var(--shell-module)')
    expect(html).toContain('border:1px solid var(--shell-border)')
    expect(html).toContain('border-radius:9px')
    expect(html).toContain('box-shadow:var(--shell-shadow)')

    // 16px backdrop blur
    expect(html).toContain('backdrop-filter:blur(16px) saturate(1.15)')

    // 1px inner top highlight pseudo/element
    expect(html).toContain('bg-[var(--shell-hairline)]')

    // Draggable header with grip affordance
    expect(html).toContain('mod-h')
    expect(html).toContain('grip')

    // Title and badge
    expect(html).toContain('测试模块')
    expect(html).toContain('就绪')
  })

  test('collapse control renders toggle and hides body when collapsed', () => {
    const expandedHtml = renderToStaticMarkup(
      <Module id="mod-exp" title="尺寸" isCollapsed={false}>
        <div id="content-exp">Expanded Content</div>
      </Module>
    )
    expect(expandedHtml).toContain('−')
    expect(expandedHtml).toContain('id="content-exp"')

    const collapsedHtml = renderToStaticMarkup(
      <Module id="mod-col" title="尺寸" isCollapsed={true}>
        <div id="content-col">Collapsed Content</div>
      </Module>
    )
    expect(collapsedHtml).toContain('＋')
    expect(collapsedHtml).not.toContain('id="content-col"')
    expect(collapsedHtml).toContain('closed')
  })

  test('body does not clip content and allows vertical scrolling without cutoff', () => {
    const html = renderToStaticMarkup(
      <Module id="mod-clip" title="检验">
        <div style={{ height: 2000 }}>Tall content</div>
      </Module>
    )
    // Never clip own content: overflow-y-auto, overflow-x-hidden
    expect(html).toContain('overflow-y-auto')
    expect(html).toContain('overflow-x-hidden')
    expect(html).toContain('Tall content')
  })

  test('supports free dragged positioning', () => {
    const html = renderToStaticMarkup(
      <Module
        id="mod-free"
        title="零件槽位"
        isFree={true}
        position={{ x: 120, y: 240 }}
      >
        <div>Content</div>
      </Module>
    )
    expect(html).toContain('data-free="1"')
    expect(html).toContain('left:120px')
    expect(html).toContain('top:240px')
  })

  test('respects hidden prop for density levels and space key hiding', () => {
    const visibleHtml = renderToStaticMarkup(
      <Module id="mod-vis" title="视口" hidden={false}>
        <div>Visible</div>
      </Module>
    )
    // Assert the class TOKEN, not a concatenation of two class strings: the module
    // legitimately has other classes between them.
    // Whole-token match: `overflow-hidden` must not count as the `hidden` utility.
    const hasHiddenToken = (html: string) =>
      Array.from(html.matchAll(/class="([^"]*)"/g)).some(m =>
        m[1].split(/\s+/).includes('hidden')
      )
    expect(hasHiddenToken(visibleHtml)).toBe(false)

    const hiddenHtml = renderToStaticMarkup(
      <Module id="mod-hid" title="视口" hidden={true}>
        <div>Hidden</div>
      </Module>
    )
    expect(hasHiddenToken(hiddenHtml)).toBe(true)
  })
})
