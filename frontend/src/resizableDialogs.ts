/**
 * Every popup window can be resized by dragging its bottom-right corner.
 *
 * Popups are found as they appear (role="dialog" / "alertdialog" sitting in a fixed full-screen overlay), so
 * no dialog needs to opt in. Each keeps the width it opened at, then can be dragged between a small minimum and
 * 95% of the window; the height follows the content until the user drags it, and the content scrolls inside.
 */

const SELECTOR = '[role="dialog"], [role="alertdialog"]';
const MARK = "data-resizable";

function isPopup(element: HTMLElement): boolean {
  if (element.hasAttribute(MARK)) return false;
  const overlay = element.parentElement;
  const fixed = (node: Element | null) => !!node && window.getComputedStyle(node).position === "fixed";
  return fixed(element) || fixed(overlay);
}

function makeResizable(element: HTMLElement) {
  if (!isPopup(element)) return;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0) return; // not laid out (hidden, or a test environment)
  element.setAttribute(MARK, "true");
  // Fix the opening width so the max-w-* class no longer decides it; dragging can then widen past it.
  element.style.width = `${Math.round(rect.width)}px`;
  element.style.maxWidth = "95vw";
  element.style.maxHeight = "95vh";
  element.style.minWidth = `${Math.min(280, Math.round(rect.width))}px`;
  element.style.minHeight = "120px";
  element.style.resize = "both";
  if (window.getComputedStyle(element).overflow === "visible") element.style.overflow = "auto";
}

function scan(root: ParentNode) {
  if (root instanceof HTMLElement && root.matches(SELECTOR)) makeResizable(root);
  root.querySelectorAll<HTMLElement>(SELECTOR).forEach(makeResizable);
}

/** Start watching the page for popups. Returns a function that stops watching. */
export function enableResizableDialogs(): () => void {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => undefined;
  scan(document.body);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) scan(node);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
