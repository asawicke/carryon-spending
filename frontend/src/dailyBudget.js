import { dayNumber, localDate, timing } from './time.js';

export function dailyBudget(trip, expenses, today = localDate()) {
  const daily = trip.dailyCategories || ['Food', 'Activities', 'Shopping', 'Other'];
  const limits = trip.categoryBudgets || {};
  const selected = expenses.filter((row) => daily.includes(row.category));
  const spent = expenses.reduce((sum, row) => sum + Number(row.amountBase), 0);
  const variableSpent = selected.reduce((sum, row) => sum + Number(row.amountBase), 0);
  const spentToday = selected.filter((row) => row.date === today).reduce((sum, row) => sum + Number(row.amountBase), 0);
  const planned = daily.reduce((sum, category) => sum + Number(limits[category] || 0), 0);
  const fixedOutstanding = Object.entries(limits).filter(([category]) => !daily.includes(category)).reduce((sum, [category, limit]) =>
    sum + Math.max(0, Number(limit) - expenses.filter((row) => row.category === category).reduce((n, row) => n + Number(row.amountBase), 0)), 0);
  const remaining = Math.min(planned - variableSpent, trip.budget - spent - fixedOutstanding);
  const time = timing(trip, today), stops = trip.destinations || [];
  const current = stops.find((row) => row.startDate <= today && row.endDate >= today);
  const first = stops[0], active = current || (today < trip.startDate ? first : null);
  const weight = (row) => row?.priceLevel?.value ? row.priceLevel.value / 100 : 1;
  let totalWeight = time.remaining;
  if (stops.length && time.remaining) {
    totalWeight = stops.reduce((sum, row) => {
      const days = Math.max(0, dayNumber(row.endDate) - Math.max(dayNumber(row.startDate), dayNumber(today)) + 1);
      return sum + days * weight(row);
    }, 0);
  }
  const target = planned > 0 && totalWeight > 0 ? Math.max(0, remaining + (time.active ? spentToday : 0)) * weight(active) / totalWeight : null;
  return { planned, remaining, spentToday, target, leftToday: target === null ? null : target - spentToday,
    suggested: target === null ? null : Math.max(0, remaining) * weight(active) / totalWeight,
    destination: active, variableSpent, categories: daily, time };
}
