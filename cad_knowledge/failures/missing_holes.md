# Missing Holes

## Symptom
Validation detects fewer holes than expected (hole_count check fails). The user requested N holes but only M < N appear in the rendered part.

## Common Causes

1. **Hole pattern uses wrong coordinates.** The `for` loop positions holes outside the part body. Check that hole positions are within the part bounds.
2. **Boolean subtraction order.** Holes are subtracted from the wrong parent solid. Ensure `difference()` wraps the part body AND the holes subtract from it.
3. **Insufficient deviation (circle resolution).** Low `$fn` values make circular holes look like polygons. Use `$fn = max(32, d * 4)` for clean holes.
4. **Hole depth too shallow.** The subtracted cylinder doesn't fully penetrate the part. Add `+ 1` or `+ _merge_tol * 2` to hole cylinder height.

## Repair Strategy

1. Count holes in generated SCAD — count `cylinder` calls inside `difference()` blocks
2. Verify hole coordinates are inside part bounding box
3. Verify hole height > part thickness at hole location
4. Add missing holes at correct positions
5. Re-validate with hole_count check

## Prevention

When generating parts with holes:
- Use `bolt_pattern_rect()` or `circular_array()` from agentscad_std.scad
- Always extend hole height past part surface: `h = thickness + 1`
- Verify `margin` is large enough that holes don't break through edges
