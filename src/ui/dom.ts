export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}
