# Development agreements

- Use task branches and PRs. Never push directly to the default branch or bypass required checks.
- Preserve uncommitted work. Store enduring decisions in docs and public-safe development state in Issues/PRs. Never include personal data or secrets.
- Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` for behavioral changes.
- Deadline data can change only through explicit confirmation; scheduling and AI must never mutate it. Starting, ending a step, work completion and personal submission confirmation are distinct events.
- Do not send test data to real Push, Calendar or AI services. Fixtures use isolated databases and fake providers.
- Consult `docs/development-workflow.md` for bootstrap status. After three meaningful failed attempts on the same unresolved problem, record evidence in the Issue and mark Blocked, continuing independent work.
