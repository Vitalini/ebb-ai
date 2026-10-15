// Toasts: short confirmations at the bottom of the page. Info toasts use
// role="status", errors role="alert". A toast may carry one action button
// (Undo, Start dispatcher, Open).

import { h } from "./dom.js";

const MAX_VISIBLE = 3;

function region() {
  return document.getElementById("toasts");
}

/**
 * Show a toast. Returns `{dismiss}`. `timeout` 0 keeps it until dismissed.
 * `onTimeout` runs when the toast expires on its own (not on dismiss or
 * on its action), which is how Undo's delayed commit works.
 */
export function toast(message, opts = {}) {
  const { kind = "info", action, timeout = kind === "error" ? 8000 : 4500, onTimeout, countdown = false } = opts;
  const root = region();
  let timer = null;
  let done = false;
  const el = h("div", {
    class: ["toast", `toast-${kind}`, countdown && "toast-countdown"],
    role: kind === "error" ? "alert" : "status",
  });
  const close = (why) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    el.classList.add("toast-out");
    setTimeout(() => el.remove(), 220);
    if (why === "timeout" && onTimeout) onTimeout();
  };
  el.append(h("span", { class: "toast-msg" }, message));
  if (action) {
    el.append(
      h("button", {
        type: "button",
        class: "toast-action",
        onclick: () => {
          close("action");
          action.run();
        },
      }, action.label),
    );
  }
  el.append(h("button", { type: "button", class: "toast-close", "aria-label": "Dismiss", onclick: () => close("dismiss") }, "×"));
  if (countdown && timeout > 0) {
    const bar = h("span", { class: "toast-bar", "aria-hidden": "true" });
    bar.style.animationDuration = `${timeout}ms`;
    el.append(bar);
  }
  root.append(el);
  // Evict the oldest toast that carries no pending commit. An Undo toast
  // stays until it expires (its expiry is the commit), so the stack may grow
  // past the cap when several cancels wait at once.
  while (root.children.length > MAX_VISIBLE) {
    const old = [...root.children].find((c) => !c.classList.contains("toast-countdown"));
    if (!old) break;
    old.remove();
  }
  if (timeout > 0) timer = setTimeout(() => close("timeout"), timeout);
  return { dismiss: () => close("dismiss"), expire: () => close("timeout"), element: el };
}

export function errorToast(message, action) {
  return toast(message, { kind: "error", action });
}
