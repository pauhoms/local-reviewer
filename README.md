# AI Code Reviewer

Aplicación de escritorio local para revisar a mano el código que escribió la IA,
antes del commit. Tres paneles fijos —árbol · diff · comentarios— manejados
enteramente con el teclado, con la memoria muscular de Vim.

## La filosofía

La IA escribe, el humano revisa. El agente produce código más rápido de lo que
nadie lo lee, y el commit sin leer es donde se cuela lo que después cuesta caro.
Esta herramienta existe para que leerlo sea barato: abrir el repo, recorrer el
diff sin soltar el teclado, anotar lo que no convence y devolverle a la IA una
lista de correcciones concreta, con fichero y líneas.

Por eso la herramienta **solo lee**: nunca commitea, nunca toca el índice de
git, nunca modifica el código revisado. No es un editor. Lo único que escribe
son tus comentarios y el Markdown que exportas, y siempre en `~/.codex/reviews/`.

## Instalación

Hace falta el binario de release construido:

```
npm install
npm run tauri build          # deja src-tauri/target/release/reviewv4
./deploy/install.sh
```

`deploy/install.sh` copia ese binario como `reviewer` y deja la entrada de
escritorio junto a él:

```
$ ./deploy/install.sh
  ✓ binario     ~/.local/bin/reviewer
  ✓ escritorio  ~/.local/share/applications/reviewer.desktop
  ✓ icono       ~/.local/share/icons/hicolor/128x128/apps/reviewer.png
  ✓ ~/.local/bin ya está en el PATH
```

| Opción | Qué hace |
| --- | --- |
| `--prefix <dir>` | instala bajo otro prefijo; por defecto `~/.local` |
| `--dry-run` | dice lo que escribiría y no escribe nada |
| `--help`, `-h` | muestra la ayuda del instalador |

Con un `--prefix` que no sea `~/.local`, el escritorio **no encontrará el
icono** salvo que ese `share` esté en `XDG_DATA_DIRS`. La entrada se instala y
se lanza igual; solo sale sin icono. Para que lo encuentre:

```
export XDG_DATA_DIRS="<dir>/share:$XDG_DATA_DIRS"
```

Si `~/.local/bin` no está en tu `PATH`, el instalador **avisa y no lo arregla
por su cuenta**: no toca los ficheros de arranque de tu shell. Añádelo tú:

```
export PATH="$HOME/.local/bin:$PATH"
```

Para deshacerlo, `./deploy/uninstall.sh` (acepta el mismo `--prefix` y el mismo
`--dry-run`). Borra el lanzador, la entrada de escritorio y el icono; nada más.

## Uso

```
reviewer [<commit>|<a>..<b>]
  sin argumentos   revisa los cambios sin commitear del repo actual
  <commit>         revisa un commit concreto
  <a>..<b>         revisa el acumulado de un rango de commits
  --help, -h       muestra esta ayuda
  (fuera de un repo git, abre la pantalla de selección)
```

```
cd ~/mi-repo
reviewer                     # los cambios que la IA acaba de dejar sin commitear
reviewer HEAD                # el último commit
reviewer main..HEAD          # todo lo que trae la rama
```

Lanzado fuera de un repo git —o desde el menú del escritorio— abre la pantalla
de selección: repos recientes, un explorador de directorios y el ámbito a
revisar (cambios sin commitear, un commit o un rango).

## Los tres paneles

`1` el árbol de ficheros, `2` el diff, `3` los comentarios. El panel activo es
independiente del modo: cambiar de panel no mueve los cursores de los demás.

El diff se lee unificado o partido (`Ctrl+w v` / `Ctrl+w o`); en el partido,
`h` y `l` cambian de columna. Se comenta marcando un rango en modo visual (`v`,
`j`/`k` para extenderlo) y pulsando `c`: el comentario queda anclado a esas
líneas y sobrevive a cerrar la aplicación.

## Atajos

### Globales

| Tecla | Qué hace |
| --- | --- |
| `1` | ir al árbol de ficheros |
| `2` | ir al diff |
| `3` | ir a los comentarios |
| `Esc` | salir de visual o de insert, cancelando lo que hubiera a medias; en la pantalla de selección, volver atrás |
| `y` | exportar la revisión a Markdown |
| `e` | copiar al portapapeles la ruta del Markdown exportado |

### Árbol de ficheros

| Tecla | Qué hace |
| --- | --- |
| `j` / `k` | bajar / subir una fila |
| `h` | cerrar la carpeta, o saltar a la que contiene la fila |
| `l` | abrir la carpeta |
| `Enter` | abrir el fichero en el diff, o plegar y desplegar la carpeta |

### Diff

| Tecla | Qué hace |
| --- | --- |
| `j` / `k` | bajar / subir una línea, o extender el rango en visual |
| `gg` / `G` | ir al principio / al final |
| `Ctrl+d` / `Ctrl+u` | media página abajo / arriba |
| `Ctrl+w v` / `Ctrl+w o` | vista partida / vista unificada |
| `Ctrl+w h` / `Ctrl+w l` | columna vieja / columna nueva de la vista partida |
| `h` / `l` | lo mismo, sin el prefijo de ventana |
| `v` | entrar en visual y empezar un rango |
| `c` | comentar el rango marcado |

### Comentarios

| Tecla | Qué hace |
| --- | --- |
| `j` / `k` | bajar / subir un comentario |
| `gg` / `G` | ir al primero / al último |
| `i` | editar el comentario seleccionado |
| `Enter` | abrir el fichero y saltar a las líneas que comenta |
| `dd` | borrar el comentario |
| `zc` / `zo` | plegar / desplegar el texto del comentario |
| `Ctrl+Enter` | guardar el comentario que estás escribiendo |

### Pantalla de selección

| Atajo | Qué hace |
| --- | --- |
| `1` / `2` / `3` | repos recientes / explorador de directorios / ámbito a revisar |
| `j` / `k` | moverse por la lista |
| `l` | entrar en el directorio |
| `h` | subir al directorio de encima |
| `Enter` | elegir el repo, el ámbito o el commit |

Mientras escribes un comentario el teclado está en modo insert: solo responden
`Ctrl+Enter`, que guarda, y `Esc`, que descarta lo escrito. Todo lo demás es
texto.

## De vuelta a Codex

Con la revisión terminada, `y` exporta todos los comentarios a un Markdown en
`~/.codex/reviews/`:

```
~/.codex/reviews/review-2026-07-26.md
```

Un bloque por comentario, con la ruta del fichero, el rango de líneas y tu
texto tal cual, ordenados como el árbol (la variable `REVIEWV4_REVIEWS_DIR`
cambia ese directorio). `e` copia esa ruta al portapapeles, y
el viaje se cierra pasándosela a Codex:

```
> aplica las correcciones de ~/.codex/reviews/review-2026-07-26.md
```

La IA lee el fichero, corrige, y la siguiente vuelta empieza otra vez en
`reviewer`.

## Desarrollo

```
npm run tauri dev            # la aplicación en modo desarrollo
npm test                     # tests del front (Vitest)
npx tsc --noEmit             # typecheck
cd src-tauri && cargo test   # tests de Rust
npm run smoke:build          # build de release y humo del binario instalado
```

## Licencia

Distribuido bajo la licencia MIT. Consulta [`LICENSE`](LICENSE).
