# Story 3.1: Clean story that parses via regex

Status: ready-for-dev

## Story

As a plugin operator,
I want a happy-path story that parses through the deterministic regex,
So that the LLM fallback is never invoked for it.

## Acceptance Criteria

**AC1 (integration):**

**Given** the regex parser is invoked on this file,
**When** parsing completes,
**Then** a `SourceStory` is returned without any LLM call.

## Dev Notes

Vanilla shape — no drift. Used to assert the LLM mock is not called.
