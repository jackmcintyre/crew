# Story 3.1: Canonical happy-path story

Status: backlog

## Story

As a **fixture story**,
I want **a canonical BMad-shaped file**,
so that **the adapter parses it without any leniency needed**.

## Acceptance Criteria

**AC1 (integration):**
**Given** the adapter scans this file,
**When** `listSourceStories()` runs,
**Then** the story is returned with `ref: "bmad:3.1"` and status `backlog`.

## Dev Notes

Minimal fixture for the happy-path branch of the real-world leniency test.
