import { browser } from 'k6/browser';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// Browser-based DK CARE (NR) flows, mirroring CRM-Applctns-LoadTestModule/tests/DK-*.ts (DK or SE via COUNTRY)
// Run: k6 run -e SCENARIO=boid|msisdn|taxpayer|multitab care-browser-frontend-test.js
// COUNTRY=DK (default) or SE selects the data file and CARE URL
const COUNTRY = (__ENV.COUNTRY || 'DK').toUpperCase();
const DATA_FILE = __ENV.DATA_FILE || `./${COUNTRY.toLowerCase()}-data.json`;
const CREDENTIALS_FILE = __ENV.CREDENTIALS_FILE || `./${COUNTRY.toLowerCase()}-credentials.json`;
const data = JSON.parse(open(DATA_FILE));
const credentials = JSON.parse(open(CREDENTIALS_FILE));

const DEFAULT_URLS = { DK: 'https://crm.nextrel.3.dk/care/', SE: 'https://crm.nextrel.tre.se/care/' };
const CARE_URL = __ENV.CARE_URL || DEFAULT_URLS[COUNTRY];
const SCENARIO = (__ENV.SCENARIO || 'boid').toLowerCase();
const VUS = parseInt(__ENV.VUS || '5');
const TABS = parseInt(__ENV.TABS || '5'); // multitab: concurrent tabs per VU
const REFRESH_S = parseInt(__ENV.REFRESH_S || '10'); // multitab: seconds between refreshes
const HOLD = __ENV.HOLD || '3m';
const RAMP_UP = __ENV.RAMP_UP || '1m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '1m';
const PEOPLESOFT = (__ENV.PEOPLESOFT || 'true') === 'true';

const SHOW_DOCS = 'input#H1SD_DOC_WRK_H1SW_LISTAGR_BTN';

export const options = {
  scenarios: {
    [SCENARIO]: {
      executor: 'ramping-vus',
      exec: SCENARIO,
      startVUs: 0,
      stages: [
        { duration: RAMP_UP, target: VUS },
        { duration: HOLD, target: VUS },
        { duration: RAMP_DOWN, target: 0 },
      ],
      gracefulRampDown: '1m',
      gracefulStop: '1m',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    flow_success: ['rate>0.9'],
    login_time: ['p(95)<15000'],
    customer_page_time: ['p(95)<30000'],
    peoplesoft_time: ['p(95)<45000'],
  },
};

const flowSuccess = new Rate('flow_success');
const loginTime = new Trend('login_time', true);
const searchTime = new Trend('search_time', true);
const customerPageTime = new Trend('customer_page_time', true);
const peoplesoftTime = new Trend('peoplesoft_time', true);
const tabLoadTime = new Trend('tab_load_time', true);
const tabErrors = new Counter('tab_errors');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const userFor = () => credentials.users[(__VU - 1) % credentials.users.length];

// SHARE_SESSIONS=true: each VU logs in once and reuses the cookies in every new
// browser context, so many VUs can share the 23 users without re-logging in each iteration.
const SHARE_SESSIONS = (__ENV.SHARE_SESSIONS || 'true') === 'true';
let sessionCookies = null;

async function newSessionContext() {
  const context = await browser.newContext();
  if (SHARE_SESSIONS && sessionCookies) await context.addCookies(sessionCookies);
  return context;
}

// Logs in only when the login form is shown; returns true if a login was performed.
async function ensureLogin(page, context, user) {
  const pwd = page.locator('input[type="password"]');
  const needsLogin = await pwd.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  if (!needsLogin) return false;
  const t = Date.now();
  await login(page, user);
  loginTime.add(Date.now() - t);
  if (SHARE_SESSIONS) sessionCookies = await context.cookies();
  return true;
}

async function login(page, user) {
  await page.locator('input[type="text"]').fill(user.username);
  await page.locator('input[type="password"]').fill(user.password);
  await page
    .locator('xpath=(//button[contains(translate(.,"SIGNLOD","signlod"),"sign in") or contains(translate(.,"SIGNLOD","signlod"),"log ind")] | //button[@type="submit"] | //input[@type="submit"])[1]')
    .first()
    .click();
}

async function waitVisible(locator, timeout) {
  await locator.waitFor({ state: 'visible', timeout });
}

async function openPeopleSoft(context, page) {
  const t = Date.now();
  const customerBtn = page.locator('xpath=//a[contains(@class,"btn")][contains(.,"Customer")]');
  await waitVisible(customerBtn, 30000);
  customerPageTime.add(Date.now() - t);
  if (!PEOPLESOFT) return true;

  const t2 = Date.now();
  const [psoft] = await Promise.all([context.waitForEvent('page'), customerBtn.click()]);
  await psoft.waitForLoadState('networkidle', { timeout: 30000 });
  await psoft.waitForTimeout(3000);

  let found = false;
  for (const target of [psoft, ...psoft.frames()]) {
    found = await target.locator(SHOW_DOCS).isVisible().catch(() => false);
    if (found) break;
  }
  peoplesoftTime.add(Date.now() - t2);
  await psoft.close();
  return found;
}

// Login on the root page, then search via the search bar (MSISDN / Taxpayer ID).
async function searchFlow(label, ids, optionText) {
  const user = userFor();
  const context = await newSessionContext();
  const page = await context.newPage();
  let ok = false;
  let searchValue = '';
  try {
    await page.goto(CARE_URL, { waitUntil: 'load' });
    await ensureLogin(page, context, user);
    await waitVisible(page.locator('xpath=//a[contains(@class,"clickable")][contains(.,"History")]'), 15000);

    const bar = page.locator('#customer-search');
    await waitVisible(bar, 15000);
    await bar.click();
    const t2 = Date.now();
    searchValue = pick(ids);
    await bar.type(searchValue, { delay: 100 });
    await waitVisible(page.locator('ul.search-matches'), 15000);
    const option = page.locator(`xpath=//ul[contains(@class,"search-matches")]//li[contains(.,"${optionText}")]`);
    await waitVisible(option, 15000);
    await option.click();
    await page.waitForLoadState('networkidle');
    searchTime.add(Date.now() - t2);

    ok = await openPeopleSoft(context, page);
  } catch (e) {
    console.error(`[${label}] VU ${__VU} ${user.username} value=${searchValue} url=${page.url()}: ${e}`);
  } finally {
    flowSuccess.add(ok);
    check(ok, { [`${label} flow completed`]: (v) => v });
    await page.close();
    await context.close();
  }
}

export async function msisdn() {
  await searchFlow('MSISDN', data.msisdns, 'MSISDN');
}

export async function taxpayer() {
  await searchFlow('TAXPAYER', data.taxpayerIds, 'Taxpayer ID');
}

// Open the customer URL by BOID, which redirects to login first.
export async function boid() {
  const user = userFor();
  const context = await newSessionContext();
  const page = await context.newPage();
  let ok = false;
  try {
    await page.goto(`${CARE_URL}customer/${pick(data.boids)}`, { waitUntil: 'load' });
    await ensureLogin(page, context, user);
    ok = await openPeopleSoft(context, page);
  } catch (e) {
    console.error(`[BOID] VU ${__VU} ${user.username}: ${e}`);
  } finally {
    flowSuccess.add(ok);
    check(ok, { 'BOID flow completed': (v) => v });
    await page.close();
    await context.close();
  }
}

// One login, then TABS tabs sharing the session, each refreshing random BOIDs for a while.
export async function multitab() {
  const user = userFor();
  const context = await newSessionContext();
  const loginPage = await context.newPage();
  let ok = false;
  try {
    await loginPage.goto(`${CARE_URL}customer/${pick(data.boids)}`, { waitUntil: 'load' });
    await ensureLogin(loginPage, context, user);
    await waitVisible(loginPage.locator('xpath=//a[contains(@class,"btn")][contains(.,"Customer")]'), 30000);

    const pages = [];
    for (let i = 0; i < TABS; i++) pages.push(await context.newPage());

    const end = Date.now() + parseInt(__ENV.TAB_DURATION_S || '60') * 1000;
    while (Date.now() < end) {
      await Promise.all(
        pages.map(async (p) => {
          const t0 = Date.now();
          try {
            const res = await p.goto(`${CARE_URL}customer/${pick(data.boids)}`, { waitUntil: 'load' });
            tabLoadTime.add(Date.now() - t0);
            if (!res || res.status() >= 400) tabErrors.add(1);
          } catch (e) {
            tabErrors.add(1);
          }
        }),
      );
      await loginPage.waitForTimeout(REFRESH_S * 1000);
    }
    ok = true;
  } catch (e) {
    console.error(`[MULTITAB] VU ${__VU} ${user.username}: ${e}`);
  } finally {
    flowSuccess.add(ok);
    await context.close();
  }
}
