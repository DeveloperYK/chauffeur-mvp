/**
 * Session lifetime policy. Kept free of DB / Node imports so the edge
 * middleware can share it with the server-side session store.
 */

/** How long a session (and its cookie) lives after the last refresh. */
export const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/** The server-side row is re-extended once it is older than this. */
export const SESSION_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
