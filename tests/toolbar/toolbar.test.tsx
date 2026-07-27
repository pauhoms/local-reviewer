/**
 * The toolbar on its own: two buttons, the path of the last export and whatever
 * went wrong. It decides nothing — it is handed what to show and calls back.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { COPY_PATH_KEY, EXPORT_KEY } from "@/keys/keymap";
import Toolbar from "@/toolbar/Toolbar";

const PATH = "/home/dev/.codex/reviews/review-2026-07-26.md";

function paint(props: Partial<ComponentProps<typeof Toolbar>> = {}) {
  const onExport = vi.fn();
  const onCopy = vi.fn();
  render(
    <Toolbar
      path={null}
      error={null}
      copied={false}
      onExport={onExport}
      onCopy={onCopy}
      {...props}
    />,
  );
  return { onExport, onCopy };
}

function exportButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Export Review/ });
}

function copyButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Copy Path/ });
}

describe("Toolbar", () => {
  it("announces the very key its keymap row is bound to", () => {
    paint();

    expect(exportButton()).toHaveAttribute("data-shortcut", EXPORT_KEY);
    expect(copyButton()).toHaveAttribute("data-shortcut", COPY_PATH_KEY);
  });

  it("calls back when the export button is clicked", async () => {
    const user = userEvent.setup();
    const { onExport } = paint();

    await user.click(exportButton());

    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("gives the keyboard straight back to the app after a click", async () => {
    const user = userEvent.setup();
    const { onExport } = paint();

    await user.click(exportButton());
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("stays out of the tab ring, so no key ever lands on a button", async () => {
    const user = userEvent.setup();
    const { onExport, onCopy } = paint({ path: PATH });

    await user.tab();
    await user.keyboard("{Enter} ");

    expect(onExport).not.toHaveBeenCalled();
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("shows nothing about an export that has not happened", () => {
    paint();

    expect(document.querySelector("[data-export-path]")).toBeNull();
  });

  it("shows the path handed to it, and nothing else in that element", () => {
    paint({ path: PATH });

    expect(document.querySelector("[data-export-path]")?.textContent).toBe(PATH);
  });

  it("does not offer to copy a path that does not exist yet", async () => {
    const user = userEvent.setup();
    const { onCopy } = paint();

    await user.click(copyButton());

    expect(onCopy).not.toHaveBeenCalled();
  });

  it("offers to copy once something has been exported", async () => {
    const user = userEvent.setup();
    const { onCopy } = paint({ path: PATH });

    await user.click(copyButton());

    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("says nothing about the clipboard before anything has been copied", () => {
    paint({ path: PATH });

    expect(screen.queryByText(/copiada/i)).toBeNull();
  });

  it("says the path is in the clipboard once it has been copied", () => {
    paint({ path: PATH, copied: true });

    expect(screen.getByText("copiada ✓")).toBeInTheDocument();
    expect(copyButton()).toHaveAccessibleName(`Copy Path ${COPY_PATH_KEY}`);
  });

  it("says out loud what went wrong", () => {
    paint({ error: "No se pudo exportar la revisión: permiso denegado" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo exportar la revisión: permiso denegado",
    );
  });

  it("keeps quiet when nothing went wrong", () => {
    paint({ path: PATH });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
