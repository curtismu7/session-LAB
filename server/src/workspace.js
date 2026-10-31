// Rule 13: a workspace id (default `default`) names a visitor's own run. The app keeps no server state, so the workspace is what
// separates one visitor's trace ids from another's (the "trace sink"); there is no data directory or session to isolate.
export const DEFAULT_WORKSPACE = 'default';
const VALID = /^[a-z0-9][a-z0-9-]{0,29}$/;
export const workspaceFrom = (value) => (typeof value === 'string' && VALID.test(value) ? value : DEFAULT_WORKSPACE);
