# reviewv4 — AI Code Reviewer

Aplicación de escritorio local (Tauri 2 + React + TypeScript) para revisar a mano
código generado por IA antes del commit. Tres paneles fijos —árbol · diff ·
comentarios— manejados enteramente con el teclado, con la memoria muscular de Vim.

La herramienta **solo lee**: nunca commitea, nunca toca el índice de git, nunca
modifica el código revisado. No es un editor.

## Arquitectura — la frontera dura es el comando IPC

```
React (src/)          render + teclado. Nunca invoca git ni escribe ficheros.
  └─ src/ipc/client.ts   ÚNICO módulo que conoce invoke()
         │ IPC
Rust (src-tauri/src/) todo lo que toca el sistema: git, persistencia, export.
```

Reglas que se derivan de eso y no se negocian:

- Ningún componente de `src/` importa `@tauri-apps/api`. Si necesita algo del
  sistema, pasa por `src/ipc/client.ts`. Es también el único módulo que se
  mockea en los tests del front.
- Ningún módulo de Rust escribe en el repo revisado. `git` se invoca siempre en
  modo lectura (`diff`, `log`, `show`, `rev-parse`), nunca `add`/`commit`/`checkout`.
- El modelo de diff (`FileDiff → Hunk → Line`) se define en `src-tauri/src/git/types.rs`
  y su espejo TS en `src/ipc/types.ts`. Los dos se cambian juntos o ninguno.

## El teclado es el núcleo

Una sola máquina de teclado, reducer puro en `src/keys/machine.ts`:
`(estado, tecla) → estado + comandos`.

- **Prohibido** `onKeyDown` en componentes. Todo pasa por el reducer.
- Los atajos son filas en las tablas de `src/keys/keymap.ts`, no `if`s.
- El reducer es puro: sin DOM, sin efectos, sin `window`. Se testea sin render.
- Modos `normal` / `visual` / `insert`. En `insert` el reducer no emite comandos
  de movimiento ni de creación: el texto llega al campo y solo `Esc` sale.
- El panel activo es estado aparte: cambiar de panel no altera el modo ni los
  cursores de los demás paneles.
- **Lo que el teclado lee se lee del store, no del closure de un render.** Si un
  comando cambia lo que otro comando lee —plegar cambia las filas, cambiar de
  fichero cambia las líneas—, ese estado vive en `state/review.ts` y llega a los
  keymaps por *getter*. Una ráfaga de teclas (auto-repeat) llega entera antes de
  que React re-renderice.

## Convenciones de código

### Idioma
- **Texto visible al usuario: español.** Etiquetas, mensajes de error de la UI,
  estados vacíos, ayudas de teclado.
- **Código en inglés**: identificadores, nombres de fichero, nombres de test,
  comentarios de código, mensajes de commit.

### Rust (`src-tauri/`)
- Edición 2021. `cargo clippy` en limpio antes de cerrar una fase; sin `#[allow]`
  salvo justificación en el sitio.
- **Cero `unwrap()`/`expect()`/`panic!()` en código de producción.** Todo error
  se propaga como `Result<T, E>` con un error tipado. En tests, libres.
- Errores tipados por dominio (`GitError { NotAGitRepo, PathOutsideHome, BadRef, … }`),
  con `thiserror` o `impl Display`; los comandos IPC los convierten a `Result<T, String>`
  serializable en el borde, no antes.
- Los comandos `#[tauri::command]` viven solo en `commands.rs`: son cáscara fina,
  la lógica está en los módulos de `git/`, `review/`, `export.rs`.
- Lógica de parseo pura y determinista: entra texto, sale modelo. Nada de I/O
  dentro del parser.
- Nombres: `snake_case`, structs `PascalCase`. Serde con
  `#[serde(rename_all = "camelCase")]` para que el espejo TS sea natural.

### TypeScript (`src/`)
- `strict: true`. Sin `any` (`unknown` + narrowing si hace falta), sin `as`
  salvo en el borde del IPC y en tests.
- Componentes funcionales, sin clases. Un componente por fichero, `PascalCase.tsx`.
- Lógica pura fuera de los componentes: `tree/build-tree.ts`, `diff/split-rows.ts`,
  `keys/machine.ts`. Los componentes solo pintan lo que esas funciones devuelven.
- Sin librerías de estado global ni de routing. El store es un módulo con
  `useSyncExternalStore` o un contexto; nada más.
- Sin CSS-in-JS ni frameworks de CSS: un único `src/styles.css` con variables de
  tema y clases. Tema **oscuro único**, sin toggle.

### Comentarios
Los mínimos. Un comentario explica **por qué**, nunca **qué** — si hace falta
explicar el qué, el código está mal escrito. Nada de comentarios de sección tipo
`// ---- helpers ----`, ni JSDoc de relleno que repita la firma.

## Tests

- **Rust**: `cd src-tauri && cargo test`. Las deps de Tauri viven tras la feature
  `app` (activada por defecto), así que `cargo test --no-default-features`
  ejercita `git/`, `review/` y `export.rs` sin compilar el webview: es el bucle
  rápido. El completo se corre antes de cerrar fase.
  Los tests de integración viven en
  `src-tauri/tests/`. Todo test de git crea un **repo temporal** con
  `tests/helpers/git_fixture.rs` (`tempfile` + `git init`): **nunca** se toca un
  repo real ni el propio repo del proyecto.
- **Front**: `npm test` (Vitest en jsdom + `@testing-library/react`).
  - Los tests de integración renderizan los componentes reales y disparan
    **eventos de teclado reales** (`userEvent.keyboard`), no llaman al reducer a mano.
  - `src/ipc/client.ts` se mockea con `tests/helpers/ipc-mock.ts`; ningún test
    invoca IPC de verdad.
  - Se assertea comportamiento observable (lo que ve el usuario), no estado interno.
- **Typecheck**: `npx tsc --noEmit` y `cargo clippy` limpios antes de cerrar fase.
- Los directorios de estado y export en tests se redirigen con la variable de
  entorno `REVIEWV4_REVIEWS_DIR`: ningún test escribe en `~/.codex/reviews/`.

## Persistencia

Un JSON por revisión en `~/.codex/reviews/.state/` (override:
`REVIEWV4_REVIEWS_DIR`). Escritura **atómica**: fichero temporal en el mismo
directorio + `rename`. Sin base de datos y sin migraciones de esquema.

## Comandos

```
npm run dev            # vite dev server
npm run tauri dev      # app en modo desarrollo
npm run tauri build    # binario de release
npm test               # vitest
npx tsc --noEmit       # typecheck del front
cd src-tauri && cargo test     # tests de Rust
cd src-tauri && cargo clippy   # lints de Rust
```
