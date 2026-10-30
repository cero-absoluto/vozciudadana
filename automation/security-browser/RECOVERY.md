# S16 — Recovery boundaries and existing evidence

No database restore, deletion, key rotation or automated remediation is authorized by this document. The monitor is read-only and alerts the Owner. A real rollback requires a concrete approved target and scope.

## Application recovery

Known verified baseline before S16: public main 27ba167ff78ff933c701a9152a4977ad0d4b5f66 (S15), API deployment ff874f4a-39be-4fe5-ba1c-fcc25c7756d6, static Pages commit 5008ef372ebade1e9e6a7155c649bfadc748629e. These identifiers describe evidence, not permanent guarantees that the platform retains rollback artifacts.

Before recovery, inspect the current service/project/environment and expected HEAD, preserve the candidate evidence, identify the failing layer, and prepare the exact previous artifact. For an S16-only frontend failure, keep the S15 API and database unchanged. Re-publish the previous verified static tree with a new commit on gh-pages, using a lease on its actual current HEAD; retain history. Then verify Pages success, index and asset hashes, and ordinary public health. Prepare a main-branch correction so a later build does not reintroduce the failed candidate. A return to S15 temporarily removes the S16 CSP; that must remain visible as a security warning rather than being treated as an all-green recovery.

For an API failure, only propose a cached deployment after checking service/environment identity, source, health and canRollback at that time. Do not rebuild an old snapshot lacking the standalone lock under a newly enforced npm ci policy. Do not roll back database ACLs to public grants. Never replace the database to repair a frontend or application deployment.

## Database evidence and limits

The Owner's isolated Windows restoration on 2026-10-28 completed with restoreExit=0, PostgreSQL17.6, and SHA256 7659C448DEE97F6EC5C52AF702A84B0E72802D665C95430625DED8073A544BA9. Its summary explicitly excluded original owners/ACL, Storage objects and Vault decryption. The earlier catalog comparison was not certified. S10/S14 database changes happened later, so this is not proof of a current full-production recovery point.

No new dump, secret or business row is read for S16. Do not label this old rehearsal as a recent verified production backup. A future complete database recovery needs its own current backup, isolated restoration, metadata comparison, permissions/Storage/Vault scope, roll-forward migration plan and Owner authorization. No real production restore is part of this scope.

## Completion criteria

Record the source/target artifacts, scope, authorization, test method and limits. Application rollback rehearsal is evidence for availability of that tested artifact, not a certified RPO/RTO or database recovery. Financial consistency, delivery idempotency, key recovery and X2/I1/X9 remain open. Real OTP remains deferred.
