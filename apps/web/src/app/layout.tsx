import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ebb-ai · carbon-aware scheduling for AI compute",
    template: "%s · ebb-ai",
  },
  description:
    "Open-source MCP server and CLI that defer non-urgent AI tasks to the cleanest electricity-grid window inside your deadline. Live carbon-intensity map of grid regions across North America, Europe and Asia-Pacific. Apache-2.0.",
  metadataBase: new URL("https://www.ebb-ai.com"),
  alternates: {
    canonical: "https://www.ebb-ai.com",
  },
  keywords: [
    "carbon-aware scheduling",
    "carbon-aware AI",
    "MCP server",
    "Model Context Protocol",
    "Claude Code plugin",
    "LLM batch API",
    "Anthropic Batch",
    "OpenAI Batch",
    "grid carbon intensity",
    "green AI",
    "sustainable AI",
    "carbon-aware computing",
    "ebb-ai",
  ],
  authors: [{ name: "Vitalii Borovyk", url: "https://github.com/Vitalini" }],
  creator: "Vitalii Borovyk",
  publisher: "ebb-ai",
  category: "developer tools",
  openGraph: {
    title: "ebb-ai — Carbon-aware scheduling for agentic AI workflows",
    description:
      "MCP server that defers non-urgent AI tasks to the cleanest grid window inside your deadline. Per-task carbon receipts, Anthropic + OpenAI Batch APIs, durable SQLite queue. Apache-2.0.",
    url: "https://www.ebb-ai.com",
    siteName: "ebb-ai",
    locale: "en_US",
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
      "MCP server that defers non-urgent AI tasks to the cleanest grid window. 333 tests, 9 MCP tools, persistent SQLite queue. Apache-2.0.",
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  verification: {
    google: "NWwuXFBCyAQVChXdBSa3n5wwxm6xsZVrhON5YvaxpSM",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": "https://www.ebb-ai.com/#software",
      name: "ebb-ai",
      url: "https://www.ebb-ai.com",
      description:
        "Open-source carbon-aware scheduler for agentic AI workflows. Defers non-urgent LLM calls to the cleanest electricity-grid window inside a deadline via the Model Context Protocol.",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS, Linux, Windows",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      license: "https://opensource.org/licenses/Apache-2.0",
      softwareVersion: "0.11.0",
      author: {
        "@type": "Person",
        name: "Vitalii Borovyk",
        url: "https://github.com/Vitalini",
      },
      codeRepository: "https://github.com/Vitalini/ebb-ai",
      keywords:
        "carbon-aware scheduling, MCP, Model Context Protocol, Claude Code plugin, grid carbon intensity, sustainable AI",
    },
    {
      "@type": "WebSite",
      "@id": "https://www.ebb-ai.com/#website",
      url: "https://www.ebb-ai.com",
      name: "ebb-ai",
      description:
        "Carbon-aware scheduling for agentic AI workflows. Live electricity-grid carbon-intensity map for major LLM-provider regions.",
      publisher: { "@id": "https://www.ebb-ai.com/#software" },
      inLanguage: "en-US",
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
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
              v0.11.0 · operator preview · UTC-aligned
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
