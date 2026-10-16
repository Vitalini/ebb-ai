# Tidegap brand

The logo is a wave with a teal trough above the "Tidegap" wordmark. Every file below is generated; do not edit them by hand.

## Files

| File | Use |
|---|---|
| `assets/brand/tidegap-logo-dark.svg` / `.png` | Stacked lockup on dark backgrounds (white wave and wordmark) |
| `assets/brand/tidegap-logo-light.svg` / `.png` | Stacked lockup on light backgrounds (navy wave and wordmark) |
| `assets/brand/tidegap-mark.svg` | Wave alone, heavy stroke, transparent; navy, white in dark mode |
| `assets/brand/tidegap-icon.svg` | Wave on a full-bleed navy tile: favicon and app icons |
| `apps/web/public/icon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | Site icons, from `tidegap-icon.svg` |
| `apps/web/src/lib/brand.generated.ts` | Horizontal header form for the site |

The PNG lockups are 2x renders with a transparent background.

## Colours

| Name | Hex | Use |
|---|---|---|
| Navy | `#0C1017` | Dark background, ink of the light lockup, icon tile |
| White | `#FFFFFF` | Ink of the dark lockup |
| Off-white | `#FAFAFA` | Light background |
| Teal | `#5FC6C4` | The trough of the wave, in every version |

These colours are for logo surfaces only. The site and `tidegap ui` keep their own UI tokens.

## Clear space and minimum sizes

- Clear space: the height of the wave on every side of the lockup.
- Stacked lockup: at least 120 px wide.
- Horizontal header form (mark left, wordmark right): at least 18 px tall.
- Below that, use the mark alone. At 32 px and below, use the icon tile.

The mark and the icon use a heavier stroke than the lockup so the wave still reads at 16 px.

## Do not

- Recolour the logo, or move the teal outside the trough.
- Add the clock, the dot or a tagline.
- Stretch, rotate or re-space the logo.
- Set the wordmark as live text in logo artwork. It is outlined Poppins Medium.

One allowance: in-app chrome, such as the `tidegap ui` header, may pair the inline mark with the product name in the app font.

## Font

Poppins Medium, from [google/fonts `ofl/poppins`](https://github.com/google/fonts/tree/main/ofl/poppins), under the SIL Open Font License 1.1. The font and its licence are in `assets/brand/fonts/`. Only the generator reads the font; no output depends on an installed font.

## Regenerate

```bash
pnpm gen:images        # scripts/build-brand.mjs, then scripts/render-images.mjs
pnpm gen:images:check  # drift check, also run in CI
```

The wave geometry, stroke weights, tracking and layout are constants at the top of `scripts/build-brand.mjs`. `pnpm gen:brand` runs the generator alone; the drift check then fails until `pnpm gen:images` records the new outputs.
