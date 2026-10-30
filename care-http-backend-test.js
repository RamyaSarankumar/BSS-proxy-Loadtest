import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// COUNTRY=DK (default) or SE selects the data file and CARE URL
const COUNTRY = (__ENV.COUNTRY || 'DK').toUpperCase();
const DATA_FILE = __ENV.DATA_FILE || `./${COUNTRY.toLowerCase()}-data.json`;
const CREDENTIALS_FILE = __ENV.CREDENTIALS_FILE || `./${COUNTRY.toLowerCase()}-credentials.json`;
const data = JSON.parse(open(DATA_FILE));
const credentials = JSON.parse(open(CREDENTIALS_FILE));

// Config (override with -e NAME=value)
const DEFAULT_URLS = { DK: 'https://crm.nextrel.3.dk/care', SE: 'https://crm.nextrel.tre.se/care' };
const CARE_URL = __ENV.CARE_URL || DEFAULT_URLS[COUNTRY];
const BACKEND_URL = __ENV.BACKEND_URL || CARE_URL; // BSS proxy backend base
// Comma-separated backend paths; {boid} and {msisdn} are substituted. Session cookie is reused.
const BACKEND_PATHS = (__ENV.BACKEND_PATHS || '/?msisdn={msisdn}')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);
const USERS = __ENV.USERS_ONLY_PREFIX
  ? credentials.users.filter((u) => u.username.startsWith(__ENV.USERS_ONLY_PREFIX))
  : credentials.users;

// Load is set from the command line: -e VUS=20 -e RAMP_UP=1m -e HOLD=3m -e RAMP_DOWN=1m
const VUS = parseInt(__ENV.VUS || '20');
const RAMP_UP = __ENV.RAMP_UP || '1m';
const HOLD = __ENV.HOLD || '3m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '1m';

export const options = {
  stages: [
    { duration: RAMP_UP, target: VUS },
    { duration: HOLD, target: VUS },
    { duration: RAMP_DOWN, target: 0 },
  ],
  thresholds: {
    'http_req_failed': ['rate<0.05'],
    'http_req_duration{name:FRONTEND_CUSTOMER_PAGE}': ['p(95)<3000'],
    'http_req_duration{name:BACKEND_CALL}': ['p(95)<3000'],
    'login_success': ['rate>0.95'],
  },
};

const loginSuccess = new Rate('login_success');
const frontendTime = new Trend('frontend_page_time', true);
const backendTime = new Trend('backend_call_time', true);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const ok = (r) => r.status >= 200 && r.status < 400;

// Each VU keeps its own cookie jar, so it logs in once and reuses the session.
let loggedIn = false;
let user;

function login() {
  user = user || USERS[(__VU - 1) % USERS.length];
  const res = http.post(
    `${CARE_URL}/`,
    { username: user.username, password: user.password },
    { tags: { name: 'LOGIN' } },
  );
  loggedIn = ok(res);
  loginSuccess.add(loggedIn);
  check(res, { 'login ok': ok });
}

export default function () {
  if (!loggedIn) {
    group('login', login);
    sleep(1);
  }

  const boid = pick(data.boids);
  const msisdn = pick(data.msisdns);

  group('frontend', () => {
    const res = http.get(`${CARE_URL}/customer/${boid}`, {
      tags: { name: 'FRONTEND_CUSTOMER_PAGE' },
    });
    frontendTime.add(res.timings.duration);
    check(res, {
      'frontend status ok': ok,
      'frontend has body': (r) => r.body && r.body.length > 0,
    });
  });

  sleep(1);

  group('backend', () => {
    for (const path of BACKEND_PATHS) {
      const url = BACKEND_URL + path.replace('{boid}', boid).replace('{msisdn}', msisdn);
      const res = http.get(url, { tags: { name: 'BACKEND_CALL' } });
      backendTime.add(res.timings.duration);
      check(res, { 'backend status ok': ok });
    }
  });

  sleep(Math.random() * 3 + 2);
}
