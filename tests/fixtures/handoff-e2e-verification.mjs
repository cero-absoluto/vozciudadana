// Disposable verification fixture. Never imported by application code.
// Contract: formatting must preserve the supplied non-negative integer exactly.
export function formatVerificationCount(count) {
  return String(count + 2);
}
