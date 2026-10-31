# Talk track

Six hops. The app shows the same text in its Talk track panel, filled for the chosen vertical (airline, health plan, bank).

Say first: three things are separate. The **PingOne session** lives at PingOne. The **cookie** is how the browser presents it to PingOne. The **tokens** are what each app holds, with their own lifetime. Ending the session does not recall a token already issued.

1. **Sign in once.** The member signs in through a DaVinci flow. Return Success Response creates the PingOne session and the browser gets a session cookie. Click Sign in, then point at the cookie panel.
2. **A second app, no prompt.** The member portal sends the browser to PingOne. The browser sends the cookie, PingOne recognises the session and issues tokens with no password prompt. Click Open app.
3. **Tokens are not the session.** The portal calls the API with its access token. The API checks signature and expiry only. Delete the session, call the API again: it still works until the token lapses.
4. **Step up.** The payments app wants mfa within a window the admin sets (Ping's write-up uses 8 or 9 hours; the lab starts at 8). A password-only session is bounced. Check Session reads the `mfa` method's own last sign-on time, not just whether a cookie exists. Complete MFA and that time moves to now; move the clock +9 hours and it is bounced again. Each method keeps its own time, so refreshing `mfa` leaves `pwd` where it was. Recording `mfa` only describes what the flow did.
5. **The widget reuses the session.** The embedded widget POSTs the SDK-token request with the stored sessionToken in `global.sessionToken`. Try it as a GET, then forget the token: both fail.
6. **An admin changes the session.** Delete it, soft delete it, shorten the idle timeout (then move the clock), add an mfa rule, or have a flow report a method that never ran. Watch the arrows light and read the impact log: which app lost SSO, which kept a still-valid token.

**Sticky SSO (the common mistake).** Sign in with MFA, move the clock +9 hours, open the payments app: bounced. Click "Report mfa with no challenge" and open it again: it passes. A flow that always sends `mfa` on Return Success Response refreshes the "last login" with no login. The right answer for a flow that authenticated nobody is to report no methods.

Passwordless: sign in with fido + pwdless and the record has no `pwd` at all. `fido` and `pwdless` are custom values, not connector built-ins.

Live demo trick: sign in, open DevTools, Application, Cookies, delete `mock-ST`, click Open app. The PingOne session is still live, but this browser can no longer prove it.

## What is simulated, what is sourced

Everything is a mock. Redirect apps receive tokens directly here; in a real redirect flow they get a code through the browser.

From Ping's docs ([PingOne Authentication connector](https://docs.pingidentity.com/connectors/p1_authentication_connector.html), [Editing an application, OIDC](https://docs.pingidentity.com/pingone/applications/p1_edit_application_oidc.html)): there is one PingOne user authentication session; Return Success Response creates it; Authentication Methods are values the flow sets (`pwd` by default, `mfa`, `otp`, `sms`, `rba`, custom); Check Session requires one method signed on within a window; Delete Session signs out and Soft Delete keeps the record; the default idle timeout is 30 days and a shorter one is set on the Return Success Response node (minutes); OIDC session management needs a custom domain and works only between apps in the same browsing mode; `/idpSignoff` can end a session from the ID token alone.

From the owner-supplied guide and write-up: session, cookie, sessionToken, SDK token and OIDC tokens are separate; the widget handoff is a POST with `global.sessionToken`; each method keeps its own last sign-on time; the idle window slides on every Return Success Response; reporting a method that did not happen makes SSO sticky; the cookie is called the "ST cookie".

Lab choices, UNVERIFIED as product behaviour: cookie flags, host and token names; the 8-hour rule; an idle-timeout change applying to a live session; the idle window also sliding on SSO through an app; whether a refresh token is tied to the session (the OIDC app page gives only 30-day and 180-day rolling durations).
