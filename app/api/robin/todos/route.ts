import { NextResponse } from "next/server";
import {
  localDate,
  newId,
  normalizeDue,
  normalizeTodoColor,
  readTodos,
  writeTodos,
  type Todo,
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
 * `today` is resolved on the server because that is where the agent wrote the
 * `due` dates. Letting the browser decide would reintroduce the off-by-one the
 * store's local/UTC split exists to prevent.
 */
export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    return NextResponse.json({ todos: readTodos(), today: localDate() });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { title?: unknown; due?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return fail(new Error("title is required"));

    let due: string | undefined;
    if (typeof body.due === "string" && body.due.trim()) due = normalizeDue(body.due);

    const todos = readTodos();
    const todo: Todo = {
      id: newId(),
      title,
      done: false,
      ...(due ? { due } : {}),
      createdAt: new Date().toISOString(),
    };
    todos.push(todo);
    writeTodos(todos);
    return NextResponse.json({ todo, today: localDate() });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as {
      id?: unknown;
      done?: unknown;
      title?: unknown;
      due?: unknown;
      color?: unknown;
    };
    if (typeof body.id !== "string") return fail(new Error("id is required"));

    const todos = readTodos();
    const todo = todos.find((t) => t.id === body.id);
    if (!todo) return NextResponse.json({ error: `No todo with id "${body.id}"` }, { status: 404 });

    if (typeof body.done === "boolean") {
      todo.done = body.done;
      if (body.done) todo.completedAt = new Date().toISOString();
      else delete todo.completedAt;
    }
    if (typeof body.title === "string" && body.title.trim()) todo.title = body.title.trim();
    if (typeof body.due === "string") {
      if (body.due.trim()) todo.due = normalizeDue(body.due);
      else delete todo.due;
    }
    if (typeof body.color === "string") {
      if (body.color.trim()) todo.color = normalizeTodoColor(body.color);
      else delete todo.color;
    }

    writeTodos(todos);
    return NextResponse.json({ todo, today: localDate() });
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

    const todos = readTodos();
    const remaining = todos.filter((t) => t.id !== body.id);
    if (remaining.length === todos.length) {
      return NextResponse.json({ error: `No todo with id "${body.id}"` }, { status: 404 });
    }
    writeTodos(remaining);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
