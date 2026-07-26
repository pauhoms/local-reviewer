import { useCallback, useEffect, useRef, useState } from "react";
import { getDiff, getStartup, recordRecent } from "./ipc/client";
import { errorMessage } from "./ipc/errors";
import type { Scope } from "./ipc/types";
import EmptyScope from "./screens/EmptyScope";
import ErrorScreen from "./screens/ErrorScreen";
import ReviewShell from "./screens/ReviewShell";
import StartScreen from "./screens/StartScreen";
import { reviewStore, useReviewState } from "./state/review";

type Route =
  | { view: "loading" }
  | { view: "failed"; message: string; repo: string | null }
  | { view: "pick"; repo: string | null }
  | { view: "review" }
  | { view: "empty" };

function loadingScreen(): JSX.Element {
  return (
    <div className="app app-message">
      <p role="status">Abriendo AI Code Reviewer…</p>
    </div>
  );
}

export default function App(): JSX.Element {
  const [home, setHome] = useState("");
  const [route, setRoute] = useState<Route>({ view: "loading" });
  const { scope } = useReviewState();

  // Only the scope asked for last may open: while a slow diff is in flight the
  // picker is still on screen, and its answer must not replace a newer one.
  const scopeRequest = useRef(0);

  const openScope = useCallback((chosen: Scope): void => {
    const request = (scopeRequest.current += 1);
    getDiff(chosen)
      .then((files) => {
        if (scopeRequest.current !== request) return;
        // Only a review that opened belongs in the recents, and best effort at
        // that: a repo the app cannot remember is still perfectly reviewable.
        recordRecent(chosen.repo).catch(() => undefined);
        reviewStore.open(chosen, files);
        setRoute(files.length > 0 ? { view: "review" } : { view: "empty" });
      })
      .catch((error: unknown) => {
        if (scopeRequest.current !== request) return;
        setRoute({
          view: "failed",
          message: `No se pudieron leer los cambios: ${errorMessage(error)}`,
          repo: chosen.repo,
        });
      });
  }, []);

  useEffect(() => {
    let alive = true;
    getStartup()
      .then((info) => {
        if (!alive) return;
        setHome(info.home);
        if (info.scope) openScope(info.scope);
        else setRoute({ view: "pick", repo: null });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setRoute({
          view: "failed",
          message: `No se pudo arrancar la revisión: ${errorMessage(error)}`,
          repo: null,
        });
      });
    return () => {
      alive = false;
    };
  }, [openScope]);

  switch (route.view) {
    case "loading":
      return loadingScreen();
    case "failed":
      return (
        <ErrorScreen
          message={route.message}
          onBack={() => setRoute({ view: "pick", repo: route.repo })}
        />
      );
    case "pick":
      return <StartScreen home={home} initialRepo={route.repo} onOpen={openScope} />;
    case "review":
      return scope === null ? loadingScreen() : <ReviewShell scope={scope} />;
    case "empty":
      return scope === null ? (
        loadingScreen()
      ) : (
        <EmptyScope scope={scope} onBack={() => setRoute({ view: "pick", repo: scope.repo })} />
      );
  }
}
