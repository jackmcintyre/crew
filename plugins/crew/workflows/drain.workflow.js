export const meta = {
  name: 'crew-drain',
  description:
    'Stage-1 stateless drain: a serial per-story loop (claim -> dev -> review -> verdict -> auto-merge gate) driven entirely through one-shot CLI seams — NO persistent MCP server on the drain path, so the cascade-SIGTERM disconnect cannot occur by construction. Story 8.5.',
  phases: [
    { title: 'drain', detail: 'serial per story: claim -> dev (worktree) -> processDevTranscript -> review -> processReviewerTranscript -> (rework) -> auto-merge gate' },
  ],
}

// ---------------------------------------------------------------------------
// Args. The Workflow runtime delivers `args` as a JSON STRING — parse defensively.
//   targetRepoRoot : absolute path to the target repo (the repo being built)
//   cli            : absolute path to the plugin's `mcp-server/dist/cli.js`
//                    (the stateless seam transport; lives in the PLUGIN, not the target)
//   sessionUlid    : (optional) launcher-minted id — pass it for journal-stable resume;
//                    omitted → minted in-script for a standalone run
//   maxStories     : story-count budget (clocks unavailable; we count stories). Default 1 (v1).
//   maxRework      : per-story NEEDS-CHANGES rework cap. Default 2.
// ---------------------------------------------------------------------------
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const REPO = A.targetRepoRoot || A.repo
const CLI = A.cli
const MAX = A.maxStories || 1
const MAX_REWORK = A.maxRework || 2

const HANDOFF = (ref) => `Handoff to reviewer — story ${ref} ready for review.`

// Clamp a seam-agent's output to a single stdout string: the courier cannot
// "decide" — the tool already decided, and the script switches on the parse.
const RawSchema = { type: 'object', additionalProperties: false, properties: { stdout: { type: 'string' } }, required: ['stdout'] }
const safeParse = (s) => { try { return JSON.parse(String(s).trim()) } catch (e) { return { _parseError: String(e), raw: String(s).slice(0, 400) } } }
const J = (o) => JSON.stringify(o)

// A SEAM: a cheap one-shot courier (haiku) that runs ONE CLI command verbatim
// and returns its single JSON line. This is the deterministic-seam discipline —
// every load-bearing decision is a tool call, never script JS and never agent prose.
const seam = async (cmd, label) => {
  const r = await agent(
    `You are a deterministic command runner. Use the Bash tool to execute the command below EXACTLY as written. ` +
      `Hard rules: do NOT modify the command, do NOT change or "correct" any path, do NOT cd, do NOT read files, do NOT run anything else. ` +
      `It prints exactly one line of JSON to stdout — return that line verbatim in the "stdout" field.\n\nCOMMAND:\n${cmd}`,
    { schema: RawSchema, label, phase: 'drain', model: 'haiku' },
  )
  return r ? safeParse(r.stdout) : { _parseError: 'agent-null' }
}

phase('drain')
if (!REPO || !CLI) return { error: 'missing-args', need: ['targetRepoRoot', 'cli'], got: Object.keys(A) }

// Session id: prefer the launcher-minted id (Layer-1 journal stability across
// resume); fall back to minting one via the CLI for a standalone run.
const SU = A.sessionUlid || (await seam(`node ${CLI} mintSessionUlid`, 'mint')).sessionUlid
if (!SU) return { error: 'no-session-ulid' }
log(`drain session=${SU} repo=${REPO} maxStories=${MAX} maxRework=${MAX_REWORK}`)

// Persona system prompts — these carry the evidence-only discipline (Story 8.3):
// agents produce code / a PR / a transcript; the TOOLS own the backlog ledger.
const devPersona = (await seam(`node ${CLI} buildPersonaSpawnPrompt --json '${J({ targetRepoRoot: REPO, role: 'generalist-dev' })}'`, 'persona:dev'))?.systemPrompt || ''

const completed = [], merged = [], pausedForHuman = [], blocked = []
let drainedReason = 'budget-exhausted'

for (let i = 0; i < MAX; i++) {
  // CLAIM — atomic to-do -> in-progress; deps satisfied from done/ only.
  const claim = await seam(`node ${CLI} claimNextStory --json '${J({ targetRepoRoot: REPO, sessionUlid: SU })}'`, `claim:${i}`)
  if (!claim || claim.next !== 'spawn-dev') { drainedReason = claim?.next || claim?._parseError || 'claim-failed'; break }
  const { ref, title, manifestPath } = claim
  log(`claimed ${ref} — ${title}`)

  let verdict = null, prNumber = null

  for (let rw = 0; rw < MAX_REWORK; rw++) {
    // DEV — persona prompt (judgment + evidence-only discipline) in its OWN worktree.
    // It implements against the manifest's ACs, then opens the PR by running the
    // crew terminal action through the one-shot CLI (no MCP server). The PR number
    // is transported via dev-outcome.json (machine-authoritative), not chat.
    const reworkNote = rw === 0 ? '' :
      `\n\nThis is rework iteration ${rw}: address the reviewer's NEEDS CHANGES feedback on the existing PR (read .crew/state for the recorded verdict), push the fixes, and hand off again.`
    const devFinal = await agent(
      `${devPersona}\n\n## This run (story ${ref})\n` +
        `- targetRepoRoot: ${REPO}\n- ref: ${ref}\n- title: "${title}"\n- sessionUlid: ${SU}\n- manifestPath: ${manifestPath}\n\n` +
        `Read the execution manifest at \`${manifestPath}\` — it identifies the source story and its acceptance criteria. ` +
        `Implement the story end-to-end in THIS worktree: write real code and tests, and run the project's build/test gates GREEN before opening the PR. ` +
        `Do NOT gold-plate; do NOT touch the execution manifest or any \`.crew/state\` file (the tools own the ledger).\n\n` +
        `To commit, push, and open the PR, run EXACTLY this (do not alter the path); fill \`body\` and \`summary\` with a real description of your change:\n` +
        `  node ${CLI} runDevTerminalAction --json '${J({ targetRepoRoot: REPO, ref, title, type: 'feat', manifestPath, sessionUlid: SU, body: '<one-paragraph body>', summary: '<one-line summary>' })}'\n` +
        `Confirm it prints "ok":true and a "prUrl". If it prints an "error", or any crew tool raises GhRecoverableError, emit the verbatim \`gh-recoverable: ...\` line as your LAST line and stop — do NOT emit the handoff phrase.${reworkNote}\n\n` +
        `Otherwise, end your final message with EXACTLY this line and nothing after it:\n${HANDOFF(ref)}`,
      { label: `dev:${ref}:${rw}`, phase: 'drain', isolation: 'worktree' },
    )

    // Evidence check (in-script, cheap): the dev must have genuinely handed off.
    // We do NOT fabricate a handoff — if the real transcript lacks the locked
    // phrase, the dev did not finish cleanly; block rather than fake success.
    const devText = String(devFinal || '')
    if (!devText.includes(HANDOFF(ref))) {
      blocked.push({ ref, blocked_by: 'dev-no-handoff', tail: devText.slice(-300) })
      break
    }

    // PARSE DEV — locked-grammar handoff parse + prNumber from dev-outcome.json.
    // The handoff line is the only transcript content processDevTranscript parses
    // for routing; prNumber comes from the machine-written outcome file. Feeding
    // the canonical (verified-present) handoff keeps the seam's shell arg safe.
    const pd = await seam(`node ${CLI} processDevTranscript --json '${J({ targetRepoRoot: REPO, sessionUlid: SU, ref, devTranscript: HANDOFF(ref) })}'`, `pd:${ref}:${rw}`)
    if (!pd || pd.next !== 'spawn-reviewer') { blocked.push({ ref, blocked_by: pd?.next || pd?._parseError || 'pd-failed' }); break }
    prNumber = pd.prNumber
    log(`${ref} -> PR #${prNumber}`)

    // REVIEW — clean context. The reviewer's binding verdict transports through
    // the reviewer-result FILE that runReviewerSession writes (never chat). Its
    // prompt comes from processDevTranscript; we add the one-shot CLI invocation.
    await agent(
      `${pd.reviewerPrompt}\n\n## How to run the review in this stateless run\n` +
        `Your FIRST and only mandatory action is to run EXACTLY this command (do not alter the path); it performs the three mandatory reads and writes the binding verdict to reviewer-result.json:\n` +
        `  node ${CLI} runReviewerSession --json '${J({ targetRepoRoot: REPO, sessionUlid: SU, ref, prNumber, role: 'generalist-reviewer' })}'\n` +
        `Then summarise the result it prints for the operator. Do NOT merge, push, edit the PR, or write any \`.crew/state\` file yourself — runReviewerSession owns the verdict file.`,
      { label: `rev:${ref}:${rw}`, phase: 'drain' },
    )

    // VERDICT — derived from the reviewer-result FILE; on green, completeStory
    // runs inside processReviewerTranscript (atomic in-progress -> done).
    verdict = await seam(`node ${CLI} processReviewerTranscript --json '${J({ targetRepoRoot: REPO, sessionUlid: SU, ref, manifestPath })}'`, `verdict:${ref}:${rw}`)
    const v = verdict?.next
    log(`${ref} verdict -> ${v}`)
    if (v === 'done-ready-for-merge') break
    if (v === 'done-blocked-reviewer-needs-changes') continue // rework
    blocked.push({ ref, blocked_by: v || verdict?._parseError || 'verdict-failed' }); break
  }

  // GATE — only on a green verdict. risk-tier x agreement x threshold; the tool
  // performs the merge or applies the needs-human label. Stage-1 expects
  // pause-needs-human (no agreement history yet) -> a human merges.
  if (verdict?.next === 'done-ready-for-merge') {
    completed.push(ref)
    const gate = await seam(`node ${CLI} runAutoMergeGate --json '${J({ targetRepoRoot: REPO, prNumber, ref, sessionUlid: SU })}'`, `gate:${ref}`)
    if (gate?.decision === 'auto-merge') merged.push({ ref, prNumber })
    else pausedForHuman.push({ ref, prNumber, reason: gate?.reason || gate?.decision || gate?._parseError || 'gate-failed' })
  }
}

// The return object IS the no-silent-failures surface: every ref lands in exactly
// one of completed / merged / pausedForHuman / blocked, with a drain reason.
return {
  sessionUlid: SU,
  drainedReason,
  drained: drainedReason !== 'budget-exhausted',
  completed,
  merged,
  pausedForHuman,
  blocked,
}
