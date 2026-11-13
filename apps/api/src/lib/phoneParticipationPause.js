// This candidate deliberately pauses all phone participation while financial
// donation/closure transitions are prepared without SMS retention evidence.
// Reopening requires a reviewed code change; no environment or caller bypass.
export function phoneParticipationPaused() { return true; }
