import { NextRequest, NextResponse } from "next/server";

/**
 * Per-request nonce-based Content-Security-Policy.
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy` (and the named
 * export `middleware` to `proxy`). This file used to be `src/middleware.ts`; the
 * logic is byte-for-byte the same. One runtime consequence: `proxy` always runs
 * on the `nodejs` runtime and that is not configurable, whereas `middleware` ran
 * on `edge`. Nothing here needs edge — `crypto.randomUUID()` and `Buffer` are
 * both Node built-ins — and the nonce hand-off below is a request-header
 * contract that is runtime-independent.
 *
 * Roadmap item 9. The baseline security headers (HSTS, X-Frame-Options,
 * X-Content-Type-Options, Referrer-Policy, Permissions-Policy) stay in
 * `next.config.ts` where they apply to *every* response including the static
 * `public/` assets; this proxy adds the one header those can't express: a
 * strict CSP whose `script-src` is pinned to a fresh per-request nonce.
 *
 * How Next.js consumes the nonce: we set the CSP on the *request* headers before
 * handing off (`NextResponse.next({ request })`). Next.js parses that request
 * header, lifts the `'nonce-…'` value out, and stamps it onto every framework
 * `<script>` it emits (bootstrap, chunks, hydration data). The JSON-LD tag in
 * `layout.tsx` reads the same value via `headers()` and carries it too. Because
 * the nonce must differ every request, any page that emits a nonced script is
 * forced into dynamic rendering — the accepted cost of this policy (see the
 * ENFORCED-vs-Report-Only note below).
 *
 * script-src is `'self' 'nonce-…' 'strict-dynamic'` — NOT `'unsafe-inline'`.
 * That is the whole point: with `'strict-dynamic'`, a CSP3 browser trusts only
 * scripts carrying the nonce (and scripts they in turn load), and *ignores* the
 * `'self'`/host allowlist. Inline injection without the nonce is blocked.
 *
 * style-src keeps `'unsafe-inline'`: Next hydration and recharts both emit
 * inline `style="…"` attributes and Tailwind v4 injects a build-time stylesheet;
 * CSP nonces don't cover style attributes, so `'unsafe-inline'` for *styles only*
 * is the documented, accepted compromise. It does not weaken script-src.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // `'unsafe-eval'` is needed only by the dev-mode React Refresh runtime; the
  // production bundle (what Vercel ships) never evals, so it is dev-only.
  const scriptSrc =
    process.env.NODE_ENV === "development"
      ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
      : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    // Styles: 'unsafe-inline' required — Next hydration / recharts / Tailwind v4
    // emit inline styles that nonces cannot cover. Scoped to styles only.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  // Expose the nonce to Server Components (layout reads `x-nonce`) and hand the
  // CSP to Next on the request so it nonces its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // Run on page routes only. Excluded, and why:
  //   api           — JSON route handlers, no HTML/script surface to protect.
  //   _next/static  — hashed immutable build assets (already covered by SRI).
  //   _next/image   — the image optimizer.
  //   architecture  — a hand-written static page in public/ that loads
  //                   /copy-buttons.js via <script src>; 'strict-dynamic' would
  //                   ignore 'self' and block it. It keeps the next.config
  //                   baseline headers, just not the nonce CSP.
  //   *.<ext>       — any file with an extension (og.png, llms.txt, site.css,
  //                   copy-buttons.js, manifest, favicon, …).
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|architecture|.*\\.[^/]+$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
