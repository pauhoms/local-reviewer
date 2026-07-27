# Local Reviewer

Local Reviewer is a Tauri 2, React, and TypeScript desktop application for
reviewing Git changes before commit. Its three fixed panels—file tree, diff,
and comments—are operated entirely from the keyboard with Vim-style controls.

The application is read-only. It never changes the repository, Git index, or
working tree.

## Architecture

The IPC boundary is strict:

```text
React (src/)             rendering and keyboard input; no Git or file writes
  └─ src/ipc/client.ts   the only frontend module that calls invoke()
         │ IPC
Rust (src-tauri/src/)    Git access, persistence, and export
```

- Frontend components must not import `@tauri-apps/api`; all system access goes
  through `src/ipc/client.ts`.
- Rust invokes Git only for read operations such as `diff`, `log`, `show`, and
  `rev-parse`.
- Keep the Rust diff model in `src-tauri/src/git/types.rs` and its TypeScript
  mirror in `src/ipc/types.ts` synchronized.

## Keyboard model

Keyboard behavior lives in the pure reducer in `src/keys/machine.ts`.

- Do not add `onKeyDown` handlers to components.
- Define shortcuts as rows in `src/keys/keymap.ts`, not conditional branches.
- Keep the reducer free of DOM access, effects, and `window`.
- Modes are `normal`, `visual`, and `insert`.
- Read burst-sensitive keyboard state synchronously from `state/review.ts`
  through getters, never from a render closure.

## Code conventions

- User-facing text, code, filenames, tests, comments, and commit messages are
  written in English.
- Rust uses edition 2021, `snake_case` functions/modules, and `PascalCase`
  structs.
- Production Rust must not use `unwrap()`, `expect()`, or `panic!()`.
- Convert typed domain errors to serializable `Result<T, String>` only at the
  IPC boundary.
- Keep parsers pure and deterministic.
- TypeScript uses strict mode without `any`; prefer `unknown` plus narrowing.
- Use functional React components, one `PascalCase.tsx` component per file.
- Keep pure logic outside components.
- Do not add a global state library, router, CSS-in-JS, or a CSS framework.
- The application has one dark theme in `src/styles.css`.
- Comments should explain why, not restate what the code does.

## Testing

- Frontend: `npm test`
- Typecheck and web build: `npm run build`
- Fast Rust loop: `cd src-tauri && cargo test --no-default-features`
- Full Rust suite: `cd src-tauri && cargo test`
- Rust formatting: `cd src-tauri && cargo fmt --check`
- Rust linting: `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`

Frontend integration tests render real components and send real keyboard events.
Mock only `src/ipc/client.ts`. Rust Git tests create temporary repositories and
must never touch a real repository.

Tests redirect review storage with `LOCAL_REVIEWER_REVIEWS_DIR`; no test may
write to `~/.codex/reviews/`.

## Persistence

Each review is stored as one JSON file under `~/.codex/reviews/.state/`, unless
`LOCAL_REVIEWER_REVIEWS_DIR` overrides the directory. Writes must remain atomic:
write a temporary file in the same directory, then rename it.
