import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import { getRequestSecurityRejection } from "./request-security";
import { getApiMethodRejection } from "./api-methods";

const requestSecurityMiddleware = createMiddleware().server(async ({ next, request }) => {
  const rejection = getRequestSecurityRejection(request);
  return rejection ?? next();
});

const apiMethodGuardMiddleware = createMiddleware().server(async ({ next, request }) => {
  const rejection = getApiMethodRejection(request);
  return rejection ?? next();
});

const serverFunctionCsrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    requestSecurityMiddleware,
    apiMethodGuardMiddleware,
    serverFunctionCsrfMiddleware,
  ],
}));
