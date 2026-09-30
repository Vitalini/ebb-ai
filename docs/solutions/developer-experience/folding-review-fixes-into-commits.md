---
title: Folding review fixes back into their owning commit — fixup/autosquash breaks on overlapping lines, rebase -i with edit doesn't
date: 2026-09-30
category: developer-experience
module: development workflow / git history
problem_type: workflow_issue
component: development_workflow
severity: low
applies_when:
  - "A code review (ce-code-review or otherwise) finds issues in a PR built as one commit per logical item, and the fixes need to land in the commit that owns the affected file rather than as new commits"
  - "Two or more review findings touch the same line, or lines close enough that a patch for one overlaps the context of another"
tags: [git, rebase, fixup, autosquash, commit-history, code-review]
---

# Folding review fixes back into their owning commit — fixup/autosquash breaks on overlapping lines, rebase -i with edit doesn't

## Context

PR #37's plan (`docs/plans/2026-09-30-1647-chore-infoq-article-prep-plan.md:104`) specified one commit per brief item and planned to fold any `ce-code-review` findings back into the commit that owns the affected file using `git commit --fixup` plus `GIT_SEQUENCE_EDITOR=: git rebase --autosquash`, explicitly noting "interactive rebase is unavailable." The PR's review pass found 4 majors and 6 minors (PR #37 body, "How verified"), and folding them in required a different mechanism than the one the plan had committed to.

## Guidance

**`git commit --fixup` + autosquash fails when two target commits touch the same line.**

A `--fixup` commit is a patch against the tip of the branch, and `rebase --autosquash` replays it as a patch onto its target commit during the rebase. When two separate review fixes land on the same line (or on lines close enough that the second fixup's patch context no longer matches after the first fixup has already been replayed), the second fixup's patch fails to apply cleanly and the automated `GIT_SEQUENCE_EDITOR=:` rebase stops with a conflict — the exact case the plan's "interactive rebase is unavailable" assumption didn't account for.

**`git rebase -i` with `edit` on the target commit, then `git commit --amend`, works instead.**

```bash
git rebase -i <commit-before-the-target>
# mark the target commit `edit`, save and close
# rebase stops with the target commit checked out
<make the fix directly>
git add <file>
git commit --amend --no-edit
git rebase --continue
```

This worked despite the plan's stated assumption, evidenced by this branch's reflog showing two `rebase (finish)` entries (`git reflog show <branch>`) rather than any fixup/autosquash commits. Because the fix is applied directly to the commit's working tree instead of being replayed as a separately-generated patch, it never hits the "patch no longer applies because an earlier fixup already changed this line" failure mode that stops autosquash.

**Any doc that quotes a commit hash from this branch needs updating after the rewrite, or should name commits by subject instead.**

`git rebase -i ... --amend` or `git commit --amend` after rewriting the branch produced two `rebase (finish)` entries), so a hash captured before the rewrite is no longer reachable on the branch. This branch avoided the problem by not citing commit hashes in its own docs (`docs/article-notes.md`, the plan, `docs/claims.md` — none quote a SHA); the PR body's "What" section names commits by subject line instead of hash. That's the generalizable rule: a commit hash written into a doc or PR description on a branch that might still be rebased is a landmine — cite the subject line instead, or expect to update the hash after any rewrite.

## Why This Matters

The plan's stated workaround (`--fixup` + automated `--autosquash`) is the right choice when it works, because it needs no interactive step and is safe to script. But it silently assumes no two fixes overlap, and when that assumption breaks, the automated rebase just stops mid-sequence with a conflict — a state that's confusing to land in if `rebase -i` was believed to be "unavailable." Knowing the fallback (`edit` + `amend`) in advance turns that stop into a two-command recovery instead of a debugging session about why the automation broke.

## When to Apply

- Folding `ce-code-review` (or any review) findings back into per-item commits on a branch that isn't merged yet.
- Specifically once a `--fixup`/`--autosquash` attempt fails to apply — reach for `rebase -i` with `edit` rather than trying to hand-resolve the autosquash conflict.
- Before writing a commit hash into a plan, PR description, or doc on a branch whose history might still be rewritten.

## Examples

```bash
# This fails when an earlier fixup already touched the same line:
git commit --fixup=<target-sha>
GIT_SEQUENCE_EDITOR=: git rebase --autosquash <base>
# -> CONFLICT: patch does not apply

# This doesn't:
git rebase -i <base>            # mark <target-sha> as `edit`
# ...fix the file directly...
git add <file> && git commit --amend --no-edit
git rebase --continue
```

## Related

- `docs/plans/2026-09-30-1647-chore-infoq-article-prep-plan.md:104` — the plan's original (incomplete) assumption about interactive rebase being unavailable.
- PR #37 body, "How verified" — "`ce-code-review`: 0 blockers; 4 majors and 6 minors fixed and folded into their commits."
