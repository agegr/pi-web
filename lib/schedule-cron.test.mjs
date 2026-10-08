import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCron, isValidCron, nextCronTime, describeToCron } from "./schedule-cron.ts";

test("parses the five basic field forms", () => {
  const f = parseCron("30 9 * * *");
  assert.deepEqual([...f.minutes], [30]);
  assert.deepEqual([...f.hours], [9]);
  assert.equal(f.daysOfMonth.size, 31);
  assert.equal(f.months.size, 12);
  assert.equal(f.daysOfWeek.size, 7);
  assert.equal(f.domRestricted, false);
  assert.equal(f.dowRestricted, false);
});

test("parses ranges, steps and lists", () => {
  assert.deepEqual([...parseCron("*/15 * * * *").minutes], [0, 15, 30, 45]);
  assert.deepEqual([...parseCron("0 9-11 * * *").hours], [9, 10, 11]);
  assert.deepEqual([...parseCron("0 0,12 * * *").hours], [0, 12]);
  assert.deepEqual([...parseCron("0 */6 * * *").hours], [0, 6, 12, 18]);
});

test("normalises Sunday: 0 and 7 both mean Sunday", () => {
  assert.deepEqual([...parseCron("0 0 * * 0").daysOfWeek], [0]);
  assert.deepEqual([...parseCron("0 0 * * 7").daysOfWeek], [0]);
  assert.deepEqual([...parseCron("0 0 * * sun").daysOfWeek], [0]);
  assert.deepEqual([...parseCron("0 0 * * mon").daysOfWeek], [1]);
});

test("accepts month names and rejects out-of-range values", () => {
  assert.deepEqual([...parseCron("0 0 1 jan *").months], [1]);
  assert.equal(isValidCron("60 0 * * *"), false);   // minute 60
  assert.equal(isValidCron("0 24 * * *"), false);   // hour 24
  assert.equal(isValidCron("0 0 32 * *"), false);   // day 32
  assert.equal(isValidCron("0 0 * 13 *"), false);   // month 13
  assert.equal(isValidCron("0 0 * * 8"), false);    // dow 8
  assert.equal(isValidCron("0 0 * *"), false);      // too few fields
  assert.equal(isValidCron("0 0 * * * *"), false);  // too many fields
  assert.equal(isValidCron("0 0 * * mon-frix"), false);
});

test("next fire time is strictly after the reference and in the future", () => {
  const from = new Date(2026, 9, 8, 8, 47, 0); // 2026-10-08 08:47 local
  const next = nextCronTime("57 8 * * *", from);
  assert.ok(next, "expected a next time");
  assert.equal(next.getDate(), 8);
  assert.equal(next.getHours(), 8);
  assert.equal(next.getMinutes(), 57);
  assert.ok(next.getTime() > from.getTime());
});

test("a time already passed today rolls to tomorrow", () => {
  const from = new Date(2026, 9, 8, 10, 0, 0);
  const next = nextCronTime("0 9 * * *", from);
  assert.ok(next);
  assert.equal(next.getDate(), 9);
  assert.equal(next.getHours(), 9);
});

test("weekly schedule lands on the requested weekday", () => {
  const from = new Date(2026, 9, 8, 0, 0, 0); // Thursday
  const next = nextCronTime("0 9 * * 1", from); // next Monday
  assert.ok(next);
  assert.equal(next.getDay(), 1);
  assert.equal(next.getDate(), 12);
});

test("both day fields restricted uses the cron OR rule", () => {
  // 1st of month OR Monday, i.e. matches whichever comes first.
  const from = new Date(2026, 9, 8, 0, 0, 0); // Thu Oct 8
  const next = nextCronTime("0 0 1 * 1", from);
  assert.ok(next);
  assert.ok(next.getDay() === 1 || next.getDate() === 1);
  assert.equal(next.getDate(), 12); // Mon Oct 12 comes before Nov 1
});

test("impossible dates return null instead of looping forever", () => {
  assert.equal(nextCronTime("0 0 30 2 *", new Date(2026, 0, 1)), null);
});

test("describeToCron maps the phrasings the UI offers", () => {
  assert.equal(describeToCron("每天 09:30")?.cron, "30 9 * * *");
  assert.equal(describeToCron("每天 9:00")?.cron, "0 9 * * *");
  assert.equal(describeToCron("每周一 09:00")?.cron, "0 9 * * 1");
  assert.equal(describeToCron("每周五 18:30")?.cron, "30 18 * * 5");
  assert.equal(describeToCron("每月 1 日 08:00")?.cron, "0 8 1 * *");
  assert.equal(describeToCron("每 2 天 09:00")?.cron, "0 9 */2 * *");
  assert.equal(describeToCron("daily 9am")?.cron, "0 9 * * *");
});

test("describeToCron refuses to guess when it does not understand", () => {
  assert.equal(describeToCron("随便什么时候"), null);
  assert.equal(describeToCron("每天 25:00"), null);
  assert.equal(describeToCron("每周 09:00"), null); // weekday missing
});

test("every expression describeToCron produces is itself valid", () => {
  for (const phrase of ["每天 09:30", "每周一 09:00", "每月 1 日 08:00", "每 2 天 09:00", "daily 9am"]) {
    const result = describeToCron(phrase);
    assert.ok(result, `no result for ${phrase}`);
    assert.equal(isValidCron(result.cron), true, `invalid cron for ${phrase}: ${result.cron}`);
  }
});
