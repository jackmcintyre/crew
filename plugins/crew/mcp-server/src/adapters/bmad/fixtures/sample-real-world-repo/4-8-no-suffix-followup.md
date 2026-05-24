# Story 4.8: No-suffix companion for sort-order coverage

Status: backlog

## Story

As a **fixture story without a letter suffix**,
I want **to sit in epic 4 alongside the letter-suffixed follow-up**,
so that **the sort comparator's no-suffix-before-letter-suffix branch is exercised**.

## Acceptance Criteria

**AC1 (integration):**
**Given** this file has filename `4-8-no-suffix-followup.md`,
**When** `listSourceStories()` runs,
**Then** this story appears with ref `bmad:4.8` and sorts before the letter-suffixed companion.

## Dev Notes

Fixture added by reviewer feedback on Story 3.8 to give the sort-order test
a no-suffix peer alongside the letter-suffixed story in epic 4.
The no-suffix-before-letter-suffix branch in `index.ts` now has real coverage.
