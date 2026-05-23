"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically calls router.refresh() so the route's server-rendered
 * data (live grid forecasts in our case) updates without a manual
 * reload — React reconciles silently against the new RSC payload, no
 * skeleton flash.
 *
 *  · Pauses while document.hidden (no waste in background tabs).
 *  · On visibility return, refreshes immediately if more than
 *    `intervalMs` has elapsed since the last refresh.
 *  · Renders nothing — drop into any server component.
 */
interface AutoRefreshProps {
  intervalMs: number;
}

export function AutoRefresh({ intervalMs }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    let lastRefresh = Date.now();

    const refresh = () => {
      lastRefresh = Date.now();
      router.refresh();
    };

    const onTick = () => {
      if (!document.hidden) refresh();
    };

    const onVisibility = () => {
      if (!document.hidden && Date.now() - lastRefresh >= intervalMs) {
        refresh();
      }
    };

    const id = window.setInterval(onTick, intervalMs);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
