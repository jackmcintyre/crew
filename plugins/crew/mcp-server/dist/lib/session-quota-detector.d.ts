/**
 * Session-quota-exhausted detector — Story 4.12 retro AC6.
 *
 * Scans a subagent's final transcript for Claude session/account-limit
 * strings. Returns `true` when any of the pinned patterns match.
 *
 * Patterns covered (case-insensitive, apostrophe-tolerant):
 *  - "You've hit your session limit"
 *  - "You have hit your session limit"
 *  - "You've hit your account limit"
 *  - "session limit reached"
 */
export declare function detectSessionQuotaExhausted(transcript: string): boolean;
