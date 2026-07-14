// Phoenix (America/Phoenix) is a fixed UTC-7 offset year-round — see
// availability.ts for why this is manual arithmetic rather than a tz library.
const PHOENIX_UTC_OFFSET_SECONDS = 7 * 3600;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatPhoenixDateTime(unixSeconds: number): string {
  const shifted = new Date((unixSeconds - PHOENIX_UTC_OFFSET_SECONDS) * 1000);
  const dow = DOW[shifted.getUTCDay()];
  const month = MONTHS[shifted.getUTCMonth()];
  const day = shifted.getUTCDate();
  let hours = shifted.getUTCHours();
  const minutes = shifted.getUTCMinutes();
  const ampm = hours < 12 ? "AM" : "PM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const mm = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${dow}, ${month} ${day} at ${hours}:${mm} ${ampm}`;
}
