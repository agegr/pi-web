import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import { getRequestSecurityRejection } from "./request-security";

const requestSecurityMiddleware = createMiddleware().server(async ({ next, request }) => {
  const rejection = getRequestSecurityRejection(request);
  return rejection ?? next();
});

const serverFunctionCsrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [requestSecurityMiddleware, serverFunctionCsrfMiddleware],
}));
