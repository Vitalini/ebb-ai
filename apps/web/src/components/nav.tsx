import Link from "next/link";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/map", label: "Map" },
  { href: "/plan", label: "Plan" },
  { href: "/docs", label: "Docs" },
  { href: "/about", label: "About" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 whitespace-nowrap font-semibold tracking-tight"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent font-mono text-base font-bold text-bg"
          >
            ~
          </span>
          <span className="text-fg">ebb-ai</span>
        </Link>

        <nav className="flex items-center gap-0.5 whitespace-nowrap text-xs sm:gap-1 sm:text-sm">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-1.5 py-1.5 text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg sm:px-3"
            >
              {link.label}
            </Link>
          ))}
          <a
            href="https://github.com/Vitalini/ebb-ai"
            target="_blank"
            rel="noreferrer"
            className="ml-0.5 rounded-md px-1.5 py-1.5 text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg sm:ml-2 sm:px-3"
          >
            GitHub<span aria-hidden="true" className="hidden sm:inline"> →</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
