// Excerpt: texts only go out 9 AM to 7 PM local time. Pure functions, unit-tested across DST changes.

const TZ = 'America/New_York';
const OPEN_HOUR = 9;
const CLOSE_HOUR = 19;

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
});

function localParts(d: Date) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, Number(x.value)]));
  return { y: p.year, mo: p.month, d: p.day, h: p.hour };
}

/** The instant local wall-clock `y-mo-d 09:00` happens (09:00 never falls in a DST gap). */
function openingInstant(y: number, mo: number, d: number): Date {
  const guess = Date.UTC(y, mo - 1, d, OPEN_HOUR);
  const p = localParts(new Date(guess));
  const offset = Date.UTC(p.y, p.mo - 1, p.d, p.h) - guess;
  return new Date(guess - offset);
}

export function isInSendWindow(at: Date): boolean {
  const { h } = localParts(at);
  return h >= OPEN_HOUR && h < CLOSE_HOUR;
}

/** `from` itself if it is inside the window, otherwise the next 9 AM. */
export function nextSendTime(from: Date): Date {
  if (isInSendWindow(from)) return from;
  const { y, mo, d, h } = localParts(from);
  // before opening: today at 9; after closing: tomorrow at 9 (Date.UTC normalises month overflow)
  const day = h < OPEN_HOUR ? d : d + 1;
  const base = new Date(Date.UTC(y, mo - 1, day));
  return openingInstant(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}
