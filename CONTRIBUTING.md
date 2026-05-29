# Contributing

Fork the repo, create a branch from `main`, make your changes, open a PR. That's it.
**Branch naming:** `fix/<topic>`, `feat/<topic>`, or `chore/<topic>`.
**Commits:** one logical change per commit, imperative subject line, 72 chars max.
**Tests:** run `npm test` before pushing. Run `npm run test:integration` when you need live OpenViking hook proof.
**Code style:** ESM, no CommonJS. No `execSync` — use `execFileSync` with array args. No hardcoded `/root/` paths — use `OPENVIKING_HOME` env (default `~/.openviking/`). Native `fetch` only, no axios.
**Shared modules** under `shared/` are the single source of truth for all four CLIs. A change there affects Claude Code, Codex, Gemini, and OpenClaw at once — test accordingly.
**PRs:** short description of what changed and why. Link any related issue. One feature or fix per PR.
Questions? Open an issue.
