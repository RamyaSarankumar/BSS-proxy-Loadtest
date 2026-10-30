# BSS-proxy-Loadtest

BSS Proxy load test framework for front-end and backend load testing using
k6. These scripts exercise CARE browser and HTTP flows. The test data is not
stored in this repository because it contains credentials and customer
identifiers. Obtain an approved local data file through your team's secure
process before running the tests.

## Test data

By default, the scripts load `dk-data.json` from the project directory.
Set `COUNTRY=SE` to use `se-data.json`, or set `DATA_FILE` to provide a
different local JSON file:

```sh
k6 run -e COUNTRY=DK -e DATA_FILE=/secure/path/dk-data.json care-http-backend-test.js
k6 run -e COUNTRY=SE -e DATA_FILE=/secure/path/se-data.json care-browser-frontend-test.js
```

The JSON object must contain:

- `users`: an array of objects with `username` and `password` strings
- `boids`: an array of BOID strings
- `msisdns`: an array of MSISDN strings
- `taxpayerIds`: an array of taxpayer-ID strings

Keep local data files out of version control. The default `*-data.json` files
and generated `results/` output are ignored by Git. Store passwords in an
approved secret manager or inject them into the test runtime; do not commit
credentials, customer identifiers, or encryption keys. For CI, use the
platform's protected secrets and approved test-data storage.

## Running

Run the HTTP test with k6:

```sh
k6 run care-http-backend-test.js
```

Run a browser scenario with the k6 browser module:

```sh
k6 run -e SCENARIO=boid care-browser-frontend-test.js
```

Both scripts accept `COUNTRY=DK` or `COUNTRY=SE`. `CARE_URL` can override the
default CARE URL. The HTTP script also accepts `BACKEND_URL` and
`BACKEND_PATHS`; the browser script supports `VUS`, `HOLD`, `RAMP_UP`, and
`RAMP_DOWN` load settings.
