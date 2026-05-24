# Story 4.8b: Follow-up story with letter-suffixed ID

Status: backlog

## Story

As a **fixture story with a letter-suffixed ID**,
I want **the adapter to parse my filename correctly**,
so that **I appear in the scan results with my full suffixed reference**.

## Acceptance Criteria

**AC1 (integration):**
**Given** this file has filename `4-8b-follow-up-story.md`,
**When** `listSourceStories()` runs,
**Then** this story is returned with a suffixed ref and a suffixed id in raw_frontmatter.

## Dev Notes

Fixture for Story 3.8 AC1: letter-suffix tolerance.
