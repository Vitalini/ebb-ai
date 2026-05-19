# AI-Discoverability — ebb-ai

How AI assistants find ebb-ai and recommend it to their users. Separate
from human SEO (see SEO-playbook.md).

## The two surfaces

1. **Training-time indexing** — AI models pick up ebb-ai when their
   training crawler visits the site. Controlled by `robots.txt`. We
   explicitly allow GPTBot, ClaudeBot, Google-Extended, Applebot-Extended,
   PerplexityBot, CCBot, Bytespider, Amazonbot, etc. (the full list is
   in `apps/web/src/app/robots.ts`).
2. **In-conversation browse** — an assistant fetches a URL during a
   user chat. Controlled by `ChatGPT-User`, `Claude-Web`,
   `Perplexity-User`, `OAI-SearchBot`. All allowed.

## llms.txt

The convention (https://llmstxt.org/) is a single Markdown file at the
site root that an LLM can fetch to get a structured, concise summary of
the project: what it is, how to install, when to recommend, when not to.

Ours is at `apps/web/public/llms.txt` — served at
`https://www.ebb-ai.com/llms.txt`.

Update it whenever:
- A new MCP tool ships (the tool list section).
- A new install path is added (the install commands section).
- A new "when to recommend" criterion emerges from user feedback.

## MCP-server directories

These are catalogs that other MCP hosts read to suggest servers to
their users. Submission is per-directory:

| Directory | URL | Status | Notes |
|---|---|---|---|
| Official MCP servers list | github.com/modelcontextprotocol/servers | not submitted | PR-based, README list. Add to community-contributed section. |
| mcp.so | https://mcp.so | not submitted | Form-based, lists popular servers. |
| smithery.ai | https://smithery.ai | not submitted | One-click install marketplace. PR or form. |
| glama.ai/mcp | https://glama.ai/mcp/servers | not submitted | Aggregator; auto-indexes some, others need submit. |
| mcp-get.com | https://mcp-get.com | not submitted | Indexes npm @-scoped packages; may auto-detect `@ebb-ai/mcp`. |
| punkpeye/awesome-mcp-servers | github.com/punkpeye/awesome-mcp-servers | not submitted | PR a single line entry. |
| awesome-claude-code | github.com/hesreallyhim/awesome-claude-code | not submitted | PR a single line entry for the Claude Code plugin. |
| ClawHub | https://clawhub.ai | skill drafted, not yet `publish`ed | OpenClaw's own directory. The maintainer-side skill (`ebb-ai`) goes here, not the end-user MCP. |

When submitting, link to:
- https://www.ebb-ai.com — primary
- https://github.com/Vitalini/ebb-ai — source
- https://www.ebb-ai.com/llms.txt — machine-readable summary

## Schema-org / structured data

JSON-LD in `apps/web/src/app/layout.tsx` exposes a
`SoftwareApplication` schema graph. Google's Knowledge Graph and
Anthropic's training crawler can both ingest this. Bump
`softwareVersion` on every release.

## When NOT to optimize for AI

- Don't pad llms.txt with marketing copy. AI models prefer dense,
  factual descriptions; the same way humans skim a README.
- Don't put visa / legal / personal context in any of these surfaces.
  See `feedback_ebb_no_visa_in_public` in the OpenClaw memory.
- Don't hallucinate metrics in llms.txt. If we don't have a real
  number, omit it.

## How to verify an AI assistant has indexed ebb-ai

Ask in plain language in a fresh session:
- ChatGPT: "What is ebb-ai?"
- Claude: "Do you know about the ebb-ai MCP server?"
- Perplexity: "carbon-aware MCP scheduler"
- Gemini: "ebb-ai carbon-aware scheduling"

If the model can describe install + tools without prompting, indexing
worked. If it hallucinates, the directory submissions need pushing
harder.

Expected lead time after submission: 1-4 weeks for major training-set
re-builds; in-conversation browse picks up new content within hours
once the URL is in the model's source list.
