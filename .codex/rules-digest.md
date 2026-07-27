---
generated: 2026-07-26
inferred: false
sources:
  AGENTS.md: 03c053179a6eb0553ad32ff6df0bc01b03111c9b71664ab55606a46ec3d8f8d4
---

# Rules digest — reviewv4

## Naming y estructura
- Ningún módulo de `src/` importa `@tauri-apps/api`: todo acceso al sistema pasa por `src/ipc/client.ts`, el único que usa `invoke()`.
- Los `#[tauri::command]` viven solo en `commands.rs` y son cáscara fina; la lógica está en `git/`, `review/`, `export.rs`.
- `src-tauri/src/git/types.rs` y su espejo `src/ipc/types.ts` se cambian juntos o ninguno.
- Prohibido `onKeyDown` en componentes React: todo teclado pasa por el reducer `src/keys/machine.ts`. Un atajo nuevo es una fila en `src/keys/keymap.ts`, no un `if`.
- `keys/machine.ts` es puro: sin DOM, sin efectos, sin `window`.
- Lo que el teclado lee se lee del store de forma síncrona, nunca del closure de un render: si un comando cambia lo que otro lee, ese estado va a `state/review.ts` y llega a los keymaps por getter (una ráfaga de auto-repeat llega antes de que React re-renderice).
- Lógica pura fuera de los componentes (`tree/build-tree.ts`, `diff/split-rows.ts`, `keys/machine.ts`); los componentes solo pintan lo que devuelven.
- Un componente por fichero, funcional, `PascalCase.tsx`. Sin clases.
- Rust: `snake_case` para funciones/módulos, `PascalCase` para structs; serde con `#[serde(rename_all = "camelCase")]`.
- Sin librerías de estado global ni routing; sin CSS-in-JS ni frameworks CSS — un solo `src/styles.css` con variables. Tema oscuro único, sin toggle.

## Idioma
- Texto visible al usuario en **español** (etiquetas, errores de UI, estados vacíos, ayudas de teclado).
- Código en **inglés**: identificadores, ficheros, nombres de test, comentarios, mensajes de commit.

## Errores y logging
- Cero `unwrap()`/`expect()`/`panic!()` en producción Rust; todo error se propaga como `Result<T, E>` tipado. En tests, libres.
- Errores tipados por dominio (`GitError { NotAGitRepo, PathOutsideHome, BadRef, … }`); la conversión a `Result<T, String>` ocurre solo en el borde IPC.
- El parser no hace I/O: entra texto, sale modelo, determinista.

## Patrones del repo
- La app **solo lee**: `git` se invoca únicamente en modo lectura (`diff`, `log`, `show`, `rev-parse`); nunca `add`/`commit`/`checkout` ni escritura en el repo revisado.
- Persistencia por escritura **atómica**: fichero temporal en el mismo directorio + `rename`. Sin BD ni migraciones.
- Directorio de estado/export configurable con `REVIEWV4_REVIEWS_DIR`; ningún test escribe en `~/.codex/reviews/`.
- TS `strict`: sin `any` (usar `unknown` + narrowing), sin `as` salvo en el borde IPC y en tests.

## Tests
- Tests de git en Rust crean un repo temporal con `tests/helpers/git_fixture.rs` (`tempfile` + `git init`); nunca tocan un repo real. Bucle rápido: `cargo test --no-default-features` (sin webview); el completo antes de cerrar fase.
- Los tests de integración del front renderizan componentes reales y disparan teclado real (`userEvent.keyboard`), nunca llaman al reducer a mano.
- `src/ipc/client.ts` se mockea con `tests/helpers/ipc-mock.ts`; ningún test invoca IPC de verdad.
- Se assertea comportamiento observable, no estado interno.

## Comentarios
- Comentarios al mínimo y solo el **por qué**, nunca el **qué**. Sin comentarios de sección (`// ---- helpers ----`) ni JSDoc que repita la firma.
