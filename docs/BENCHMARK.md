# AgentSCAD Benchmarking

AgentSCAD includes benchmark scripts for measuring CAD generation quality and pipeline cost.

## Commands

```bash
bun run cad:eval         # all benchmark cases
bun run cad:eval:fast    # simple cases only
bun run cad:eval -- --model deepseek  # with specific model
bun run cad:eval:report  # parse results as JSON
```

## Metrics

Key metrics:

- compile success rate
- geometry pass rate
- repair success rate
- average LLM calls per job
- average latency per job

The benchmark runner writes `benchmark-results.txt`, which is treated as a generated artifact and ignored by Git.

Benchmark results should be interpreted as local/runtime quality signals, not as a guarantee that every generated CAD artifact is manufacturing-ready.
