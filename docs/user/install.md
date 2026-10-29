# Install Xtend

Xtend is a desktop app for macOS and Linux. It opens x.com inside its own window, signed in as
you, and puts the tools beside it. A headless service keeps your data on your machine.

## Download

Releases are on GitHub under the repository's Releases page. Each one ships:

| file               | what it is                                                          |
| ------------------ | ------------------------------------------------------------------- |
| `Xtend-*.dmg`      | the macOS app (unsigned until signing is set up: right-click, Open) |
| `Xtend-*.zip`      | the same macOS app, zipped                                          |
| `Xtend-*.AppImage` | the Linux app; make it executable and run it                        |
| `xtend-cli-*.tgz`  | the service and CLI alone, for a server or a Mac mini               |

## First run

1. Open the app. It starts its own service in the background and opens the window.
2. The main area is x.com. Sign in there like in any browser. Your session stays in the app's
   own cookie store, separate from your other browsers; the service never sees it.
3. Open **Settings** and paste a treg token. Every X API call is paid from that balance, and
   the monthly budget under it caps what the app may spend.
4. Your handle is read from the X session once you are signed in. Set it by hand in Settings if
   you want the tools to work on another account than the one you browse with.

Nothing costs anything until you click a button that shows a price. Browsing X, the Seen feed,
drafts, slots, lists and rules are all free.

## Where data lives

The service keeps everything in `~/.xtend`: a SQLite database, the auth token, the media of
your drafts and the service log. Back that folder up and you have backed up Xtend. Delete it
and you start over.

The X session itself lives in the app's Electron profile, not in `~/.xtend`.

## Keep the service running with the app closed

Queued posts, Library's morning jobs, signal agents and automation rules fire on the service's
clock. With the app open, the app runs the service. To keep them firing with the app closed:

```sh
xtend service install
```

This writes a launchd agent on macOS that starts the service at login and restarts it if it
stops. `xtend service status` shows whether it is loaded; `xtend service uninstall` removes it.
Settings shows which one is running the service: the app, launchd, or a remote machine.

See [Remote service](./remote-service.md) to run the service on another machine.
