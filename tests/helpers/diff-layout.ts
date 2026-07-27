/**
 * jsdom has no layout: `clientHeight` and `getBoundingClientRect()` answer 0, so a
 * virtualized list has nothing to measure. This helper gives the diff panel a
 * measurable viewport through every route a sane implementation might take —
 * `clientHeight`, `offsetHeight`, `getBoundingClientRect()`, `ResizeObserver` and
 * the `--diff-line-height` custom property — and lets a test resize it.
 *
 * The contract it assumes: the scroll container carries `data-diff-viewport`, and
 * the rows carry `data-line-index` (diff lines), `data-split-row` (the rows of the
 * split view) or `data-hunk-header` (separators).
 */

export const ROW_HEIGHT = 24;
export const VIEWPORT_HEIGHT = 480;

const VIEWPORT_SELECTOR = "[data-diff-viewport]";
const ROW_SELECTOR = "[data-line-index], [data-split-row], [data-hunk-header]";

let viewportHeight = 0;
let installed = false;
const undo: Array<() => void> = [];

interface Observation {
  callback: ResizeObserverCallback;
  observer: ResizeObserver;
  targets: Element[];
}

const observations = new Set<Observation>();

function matches(node: Element, selector: string): boolean {
  return typeof node.matches === "function" && node.matches(selector);
}

function heightOf(node: Element): number {
  if (matches(node, VIEWPORT_SELECTOR)) return viewportHeight;
  if (matches(node, ROW_SELECTOR)) return ROW_HEIGHT;
  return 0;
}

function rectOf(node: Element): DOMRect {
  const height = heightOf(node);
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: height,
    width: 800,
    height,
    toJSON: () => ({}),
  };
  return rect as DOMRect;
}

function patch(target: object, key: string, descriptor: PropertyDescriptor): void {
  const previous = Object.getOwnPropertyDescriptor(target, key);
  undo.push(() => {
    if (previous) Object.defineProperty(target, key, previous);
    else Reflect.deleteProperty(target, key);
  });
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
}

function fire(observation: Observation): void {
  const entries = observation.targets.map((target) => {
    const rect = rectOf(target);
    return {
      target,
      contentRect: rect,
      borderBoxSize: [{ blockSize: rect.height, inlineSize: rect.width }],
      contentBoxSize: [{ blockSize: rect.height, inlineSize: rect.width }],
      devicePixelContentBoxSize: [{ blockSize: rect.height, inlineSize: rect.width }],
    } as ResizeObserverEntry;
  });
  if (entries.length > 0) observation.callback(entries, observation.observer);
}

class TestResizeObserver implements ResizeObserver {
  private readonly observation: Observation;

  constructor(callback: ResizeObserverCallback) {
    this.observation = { callback, observer: this, targets: [] };
    observations.add(this.observation);
  }

  observe(target: Element): void {
    this.observation.targets.push(target);
    fire(this.observation);
  }

  unobserve(target: Element): void {
    this.observation.targets = this.observation.targets.filter((known) => known !== target);
  }

  disconnect(): void {
    this.observation.targets = [];
    observations.delete(this.observation);
  }
}

export function stubLayout(height: number = VIEWPORT_HEIGHT): void {
  viewportHeight = height;
  if (installed) return;
  installed = true;

  patch(HTMLElement.prototype, "clientHeight", {
    get(this: HTMLElement) {
      return heightOf(this);
    },
  });
  patch(HTMLElement.prototype, "offsetHeight", {
    get(this: HTMLElement) {
      return heightOf(this);
    },
  });
  patch(Element.prototype, "getBoundingClientRect", {
    value(this: Element) {
      return rectOf(this);
    },
  });
  patch(globalThis, "ResizeObserver", { value: TestResizeObserver, writable: true });

  document.documentElement.style.setProperty("--diff-line-height", `${ROW_HEIGHT}px`);
}

/** Changes the viewport and notifies through both routes an implementation may use. */
export function resizeViewport(height: number): void {
  viewportHeight = height;
  for (const observation of observations) fire(observation);
  window.dispatchEvent(new Event("resize"));
}

export function restoreLayout(): void {
  observations.clear();
  while (undo.length > 0) undo.pop()?.();
  document.documentElement.style.removeProperty("--diff-line-height");
  viewportHeight = 0;
  installed = false;
}
