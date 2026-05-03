---
name: scad-improvement
description: Improve AgentSCAD generation quality from user edits, validation failures, repair outcomes, and learned SCAD patterns.
triggers:
  - improve generation
  - learn from edits
  - generation feedback
  - scad improvement
---

# SCAD Improvement — Self-Learning Loop

This skill documents the self-learning loop that extracts patterns from user edits and feeds them back into the SCAD generation pipeline. The goal is to make each generation iteration better than the last by learning from what users actually fix.

## How It Works

### The Loop

1. **Generation**: The pipeline generates OpenSCAD code using `skills/scad-generation/SKILL.md` and per-family parameter schemas in `skills/scad-generation/families/`.

2. **User Edits**: When users modify the generated code (parameters, SCAD source, or notes), those changes are tracked in `JobVersion` records via `src/lib/version-tracker.ts`. Each version records the `field` that changed, the `oldValue`, `newValue`, and `changedBy` (either `"user"` or `"ai_apply"`).

3. **Pattern Extraction**: The `analyzeUserEdits()` function in `src/lib/improvement-analyzer.ts` queries recent user edits, groups them by part family, and extracts three types of patterns:

   - **Parameter Drift**: Which parameters do users consistently change from defaults? (e.g., "users always increase wall_thickness from 1.2 to 2.0")
   - **SCAD Source Patches**: What lines do users commonly add or modify in the generated code?
   - **Validation Failures**: Which validation rules fail most often for each part family?

4. **Pattern Storage**: Extracted patterns are written to `skills/scad-generation/learned-patterns.json` with atomic file writes (write to `.tmp`, then rename).

5. **Pattern Injection**: When generating new code, `buildScadPrompt()` in `src/lib/skill-resolver.ts` loads learned patterns for the requested part family and injects them as optional context in the generation prompt. This makes the LLM aware of what users typically fix.

### Architecture

```
User edits SCAD code
        |
        v
JobVersion records created (changedBy: "user")
        |
        v
Cron: POST /api/cron { action: "analyze-edits" }
        |
        v
analyzeUserEdits() extracts patterns
        |
        v
writeLearnedPatterns() saves to learned-patterns.json
        |
        v
Next generation: buildScadPrompt() injects patterns
        |
        v
LLM generates better code informed by past edits
```

## Pattern Types

### Parameter Drift

Tracks parameters that users consistently change from generated defaults. For example, if users always increase `wall_thickness` from 1.2 to 2.0, the system learns this and suggests the higher default in future generations.

**Detection logic**: Groups parameter edits by name, counts how often each parameter is changed, and computes the average new value. Patterns require at least 2 edits to be considered significant.

### SCAD Source Patches

Tracks direct modifications to the OpenSCAD source code. Identifies commonly added lines, commonly removed lines, and overall edit frequency per family.

**Detection logic**: Diffs old and new SCAD source line-by-line, counts added/removed lines across all edits. Patterns require at least 2 occurrences of the same line change.

### Validation Failures

Tracks which validation rules fail most often per part family. This reveals systematic issues in the generation pipeline (e.g., "wall thickness validation fails 80% of the time for phone_case").

**Detection logic**: Aggregates validation results from jobs that had user edits, counts failures per rule. Patterns require at least 2 failures.

## File: learned-patterns.json

Located at `skills/scad-generation/learned-patterns.json`.

### Format

```json
{
  "lastUpdated": "2026-04-24T00:00:00Z",
  "patterns": [
    {
      "family": "spur_gear",
      "type": "parameter_drift",
      "insight": "Users consistently increased wall_thickness from ~1.2 to ~2.0 (5 edits)",
      "frequency": 5,
      "parameter": "wall_thickness",
      "suggestedValue": 2.0,
      "details": {
        "avgOld": 1.2,
        "avgNew": 2.0,
        "sampleSize": 5
      }
    }
  ],
  "stats": {
    "totalVersionsAnalyzed": 45,
    "userEdits": 15,
    "familiesAffected": 3
  }
}
```

### EditPattern Interface

```typescript
interface EditPattern {
  family: string;           // Part family (e.g., "spur_gear", "phone_case")
  type: "parameter_drift" | "scad_patch" | "validation_failure";
  insight: string;          // Human-readable description of the pattern
  frequency: number;        // How many times this pattern was observed
  parameter?: string;       // Parameter name (for drift) or internal key
  suggestedValue?: number;  // Suggested default value (for parameter drift)
  details: Record<string, unknown>;  // Additional context
}
```

## Manual Review and Curation

### Viewing Learned Patterns

Read the file directly:

```bash
cat skills/scad-generation/learned-patterns.json | jq '.patterns[] | select(.family == "spur_gear")'
```

Or query via the API to trigger a fresh analysis:

```bash
curl -X POST http://localhost:3000/api/cron \
  -H "Content-Type: application/json" \
  -d '{"action": "analyze-edits"}'
```

### Removing Specific Patterns

Edit `skills/scad-generation/learned-patterns.json` directly. Remove the pattern object from the `patterns` array and update `lastUpdated`. The next generation cycle will reflect the change.

### Adjusting Pattern Sensitivity

In `src/lib/improvement-analyzer.ts`, the `MIN_FREQUENCY_FOR_PATTERN` constant controls how many observations are needed before a pattern is recognized. Default is 2. Increase this to reduce noise, decrease it to catch patterns faster.

## Resetting / Clearing Learned Patterns

### Full Reset

Delete the learned patterns file:

```bash
rm skills/scad-generation/learned-patterns.json
```

The system will regenerate it from scratch on the next `analyze-edits` cron run.

### Per-Family Reset

Edit `skills/scad-generation/learned-patterns.json` and remove all patterns with the target `family` value. Update the `stats.familiesAffected` count accordingly.

### Disable Pattern Injection

To temporarily disable learned pattern injection without deleting the file, set the part family to `"unknown"` for the job, or wrap the `getLearnedPatternsForFamily()` call in `buildScadPrompt()` with a feature flag.

## Cron Integration

The self-learning loop is wired into the cron endpoint at `src/app/api/cron/route.ts`:

- **Action**: `analyze-edits`
- **Schedule**: Run periodically (e.g., every hour or every 6 hours)
- **Idempotent**: Running the same analysis twice with the same data produces the same output
- **Merged**: New patterns are merged with existing ones — frequencies accumulate

To run manually:

```bash
curl -X POST http://localhost:3000/api/cron \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{"action": "analyze-edits"}'
```

## Key Design Decisions

1. **Optional context only**: Learned patterns are injected as suggestions, never as hard constraints. The LLM is free to ignore them if the user's request conflicts.

2. **Idempotent analysis**: Running the analyzer twice with the same data produces the same output. Patterns are deduplicated by `family:type:parameter` key.

3. **Atomic file writes**: `learned-patterns.json` is written to a `.tmp` file first, then renamed. This prevents partial writes from corrupting the file.

4. **No new dependencies**: The analyzer uses only Prisma for database queries and Node.js `fs` for file operations. No external packages required.

5. **Frequency threshold**: Patterns require at least `MIN_FREQUENCY_FOR_PATTERN` (default 2) observations to be recognized, preventing noise from one-off edits.

6. **Merging on write**: New patterns are merged with existing ones. If a pattern already exists (same family + type + parameter), the frequency is combined and the newer insight/suggestedValue takes precedence.
