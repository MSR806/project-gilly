# Contributing

Project Gilly is in active development. Small, focused pull requests are easiest
to review while the architecture is still settling.

## Setup

```bash
bun install
bun run typecheck
bun test
```

For local services, copy the app `.env.example` files described in the README.
Do not commit secrets, local databases, or generated runtime data.

## Pull requests

- Open an issue first for large changes or new public APIs.
- Keep changes scoped to one problem.
- Add or update tests when behavior changes.
- Run `bun run typecheck` and `bun test` before requesting review.
- Document user-facing behavior in `README.md` or `docs/` when needed.

## Development status

This project is not API-stable yet. Maintainers may rename packages, move modules,
or revise contracts while the MVP is being built.
