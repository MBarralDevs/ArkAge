/**
 * Discriminated Result envelopes for MCP tool outputs.
 *
 * Every tool returns Result<T> serialized as JSON. The MCP client (or the
 * transport, in the case of `isError`) inspects `ok` to branch.
 */

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; code: string; message: string; incidentId?: string };
export type Result<T> = Ok<T> | Err;

export const ok = <T>(data: T): Ok<T> => ({ ok: true, data });

export const err = (code: string, message: string, incidentId?: string): Err =>
    incidentId ? { ok: false, code, message, incidentId } : { ok: false, code, message };
