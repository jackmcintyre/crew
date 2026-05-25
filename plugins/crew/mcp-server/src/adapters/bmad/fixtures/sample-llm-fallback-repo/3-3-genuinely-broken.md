This file is not a BMad story at all.

It has no H1, no `Status:`, no `## Acceptance Criteria` — just random
prose. Both the regex parser AND the LLM fallback should fail to
produce a valid `SourceStory`, and the file should be routed to
`blocked/<ref>.yaml` with `blocked_by: "unparseable"`.

The test mocks the LLM fallback to return non-JSON output for this
file so the integration test does not depend on a live model call.
