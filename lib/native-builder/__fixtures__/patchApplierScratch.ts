/**
 * Fixed-content scratch fixture used only by lib/native-builder/nativeBuilder.validation.ts to
 * exercise patchApplier/rollback (create_file, replace_range, stale-hash rejection). Every test
 * that writes to this file restores it to this exact content via rollback before finishing.
 */
export const SCRATCH_MARKER = 'original-scratch-value'
