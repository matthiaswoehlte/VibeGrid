# VibeGrid
## Demo — what it produces

A complete video produced with VibeGrid:

[![VibeGrid Demo Video](https://img.youtube.com/vi/t6KrayvSNlA/maxresdefault.jpg)](https://www.youtube.com/watch?v=t6KrayvSNlA)

This is the real output of the pipeline. The project itself is shelved —
this repo is a snapshot, not a running product. What it's actually about is
the path to that result: the spec-and-review trail under
[`docs/superpowers/plans`](docs/superpowers/plans).


> AI-assisted tool for creating scene and music videos — published here as an
> open working example, not as a product.

VibeGrid was a commercial attempt that was discontinued (too many well-funded
competitors). Rather than letting the code gather dust in a drawer, it's open
here — as a concrete example of a way of working I write about: **AI-assisted
development where quality comes not from reading every line of code, but from
specification, decomposition, and verification.**

Background on the method:
["Why I no longer read the code my AI writes"](https://www.linkedin.com/in/matthias-w%C3%B6hlte-4a7225143/)

---

## Why this repo is public

Discussions of this approach keep raising the same, fair question:
*"Show me the repo — code and tests."*

Here it is. But with a request about the right yardstick.

This repo is **not** evidence of hand-crafted, manually polished lines of code.
That would be contradictory — the whole point of the method is that I precisely
*don't* read the generated code line by line. The right yardstick is a different
one: **How thoroughly is the result verified, and does the system do what it
should?**

So if you're looking for flaky lines, you may well find some. If you want to know
whether a specification- and test-driven process without classic code review
produces robust software, look at the test coverage and the behavior — and that's
exactly what this repo is open for.

---

## What to look at

The evidence lives in the [`tests/`](./tests) directory:

- **236 test files** across three levels:
  - `tests/unit/` — components, renderers, AI schema validation, admin
  - `tests/integration/` — API routes (SceneFlow, TTS, uploads, sessions)
  - `tests/e2e/` — end-to-end flows
- Every run executes **all** tests, including those for earlier features — so
  regressions and side effects surface immediately, not only in review.

Architecture worth skimming:

- [`app/`](./app) — Next.js App Router (studio, auth, API routes, storyboard)
- [`components/`](./components) — UI: timeline, inspector, SceneFlow, studio
- [`db/`](./db) — schema and versioned migrations

---

## Architecture & stack

| Area           | Technology |
|----------------|-------------|
| Framework      | Next.js (App Router), TypeScript |
| Database       | PostgreSQL (versioned migrations in `db/migrations`) |
| Object storage | Cloudflare R2 |
| Video/image AI | fal.ai |
| Image analysis | Anthropic API |
| Speech (TTS)   | ElevenLabs |
| Tests          | Unit · Integration · E2E |

---

## Local setu
