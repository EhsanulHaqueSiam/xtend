# Settings

## X account

- **Handle**: taken from your X session when empty. Scores, analytics and mentions are about it.
- **Keywords**: comma separated. Library, Engage and Leads search these by default.

## treg and budget

- **treg token**: every paid call uses it. It is encrypted at rest.
- **Monthly budget (USD)** and **This month**: the cap and the meter. See [Costs](./costs.md).
- **Daily Library jobs**: the morning picks and three suggested posts. Off until turned on,
  since they spend with nobody clicking.

## Time and voice

- **Time zone**: an IANA zone (`Europe/Berlin`). Posting slots, the calendar, schedule
  triggers, the best-time grid and the spend meter's day and month use it. Defaults to the
  service machine's zone.
- **Voice notes**: one paragraph on what you post about and how you sound. The assistant writes
  in this voice.

## Desktop

- **Clean X**: the CSS skin over x.com. Applied at once; it is a preference of this window.
- **Post media through X**: off by default. On, posts with media go through your X session
  instead of the API.

## Service

Shows how this window reached its service (child of the app, launchd, remote) and the data
directory. **Remote service** points the desktop at a service on another machine: a URL such
as `http://mac-mini:4820` and that machine's service token. Changing it relaunches the app.
See [Remote service](./remote-service.md).

## Accounts

Connected X handles. See [Accounts](./accounts.md).

Unsaved changes are named at the top of the page until saved.
