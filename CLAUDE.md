# CLAUDE.md

Read README.md (rules) and docs/DESIGN.md before changing code. docs/CLUBSPARK.md
holds what is known about the ClubSpark API; update it when something is
confirmed or turns out wrong.

- Before pushing: `pnpm typecheck && pnpm typecheck:tests && pnpm lint && pnpm test`.
- Never disable the workflow determinism lint rules; move the code to an activity.
- Money in domain code is integer pence (`number` is fine at these sizes, but
  never fractional pounds). Convert ClubSpark's decimal pounds at the parser.
- Cloud containers are blocked by ClubSpark's Cloudflare. Do not try to get
  around it. Work from recorded fixtures, and ask the user to run captures at home.
- Never commit captures that have not been redacted, `.env`, cookies or card data.
