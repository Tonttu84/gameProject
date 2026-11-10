# History of the working rules

Where the rules in `AGENTS.md` came from. `AGENTS.md` states the current rules only; the
incidents and dated instructions behind them live here. The campaign layer's own design history
stays in `docs/CAMPAIGN_PLAN.md`.

## 2026-11-10: moved onto the shared ai-workflow rules

`CLAUDE.md` was the project rulebook until 2026-11-10. It became the one line `@AGENTS.md`, and
`AGENTS.md` took over the still-true project rules. The rules the shared working agreements now
cover were dropped from the project file (see `docs/decisions.md`, D1 to D3):

- **Grill before you build.** The project vendored `grill-me` and `grilling` under
  `.claude/skills/` so the skill fired proactively, and CI ran `scripts/check_claude_skills.sh`
  to prove the copies survived a fresh clone (the blanket `.claude/*` ignore had once swallowed
  them). The skill is now installed once at user level from ai-workflow, so the copies, the
  check and its CI job were removed.
- **Plan with Fable, code with an Opus subagent** (user, 2026-08-28). The planning model did the
  design work and handed code-writing to a subagent with `model: "opus"` and a complete spec,
  then reviewed the diff, ran the suites and shipped itself. The shared rules keep the split
  but leave the subagent's model at the user-settings default; the spec conventions moved to
  `AGENTS.md` ("Writing a brief").
- **Which model codes** (user, 2026-09-04 and 2026-09-06): Opus (`model: "opus"`) by default,
  Fable (`model: "fable"`) for a genuinely hard slice, and Fable could write a hard slice itself
  in the planning session when a hand-off cost more than it saved (AI-2 was built that way, by
  the user's leave). The shared rules leave the default model unset and escalate a hard task to
  Opus or Fable at high effort with an explanation; `AGENTS.md` keeps the project's definition
  of a hard slice.
- **Slicing is the assistant's call** (user, 2026-09-06: *"dont ask me about slices anymore"*).
  Still true, kept in `AGENTS.md`.
- **Shipping** (user, 2026-08-10): "once a feature is COMPLETE and CI is green, merge it to
  `main` yourself", no PR unless asked. This is the shared rules' solo kind. The "CI green on
  the pushed commit" part stays in `AGENTS.md`, because the sanitized engine suite runs only
  in CI.
- **`main` in web sessions** (user, 2026-08-24): *"just use main, I dont understand why this
  chat always wants to switch the branch"*. Web sessions arrive with a harness-injected
  instruction naming a `claude/...` branch; it comes from the session's branch field, not
  from the user or this repo. Still true, kept in `AGENTS.md`.

## 2026-08-20: a commit landed on the wrong branch

A clear-and-resume kept the conversation's memory of the branch but not the checkout. A commit
meant for a feature branch landed on local `main`; the push then reported "Everything
up-to-date" and looked like a success. Since then: check the branch
(`git rev-parse --abbrev-ref HEAD`) before the first commit of a session or after a `/clear`.
The shared rules now say the same.

## 2026-08-18: fast local tests, sanitized CI

`./run_tests_fast` took about 3 s against `./run_tests`'s 115 s for the same 361 cases, so the
local loop moved to `make test-fast` and the sanitized build became CI's job. That was only safe
once CI caught all three sanitizer kinds: UBSan recovers by default, printing
`runtime error: ...` and exiting 0, so undefined behaviour reached a CI log while the job went
green. `-fno-sanitize-recover=undefined` in `CFLAGS` fixed that.

## 2026-08-29: the architecture section was rewritten

The architecture notes described a "placeholder React app" for many stages after the campaign
layer was real, and `ARCHITECTURE.md` had rotted back to the pre-hex, pre-magic engine. Both
were rewritten against the real system on 2026-08-29.

## 2026-07-08: `scripts/dev.sh`

Claude Code's permission engine splits a command on shell operators and is not quote-aware, so
any `&&`, `|` or `;` inside `wsl -e bash -lc '...'` forced a prompt. `scripts/dev.sh` keeps the
operators inside the script, so each task is one fixed command line that one exact allow rule
covers.
