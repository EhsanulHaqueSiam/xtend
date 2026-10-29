# Remote service

The service is a separate process, so it can run on a machine that stays on (a Mac mini, a
VPS) while the desktop app and a browser connect to it. Schedules, agents and rules then fire
whether or not your laptop is open.

## Run the service elsewhere

Unpack the CLI tarball from the release on that machine and start it on an interface your
other machines can reach, for instance a Tailscale address:

```sh
xtend --host <tailnet ip> --port 4820
xtend service install   # macOS: keep it running across logins
```

The service makes a token on first start at `~/.xtend/auth-token`. Whoever has it can drive
the service, so share it only with your own devices.

## Point the desktop at it

Settings, Service page, **Remote service**: the URL (`http://<tailnet ip or host>:4820`) and
that machine's token. **Check** tests both; **Connect and relaunch** relaunches the app against
it, and **Use local service** goes back. The x.com session stays in the desktop; the service
never holds it. Observations the desktop captures are posted to the remote service.

## Use it from a browser

Open `http://<host>:4820/?token=<token>` once. The web app keeps the token for the session and
strips it from the address bar. The browser has no X session, so Home shows what the desktop
observed and there is no x.com panel; every tool works otherwise.

## Health

`GET /api/health` answers without a token. Everything else needs it.
