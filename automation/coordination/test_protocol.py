import unittest
from protocol import Task


class HandoffTests(unittest.TestCase):
    def task(self):
        return Task("fixture", "a" * 40)

    def submit(self, task, sha="b" * 40):
        task.implementation(actor="claude", head_sha=sha, evidence="synthetic")

    def review(self, task, verdict="ACCEPT", sha=None):
        task.review(actor="openai", head_sha=sha or task.head_sha, verdict=verdict, findings="synthetic")

    def test_accept_stops_at_owner(self):
        t = self.task(); self.submit(t); self.review(t)
        self.assertEqual(t.state, "OWNER_REVIEW")
        self.assertFalse(hasattr(t, "merge"))
        with self.assertRaises(ValueError): self.submit(t, "c" * 40)

    def test_two_corrections_then_escalation(self):
        t = self.task()
        for sha in ("b", "c", "d"):
            self.submit(t, sha * 40); self.review(t, "CHANGES")
        self.assertEqual(t.corrections, 2)
        self.assertEqual(t.state, "ESCALATED")

    def test_stale_review_rejected(self):
        t = self.task(); self.submit(t)
        with self.assertRaises(ValueError): self.review(t, sha="c" * 40)
        self.assertEqual(t.state, "AUDIT")

    def test_wrong_actor_rejected(self):
        t = self.task()
        with self.assertRaises(ValueError):
            t.implementation(actor="openai", head_sha="b" * 40, evidence="synthetic")
        self.submit(t)
        with self.assertRaises(ValueError):
            t.review(actor="claude", head_sha=t.head_sha, verdict="ACCEPT", findings="synthetic")

    def test_bad_identity_or_missing_evidence(self):
        with self.assertRaises(ValueError): Task("fixture", "short")
        t = self.task()
        with self.assertRaises(ValueError):
            t.implementation(actor="claude", head_sha="b" * 40, evidence=" ")

    def test_same_commit_cannot_count_as_correction(self):
        t = self.task(); self.submit(t); self.review(t, "CHANGES")
        with self.assertRaises(ValueError): self.submit(t)

    def test_blocked_escalates_immediately(self):
        t = self.task(); self.submit(t); self.review(t, "BLOCKED")
        self.assertEqual(t.state, "ESCALATED")

    def test_unknown_verdict_and_empty_review(self):
        t = self.task(); self.submit(t)
        with self.assertRaises(ValueError): self.review(t, "MAYBE")
        with self.assertRaises(ValueError):
            t.review(actor="openai", head_sha=t.head_sha, verdict="ACCEPT", findings="")


if __name__ == "__main__":
    unittest.main()
