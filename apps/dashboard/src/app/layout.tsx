import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "ebb-ai · live carbon map for AI compute",
  description:
    "Real-time carbon-intensity map of the electricity grids that power major LLM provider regions. Best-window finder for carbon-aware AI workloads.",
  metadataBase: new URL("https://ebb-ai.com"),
  openGraph: {
    title: "ebb-ai — Carbon-aware scheduling for agentic AI workflows",
    description:
      "MCP server that defers non-urgent AI tasks to the cleanest grid window inside your deadline. Per-task carbon receipts, Anthropic + OpenAI Batch APIs, durable SQLite queue. Apache-2.0.",
    url: "https://ebb-ai.com",
    siteName: "ebb-ai",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "ebb-ai — Carbon-aware scheduling for agentic AI workflows",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ebb-ai — Carbon-aware scheduling for agentic AI workflows",
    description:
      "MCP server that defers non-urgent AI tasks to the cleanest grid window. 169 tests, 8 MCP tools, 10 host integrations. Apache-2.0.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav />
        <main className="relative z-10 mx-auto max-w-6xl px-6 py-10">{children}</main>
        <footer className="relative z-10 mt-16 border-t border-rule">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-8 text-xs text-fg-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
              Apache-2.0 · grid data via{" "}
              <a
                href="https://www.electricitymaps.com/"
                className="text-accent hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                Electricity Maps
              </a>{" "}
              (mock fallback when no key is configured)
            </p>
            <p className="font-mono text-fg-dim">
              v0.2 · operator preview · UTC-aligned
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
