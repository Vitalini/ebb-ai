/**
 * Tailwind 4 ships its PostCSS plugin as a separate package.
 * That's the only step needed — Tailwind 4 inlines autoprefixer.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
