---
generated: 2026-07-27
inferred: false
sources:
  AGENTS.md: 5e31fd5a5feb63ef6fc6bb390725784b063b5124ae9dccd16fd9a5ee8c0bc3cf
---

# Rules digest — Local Reviewer

- All repository and user-facing text is written in English.
- Frontend system access goes only through `src/ipc/client.ts`.
- Rust uses Git exclusively for read operations.
- Keep the Rust and TypeScript IPC models synchronized.
- Route all keyboard input through the pure reducer and declarative keymaps.
- Read burst-sensitive keyboard state from the store, not render closures.
- Production Rust contains no `unwrap()`, `expect()`, or `panic!()`.
- Use typed domain errors and serialize them only at the IPC boundary.
- Keep pure parsing and transformation logic outside UI components.
- Review storage is atomic and configurable with `LOCAL_REVIEWER_REVIEWS_DIR`.
- Tests must use temporary repositories and redirected review storage.
