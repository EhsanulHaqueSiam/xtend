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

## Join it from another desktop

One service holds your drafts, rules, spend and scores. A second desktop that starts its own
service starts empty, even signed into the same X account, so join the first one instead.

1. On the machine running the service: Settings, Service, **Add a device**. It makes a
   single-use pairing link that works for ten minutes.
2. On the other desktop: Settings, Service, **Join a service**, paste the link, **Join and
   relaunch**.

Each joined desktop gets a token of its own; **Sign out** in the Devices list on any device
revokes it. The x.com session stays in each desktop; the service never holds it. What the
joining desktop's own service held stays on it; **Use local service** gets back to it.

## Change another device's settings

With more than one desktop, the X session and Service pages of Settings show **Settings for**
in the header. Clean X and the update channel belong to the device picked there and apply on it
at once; everything else (budget, treg token, voice, rules, session actions) is shared by every
device.

## Use it from a browser

Open `http://<host>:4820/?token=<token>` once. The web app keeps the token for the session and
strips it from the address bar. The browser has no X session, so Home shows what the desktop
observed and there is no x.com panel; every tool works otherwise.

If the service is unreachable at launch, the desktop offers Retry and connection settings;
if it disconnects later, Service settings stays available from the connection notice.

## Health

`GET /api/health` answers without a token. Everything else needs it.
