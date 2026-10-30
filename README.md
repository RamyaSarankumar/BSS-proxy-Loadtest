# BSS-proxy-Loadtest

BSS Proxy load test framework for front-end and backend load testing using
k6. These scripts exercise CARE browser and HTTP flows. Country data files
contain BOIDs, MSISDNs, and taxpayer IDs; login credentials are stored in
separate local files and are not committed.

## Test data

By default, the scripts load `dk-data.json` and `dk-credentials.json` from
the project directory. Set `COUNTRY=SE` to use the Swedish files, or override
either path with `DATA_FILE` or `CREDENTIALS_FILE`:

```sh
k6 run -e COUNTRY=DK -e CREDENTIALS_FILE=/secure/path/dk-credentials.json care-http-backend-test.js
k6 run -e COUNTRY=SE -e CREDENTIALS_FILE=/secure/path/se-credentials.json care-browser-frontend-test.js
```

The data JSON contains the identifier arrays `boids`, `msisdns`, and
`taxpayerIds`. The separate credentials JSON must contain a `users` array of
objects with `username` and `password` strings. Keep the credentials file
private and restrict its filesystem permissions. For example:

```sh
chmod 600 dk-credentials.json
```

Obtain credentials through your team's approved secure process. For CI,
inject them from protected secrets or approved secret storage. Never commit
credentials or encryption keys.

The default `*-credentials.json` files and generated `results/` output are
ignored by Git. Keep customer identifiers out of public repositories unless
you have approval to publish them.

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
