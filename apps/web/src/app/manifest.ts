import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ebb-ai — Carbon-aware scheduling for AI workflows",
    short_name: "ebb-ai",
    description:
      "Defer non-urgent AI tasks to the cleanest grid window inside your deadline. Per-task carbon receipts, Anthropic + OpenAI Batch APIs, durable SQLite queue.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0e0d",
    theme_color: "#2dd4bf",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
