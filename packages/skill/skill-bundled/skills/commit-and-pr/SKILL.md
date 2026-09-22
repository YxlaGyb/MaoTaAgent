---
name: commit-and-pr
description: Prepare and hand over a change: run the project's own checks, inspect what is staged, write a message that explains why, and open a reviewable pull request.
when-to-use: When asked to commit, push, open a pull request, or otherwise hand work over.
---

# Handing over a change

## Run the project's checks

Find out what this project runs before a change is accepted, and run it. Common
places: a task runner script, a CI configuration, a contributing guide. Run the
narrowest useful scope while iterating and the full set before handing over. If a
check fails for a reason unrelated to the change, say so instead of fixing it in
passing.

## Look at what you are about to commit

```
git status --short
git diff
```

Read the diff as a reviewer would. Look for debug output, temporary files,
generated artifacts, credentials, local paths, and unrelated edits that happened
to be in the working tree. An unrelated file committed "because it was there"
costs more to review than to revert.

## The message

One line: imperative mood, scoped to the area, describing what becomes true.

```
fix(parser): reject an unterminated string
feat(cli): add a --json output mode
docs(api): describe the retry limit
```

The body explains why when the subject cannot: what was wrong, what the change
assumes, what a reviewer should verify. Do not describe the file-by-file
mechanics of the diff. No emoji. Keep one logical change per commit, so a revert
reverts one thing.

## The pull request

State what changed, why, how it was verified, and what was deliberately left
out. Name the checks that ran, not the ones that should have run. Note any
follow-up work and any behaviour a reviewer cannot see from the diff: a
migration, a flag, a deployment step.

## Boundaries

Never commit, push, or open a pull request that was not asked for. Never rewrite
published history, force-push a shared branch, or amend someone else's commit
without being asked. Do not commit anything that looks like a secret, and say so
rather than quietly deleting it.
