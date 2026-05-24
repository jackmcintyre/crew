# Story 5.1: Story without a Status line

## Story

As a **fixture story with no Status field**,
I want **the adapter to default my status to `backlog`**,
so that **I land in `to-do/` rather than halting the scan**.

## Acceptance Criteria

**AC1 (integration):**
**Given** this file has no `Status:` line between the H1 and the first section heading,
**When** the adapter parses it,
**Then** `raw_frontmatter.status === "backlog"` and `raw_frontmatter.status_defaulted === true`.

## Dev Notes

Fixture for Story 3.8 AC2: missing-Status default behaviour.
