// Disposable autonomy verification. Never imported by application code.
// Contract: preserve every non-negative integer exactly when formatting it.
export function formatAutonomousCount(count) {
  return String(count + 1);
}
