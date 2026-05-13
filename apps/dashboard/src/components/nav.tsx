import Link from "next/link";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Map" },
  { href: "/forecast", label: "Forecast" },
  { href: "/plan", label: "Plan" },
  { href: "/queue", label: "Queue" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent font-mono text-base font-bold text-bg"
          >
            ~
          </span>
          <span className="text-fg">ebb-ai</span>
          <span className="text-xs font-normal text-fg-muted">/ dashboard</span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg"
            >
              {link.label}
            </Link>
          ))}
          <a
            href="https://github.com/Vitalini/ebb-ai"
            target="_blank"
            rel="noreferrer"
            className="ml-2 rounded-md px-3 py-1.5 text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg"
          >
            GitHub <span aria-hidden="true">→</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
