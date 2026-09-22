---
name: debug-repro
description: Diagnose a failure methodically: reproduce it, shrink it, locate the layer that lies, read the real error, and confirm the fix against the original case.
when-to-use: When something fails and the cause is not obvious from reading the code, in any language or project.
---

# Debugging a failure

## Reproduce first

Get a case that fails on demand, and keep it. Everything after this depends on
being able to tell whether a change helped. If the failure is intermittent,
first find the condition that makes it certain: timing, ordering, a seed, a
specific input, or accumulated state.

## Shrink it

Remove everything the failure does not need: other modules, network calls, file
system state, extra data. A minimal case usually reveals the cause on its own,
and it becomes the regression test when you are done.

## Find the layer that lies

The symptom is almost never where the defect is. Walk the path from the input to
the symptom and find the first place where what you expected and what is there
diverge. Useful questions:

- Is the value wrong at the boundary, or does it become wrong later?
- Does the code that produced it know something the caller does not? A cache, a
  default, a fallback, an earlier failed attempt.
- Is this the first time this path ran, or has earlier state changed the result?
- Does it fail only under a build, a different platform, a different locale, or
  a different environment variable?

## Read the error, not your assumption about it

Copy the actual message and the top frame of the stack. A wrapped error often
carries the original cause underneath it. A generic message with no cause is
itself a defect worth reporting.

## Change one thing at a time

Keep a log of what you changed and what happened. A debugger plus a watch
expression beats print statements; a print at the boundary beats one deep inside
the logic. When you add temporary instrumentation, remove it before finishing.

## Prove the fix

Re-run the original failing case, then the small one, then the wider suite. If
the fix is a guess that happened to work, say so; the next occurrence will be
just as mysterious. Add the case to the tests, and note in the message what the
cause was, because the next reader will wonder the same thing.
