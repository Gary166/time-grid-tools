# time-grid-tools

Generates an array of evenly spaced time slots between two datetimes at a specified interval, marking any slots that fall inside defined break windows.

## Usage

```js
import { generateTimeGrid } from 'time-grid-tools';

const slots = generateTimeGrid(
  '2024-06-01T09:00:00.000Z',
  '2024-06-01T17:00:00.000Z',
  30 * 60 * 1000, // 30 minutes in ms
  [
    { start: '2024-06-01T12:00:00.000Z', end: '2024-06-01T13:00:00.000Z' }, // lunch
  ]
);

// slots: [{ start, end, isBreak }, ...]
```

`start` and `end` are UTC ISO 8601 strings with milliseconds. `intervalMs` is a positive integer number of milliseconds. `breaks` is an optional array of `{ start, end }` windows. Each returned slot has `start`, `end`, and `isBreak` (a boolean).

## Why this exists

Booking and scheduling UIs frequently need a list of time slots with lunch or maintenance breaks visibly flagged. Doing this ad hoc in each project means every codebase reinvents the same off-by-one logic around break boundaries. This library does it once, deterministically, with no dependencies.

The trade-off: all datetimes must be in UTC (the string must end in `Z` or `+00:00`). Local-zone strings near DST transitions shift the grid in ways callers do not expect, so they are rejected outright. Convert to UTC before calling.

## Edge cases

If `intervalMs` does not evenly divide the span from `start` to `end`, the final slot is truncated so its `end` equals the requested `end`. It will be shorter than the others; this is intentional, not a bug.

A slot that straddles a break boundary is split into two slots — one non-break, one break — so no slot is ever partially inside a break. Overlapping or adjacent breaks are applied in sorted order and produce the same result regardless of input order. Zero-width or negative-width break windows are silently ignored.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

