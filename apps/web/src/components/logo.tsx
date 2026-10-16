import { BRAND_HEADER, BRAND_PALETTE } from "@/lib/brand.generated";

/**
 * Horizontal Tidegap logo for the site header: heavy wave and outlined
 * wordmark from scripts/build-brand.mjs. Decorative; the enclosing link
 * carries the accessible name.
 */
export function Logo({ className }: { className?: string }) {
  const { viewBox, stroke, wave, inkClip, tealClip, wordmark } = BRAND_HEADER;
  return (
    <svg viewBox={viewBox} className={className} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="tg-header-ink">
          <rect {...inkClip} />
        </clipPath>
        <clipPath id="tg-header-teal">
          <rect {...tealClip} />
        </clipPath>
      </defs>
      <path
        d={wave}
        fill="none"
        stroke={BRAND_PALETTE.white}
        strokeWidth={stroke}
        clipPath="url(#tg-header-ink)"
      />
      <path
        d={wave}
        fill="none"
        stroke={BRAND_PALETTE.teal}
        strokeWidth={stroke}
        clipPath="url(#tg-header-teal)"
      />
      <path d={wordmark} fill={BRAND_PALETTE.white} />
    </svg>
  );
}
