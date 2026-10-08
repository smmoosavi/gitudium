import { expect, test } from "bun:test";
import { formatDate } from "../src/client/date";

test("shared date formatter retains default locale, time zone, options and invalid fallback", () => {
  const expected = new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  for (const value of ["2026-01-01T00:00:00Z", "2026-07-01T23:59:00+03:30", "1970-01-01", "2024-02-29T12:34:56Z"]) {
    expect(formatDate(value)).toBe(expected.format(new Date(value)));
  }
  for (const value of ["", "not a date", "2026-99-99"]) expect(formatDate(value)).toBe(value);
});
