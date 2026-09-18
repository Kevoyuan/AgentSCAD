/**
 * Shared OpenSCAD Syntax Highlighter
 * Used by both ScadViewer and ScadEditor components.
 *
 * One hue per token is not syntax colouring, it is a rainbow: the old map spent
 * violet, cyan, emerald, amber, orange, rose and zinc on seven token kinds, which is
 * what DESIGN.md section 11 forbids ("one expressive accent ... no rainbow icon
 * colouring"). Roles now carry the meaning instead: the one accent marks keywords,
 * caution marks engine variables, and everything else steps down the text ladder, so
 * numbers and structure stay the most legible things in the panel.
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function highlightScad(code: string): string {
  // Tokenize and highlight OpenSCAD code
  // Order matters: comments and strings first (to avoid highlighting inside them)

  const keywords = ['module', 'function', 'if', 'else', 'for', 'each', 'let', 'assign']
  const builtins = [
    'cube', 'cylinder', 'sphere', 'translate', 'rotate', 'difference', 'union',
    'intersection', 'linear_extrude', 'rotate_extrude', 'hull', 'minkowski',
    'offset', 'color', 'echo', 'scale', 'resize', 'mirror', 'multmatrix',
    'projection', 'render', 'children', 'search', 'concat', 'lookup',
    'min', 'max', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
    'abs', 'ceil', 'floor', 'round', 'pow', 'sqrt', 'exp', 'log', 'ln',
    'len', 'str', 'chr', 'ord', 'norm', 'cross', 'rands', 'vector',
  ]
  const specialValues = ['true', 'false', 'undef']
  const keywordPattern = new RegExp(`\\b(${keywords.join('|')})\\b`)
  const builtinPattern = new RegExp(`\\b(${builtins.join('|')})\\b`)
  const specialValuePattern = new RegExp(`\\b(${specialValues.join('|')})\\b`)

  const lines = code.split('\n')
  const highlighted = lines.map(line => {
    let result = ''
    let i = 0

    while (i < line.length) {
      // Block comment /* ... */
      if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '*') {
        let end = line.indexOf('*/', i + 2)
        if (end === -1) {
          result += `<span class="text-[var(--shell-text-dim)] italic">${escapeHtml(line.slice(i))}</span>`
          i = line.length
        } else {
          result += `<span class="text-[var(--shell-text-dim)] italic">${escapeHtml(line.slice(i, end + 2))}</span>`
          i = end + 2
        }
        continue
      }

      // Line comment //
      if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '/') {
        result += `<span class="text-[var(--shell-text-dim)] italic">${escapeHtml(line.slice(i))}</span>`
        i = line.length
        continue
      }

      // String literal "..."
      if (line[i] === '"') {
        let j = i + 1
        while (j < line.length && line[j] !== '"') {
          if (line[j] === '\\') j++ // skip escaped char
          j++
        }
        if (j < line.length) j++ // include closing quote
        result += `<span class="text-[var(--shell-text-muted)]">${escapeHtml(line.slice(i, j))}</span>`
        i = j
        continue
      }

      // Variable ($fn, $fa, $fs, etc.)
      if (line[i] === '$' && i + 1 < line.length && /[a-zA-Z_]/.test(line[i + 1])) {
        let j = i + 1
        while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++
        result += `<span class="text-[var(--shell-warn)]">${escapeHtml(line.slice(i, j))}</span>`
        i = j
        continue
      }

      // Number (including decimal)
      if (/[0-9]/.test(line[i]) || (line[i] === '.' && i + 1 < line.length && /[0-9]/.test(line[i + 1]))) {
        let j = i
        // Integer part
        while (j < line.length && /[0-9]/.test(line[j])) j++
        // Decimal part
        if (j < line.length && line[j] === '.' && j + 1 < line.length && /[0-9]/.test(line[j + 1])) {
          j++ // skip the dot
          while (j < line.length && /[0-9]/.test(line[j])) j++
        }
        // Scientific notation
        if (j < line.length && (line[j] === 'e' || line[j] === 'E')) {
          j++
          if (j < line.length && (line[j] === '+' || line[j] === '-')) j++
          while (j < line.length && /[0-9]/.test(line[j])) j++
        }
        result += `<span class="text-[var(--shell-text)]">${escapeHtml(line.slice(i, j))}</span>`
        i = j
        continue
      }

      // Identifier (keyword, builtin, or special value check)
      if (/[a-zA-Z_]/.test(line[i])) {
        let j = i
        while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++
        const word = line.slice(i, j)
        if (keywordPattern.test(word)) {
          result += `<span class="text-[var(--shell-signal-soft)]">${word}</span>`
        } else if (builtinPattern.test(word)) {
          result += `<span class="text-[var(--shell-text-label)]">${word}</span>`
        } else if (specialValuePattern.test(word)) {
          result += `<span class="text-[var(--shell-warn)]">${word}</span>`
        } else {
          result += escapeHtml(word)
        }
        i = j
        continue
      }

      // Operators
      if ('=+-*/%<>!&|'.includes(line[i])) {
        let op = line[i]
        let j = i + 1
        // Two-character operators
        if (j < line.length) {
          const twoChar = line.slice(i, j + 1)
          if (['==', '!=', '<=', '>=', '&&', '||'].includes(twoChar)) {
            op = twoChar
            j = i + 2
          }
        }
        result += `<span class="text-[var(--shell-text-dim)]">${escapeHtml(op)}</span>`
        i = j
        continue
      }

      // Default: pass through
      result += escapeHtml(line[i])
      i++
    }

    return result
  })

  return highlighted.join('\n')
}
