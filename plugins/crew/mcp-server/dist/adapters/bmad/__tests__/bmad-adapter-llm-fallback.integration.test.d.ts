/**
 * Integration test for the BMad adapter's LLM-fallback extraction path
 * (Story 3.9). Three fixture stories under
 * `fixtures/sample-llm-fallback-repo/`:
 *
 *   - `3-1-clean-story.md`        — parses via regex; LLM mock NOT called.
 *   - `3-2-drifted-em-dash-acs.md` — regex fails, LLM fallback returns a
 *                                    valid `SourceStory`; manifest written
 *                                    to `to-do/`.
 *   - `3-3-genuinely-broken.md`   — regex fails, LLM mock returns garbage;
 *                                    routed to `blocked/` with
 *                                    `blocked_by: "unparseable"`.
 *
 * The Anthropic SDK is mocked via the `getAnthropicClient` seam in
 * `src/lib/anthropic-client.ts` — no live API calls.
 */
export {};
