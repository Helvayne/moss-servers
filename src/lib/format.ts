export function formatBytes(n: number): string {
  if (n < 1_000) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1_000)} KB`;
  if (n < 1_000_000_000) return `${Math.round(n / 1_000_000)} MB`;
  return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')} GB`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Fixed month names: ICU output differs between runtimes (e.g. "Sept" in en-GB).
export function formatDate(d: Date | string): string {
  const date = new Date(d);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// Discord-style icon text: one letter per word ("Moss Vanilla" -> "MV"), every capital in
// camel-cased words ("SkyFactory" -> "SF"), symbols and digits kept ("Cogs & Curses" -> "C&C").
export function serverInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).map((word) => {
    const caps = word.match(/[A-Z]/g);
    return caps && caps.length > 1 ? caps.join('') : word[0];
  });
  return parts.join('').toUpperCase().slice(0, 3);
}
