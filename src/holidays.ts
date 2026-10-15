import data from "./holidays/2026.json";
import { localDay } from "./domain";
const years: Record<
  number,
  { complete: boolean; holidays: Record<string, string>; workdays: string[] }
> = { 2026: data };
export function dayInfo(date: string) {
  const year = years[Number(date.slice(0, 4))];
  const holiday = year?.holidays[date];
  const workday = year?.workdays.includes(date) ?? false;
  const weekday = localDay(date).getDay();
  return {
    holiday,
    workday,
    weekend: !workday && !holiday && (weekday === 0 || weekday === 6),
    known: year?.complete ?? false,
  };
}
