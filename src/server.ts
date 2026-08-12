import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { configureHttpDispatcher } from "@/lib/http-dispatcher";

configureHttpDispatcher();

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
