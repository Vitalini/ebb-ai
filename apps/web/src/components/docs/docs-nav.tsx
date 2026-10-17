"use client";

import { useEffect, useRef, useState } from "react";

export type DocsNavItem = { id: string; label: string };

/** Height of the sticky site header plus the mobile bar, used as the observer's top margin. */
const TOP_MARGIN_PX = 120;

const LINK_CLASS =
  "block rounded-md border-l-2 border-transparent px-3 py-2 text-sm text-fg-muted transition-colors hover:text-fg aria-[current=location]:border-accent aria-[current=location]:bg-accent/5 aria-[current=location]:text-fg";

/**
 * The /docs category nav. At `lg` and up it is a sticky left column; below
 * `lg` it is a sticky bar holding a `<details>` list. Both are plain anchor
 * links, so they work without JavaScript. With JavaScript, a scroll-spy marks
 * the category in view with `aria-current="location"`.
 */
export function DocsNav({ items }: { items: readonly DocsNavItem[] }) {
  const [current, setCurrent] = useState(items[0]?.id ?? "");
  const lockTimer = useRef<number | undefined>(undefined);
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    const visible = new Set<string>();
    const lastId = items[items.length - 1]?.id ?? "";

    const update = () => {
      if (lockTimer.current !== undefined) return;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) return setCurrent(lastId);
      const first = items.find((item) => visible.has(item.id));
      if (first) setCurrent(first.id);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        update();
      },
      { rootMargin: `-${TOP_MARGIN_PX}px 0px -60% 0px` },
    );
    for (const section of sections) observer.observe(section);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update);
      window.clearTimeout(lockTimer.current);
    };
  }, [items]);

  const choose = (id: string) => {
    setCurrent(id);
    // Ignore the observer while the smooth scroll runs, so the highlight does not flicker.
    window.clearTimeout(lockTimer.current);
    lockTimer.current = window.setTimeout(() => {
      lockTimer.current = undefined;
    }, 900);
    if (details.current) details.current.open = false;
  };

  const currentLabel = items.find((item) => item.id === current)?.label ?? items[0]?.label;

  const links = items.map((item) => (
    <li key={item.id}>
      <a
        href={`#${item.id}`}
        onClick={() => choose(item.id)}
        aria-current={item.id === current ? "location" : undefined}
        className={LINK_CLASS}
      >
        {item.label}
      </a>
    </li>
  ));

  return (
    <>
      <nav aria-label="Docs categories" className="sticky top-24 hidden self-start lg:block">
        <ul className="space-y-0.5">{links}</ul>
      </nav>

      <nav
        aria-label="Docs categories"
        className="sticky top-[61px] z-10 -mx-6 border-b border-rule bg-bg/95 px-6 backdrop-blur-md sm:top-[65px] lg:hidden"
      >
        <details ref={details} className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
            <span className="truncate">
              <span className="text-fg-dim">On this page: </span>
              <span className="text-fg">{currentLabel}</span>
            </span>
            <span aria-hidden="true" className="text-fg-muted transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <ul className="space-y-0.5 pb-3">{links}</ul>
        </details>
      </nav>
    </>
  );
}
