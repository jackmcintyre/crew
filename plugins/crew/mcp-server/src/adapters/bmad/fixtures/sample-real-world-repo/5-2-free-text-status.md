# Story 5.2: Story with a free-text Status value

Status: revised — re-implement per 4.6 retro

## Story

As a **fixture story with an out-of-vocabulary Status**,
I want **the adapter to not throw on my Status line**,
so that **the scan continues and lands me in `blocked/` with a warning**.

## Acceptance Criteria

**AC1 (integration):**
**Given** this file has `Status: revised — re-implement per 4.6 retro`,
**When** the adapter parses it,
**Then** no error is thrown, `raw_frontmatter.status_unknown.raw` equals the original value,
and the scan writes a manifest to `.crew/state/blocked/` with `blocked_by: "status-vocabulary-unknown"`.

## Dev Notes

Fixture for Story 3.8 AC3: unknown-Status leniency.
