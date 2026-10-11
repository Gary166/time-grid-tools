/**
 * Generates an array of evenly spaced time slots between two datetimes at a
 * specified interval, supporting exclusion of defined break windows.
 *
 * All inputs and return values are ISO 8601 strings with milliseconds, in UTC.
 * We restrict to UTC because mixing local-zone strings with break windows
 * near DST boundaries is a source of off-by-one-hour bugs that callers do not
 * expect. If you need local-time grids, convert to UTC before calling.
 *
 * Each slot is an object: { start: string, end: string, isBreak: boolean }.
 * Slots entirely inside a break window are marked isBreak=true and kept in the
 * list. Slots that merely overlap a boundary are truncated so they remain
 * wholly inside or wholly outside the break. This avoids ambiguous "partial
 * break" slots that downstream code would have to interpret.
 */

/**
 * Parse an ISO 8601 string into milliseconds since the epoch.
 *
 * We require the 'Z' suffix (or '+00:00') so the caller is forced to state the
 * timezone explicitly. Silent UTC assumption from naked strings is the most
 * common source of subtle grid-shifting bugs, so we refuse it.
 */
function parseUtcMs(iso) {
  if (typeof iso !== 'string') {
    throw new TypeError('Expected an ISO 8601 string');
  }
  if (!/T.*([Z]|[+]00:00)$/.test(iso)) {
    throw new Error(
      `Expected a UTC ISO 8601 string ending in 'Z' or '+00:00', got: ${iso}`
    );
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`Unparseable date: ${iso}`);
  }
  return ms;
}

/**
 * Format milliseconds since the epoch as a fixed-width ISO 8601 UTC string.
 * Date.toISOString already does exactly this; we wrap it for symmetry with
 * parseUtcMs and to make the format boundary explicit.
 */
function formatUtcIso(ms) {
  return new Date(ms).toISOString();
}

/**
 * Split a slot at a given boundary timestamp, returning one slot before the
 * boundary and one at-or-after the boundary. Only called when the boundary
 * strictly splits the slot, so the two halves never overlap.
 */
function splitSlot(slot, boundaryMs) {
  return [
    { start: slot.start, end: formatUtcIso(boundaryMs), isBreak: slot.isBreak },
    { start: formatUtcIso(boundaryMs), end: slot.end, isBreak: slot.isBreak },
  ];
}

/**
 * Given a list of slots sorted by start time, apply one break window and
 * return a new list with any overlapping slots split and flagged.
 *
 * We iterate left-to-right and rebuild the list because the number of slots
 * per break is small (a grid rarely has more than a few hundred slots), so a
 * simple linear scan is clearer than a binary search and has no measurable
 * cost.
 */
function applyBreak(slots, breakStartMs, breakEndMs) {
  const out = [];
  for (const slot of slots) {
    const slotStartMs = parseUtcMs(slot.start);
    const slotEndMs = parseUtcMs(slot.end);

    if (slotEndMs <= breakStartMs) {
      // entirely before the break
      out.push(slot);
      continue;
    }
    if (slotStartMs >= breakEndMs) {
      // entirely after the break
      out.push(slot);
      continue;
    }

    // There is some overlap. Handle the leading non-break tail, the break
    // middle, and the trailing non-break tail independently.
    if (slotStartMs < breakStartMs) {
      out.push({
        start: slot.start,
        end: formatUtcIso(breakStartMs),
        isBreak: false,
      });
    }

    const midStart = Math.max(slotStartMs, breakStartMs);
    const midEnd = Math.min(slotEndMs, breakEndMs);
    if (midStart < midEnd) {
      out.push({
        start: formatUtcIso(midStart),
        end: formatUtcIso(midEnd),
        isBreak: true,
      });
    }

    if (slotEndMs > breakEndMs) {
      out.push({
        start: formatUtcIso(breakEndMs),
        end: slot.end,
        isBreak: false,
      });
    }
  }
  return out;
}

/**
 * Normalise and sort break windows so we can apply them in ascending order.
 * Windows where end <= start are dropped: a zero-width break is meaningless
 * and a negative-width break is almost certainly a caller typo.
 */
function normalizeBreaks(breaks) {
  if (!breaks) return [];
  const out = [];
  for (const b of breaks) {
    const s = parseUtcMs(b.start);
    const e = parseUtcMs(b.end);
    if (e <= s) continue;
    out.push({ start: s, end: e });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * @typedef {Object} TimeSlot
 * @property {string} start   ISO 8601 UTC string with milliseconds.
 * @property {string} end     ISO 8601 UTC string with milliseconds.
 * @property {boolean} isBreak True if this slot lies entirely inside a break.
 */

/**
 * Generate evenly spaced time slots between `start` and `end` at `intervalMs`
 * milliseconds, marking any slots that fall inside the given break windows.
 *
 * Slots begin at `start` and step forward by `intervalMs`. A final slot whose
 * end would exceed `end` is truncated so its end equals `end`; we never emit a
 * slot past the requested boundary. If `intervalMs` does not divide the total
 * span, the last slot is simply shorter — this is the pragmatic choice, and is
 * documented here so callers know not to expect uniform last-slot length.
 *
 * @param {string} start     UTC ISO 8601 string, inclusive grid start.
 * @param {string} end       UTC ISO 8601 string, inclusive grid end.
 * @param {number} intervalMs Slot width in milliseconds. Must be a positive
 *                            finite integer.
 * @param {Array<{start: string, end: string}>} [breaks=[]] Break windows.
 * @returns {TimeSlot[]} Ordered list of slots covering [start, end].
 */
export function generateTimeGrid(start, end, intervalMs, breaks = []) {
  if (typeof intervalMs !== 'number' ||
      !Number.isInteger(intervalMs) ||
      intervalMs <= 0) {
    throw new Error(`intervalMs must be a positive integer, got: ${intervalMs}`);
  }

  const startMs = parseUtcMs(start);
  const endMs = parseUtcMs(end);
  if (endMs < startMs) {
    throw new Error(`end must not be before start: start=${start}, end=${end}`);
  }

  // Build the raw, break-less grid. A zero-duration range (start === end)
  // produces an empty array because a slot of width zero is useless and
  // callers asking for an empty range almost always want an empty result.
  const slots = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const slotEnd = Math.min(cursor + intervalMs, endMs);
    slots.push({
      start: formatUtcIso(cursor),
      end: formatUtcIso(slotEnd),
      isBreak: false,
    });
    cursor = slotEnd;
  }

  const normBreaks = normalizeBreaks(breaks);
  let result = slots;
  for (const b of normBreaks) {
    result = applyBreak(result, b.start, b.end);
  }

  return result;
}
