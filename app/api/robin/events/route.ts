import { NextResponse } from "next/server";
import { addDays } from "@/extension/robin/dates";
import type { DashboardEvent } from "@/extension/robin/events";
import { fetchEvents, isConnected } from "@/extension/robin/google-calendar";
import {
  localDate,
  newId,
  normalizeDue,
  normalizeTime,
  readEvents,
  writeEvents,
  type CalendarEvent,
} from "@/extension/robin/store";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function guard(req: Request, requireJson: boolean): NextResponse | null {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (requireJson && !hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

function fail(error: unknown, status = 400): NextResponse {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

/**
 * Local events, plus read-only ones from a connected Google calendar.
 *
 * `today` comes from the server, matching the local dates the agent wrote.
 * A Google failure degrades to local-only rather than failing the request: the
 * dashboard staying up with the user's own events beats an error page.
 */
export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    const today = localDate();
    const events: DashboardEvent[] = readEvents();

    if (!isConnected()) {
      return NextResponse.json({ events, today, google: { connected: false } });
    }

    try {
      // Wide enough to cover the month grid on either side of today.
      const pulled = await fetchEvents(addDays(today, -45), addDays(today, 75));
      return NextResponse.json({
        events: [...events, ...pulled],
        today,
        google: { connected: true },
      });
    } catch (googleError) {
      return NextResponse.json({
        events,
        today,
        google: {
          connected: true,
          error: googleError instanceof Error ? googleError.message : String(googleError),
        },
      });
    }
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as {
      title?: unknown;
      date?: unknown;
      endDate?: unknown;
      start?: unknown;
      end?: unknown;
      location?: unknown;
    };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return fail(new Error("title is required"));
    if (typeof body.date !== "string" || !body.date.trim()) return fail(new Error("date is required"));

    const date = normalizeDue(body.date);
    const endDate = typeof body.endDate === "string" && body.endDate.trim()
      ? normalizeDue(body.endDate)
      : undefined;
    if (endDate && endDate < date) return fail(new Error(`endDate ${endDate} is before ${date}`));

    const start = typeof body.start === "string" && body.start.trim()
      ? normalizeTime(body.start)
      : undefined;
    const end = typeof body.end === "string" && body.end.trim() ? normalizeTime(body.end) : undefined;
    if (end && !start) return fail(new Error("An end time needs a start time too"));
    // Times only have to be ordered within a single day; on a multi-day event
    // the end time belongs to the last day and may legitimately be earlier.
    if (start && end && !endDate && end < start) {
      return fail(new Error(`End ${end} is before start ${start}`));
    }

    const location = typeof body.location === "string" && body.location.trim()
      ? body.location.trim()
      : undefined;

    const events = readEvents();
    const event: CalendarEvent = {
      id: newId(),
      title,
      date,
      ...(endDate && endDate > date ? { endDate } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(location ? { location } : {}),
      createdAt: new Date().toISOString(),
    };
    events.push(event);
    writeEvents(events);
    return NextResponse.json({ event, today: localDate() });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { id?: unknown };
    if (typeof body.id !== "string") return fail(new Error("id is required"));

    const events = readEvents();
    const remaining = events.filter((event) => event.id !== body.id);
    if (remaining.length === events.length) {
      return NextResponse.json({ error: `No event with id "${body.id}"` }, { status: 404 });
    }
    writeEvents(remaining);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
