# Story 3.2: Drifted story with em-dash AC headings

Status: ready-for-dev

## Story

As a plugin operator,
I want a story whose AC headings drift from the canonical `**ACn:**` shape,
So that the LLM fallback can recover it.

## Acceptance Criteria

**AC1 — first thing (integration):**

**Given** the regex parser is invoked,
**When** it fails on the drifted heading,
**Then** the LLM fallback is invoked once and returns a valid `SourceStory`.

**AC2 — second thing:**

**Given** the LLM fallback path,
**When** extraction succeeds,
**Then** the manifest is written to `to-do/` like any other story.

## Dev Notes

This file is intentionally drifted — the AC headings use em-dash and trailing
title text, which the regex parser does not accept. Story 3.9's LLM fallback
recovers it.
