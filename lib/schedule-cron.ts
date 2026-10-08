/**
 * A small 5-field cron parser and next-fire-time calculator.
 *
 * Field order: minute hour day-of-month month day-of-week.
 * Supported syntax per field: `*`, `a`, `a-b`, `a-b/step`, `*∕step`, and comma
 * lists of those. Day-of-week accepts 0-7 with both 0 and 7 meaning Sunday, and
 * names (`mon`..`sun`). Month accepts names (`jan`..`dec`).
 *
 * Deliberately dependency-free: the repo ships no cron library, and this is the
 * kind of pure function that is cheaper to test than to vendor. Times are read in
 * the host's local timezone, which is what a user typing "9am daily" means.
 */

export interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  /** True when the field was `*`, so day matching can use the DOM/DOW OR rule. */
  domRestricted: boolean;
  dowRestricted: boolean;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const DAY_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const RANGES: Record<string, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 7],
};

function namedValue(raw: string, kind: string): number | null {
  const lower = raw.toLowerCase();
  if (kind === "month" && lower in MONTH_NAMES) return MONTH_NAMES[lower];
  if (kind === "dayOfWeek" && lower in DAY_NAMES) return DAY_NAMES[lower];
  return null;
}

function parseNumber(raw: string, kind: string): number {
  const named = namedValue(raw, kind);
  if (named !== null) return named;
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${kind}: ${raw}`);
  return Number(raw);
}

function parseField(raw: string, kind: string, label: string): { values: Set<number>; restricted: boolean } {
  const [min, max] = RANGES[kind];
  const values = new Set<number>();
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`Empty ${label} field`);

  for (const part of trimmed.split(",")) {
    const segment = part.trim();
    if (!segment) throw new Error(`Empty entry in ${label} field`);

    // step: `*/5`, `1-10/2`, or `5/2` (treated as 5-max/2 per cron convention)
    let step = 1;
    let base = segment;
    const slash = segment.indexOf("/");
    if (slash !== -1) {
      base = segment.slice(0, slash);
      const stepRaw = segment.slice(slash + 1).trim();
      if (!/^\d+$/.test(stepRaw)) throw new Error(`Invalid step in ${label}: ${segment}`);
      step = Number(stepRaw);
      if (step < 1) throw new Error(`Step must be >= 1 in ${label}: ${segment}`);
    }

    let lo: number;
    let hi: number;
    if (base === "*") {
      lo = min;
      hi = max;
    } else if (base.includes("-")) {
      const [loRaw, hiRaw] = base.split("-");
      lo = parseNumber(loRaw.trim(), kind);
      hi = parseNumber(hiRaw.trim(), kind);
    } else {
      lo = parseNumber(base, kind);
      // `5/2` means "from 5 to max, every 2"; a bare `5` is just 5.
      hi = slash === -1 ? lo : max;
    }

    if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error(`Invalid range in ${label}: ${segment}`);
    if (lo < min || hi > max || lo > hi) {
      throw new Error(`${label} out of range ${min}-${max}: ${segment}`);
    }
    for (let value = lo; value <= hi; value += step) values.add(value);
  }

  // 7 and 0 both mean Sunday; normalise so matching only compares 0-6.
  if (kind === "dayOfWeek" && values.has(7)) {
    values.delete(7);
    values.add(0);
  }
  return { values, restricted: trimmed !== "*" };
}

/** Parse a 5-field cron expression. Throws with a readable message on bad input. */
export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron expression needs 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const m = parseField(minute, "minute", "minute");
  const h = parseField(hour, "hour", "hour");
  const dom = parseField(dayOfMonth, "dayOfMonth", "day-of-month");
  const mo = parseField(month, "month", "month");
  const dow = parseField(dayOfWeek, "dayOfWeek", "day-of-week");
  return {
    minutes: m.values,
    hours: h.values,
    daysOfMonth: dom.values,
    months: mo.values,
    daysOfWeek: dow.values,
    domRestricted: dom.restricted,
    dowRestricted: dow.restricted,
  };
}

/** True when the expression parses; used by the API to reject bad schedules early. */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

function dayMatches(fields: CronFields, date: Date): boolean {
  if (!fields.months.has(date.getMonth() + 1)) return false;
  const domMatch = fields.daysOfMonth.has(date.getDate());
  const dowMatch = fields.daysOfWeek.has(date.getDay());
  // Standard cron: when both day fields are restricted, either may match.
  if (fields.domRestricted && fields.dowRestricted) return domMatch || dowMatch;
  if (fields.domRestricted) return domMatch;
  if (fields.dowRestricted) return dowMatch;
  return true;
}

/**
 * The first fire strictly after `from`, in local time.
 *
 * Walks minute by minute but skips whole days and hours that cannot match, so a
 * sparse expression such as `0 3 1 1 *` resolves by scanning a year of days
 * rather than half a million minutes. Returns null when nothing matches within
 * ~4 years (e.g. `0 0 30 2 *`), which is a real answer, not a failure.
 */
export function nextCronTime(expression: string, from: Date = new Date()): Date | null {
  const fields = parseCron(expression);
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limit = new Date(cursor.getTime());
  limit.setFullYear(limit.getFullYear() + 4);

  while (cursor < limit) {
    if (!fields.months.has(cursor.getMonth() + 1) || !dayMatches(fields, cursor)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!fields.hours.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!fields.minutes.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }
    return new Date(cursor.getTime());
  }
  return null;
}

/**
 * Turn a natural-language schedule into a cron expression.
 *
 * Only the phrasings the Schedule UI offers are recognised; anything else returns
 * null so the caller can ask the user instead of guessing. Guessing here would
 * silently schedule the wrong thing, which is worse than a missing schedule.
 */
export function describeToCron(text: string): { cron: string; summary: string } | null {
  const raw = text.trim();
  const lower = raw.toLowerCase();

  // Match the clock time first, preferring an explicit HH:MM (with either colon)
  // and only then a bare hour. Parsing the digit that follows "每月 1 日" as a
  // time would silently schedule 01:00 instead of the stated 08:00.
  let hour: number | undefined;
  let minute = 0;
  const clock = raw.match(/(\d{1,2})[:：](\d{2})\s*(am|pm)?/i);
  if (clock) {
    hour = Number(clock[1]);
    minute = Number(clock[2]);
    if (clock[3]?.toLowerCase() === "pm" && hour < 12) hour += 12;
    if (clock[3]?.toLowerCase() === "am" && hour === 12) hour = 0;
  } else {
    const bare = lower.match(/(?<![:：\d])(\d{1,2})\s*(am|pm)/);
    if (bare) {
      hour = Number(bare[1]);
      if (bare[2] === "pm" && hour < 12) hour += 12;
      if (bare[2] === "am" && hour === 12) hour = 0;
    }
  }
  if (hour === undefined || hour > 23 || minute > 59) return null;
  const hm = `${minute} ${hour}`;

  if (/每天|每日|daily|every\s*day/.test(lower)) {
    return { cron: `${hm} * * *`, summary: `每天 ${pad(hour)}:${pad(minute)}` };
  }
  if (/每周|每星期|weekly|every\s*week/.test(lower)) {
    const day = weekdayFrom(lower);
    if (day === null) return null;
    return { cron: `${hm} * * ${day}`, summary: `每周${DAY_CN[day]} ${pad(hour)}:${pad(minute)}` };
  }
  if (/每月|monthly|every\s*month/.test(lower)) {
    // Take the day-of-month that precedes 日/号, never a bare digit elsewhere.
    const domMatch = lower.match(/(\d{1,2})\s*(号|日)/) ?? lower.match(/day\s*(\d{1,2})/);
    const dom = domMatch ? Number(domMatch[1]) : 1;
    if (dom < 1 || dom > 31) return null;
    return { cron: `${hm} ${dom} * *`, summary: `每月 ${dom} 日 ${pad(hour)}:${pad(minute)}` };
  }
  const everyN = lower.match(/每\s*(\d+)\s*天|every\s*(\d+)\s*days?/);
  if (everyN) {
    const n = Number(everyN[1] ?? everyN[2]);
    if (n < 1 || n > 31) return null;
    // Approximated as "1st,1+n,1+2n..." of the month; a true N-day interval
    // needs a stateful scheduler, so keep it inside one month.
    return { cron: `${hm} */${n} * *`, summary: `每 ${n} 天 ${pad(hour)}:${pad(minute)}（按日期近似）` };
  }
  if (/一次|only\s*once|once/.test(lower)) {
    // One-shot has no cron form; the caller stores an absolute time instead.
    return null;
  }
  return null;
}

const DAY_CN: Record<number, string> = { 0: "日", 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六" };

function weekdayFrom(lower: string): number | null {
  if (/周一|星期一|monday|mon\b/.test(lower)) return 1;
  if (/周二|星期二|tuesday|tue\b/.test(lower)) return 2;
  if (/周三|星期三|wednesday|wed\b/.test(lower)) return 3;
  if (/周四|星期四|thursday|thu\b/.test(lower)) return 4;
  if (/周五|星期五|friday|fri\b/.test(lower)) return 5;
  if (/周六|星期六|saturday|sat\b/.test(lower)) return 6;
  if (/周日|周天|星期日|星期天|sunday|sun\b/.test(lower)) return 0;
  return null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Human-readable summary of a cron expression, used when the UI has only the cron. */
export function summarizeCron(expression: string): string {
  try {
    const fields = parseCron(expression);
    const next = nextCronTime(expression);
    const at = fields.minutes.size === 1 && fields.hours.size === 1
      ? `${pad([...fields.hours][0])}:${pad([...fields.minutes][0])}`
      : "（自定义）";
    return next ? `${at}，下次 ${next.toLocaleString("zh-CN")}` : `${at}（未来 4 年内无匹配时间）`;
  } catch (error) {
    return `无效表达式：${(error as Error).message}`;
  }
}
