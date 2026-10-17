"""Offline handoff validator. No model calls, network, shell, git writes or deployment.

This validates a coordination protocol, not code quality or sandbox isolation.
Provider adapters and trusted CI execution are deliberately not implemented yet.
"""
from dataclasses import dataclass, field
import re


def valid_sha(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


@dataclass
class Task:
    task_id: str
    base_sha: str
    state: str = field(default="IMPLEMENTATION", init=False)
    corrections: int = field(default=0, init=False)
    head_sha: str | None = field(default=None, init=False)
    history: list = field(default_factory=list, init=False)

    def __post_init__(self):
        if not self.task_id or not valid_sha(self.base_sha):
            raise ValueError("Task identity and full base SHA required")

    def implementation(self, *, actor, head_sha, evidence):
        if self.state != "IMPLEMENTATION" or actor != "claude":
            raise ValueError("Only Claude may submit an implementation at this stage")
        if not valid_sha(head_sha) or head_sha in (self.base_sha, self.head_sha):
            raise ValueError("A new full commit SHA is required")
        if not isinstance(evidence, str) or not evidence.strip():
            raise ValueError("Evidence reference required; this is not evidence verification")
        self.head_sha = head_sha
        self.state = "AUDIT"
        self.history.append(dict(event="implementation", actor=actor, sha=head_sha, evidence=evidence))

    def review(self, *, actor, head_sha, verdict, findings):
        if self.state != "AUDIT" or actor != "openai":
            raise ValueError("Only the independent OpenAI reviewer may review")
        if head_sha != self.head_sha:
            raise ValueError("Stale review: commit differs")
        if verdict not in ("ACCEPT", "CHANGES", "BLOCKED"):
            raise ValueError("Unknown verdict")
        if not isinstance(findings, str) or not findings.strip():
            raise ValueError("Review rationale required")
        if verdict == "ACCEPT":
            self.state = "OWNER_REVIEW"
        elif verdict == "BLOCKED" or self.corrections >= 2:
            self.state = "ESCALATED"
        else:
            self.corrections += 1
            self.state = "IMPLEMENTATION"
        self.history.append(dict(event="review", actor=actor, sha=head_sha, verdict=verdict, findings=findings))


if __name__ == "__main__":
    import json
    task = Task("synthetic-demo", "a" * 40)
    task.implementation(actor="claude", head_sha="b" * 40, evidence="synthetic fixture, not a real test run")
    task.review(actor="openai", head_sha="b" * 40, verdict="CHANGES", findings="synthetic missing fallback")
    task.implementation(actor="claude", head_sha="c" * 40, evidence="synthetic corrected fixture")
    task.review(actor="openai", head_sha="c" * 40, verdict="ACCEPT", findings="synthetic review only")
    print(json.dumps(dict(state=task.state, history=task.history), indent=2))
