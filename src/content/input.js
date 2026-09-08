export function trustedKey(e) {
  return e.isTrusted === true && !e.isComposing && e.keyCode !== 229;
}
export function focusedElement() {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}
