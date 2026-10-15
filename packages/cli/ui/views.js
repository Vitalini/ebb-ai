// Shared view states: empty, error and loading skeletons.

import { h } from "./dom.js";

export function emptyState({ title, body, link, glyph = "○" }) {
  return h("div", { class: "empty" },
    h("div", { class: "empty-glyph", "aria-hidden": "true" }, glyph),
    h("p", { class: "empty-title" }, title),
    body ? h("p", { class: "empty-body" }, body) : null,
    link ? h("a", { class: "empty-link", href: link.href }, link.text) : null);
}

/** Inline error card with Retry (handled by app.js through data-action). */
export function errorCard(message) {
  return h("div", { class: "error-card", role: "alert" },
    h("span", {}, message),
    h("button", { type: "button", class: "btn btn-sm", "data-action": "retry" }, "Retry"));
}

export function skeletonRows(n) {
  const ul = h("ul", { class: "rows", "aria-hidden": "true" });
  for (let i = 0; i < n; i++) {
    ul.append(h("li", { class: "row row-skeleton" },
      h("span", { class: "row-dot" }),
      h("span", { class: "sk sk-time" }),
      h("span", { class: "sk sk-chip" }),
      h("span", { class: "row-main" }, h("span", { class: `sk sk-line ${i % 2 ? "sk-short" : ""}` }), h("span", { class: "sk sk-line sk-sub" })),
      h("span", { class: "sk sk-pm" })));
  }
  return ul;
}
