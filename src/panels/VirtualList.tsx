import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, UIEvent } from "react";
import type { IndexWindow } from "@/diff/window";
import { revealCursor } from "./cursor-scroll";

/** Matches `--diff-line-height` in styles.css; used only while nothing can be measured. */
const FALLBACK_ROW_HEIGHT = 24;

interface Metrics {
  rowHeight: number;
  pageSize: number;
}

interface VirtualListProps {
  rowCount: number;
  /** First row mounted; everything above it is empty space in the sizer. */
  firstRow: number;
  /** Row the viewport is scrolled to, so the cursor stays on screen. */
  scrollRow: number;
  /** Items on show and how many of them fit, for whoever asks the DOM. */
  items: IndexWindow;
  itemsPerPage: number;
  onRowsPerPage: (rows: number) => void;
  onTopRow: (row: number) => void;
  children: ReactNode;
}

function cssRowHeight(node: HTMLElement): number {
  const declared = Number.parseFloat(
    window.getComputedStyle(node).getPropertyValue("--diff-line-height"),
  );
  return Number.isFinite(declared) ? declared : 0;
}

function measure(node: HTMLElement): Metrics | null {
  const row = node.querySelector<HTMLElement>("[data-split-row], [data-line-index]");
  const rowHeight = row?.getBoundingClientRect().height || cssRowHeight(node);
  const height = node.clientHeight || node.getBoundingClientRect().height;
  if (rowHeight <= 0 || height <= 0) return null;
  return { rowHeight, pageSize: Math.max(1, Math.floor(height / rowHeight)) };
}

export default function VirtualList({
  rowCount,
  firstRow,
  scrollRow,
  items,
  itemsPerPage,
  onRowsPerPage,
  onTopRow,
  children,
}: VirtualListProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(FALLBACK_ROW_HEIGHT);
  const rowHeightRef = useRef(FALLBACK_ROW_HEIGHT);
  const reportedRef = useRef<number | null>(null);
  const scrolledRef = useRef(-1);

  const onRowsPerPageRef = useRef(onRowsPerPage);
  onRowsPerPageRef.current = onRowsPerPage;

  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;

    const apply = (): void => {
      const metrics = measure(node);
      // Nothing to measure yet: the defaults keep the window small and bounded.
      if (!metrics) return;
      if (metrics.rowHeight !== rowHeightRef.current) {
        rowHeightRef.current = metrics.rowHeight;
        setRowHeight(metrics.rowHeight);
      }
      if (metrics.pageSize !== reportedRef.current) {
        reportedRef.current = metrics.pageSize;
        onRowsPerPageRef.current(metrics.pageSize);
      }
    };

    apply();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(node);
    globalThis.addEventListener("resize", apply);
    return () => {
      observer?.disconnect();
      globalThis.removeEventListener("resize", apply);
    };
  }, []);

  // On every render, not only when the row changes: a scroll the window refused
  // to follow leaves the DOM showing a place the rows are no longer mounted for.
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const top = scrollRow * rowHeight;
    if (Math.abs(node.scrollTop - top) < 1) return;
    scrolledRef.current = top;
    node.scrollTop = top;
  });

  // The virtual window normally predicts the right scroll offset, but rendered
  // geometry is the final authority when CSS or the webview measures differently.
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (node && revealCursor(node)) scrolledRef.current = node.scrollTop;
  });

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>): void => {
      const { scrollTop } = event.currentTarget;
      // Only a scroll the user asked for moves the window; ours already did.
      if (scrollTop === scrolledRef.current) return;
      onTopRow(Math.max(0, Math.round(scrollTop / rowHeight)));
    },
    [onTopRow, rowHeight],
  );

  return (
    <div
      ref={viewportRef}
      className="diff-viewport"
      data-diff-viewport=""
      data-page-size={itemsPerPage}
      data-first-visible={items.first}
      data-last-visible={items.last}
      onScroll={handleScroll}
    >
      <div className="diff-sizer" style={{ height: `${rowCount * rowHeight}px` }}>
        <ul
          role="listbox"
          className="diff-rows"
          style={{ transform: `translateY(${firstRow * rowHeight}px)` }}
        >
          {children}
        </ul>
      </div>
    </div>
  );
}
