import { describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import DiffLine from "@/panels/DiffLine";
import type { Token } from "@/highlight/shiki";
import type { Line } from "@/ipc/types";

function line(kind: Line["kind"], oldNo: number | null, newNo: number | null, content: string): Line {
  return { kind, oldNo, newNo, content };
}

function show(
  row: Line,
  options: { cursor?: boolean; selected?: boolean; tokens?: Token[] | null } = {},
): HTMLElement {
  cleanup();
  const { getByRole } = render(
    <DiffLine
      line={row}
      index={7}
      cursor={options.cursor ?? false}
      selected={options.selected ?? false}
      tokens={options.tokens ?? null}
    />,
  );
  return getByRole("option");
}

function part(row: HTMLElement, attribute: string): HTMLElement {
  const node = row.querySelector<HTMLElement>(`[${attribute}]`);
  if (!node) throw new Error(`la línea no tiene [${attribute}]`);
  return node;
}

describe("a diff line shows its numbers, its marker and its body", () => {
  it("writes both numbers of a context line", () => {
    const row = show(line("context", 5, 8, "    return $x;"));

    expect(part(row, "data-old-no")).toHaveTextContent("5");
    expect(part(row, "data-new-no")).toHaveTextContent("8");
    expect(part(row, "data-line-marker").textContent?.trim()).toBe("");
    expect(part(row, "data-line-content").textContent).toBe("    return $x;");
  });

  it("leaves the missing number blank on an added and on a deleted line", () => {
    const added = show(line("add", null, 3, "nueva"));
    expect(part(added, "data-old-no").textContent).toBe("");
    expect(part(added, "data-line-marker").textContent?.trim()).toBe("+");

    const deleted = show(line("del", 3, null, "vieja"));
    expect(part(deleted, "data-new-no").textContent).toBe("");
    expect(part(deleted, "data-line-marker").textContent?.trim()).toMatch(/^[-−]$/);
  });

  it("drops the carriage return of a CRLF line", () => {
    const row = show(line("add", null, 1, "con retorno\r"));

    expect(part(row, "data-line-content").textContent).toBe("con retorno");
  });
});

describe("a diff line says where the cursor and the range are", () => {
  it("marks the head with data-cursor and nothing else with it", () => {
    expect(show(line("add", null, 1, "a"), { cursor: true })).toHaveAttribute("data-cursor", "true");
    expect(show(line("add", null, 1, "a"))).not.toHaveAttribute("data-cursor");
  });

  it("marks a selected line with aria-selected", () => {
    expect(show(line("add", null, 1, "a"), { selected: true })).toHaveAttribute("aria-selected", "true");
    expect(show(line("add", null, 1, "a"))).toHaveAttribute("aria-selected", "false");
  });

  it("carries its index and its kind as data", () => {
    const row = show(line("del", 2, null, "a"));

    expect(row).toHaveAttribute("data-line-index", "7");
    expect(row).toHaveAttribute("data-kind", "del");
  });
});

describe("the tokens colour the body without replacing it", () => {
  it("paints one span per coloured token", () => {
    const tokens: Token[] = [
      { content: "const", color: "#ff0000" },
      { content: " x", color: "#00ff00" },
    ];
    const row = show(line("add", null, 1, "const x"), { tokens });

    const content = part(row, "data-line-content");
    expect(content.textContent).toBe("const x");
    const colours = Array.from(content.querySelectorAll<HTMLElement>("[style]")).map(
      (node) => node.style.color,
    );
    expect(colours).toHaveLength(2);
    expect(content.style.color).toBe("");
  });

  it("writes a token with no colour as plain text", () => {
    const row = show(line("add", null, 1, "texto"), { tokens: [{ content: "texto" }] });

    const content = part(row, "data-line-content");
    expect(content.textContent).toBe("texto");
    expect(content.querySelectorAll("[style]")).toHaveLength(0);
  });
});
