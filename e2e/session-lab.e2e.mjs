// Browser checks against a RUNNING session-lab: E2E_URL=http://127.0.0.1:6890/ node e2e/session-lab.e2e.mjs
// Playwright is not a dependency of this repo: install it anywhere and point PLAYWRIGHT_DIR at that folder (or install it globally).
import { createRequire } from 'node:module';
const require = createRequire(`${process.env.PLAYWRIGHT_DIR || process.cwd()}/package.json`);
const { chromium } = require('playwright');
const B = process.env.E2E_URL || 'http://127.0.0.1:6890/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) process.exitCode = 1; };
const text = (id) => page.getByTestId(id).innerText();

await page.goto(B); await page.getByTestId('banner').waitFor();
ok(/SIMULATION/.test(await text('banner')), 'banner says simulation');
ok((await page.locator('.react-flow__node').count()) === 8, '8 diagram boxes');

// 1. sign in -> real cookie
await page.getByText('Sign in (password only)').click();
await page.getByTestId('cookie').waitFor();
const real = await ctx.cookies(B);
const c = real.find((x) => x.name === 'mock-ST');
ok(c && c.httpOnly === true, 'browser really holds an HttpOnly mock-ST cookie');
ok((await text('docookie')).includes('document.cookie = ""'), 'page JavaScript cannot read it');
ok(await page.evaluate(() => document.cookie) === '', 'document.cookie is empty in the page');

// 2. SSO
await page.getByTestId('app-portal').getByText('Open app (SSO)').click();
await page.getByText('signed in').first().waitFor();
ok((await text('outcome-portal')).includes('signed in'), 'portal SSO with no prompt');
ok((await page.locator('.box--hot').count()) >= 2, 'diagram lit arrows for the last action');

// 3. step-up
await page.getByTestId('app-banking').getByText('Open app (SSO)').click();
await page.waitForFunction(() => document.querySelector('[data-testid=outcome-banking]')?.textContent.includes('asks for MFA'));
ok(true, 'payments app bounced to MFA (pwd-only session)');
await page.getByTestId('app-banking').getByText('Complete MFA').click();
await page.getByTestId('app-banking').getByText('Open app (SSO)').click();
await page.waitForFunction(() => document.querySelector('[data-testid=outcome-banking]')?.textContent.includes('signed in'));
ok(/pwd mfa/.test(await text('session')), 'session now records pwd mfa');
await page.getByText('+9 hours', { exact: true }).click();
await page.getByTestId('app-banking').getByText('Open app (SSO)').click();
await page.waitForFunction(() => document.querySelector('[data-testid=outcome-banking]')?.textContent.includes('asks for MFA'));
ok(true, 'after 9 h mfa is too old: bounced again');
// 3b. sticky SSO: a flow reports mfa with no challenge, the gate stops firing; a null report moves nothing
await page.getByText('Report no methods (correct for a routing flow)').click();
await page.getByTestId('app-banking').getByText('Open app (SSO)').click();
await page.waitForFunction(() => document.querySelector('[data-testid=outcome-banking]')?.textContent.includes('asks for MFA'));
ok(true, 'null report moves nothing: still bounced');
await page.getByText('Report mfa with no challenge (the mistake)').click();
await page.getByTestId('app-banking').getByText('Open app (SSO)').click();
await page.waitForFunction(() => document.querySelector('[data-testid=outcome-banking]')?.textContent.includes('signed in'));
ok(/NO user challenge/.test(await text('log')), 'sticky SSO: mfa reported with no challenge, payments app signs in, log says no challenge ran');

// 3c. passwordless session record has no pwd
await page.getByRole('button', { name: 'Reset', exact: true }).click(); await page.getByTestId('cookie-none').waitFor();
await page.getByText('Sign in (passwordless: fido + pwdless)').click();
await page.getByTestId('session').waitFor();
await page.getByText('Session record (mock values').click();
const rec = await page.getByTestId('session-record').innerText();
ok(/fido/.test(rec) && /pwdless/.test(rec) && !/"pwd"/.test(rec), 'passwordless session record shows fido + pwdless and no pwd');
ok(/idleTimeoutInMinutes/.test(rec) && /withAuthenticator/.test(rec), 'record shows idleTimeoutInMinutes and per-method sign-on');
await page.getByRole('button', { name: 'Reset', exact: true }).click(); await page.getByTestId('cookie-none').waitFor();
await page.getByText('Sign in (password only)').click(); await page.getByTestId('session').waitFor();
await page.getByTestId('app-portal').getByText('Open app (SSO)').click();
await page.waitForFunction(() => document.querySelector('[data-testid=outcome-portal]')?.textContent.includes('signed in'));

// 4. idle timeout while access token valid
await page.getByRole('button', { name: '5 min', exact: true }).first().click();
await page.getByText('+5 min').click(); await page.getByText('+5 min').click();
await page.waitForFunction(() => document.querySelector('[data-testid=session]')?.textContent.includes('idle timeout passed'));
ok(true, 'session idle-expired');

// 5. hard delete: cookie stays but stale; held token... (portal token may have expired by +9h; refresh then call)
await page.getByTestId('app-portal').getByText('Refresh token').click();
await page.getByTestId('app-portal').getByText('Call API with its token').click();
await page.waitForFunction(() => /accepted the access token/.test(document.querySelector('[data-testid=log]')?.textContent || ''));
ok(true, 'API accepts the token though the session is dead');
await page.getByText('Delete session', { exact: true }).click();
await page.getByTestId('cookie-status').waitFor();
ok((await text('cookie-status')).includes('stale'), 'cookie still in browser but stale');
ok((await ctx.cookies(B)).some((x) => x.name === 'mock-ST'), 'cookie was NOT cleared by the revoke');

// 6. delete the cookie in the browser, sign in again, SSO fails
await page.getByText('Sign in (password only)').click();
await page.waitForFunction(() => document.querySelector('[data-testid=cookie-status]')?.textContent.includes('recognised'));
await ctx.clearCookies();
await page.getByTestId('app-portal').getByText('Open app (SSO)').click();
await page.waitForFunction(() => document.querySelector('[data-testid=outcome-portal]')?.textContent.includes('asks to sign in'));
ok(true, 'cookie deleted in browser: SSO asks to sign in although the PingOne session is live');

// 7. widget
await page.getByText('Sign in (password only)').click();
await page.getByTestId('app-widget').getByText('Sign in through the flow').click();
await page.getByTestId('sessiontoken').waitFor();
await page.getByTestId('app-widget').getByText('Try as GET').click();
ok(/must_be_post/.test(await text('msg')), 'GET refused: must be POST');
await page.getByTestId('app-widget').getByText('Reuse sessionToken (POST)').click();
await page.waitForFunction(() => document.querySelector('[data-testid=outcome-widget]')?.textContent.includes('signed in'));
ok(true, 'POST with global.sessionToken reuses the session');
await page.getByTestId('app-widget').getByText('Forget sessionToken').click();
await page.getByTestId('sessiontoken-none').waitFor();
await page.getByTestId('app-widget').getByText('Reuse sessionToken (POST)').click();
await page.waitForFunction(() => document.querySelector('[data-testid=outcome-widget]')?.textContent.includes('asks to sign in'));
ok(true, 'dropped sessionToken: the flow shows its sign-in form');

// 8. diagram: simulate, drag, reset
await page.getByText('Simulate', { exact: true }).click();
ok((await text('step')).includes('Sign in once'), 'simulate starts at step 1');
await page.getByText('Next', { exact: true }).click();
ok((await text('step')).includes('A second app'), 'next goes to step 2');
const box = page.getByTestId('node-browser'); const b0 = await box.boundingBox();
await page.mouse.move(b0.x + 20, b0.y + 15); await page.mouse.down(); await page.mouse.move(b0.x + 140, b0.y + 95, { steps: 6 }); await page.mouse.up();
const b1 = await box.boundingBox();
ok(Math.abs(b1.x - b0.x) > 50, 'a box can be dragged');
await page.getByText('Reset diagram').click(); await page.waitForTimeout(300);
const b2 = await box.boundingBox();
ok(Math.abs(b2.x - b0.x) < 15 && Math.abs(b2.y - b0.y) < 15, 'Reset diagram restores box positions');

// 9. reset all + presenter + vertical
await page.getByRole('button', { name: 'Reset', exact: true }).click();
await page.getByTestId('cookie-none').waitFor();
ok(true, 'Reset clears the session world');
await page.getByText('Presenter mode').click();
ok(await page.getByTestId('banner').isVisible(), 'banner visible in presenter mode');
await page.getByText('Exit presenter mode').click();
await page.getByLabel('Vertical').selectOption('health');
await page.getByRole('heading', { name: 'Claims payments app' }).waitFor();
ok(true, 'vertical pack renames the apps');

// 10. review fixes
// S2: an expired session does not come back when the idle timeout is raised
await page.getByRole('button', { name: 'Reset', exact: true }).click(); await page.getByTestId('cookie-none').waitFor();
await page.getByText('Sign in (password only)').click(); await page.getByTestId('session').waitFor();
await page.getByRole('button', { name: '5 min', exact: true }).first().click();
await page.getByText('+1 hour').click();
await page.waitForFunction(() => document.querySelector('[data-testid=session]')?.textContent.includes('idle timeout passed'));
await page.getByText('30 days (default)').click();
await page.waitForTimeout(300);
ok((await text('session')).includes('idle timeout passed'), 'S2: raising the idle timeout does not revive an expired session');
// S7: two tabs of one browser share one world and one cookie
const tab2 = await ctx.newPage(); await tab2.goto(B); await tab2.getByTestId('cookie').waitFor();
ok(true, 'S7: a second tab sees the same session (one workspace per browser)');
await tab2.close();
// S10: the widget flow sets no browser cookie
const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage(); await p2.goto(B);
await p2.getByTestId('app-widget').getByText('Sign in through the flow').click(); await p2.getByTestId('sessiontoken').waitFor();
ok((await ctx2.cookies(B)).length === 0, 'S10: widget flow sign-in sets no cookie, only a sessionToken');
// rule 13: a separate browser is a separate workspace
ok((await p2.getByTestId('cookie-none').count()) === 1, 'rule 13: second browser context has no session cookie of its own');
await ctx2.close();
// S11: token cards open, 375px, no sideways scroll
await page.getByTestId('app-portal').getByText('Open app (SSO)').click().catch(() => {});
await page.getByRole('button', { name: 'Reset', exact: true }).click(); await page.getByTestId('cookie-none').waitFor();
await page.getByText('Sign in (password only)').click(); await page.getByTestId('cookie').waitFor();
await page.getByTestId('app-portal').getByText('Open app (SSO)').click();
await page.getByTestId('app-portal').getByText('Raw tokens (mock, labelled)').click();
await page.getByTestId('app-portal').getByText('Decoded access token').click();
await page.setViewportSize({ width: 375, height: 800 });
const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(ov2 <= 1, `S11: no horizontal scroll at 375px with token cards open (overflow ${ov2}px)`);
await page.setViewportSize({ width: 1400, height: 1000 });

// 375px
await page.setViewportSize({ width: 375, height: 800 });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(overflow <= 1, `no horizontal page scroll at 375px (overflow ${overflow}px)`);
await page.screenshot({ path: process.env.E2E_SHOTS ? `${process.env.E2E_SHOTS}/mobile.png` : 'mobile.png', fullPage: false });
await page.setViewportSize({ width: 1400, height: 1000 });
await page.screenshot({ path: process.env.E2E_SHOTS ? `${process.env.E2E_SHOTS}/desktop.png` : 'desktop.png' });
await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: process.env.E2E_SHOTS ? `${process.env.E2E_SHOTS}/dark.png` : 'dark.png' });
ok(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
