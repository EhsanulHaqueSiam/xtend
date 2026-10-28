# Install

Xtend is a desktop app for macOS and Linux. It opens x.com in the middle of the window with
your own login, and puts its tools around it. A headless service holds your data on your
machine; the app is a client of it.

## Desktop

Download the latest release from the repository's Releases page: a `.dmg` for macOS (Apple
Silicon and Intel) or an `.AppImage` for Linux. Open it, sign in to X in the middle of the
window as you would in a browser. Your session stays in the app's own profile and never
leaves the machine.

The first start creates `~/.xtend` with the database, the service token and logs. Everything
Xtend knows lives there.

## Paid actions need treg

Reading X through your own session is free. Anything that calls X's API or a model, such as
posting through the API, fetching a competitor's posts or asking the assistant, is paid from
your treg balance. Put your treg token in Settings and set a monthly budget; every paid button
shows its price before you press it. See [Costs and the budget](./costs.md).

## CLI

The service also runs on its own, without the window, for schedules, the HTTP API and MCP:

```sh
sh scripts/install.sh        # needs the GitHub CLI logged in, and Node 24 or newer
xtend --help
```

See [CLI, HTTP API and MCP](./cli.md).

## Updating

The desktop checks the Releases page and installs updates on macOS (signed builds) and Linux.
The CLI updates by running the install script again.
