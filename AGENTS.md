# Development agreements

- Use task branches and PRs. Never push directly to the default branch or bypass required checks.
- Preserve uncommitted work. Store enduring decisions in docs and public-safe development state in Issues/PRs. Never include personal data or secrets.
- Choose local checks by affected area: `npm run lint` and `npm run typecheck` for TypeScript; `npm test` for server or domain logic; `npm run build` for production-bundle or build-configuration changes; `npm run test:e2e` for browser-visible behavior. For documentation-only changes, inspect the diff and verify referenced links and commands. Before merge, the complete required CI suite must pass; never bypass it.
- Deadline data can change only through explicit confirmation; scheduling and AI must never mutate it. Starting, ending a step, work completion and personal submission confirmation are distinct events.
- Do not send test data to real Push, Calendar or AI services. Fixtures use isolated databases and fake providers.
- Consult `docs/development-workflow.md` for bootstrap status. After three meaningful failed attempts on the same unresolved problem, record evidence in the Issue and mark Blocked, continuing independent work.
