export function localDate() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
export function shortDate(value) { return value ? new Date(value + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; }
export function dayNumber(value) { return value ? Date.parse(value + 'T00:00:00Z') / 86400000 : null; }
export function timing(trip, today = localDate()) {
  const start = dayNumber(trip.startDate), end = dayNumber(trip.endDate), now = dayNumber(today);
  if (start === null || end === null) return { total: 1, remaining: 1, phase: 'Add trip dates on Plan', active: false };
  const total = Math.max(1, end - start + 1);
  return { total, remaining: now > end ? 0 : now < start ? total : end - now + 1,
    phase: now < start ? (start - now) + ' days until departure' : now > end ? 'Trip completed' : 'Day ' + (now - start + 1) + ' of ' + total,
    active: now >= start && now <= end };
}
