import type { CSSProperties } from "react";
import { BRAND_HEADER, BRAND_PALETTE } from "@/lib/brand.generated";

/**
 * Horizontal Tidegap logo for the site header: heavy wave and outlined
 * wordmark from scripts/build-brand.mjs. Decorative; the enclosing link
 * carries the accessible name. The wave path slides one period inside
 * fixed clips (`tg-wave` in globals.css); the clips sit on the wrapping
 * groups so they do not move with the path.
 */
export function Logo({ className }: { className?: string }) {
  const { viewBox, stroke, wave, wavePeriod, inkClip, tealClip, wordmark } = BRAND_HEADER;
  const period = { "--tg-wave-p": `${wavePeriod}px` } as CSSProperties;
  return (
    <svg viewBox={viewBox} className={className} style={period} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="tg-header-ink">
          <rect {...inkClip} />
        </clipPath>
        <clipPath id="tg-header-teal">
          <rect {...tealClip} />
        </clipPath>
      </defs>
      <g clipPath="url(#tg-header-ink)">
        <path className="tg-wave" d={wave} fill="none" stroke={BRAND_PALETTE.white} strokeWidth={stroke} />
      </g>
      <g clipPath="url(#tg-header-teal)">
        <path className="tg-wave" d={wave} fill="none" stroke={BRAND_PALETTE.teal} strokeWidth={stroke} />
      </g>
      <path d={wordmark} fill={BRAND_PALETTE.white} />
    </svg>
  );
}
