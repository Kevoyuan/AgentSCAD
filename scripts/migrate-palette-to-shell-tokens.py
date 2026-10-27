#!/usr/bin/env python3
"""
One-shot migration: Tailwind palette classes -> shell tokens.

DESIGN.md section 11: colour is a token, never a literal, and the shell has a
fixed palette (signal / ok / warn / fail / text / border). The 2026-10-27 UI
review counted 107 palette utilities across the CAD tree and two primitives,
including `cyan-400`, which section 11 forbids by name.

The replacement is not a colour swap - it is a question: does this element carry
a SEMANTIC state (pass / warn / fail / accent), or is it decoration?

  - semantic  -> var(--shell-ok | --shell-warn | --shell-fail | --shell-signal-soft)
  - decoration-> var(--shell-text-muted | --shell-text-label | --shell-well | --shell-border)

Pairs are replaced before singles so that a `dark:` twin never survives as a
second writer for the same property.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FILES = [
    "src/components/cad/validation-panel.tsx",
    "src/components/cad/chat-panel.tsx",
    "src/components/cad/research-panel.tsx",
    "src/components/cad/timeline-panel.tsx",
    "src/components/cad/job-version-history.tsx",
    "src/components/cad/notes-panel.tsx",
    "src/components/cad/job-dependencies.tsx",
    "src/components/ui/toast.tsx",
    "src/components/ui/slider.tsx",
]

OK = "var(--shell-ok)"
WARN = "var(--shell-warn)"
FAIL = "var(--shell-fail)"
SIGNAL = "var(--shell-signal-soft)"
MUTED = "var(--shell-text-muted)"
LABEL = "var(--shell-text-label)"
TEXT = "var(--shell-text)"
WELL = "var(--shell-well)"
HOVER = "var(--shell-hover)"
BORDER = "var(--shell-border)"


def mix(token: str, pct: int) -> str:
    return f"color-mix(in_srgb,{token}_{pct}%,transparent)"


# (needle, replacement) - order matters: pairs first, then longer before shorter.
PAIRS = [
    # ── light/dark twins: one token, one writer ─────────────────────────────
    (f"text-emerald-600 dark:text-emerald-400", f"text-[{OK}]"),
    (f"text-rose-600 dark:text-rose-400", f"text-[{FAIL}]"),
    (f"text-amber-600 dark:text-amber-400", f"text-[{WARN}]"),
    (f"text-rose-700 dark:text-rose-300", f"text-[{FAIL}]"),
    (f"text-amber-700 dark:text-amber-300", f"text-[{WARN}]"),

    # ── semantic surfaces ──────────────────────────────────────────────────
    (f"bg-rose-500/15", f"bg-[{mix(FAIL, 15)}]"),
    (f"bg-rose-500/10", f"bg-[{mix(FAIL, 10)}]"),
    (f"bg-rose-500/[0.06]", f"bg-[{mix(FAIL, 6)}]"),
    (f"bg-rose-600", f"bg-[{FAIL}]"),
    (f"bg-rose-500", f"bg-[{FAIL}]"),
    (f"text-rose-700", f"text-[{FAIL}]"),
    (f"text-rose-500", f"text-[{FAIL}]"),
    (f"text-rose-400", f"text-[{FAIL}]"),
    (f"text-rose-300/80", f"text-[{FAIL}]"),
    (f"text-rose-300", f"text-[{FAIL}]"),
    (f"border-rose-500/30", f"border-[{mix(FAIL, 30)}]"),

    (f"bg-amber-500/15", f"bg-[{mix(WARN, 15)}]"),
    (f"bg-amber-500/10", f"bg-[{mix(WARN, 10)}]"),
    (f"bg-amber-500/[0.04]", f"bg-[{mix(WARN, 4)}]"),
    (f"bg-amber-500", f"bg-[{WARN}]"),
    (f"text-amber-700", f"text-[{WARN}]"),
    (f"text-amber-400", f"text-[{WARN}]"),
    (f"text-amber-300", f"text-[{WARN}]"),
    (f"border-amber-500/40", f"border-[{mix(WARN, 40)}]"),
    (f"border-amber-500/30", f"border-[{mix(WARN, 30)}]"),
    (f"border-amber-500/25", f"border-[{mix(WARN, 25)}]"),

    (f"bg-emerald-500/15", f"bg-[{mix(OK, 15)}]"),
    (f"bg-emerald-500/10", f"bg-[{mix(OK, 10)}]"),
    (f"bg-emerald-400", f"bg-[{OK}]"),
    (f"text-emerald-700", f"text-[{OK}]"),
    (f"text-emerald-600", f"text-[{OK}]"),
    (f"text-emerald-500", f"text-[{OK}]"),
    (f"text-emerald-400", f"text-[{OK}]"),
    (f"text-emerald-300/80", f"text-[{OK}]"),
    (f"text-emerald-300", f"text-[{OK}]"),
    (f"border-emerald-500/30", f"border-[{mix(OK, 30)}]"),
    (f"border-emerald-500/20", f"border-[{mix(OK, 20)}]"),

    # ── forbidden hues: decorative, so they become neutral chrome ─────────
    (f"bg-cyan-500/10", f"bg-[{WELL}]"),
    (f"bg-cyan-500/5", f"bg-[{WELL}]"),
    (f"border-cyan-500/20", f"border-[color:{BORDER}]"),
    (f"border-cyan-500/15", f"border-[color:{BORDER}]"),
    (f"text-cyan-400", f"text-[{MUTED}]"),
    (f"text-cyan-300", f"text-[{TEXT}]"),
    (f"text-sky-400", f"text-[{MUTED}]"),
    (f"text-teal-400", f"text-[{MUTED}]"),
    (f"text-stone-300", f"text-[{MUTED}]"),
    (f"text-lime-400", f"text-[{MUTED}]"),
    (f"bg-lime-500/10", f"bg-[{WELL}]"),

    (f"text-orange-400", f"text-[{SIGNAL}]"),
    (f"text-red-300", f"text-[{TEXT}]"),
    (f"text-red-50", f"text-[{TEXT}]"),
    (f"focus:ring-red-400", f"focus:ring-[{FAIL}]"),
    (f"focus:ring-offset-red-600", "focus:ring-offset-[var(--shell-module-solid)]"),
    (f"dark:bg-slate-200", "dark:bg-[var(--shell-module-solid)]"),
]

PALETTE = re.compile(
    r"(?<![\w-])(?:[a-z-]+:)*(text|bg|border|ring|from|to|via|fill|stroke|outline|decoration|divide|accent|caret|placeholder)-"
    r"(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)"
    r"(?:-[0-9]{2,3})?(?:/[0-9]{1,3})?"
)

total = 0
for rel in FILES:
    path = ROOT / rel
    if not path.exists():
        print(f"missing {rel}", file=sys.stderr)
        continue
    original = path.read_text()
    text = original
    hits = 0
    for needle, replacement in PAIRS:
        count = text.count(needle)
        if count:
            text = text.replace(needle, replacement)
            hits += count
    if text != original:
        path.write_text(text)
        total += hits
        print(f"{rel}: {hits} replacements")
    leftover = sorted(set(PALETTE.findall(text)))
    raw = PALETTE.findall(text)
    if raw:
        print(f"  !! LEFTOVER in {rel}: {sorted(set(raw))}")

print(f"total replacements: {total}")
