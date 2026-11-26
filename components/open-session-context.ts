"use client";

import { createContext } from "react";

/** Opens a session inside this page, as picking its sidebar row does; false
 *  when the page cannot (the session is not listed), so the link it came from
 *  is left to the browser. A link in the transcript (a quoted session's title)
 *  reads it: a plain click must not reload the whole app. */
export const OpenSessionContext = createContext<((sessionId: string) => boolean) | null>(null);
