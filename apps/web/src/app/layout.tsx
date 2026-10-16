import type { Metadata } from "next";
import { headers } from "next/headers";
import { Nav } from "@/components/nav";
import { VERSION } from "@/lib/version";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Tidegap · carbon-aware scheduling for AI compute",
    template: "%s · Tidegap",
  },
  description:
    "Open-source MCP server and CLI that defer non-urgent AI tasks to the cleanest electricity-grid window inside your deadline. Live carbon-intensity map of grid regions across North America, Europe and Asia-Pacific. Apache-2.0.",
  metadataBase: new URL("https://www.tidegap.com"),
  alternates: {
    canonical: "https://www.tidegap.com",
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
    "tidegap",
  ],
  authors: [{ name: "Vitalii Borovyk", url: "https://github.com/Vitalini" }],
  creator: "Vitalii Borovyk",
  publisher: "Tidegap",
  category: "developer tools",
  openGraph: {
    title: "Tidegap — Carbon-aware scheduling for agentic AI workflows",
    description:
      "MCP server that defers non-urgent AI tasks to the cleanest grid window inside your deadline. Per-task carbon receipts, Anthropic + OpenAI Batch APIs, durable SQLite queue. Apache-2.0.",
    url: "https://www.tidegap.com",
    siteName: "Tidegap",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Run non-urgent LLM tasks at the cleanest grid hour before your deadline.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Tidegap — Carbon-aware scheduling for agentic AI workflows",
    description:
      "MCP server that defers non-urgent AI tasks to the cleanest grid window. 1,423 tests, 10 MCP tools, persistent SQLite queue. Apache-2.0.",
    images: ["/og-image.png"],
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
      "@id": "https://www.tidegap.com/#software",
      name: "Tidegap",
      url: "https://www.tidegap.com",
      description:
        "Open-source carbon-aware scheduler for agentic AI workflows. Defers non-urgent LLM calls to the cleanest electricity-grid window inside a deadline via the Model Context Protocol.",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS, Linux, Windows",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      license: "https://opensource.org/licenses/Apache-2.0",
      softwareVersion: VERSION,
      author: {
        "@type": "Person",
        name: "Vitalii Borovyk",
        url: "https://github.com/Vitalini",
      },
      codeRepository: "https://github.com/tidegap/tidegap",
      keywords:
        "carbon-aware scheduling, MCP, Model Context Protocol, Claude Code plugin, grid carbon intensity, sustainable AI",
    },
    {
      "@type": "WebSite",
      "@id": "https://www.tidegap.com/#website",
      url: "https://www.tidegap.com",
      name: "Tidegap",
      description:
        "Carbon-aware scheduling for agentic AI workflows. Live electricity-grid carbon-intensity map for major LLM-provider regions.",
      publisher: { "@id": "https://www.tidegap.com/#software" },
      inLanguage: "en-US",
    },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The proxy-generated per-request nonce. The JSON-LD tag must carry it,
  // otherwise 'strict-dynamic' blocks this inline script. Reading `headers()`
  // is also what opts pages into dynamic rendering (see proxy.ts).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          nonce={nonce}
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
              v{VERSION} · operator preview · UTC-aligned
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
