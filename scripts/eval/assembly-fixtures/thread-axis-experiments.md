# Thread axis: analytic and feature-identity experiments

These original offline experiments test an exploratory estimator. They do not establish a production coaxiality verdict. The JSON protocols were written and hashed before their respective runs; their finite case selections are visible and are not an independent hidden test set.

Run from the repository root:

```sh
bun scripts/eval/check-thread-axis-analytic.ts
bun scripts/eval/check-thread-axis-decoy.ts
```

Each run writes the protocol, exact experiment and estimator sources, generated STL files and SHA-256 hashes to a fresh directory under `.agentscad/experiments/`. A later rerun can be compared by hashes and measurements. Runtime and library environment are not frozen; the artifacts are evidence for the recorded execution, not a fully hermetic environment.

## Analytic comparison

Protocol SHA-256: `67cd808ab155054380a1f21517345b56451d0a85383e5aebacf766cb5d589180`. The original polygonal cylinder generator and closed-form axis truth are independent of the estimator. In `.agentscad/experiments/thread-axis-analytic-iRyjUB/report.json`, the three measurable examples had maximum absolute position error 0.00319 mm and angle error 0.185 degrees. The out-of-range radius produced no estimate. The thresholds recorded in the protocol were fixed before running, and apply to these examples only. These shapes are polygonal prisms, not threads; results establish neither generalization nor an uncertainty bound.

## Feature identity counterexample

Protocol SHA-256: `ad434d47c1bf33cbecb91b15529ce79670f2608d5bbd392b79e4cce46db92a98`. The constructed annular part has a polygonal bore centered at (0.5, 0) mm and an outer silhouette centered at (0, 0). The intended feature is the bore. In `.agentscad/experiments/thread-axis-decoy-yphCRx/report.json`, the fitted axis was 0.49974 mm from the bore center and 0.00029 mm from the outer center. This occurred despite approximately 357 degrees of fit coverage and small radial residuals. A separate edge-incidence calculation on the STL found 768 triangles, no edge with incidence other than two, no directed-edge mismatches, and no degenerate triangles; self-intersection was not independently tested. `trimesh` was unavailable in the system Python, so that independent tool was not run.

This counterexample demonstrates that well-fitted circular geometry need not be the intended feature. A future production verifier needs both reliable feature binding and a calibrated measurement uncertainty for its stated geometric domain. Even those would not alone prove thread engagement, assembly, or physical functionality. Both experiment verdicts remain `NOT_RUN` for actual assembly coaxiality.
