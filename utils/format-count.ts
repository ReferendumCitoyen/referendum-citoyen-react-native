/**
 * A vote count as the reader's language writes it (QA 2.0.2, item 8): French
 * "1 201" (narrow no-break space, so the number never breaks across lines),
 * English "1,201". Done by hand rather than with toLocaleString(), whose
 * result depends on the phone's Intl data, not on the app's language: the
 * QA gallery showed "1,201" in the French app.
 */
import i18next from 'i18next';

const NARROW_NBSP = ' ';

export function formatCount(value: number | bigint, language?: string): string {
  const lang = (language ?? i18next.language ?? 'fr').toLowerCase();
  const n = typeof value === 'bigint' ? value : BigInt(Math.trunc(Number.isFinite(value) ? value : 0));
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString();
  const sep = lang.startsWith('en') ? ',' : NARROW_NBSP;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return negative ? `-${grouped}` : grouped;
}
