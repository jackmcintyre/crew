# Provisional trust (cold-start auto-merge)

`plugin.provisional_trust` is a config flag that lets the auto-merge gate
merge a pull request **with no human in the loop** while the team's agreement
history is still being built up. It exists to solve a cold-start problem: the
normal auto-merge gate needs a window of past reviewer/dev verdicts to judge
whether the team is trustworthy enough to merge automatically. On a brand-new
repo that window is empty, so without this flag *every* PR would pause and wait
for a human — even the safest ones. Provisional trust bootstraps the loop by
letting the lowest-risk changes flow through while that history accrues.

## What it does

When `provisional_trust` is `true`, the auto-merge gate will auto-merge a
**`low`-risk** PR even when the agreement metric is still `null` — that is,
while the agreement window has not yet filled with enough resolved verdict
pairs to compute a meaningful ratio. This spans the whole ramp from zero
history up to a full window, not just the very first PR. The intent is
deliberate: low-risk merges have to flow during the ramp so that agreement
history can build up and the normal threshold gate can eventually take over.

It **defaults to `false`**. With the flag off (the default), a `low`-risk PR
that lacks enough agreement history pauses and waits for a human, just like
every other PR.

## The safety constraint — low-risk PRs only

This is the part that matters most: **provisional trust ONLY relaxes the gate
for `low`-risk PRs.** It changes exactly one outcome — a `low`-risk PR whose
agreement window is still filling. Nothing else.

`medium`-risk, `high`-risk, and untiered PRs **always pause for a human**,
regardless of whether this flag is on or off. The flag cannot and does not
auto-merge them. Concretely:

| Risk tier of the PR        | With `provisional_trust: true` | With `provisional_trust: false` |
|----------------------------|--------------------------------|---------------------------------|
| `low`, history still filling | auto-merges                  | pauses for a human              |
| `medium`                   | pauses for a human             | pauses for a human              |
| `high`                     | pauses for a human             | pauses for a human              |
| untiered (no tier resolved) | pauses for a human            | pauses for a human              |

So the worst the flag can do is auto-merge a change that the risk classifier
has already determined is `low`-risk — typically docs-only or comment-only
changes. (See [`risk-tiering.md`](./risk-tiering.md) for how a PR's risk tier
is decided.) Anything with real blast radius still waits for you.

## How to enable / disable

The flag lives under the `plugin:` block in your repo's `.crew/config.yaml`.

To **enable** it:

```yaml
plugin:
  provisional_trust: true
```

To **disable** it, set it back to `false` (or remove the line entirely — the
default is `false`):

```yaml
plugin:
  provisional_trust: false
```

The flag is **operator-controlled and has no automatic expiry.** It will stay
on until you turn it off yourself — there is no built-in timer or counter that
disables it once enough history exists. You should turn it off once the
agreement window has filled (i.e. the team has accrued enough resolved verdict
pairs for the normal threshold gate to make its own judgement), so that the
real threshold gate takes over and low-risk PRs are once again gated on actual
agreement history rather than on cold-start trust.
