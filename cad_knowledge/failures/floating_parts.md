# Floating / Disconnected Parts

## Symptom
The generated part contains disconnected components. Validation detects floating geometry that would print separately from the main body.

## Common Causes

1. **Missing `union()`.** Multiple solids defined at module scope without being wrapped in `union()`. They render individually, creating separate mesh islands.
2. **Boolean operations with gaps.** A `difference()` accidentally severs the connection between two regions of the part.
3. **Translated children not connected.** `translate()` moves a child outside the parent body without providing a connecting element.
4. **Misaligned STL components.** Multiple parts output as separate meshes in the STL (e.g., lid separate from body without a connecting runner).

## Repair Strategy

1. Wrap all geometry in a single `union()` at the top level
2. Add connecting bridges or runners between separated components
3. Verify translation offsets — ensure features are positioned within the main body
4. For multi-part assemblies (e.g., enclosure + lid), offset the lid so it's clearly separate

## Prevention

- All geometry must be inside a single `union()` in `generated_part()`
- Features (ribs, bosses, standoffs) must penetrate the base by `_merge_tol`
- Use `cylinder_boss()` instead of raw `cylinder()` for standoffs
- Verify translations are within expected body bounds
