import type { CarbonBand } from "@/lib/types";

const BAND_LABEL: Record<CarbonBand, string> = {
  very_clean: "very clean",
  clean: "clean",
  average: "average",
  dirty: "dirty",
  very_dirty: "very dirty",
};

const BAND_CLASSES: Record<CarbonBand, string> = {
  very_clean:
    "bg-band-very-clean/15 text-band-very-clean ring-band-very-clean/30",
  clean: "bg-band-clean/15 text-band-clean ring-band-clean/30",
  average: "bg-band-average/15 text-band-average ring-band-average/30",
  dirty: "bg-band-dirty/15 text-band-dirty ring-band-dirty/30",
  very_dirty:
    "bg-band-very-dirty/15 text-band-very-dirty ring-band-very-dirty/30",
};

export function CarbonBandBadge({
  band,
  size = "md",
}: {
  band: CarbonBand;
  size?: "sm" | "md";
}) {
  const padding = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-mono uppercase tracking-wide ring-1 ${padding} ${BAND_CLASSES[band]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {BAND_LABEL[band]}
    </span>
  );
}

export function bandColor(band: CarbonBand): string {
  switch (band) {
    case "very_clean":
      return "var(--color-band-very-clean)";
    case "clean":
      return "var(--color-band-clean)";
    case "average":
      return "var(--color-band-average)";
    case "dirty":
      return "var(--color-band-dirty)";
    case "very_dirty":
      return "var(--color-band-very-dirty)";
  }
}
