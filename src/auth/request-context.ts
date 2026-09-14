import { AsyncLocalStorage } from "node:async_hooks";
/** Set by the HTTP guard, never from a client-supplied header. */
export type AuthorizationContext = {
  actorId?: string;
  action?: string;
  sessionId?: string;
};
export const authorizationContext =
  new AsyncLocalStorage<AuthorizationContext>();
