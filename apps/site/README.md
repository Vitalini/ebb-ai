# ebb-ai landing site

Static HTML/CSS. No build step. Serve locally with anything:

```bash
# from this directory
python3 -m http.server 8787
# then open http://localhost:8787
```

Or:

```bash
npx serve .
# or
npx http-server .
```

## Why static

This is meant to be deployable to GitHub Pages, Vercel, Netlify, or any
static host with zero config. There is no framework, no JS, no
build. The dashboard component (live grid map, queue status) lands in
a separate `apps/dashboard/` package once the public API stabilizes —
see `../../PLAN.md` section 7 Month 4.
