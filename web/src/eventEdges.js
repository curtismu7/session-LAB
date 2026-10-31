// Which diagram arrows an event lit up. Indexes follow server/diagrams/session-lab-flow.json (the same numbers its steps use).
// This is what makes the diagram react to what you just did.
const MAP = {
  "session.created": [0, 1],
  "authorize.sso": [2, 3],
  "authorize.login_required": [2],
  "authorize.step_up_required": [4, 5],
  "session.mfa_recorded": [4],
  "widget.sso": [6, 7, 8],
  "widget.sign_in": [0, 1, 8],
  "widget.login_required": [6, 7],
  "widget.rejected": [6],
  "widget.token_dropped": [6],
  "api.200": [9],
  "api.401": [9],
  "token.refreshed": [2, 3],
  "session.deleted": [10],
  "session.soft_deleted": [10],
  "config.idle_timeout": [10],
  "config.mfa_policy": [10],
  "session.method_reported": [10],
  "session.report_null": [10],
};
export const edgesForEvent = (ev) => (ev && MAP[ev.kind]) || [];
