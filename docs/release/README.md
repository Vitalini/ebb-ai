# ebb-ai release artefacts

Per-version "ready to share" bundles. Each subdirectory holds the
release notes, rendered docs (PDF), diagrams (Mermaid source +
rendered PNG), and assets we hand out for announcements (Show HN,
mailing list, tweets, press kit citations).

| Version | Date | Folder | Highlights |
|---|---|---|---|
| [v0.7.1](./v0.7.1/) | 2026-05-14 | [`v0.7.1/`](./v0.7.1/) | Persistent queue by default, full CRUD slash commands |

## Conventions

- **`<version>/README.md`** — index for that release
- **`<version>/release-notes.md`** — paste-ready human summary
- **`<version>/diagrams/`** — Mermaid source (`*.mmd`) + rendered PNG
- **`<version>/pdf/`** — pandoc + weasyprint renders of README, PLUGIN,
  CHANGELOG
- **`<version>/images/`** — illustrations / OG cards / hero art
  (generated via image-model when available)

## Regenerating

Diagrams:

```bash
cd docs/release/<version>/diagrams
npx -y @mermaid-js/mermaid-cli -i architecture.mmd -o architecture.png \
  -w 1800 -H 1000 -b transparent
```

PDFs (requires pandoc + a PDF engine — weasyprint, wkhtmltopdf, or a
LaTeX engine):

```bash
pandoc README.md -o docs/release/<version>/pdf/README.pdf \
  --pdf-engine=weasyprint \
  --metadata title="ebb-ai · README"
```
