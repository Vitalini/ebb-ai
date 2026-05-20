"use client";

import { useMemo, useState } from "react";

type Host = {
  id: string;
  label: string;
  group: "mcp" | "ide" | "agent" | "lib";
  desc: string;
  command: string;
  lang: "bash" | "json" | "yaml";
  followup: string;
};

const HOSTS: Host[] = [
  {
    id: "mcp",
    label: "MCP server (generic)",
    group: "mcp",
    desc: "Universal — add ebb-mcp to any host that speaks Model Context Protocol.",
    command: "npx -y @ebb-ai/mcp",
    lang: "bash",
    followup:
      "Wire this into your host's MCP config (the snippets for specific hosts are in the dropdown).",
  },
  {
    id: "claude-code",
    label: "Claude Code (plugin)",
    group: "agent",
    desc: "Adds eight /ebb-ai:* slash commands plus auto-wires the MCP server.",
    command: "/plugin marketplace add Vitalini/ebb-ai\n/plugin install ebb-ai",
    lang: "bash",
    followup:
      "Restart your session. Then call: /ebb-ai:defer \"summarize this\" --by tomorrow 6pm",
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    group: "ide",
    desc: "Edit ~/Library/Application Support/Claude/claude_desktop_config.json (macOS) or %APPDATA%\\Claude\\claude_desktop_config.json (Windows).",
    command: `{
  "mcpServers": {
    "ebb-ai": {
      "command": "npx",
      "args": ["-y", "@ebb-ai/mcp"]
    }
  }
}`,
    lang: "json",
    followup: "Restart Claude Desktop. ebb-ai tools available in any chat.",
  },
  {
    id: "cursor",
    label: "Cursor",
    group: "ide",
    desc: "Settings → MCP → Add new MCP server. Or edit ~/.cursor/mcp.json directly.",
    command: `{
  "mcpServers": {
    "ebb-ai": {
      "command": "npx",
      "args": ["-y", "@ebb-ai/mcp"]
    }
  }
}`,
    lang: "json",
    followup: "Reload Cursor — ebb-ai shows up in the MCP servers list.",
  },
  {
    id: "windsurf",
    label: "Windsurf (Codeium)",
    group: "ide",
    desc: "Edit ~/.codeium/windsurf/mcp_config.json.",
    command: `{
  "mcpServers": {
    "ebb-ai": {
      "command": "npx",
      "args": ["-y", "@ebb-ai/mcp"]
    }
  }
}`,
    lang: "json",
    followup: "Restart Windsurf.",
  },
  {
    id: "continue",
    label: "Continue (VS Code)",
    group: "ide",
    desc: "Add to ~/.continue/config.yaml under mcpServers.",
    command: `mcpServers:
  - name: ebb-ai
    command: npx
    args:
      - -y
      - "@ebb-ai/mcp"`,
    lang: "yaml",
    followup: "Reload the Continue panel.",
  },
  {
    id: "cline",
    label: "Cline (VS Code)",
    group: "ide",
    desc: "Cline → Settings (gear) → MCP Servers → Edit MCP Settings.",
    command: `{
  "mcpServers": {
    "ebb-ai": {
      "command": "npx",
      "args": ["-y", "@ebb-ai/mcp"],
      "disabled": false
    }
  }
}`,
    lang: "json",
    followup: "Reload Cline. ebb-ai tools appear in Cline's tool list.",
  },
  {
    id: "zed",
    label: "Zed editor",
    group: "ide",
    desc: "In Zed settings.json, add a context_servers entry.",
    command: `"context_servers": {
  "ebb-ai": {
    "command": {
      "path": "npx",
      "args": ["-y", "@ebb-ai/mcp"]
    }
  }
}`,
    lang: "json",
    followup: "Restart Zed. Tools surface in the Assistant panel.",
  },
  {
    id: "goose",
    label: "Goose (Block)",
    group: "agent",
    desc: "goose configure → Add Extension → Command-line.",
    command: "npx -y @ebb-ai/mcp",
    lang: "bash",
    followup:
      "When asked for an Extension Name, enter ebb-ai. Then: goose session.",
  },
  {
    id: "openclaw",
    label: "OpenClaw (plugin via ClawHub)",
    group: "agent",
    desc: "Native OpenClaw plugin that registers four ebb-ai tools (ebb_schedule_task, ebb_recommend_window, ebb_check_queue_status, ebb_cancel_task). Page: https://clawhub.ai/plugins/@vitalini/ebb-ai-mcp",
    command: "openclaw plugins install clawhub:@vitalini/ebb-ai-mcp",
    lang: "bash",
    followup:
      'Restart the OpenClaw gateway. Then say "do this later" / "by tomorrow" / "overnight" in any session — ebb_schedule_task fires automatically.',
  },
  {
    id: "mcphost-cli",
    label: "mcphost / mcp-cli",
    group: "agent",
    desc: "Generic command-line MCP host. Add ebb-ai to your hosts config.",
    command: `{
  "mcpServers": {
    "ebb-ai": {
      "command": "npx",
      "args": ["-y", "@ebb-ai/mcp"]
    }
  }
}`,
    lang: "json",
    followup: "mcphost --config <your-config>.json or mcp-cli with --server ebb-ai.",
  },
  {
    id: "python-lib",
    label: "Python library (no MCP)",
    group: "lib",
    desc: "Use ebb-ai directly as a Python library — no MCP host needed.",
    command: "pip install ebb-ai",
    lang: "bash",
    followup:
      "from ebb_ai import Scheduler; s = Scheduler(); await s.schedule(...). Same API as the TypeScript core.",
  },
  {
    id: "node-lib",
    label: "TypeScript / Node library (no MCP)",
    group: "lib",
    desc: "Use @ebb-ai/core directly as an npm dependency.",
    command: "pnpm add @ebb-ai/core   # or npm install / yarn add",
    lang: "bash",
    followup:
      "import { createScheduler } from '@ebb-ai/core'. Same scheduler shape, no MCP wrapper.",
  },
];

const GROUP_LABELS: Record<Host["group"], string> = {
  mcp: "MCP universal",
  ide: "Editors / IDEs",
  agent: "Agent hosts",
  lib: "Library (no MCP)",
};

export function InstallPicker() {
  const [hostId, setHostId] = useState<string>("mcp");
  const [copied, setCopied] = useState(false);

  const host: Host = useMemo(
    () => HOSTS.find((h) => h.id === hostId) ?? HOSTS[0]!,
    [hostId],
  );

  const grouped = useMemo(() => {
    const out: Record<Host["group"], Host[]> = {
      mcp: [],
      ide: [],
      agent: [],
      lib: [],
    };
    for (const h of HOSTS) out[h.group].push(h);
    return out;
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(host.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — fall back to manual select
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="font-mono text-[11px] uppercase tracking-wider text-fg-dim sm:min-w-[120px]">
          install for
        </span>
        <select
          value={hostId}
          onChange={(e) => setHostId(e.target.value)}
          className="w-full rounded-md border border-rule bg-bg-elev px-3 py-2 font-mono text-sm text-fg outline-none transition-colors hover:border-accent/40 focus:border-accent sm:max-w-md"
        >
          {(Object.keys(grouped) as Host["group"][]).map((g) => (
            <optgroup key={g} label={GROUP_LABELS[g]}>
              {grouped[g].map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <p className="text-sm text-fg-muted">{host.desc}</p>

      <div className="relative rounded-md border border-rule bg-bg overflow-hidden">
        <div className="flex items-center justify-between border-b border-rule bg-bg-elev px-3 py-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
            {host.lang}
          </span>
          <button
            type="button"
            onClick={copy}
            className="rounded px-2 py-0.5 font-mono text-[11px] text-fg-muted transition-colors hover:bg-bg-card hover:text-accent"
          >
            {copied ? "copied ✓" : "copy"}
          </button>
        </div>
        <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-fg">
          <code>{host.command}</code>
        </pre>
      </div>

      <p className="text-sm text-fg-muted">
        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
          then
        </span>{" "}
        {host.followup}
      </p>
    </div>
  );
}
