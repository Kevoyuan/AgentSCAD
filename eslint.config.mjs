import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  ignores: [
    "node_modules/**",
    // `distDir` can be redirected with AGENTSCAD_BUILD_DIR so a production build
    // and a running dev server stop fighting over `.next`. Whatever the build
    // directory is called, linting its output is pointless and slow — and the
    // whole `.next*` family is matched at once, because a per-name rule misses
    // the next name that gets used.
    ".next*/**",
    "outputs/**",
    ".agents/**",
    ".claude/worktrees/**",
    ".openscad-runtime/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "examples/**",
    "skills/**",
  ]
}, {
  /*
   * DESIGN.md section 11: colour is a token, never a literal.
   *
   * The 2026-10 UI review counted 81 hardcoded hex values across the CAD tree -
   * enough that the light theme could not be fixed in one place, and a single
   * `#7BD68A` was rendering at 1.9:1 on white. Every one of them is a
   * `var(--shell-*)`, `var(--provider-*)` or `color-mix()` now; this rule is what
   * stops them growing back. The fix is never "add an exception" - add the token
   * to `:root` in globals.css (or reuse one) and reference it.
   *
   * Scoped to the CAD tree because that is the surface DESIGN.md governs; the
   * shadcn primitives under src/components/ui keep their own conventions. Test
   * files are exempt: they legitimately quote the forbidden literal to assert it
   * is gone (`expect(globals).not.toContain('--ring: #F59E0B')`).
   */
  files: ["src/components/cad/**/*.{ts,tsx}"],
  ignores: ["src/components/cad/**/__tests__/**"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "Literal[value=/#[0-9a-fA-F]{6}\\b/]",
        message:
          "Hardcoded hex colour. Use a shell token instead: var(--shell-signal), var(--shell-ok), var(--shell-fail), var(--shell-warn), var(--shell-text*), var(--shell-border*), var(--provider-*).",
      },
      {
        selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{6}\\b/]",
        message:
          "Hardcoded hex colour inside a template literal (usually a Tailwind arbitrary value such as bg-[#FF5A1F]). Use a shell token instead: var(--shell-signal), var(--shell-ok), var(--shell-fail), var(--shell-warn), var(--shell-text*), var(--shell-border*), var(--provider-*).",
      },
    ],
  },
}, {
  /*
   * DESIGN.md section 11, continued: the Tailwind palette is not a colour
   * system, it is a hundred shades that were never chosen for this product.
   *
   * The 2026-10-27 review counted 107 palette utilities across the CAD tree
   * and two shell-visible primitives - `text-emerald-400`, `bg-rose-500/15`,
   * `border-cyan-500/20` and the rest - and a runtime probe confirmed they
   * really rendered, so the light theme's semantic colours were being
   * contradicted by hardcoded hexes wearing Tailwind's names. Section 11
   * forbids cyan by name, and forbids a rainbow of icon colours generally.
   *
   * The replacement is a question, not a lookup: does the element carry a
   * semantic state? Then var(--shell-ok | --shell-warn | --shell-fail |
   * --shell-signal-soft). Is it decoration? Then var(--shell-text-muted |
   * --shell-text-label | --shell-well | --shell-border). A colour that means
   * nothing must not look like a colour that means something.
   *
   * Scoped to src/components (the CAD tree plus the primitives the shell puts
   * on screen). The whole tree is currently clean, so nothing is grandfathered.
   * Test files are exempt for the same reason as the hex rule: they quote the
   * forbidden class in order to assert it is gone.
   */
  files: ["src/components/**/*.{ts,tsx}"],
  ignores: ["src/components/**/__tests__/**"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "Literal[value=/\\b(?:text|bg|border|ring|fill|stroke|from|to|via|outline|decoration|divide|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}/]",
        message:
          "Tailwind palette colour. The shell has a palette and it is tokenised: var(--shell-ok) for pass, var(--shell-warn) for review, var(--shell-fail) for failure, var(--shell-signal-soft) for the accent, var(--shell-text-muted) / var(--shell-text-label) / var(--shell-well) / var(--shell-border) for chrome. See DESIGN.md section 11.",
      },
    ],
  },
}, {
  files: ["scripts/openscad-wasm-sandbox.cjs"],
  rules: {
    "@typescript-eslint/no-require-imports": "off",
  },
}];

export default eslintConfig;
