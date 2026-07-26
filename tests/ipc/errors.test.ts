import { describe, it, expect } from "vitest";
import { errorMessage } from "@/ipc/errors";

describe("what the user is told when a command fails", () => {
  it("passes through the typed message the backend sends as a string", () => {
    expect(errorMessage("/tmp no es un repositorio git")).toBe("/tmp no es un repositorio git");
  });

  it("takes the message out of an Error", () => {
    expect(errorMessage(new Error("no se pudo leer /tmp"))).toBe("no se pudo leer /tmp");
  });

  it("never leaves the user with an empty explanation", () => {
    for (const raw of [undefined, null, "", "   ", {}, 42]) {
      expect(errorMessage(raw).trim().length).toBeGreaterThan(0);
    }
  });
});
