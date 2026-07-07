"use client";

import { useEffect, useState } from "react";

/**
 * Deadline picker that resolves the visitor's timezone in the browser.
 *
 * `datetime-local` inputs submit a timezone-less `YYYY-MM-DDTHH:MM`
 * string; parsing that on the server (UTC on Vercel) skews the deadline
 * by the visitor's UTC offset — near-term deadlines get falsely
 * rejected as past, and the rendered deadline differs from what was
 * typed. So the visible input is intentionally unnamed (never
 * submitted); a hidden `deadline` field carries the equivalent UTC ISO
 * instant, converted here in the browser where the visitor's timezone
 * is known.
 */
export function DeadlineField({
  initialIso,
  className,
}: {
  /** Previously-submitted deadline (UTC ISO), echoed back into the form. */
  initialIso?: string;
  className?: string;
}) {
  // Start empty and fill in an effect: both the "echo the submitted
  // deadline back" and the "default to ~12h from now" branches need the
  // visitor's timezone, which only exists client-side. Rendering the
  // value during SSR would bake in the server's UTC wall clock.
  const [local, setLocal] = useState("");

  useEffect(() => {
    if (initialIso) {
      const d = new Date(initialIso);
      if (!Number.isNaN(d.getTime())) {
        setLocal(toDatetimeLocal(d));
        return;
      }
    }
    const d = new Date(Date.now() + 12 * 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    setLocal(toDatetimeLocal(d));
  }, [initialIso]);

  // `new Date("YYYY-MM-DDTHH:MM")` in the browser parses in the
  // visitor's local timezone; toISOString() converts to UTC.
  const parsed = local ? new Date(local) : null;
  const iso =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : "";

  return (
    <>
      <input
        type="datetime-local"
        required
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        className={className}
      />
      <input type="hidden" name="deadline" value={iso} />
    </>
  );
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
