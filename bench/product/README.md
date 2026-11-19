# P-A08 product-path preparation (six-part guided/retained)

This is the first **product-path** bench family: it calls the real `prepareContractAssembly`, not a tool-level renderer. The task uses a six-part guided/retained embedded declaration and scores the seven layers the product-preparation path can measure:

- `distinct-exported-parts`: selector-distinct parts;
- `part-connectivity`: every rendered part connects;
- `assembly-reconstruction`: delivered triangles rebuild the placed assembly;
- `assembly-path`: declared insertion order, checked as the reverse of the declared removal paths;
- `disassembly-path`: declared removal order;
- `diametral-clearance`: **one eccentric revolute fit** (0.1–0.6 mm);
- `measured-joint-frames`: measured joint-frame agreement for that same eccentric fit.

Fit and joint frames cover only the eccentric revolute. Main-shaft and wrist stations are not valid cylindrical probes in this fixture and remain NOT_RUN. Motion, source motion and physical function are also outside this family.

## Result

```
bun run bench:product:check
SELF-CHECK OK: 1 reference(s) pass, 5 adversarial submission(s) rejected.
```

| Submission | Result |
|---|---|
| `reference` | **PASS 7/7**; 6 parts; topology/reconstruction/assembly/disassembly PASS; eccentric fit 0.395–0.405 mm PASS; joint frames PASS |
| `adversarial-slider-before-guide` | **FAIL 5/7**; topology/reconstruction/fit/joint PASS, disassembly FAIL; assembly NOT_RUN because this counterexample has no insertion sequence |
| `adversarial-declaration-missing-guide` | FAIL 4/7; 5 parts; reconstruction NOT_RUN, distinct parts fail |
| `adversarial-crank-radius` | FAIL 3/7; reconstruction NOT_RUN, disassembly FAIL, topology still PASS |
| `adversarial-fit-pin` | FAIL 3/7; eccentric clearance **−0.605 to −0.594 mm**, fit FAIL; joint frames still PASS, reconstruction NOT_RUN |
| `adversarial-joint-offset` | FAIL 3/7; fit still PASS, but measured joint frames FAIL; assembly/disassembly FAIL |

### A semantic boundary

An early attempt treated the key/guide swap as an adversarial case, but the product path correctly PASSES it: both orders are geometrically removable. The blocked order is **slider before guide**. The family therefore uses `adversarial-slider-before-guide`, not the structural-contract key/guide swap. The product layer checks geometric order; the declaration-contract layer may freeze a stricter structural order.

## Hidden set

The hidden manifest family `product` has an external development copy `hidden-product-joint-dev [product]`: 1 task / 1 case, reference PASS, `layers 7/7`, `independentHiddenEvaluation=NOT_RUN`. It is still a development copy, not an independent hidden evaluation.

## Boundaries

- Only the seven product-preparation layers are scored. Fit/joint cover only the eccentric revolute. The assembly path is a discrete reverse of declared removals, not continuous transport.
- This is not the A001 contract gate, user acceptance, continuous motion, or physical function.
- One fixture, one correct order, five counterexamples; no claim about arbitrary product workflows or model generation.
- Included in the twelve-family `bench:all` gate and the hidden split. The last gate matrix predates the sixth counterexample (`adversarial-joint-offset`); the product row is therefore not the latest case count.
