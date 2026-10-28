# x.com inside Xtend

The window is Xtend. x.com runs inside it as your own logged-in browser session: browsing it
costs nothing and looks to X like an ordinary tab. Xtend's sidebar is the navigation for both
X's pages and the tools; X's own left rail and right column are hidden.

## The sidebar

The X rows at the top open X's pages in the main area: Home, Notifications, Messages,
Bookmarks, Profile. Notifications shows X's unread count. The tools follow: Compose, Plan,
Analyze, Engage, Library, Leads, Automate, Scores, then Seen and Settings. Each tool's sections
show as rows under it once it is open.

## X beside a tool

On a tool, x.com docks as a panel on the right, so a post you are replying to or a profile you
are scoring stays in view. The panel bar shows the current path with back, forward, reload,
full size, open in your browser and close. Drag its left edge to resize it.

`⌘\` toggles the panel. From X itself it returns you to the last tool with the panel open.
Closing the panel parks it; your place on X and your scroll position survive.

## Clean X

Settings has a **Clean X** switch. On, it hides X's navigation, right column and the Premium and
Grok prompts, and centres the timeline. It is CSS only: X's own code runs untouched and
nothing is clicked or fetched on your behalf. Off, you get the stock x.com inside the window.

## What Xtend adds on top of X's pages

Three small pieces sit on X's pages, drawn from what X already rendered, never from a request:

- **Metrics row** under each post: views, engagement rate, views per hour, the author's
  followers and how the post compares to your average. Two actions: Save to the Library and
  Reply with AI, which opens Compose on a reply.
- **Schedule chip** in X's composer, before Post. Click it and what you typed moves into
  Compose, where it can be queued for a slot.
- **Hover card** on an author's avatar or name after a short pause: their followers and a
  Full report link that opens Scores on them.

`⌥O` hides and shows the metrics rows.

## What the app reads from your session

As you browse, the app reads the posts, authors and metrics that X sent to the page and stores
them in the service. That is where the Seen feed, the free parts of Engage and Analyze, and
the best-time suggestions come from. Nothing is replayed to X and nothing is sent anywhere but
your own service.

## Posting through the session

The tools post through the X API by default. Settings has **Post media through X** (off by
default). On, drafts with images or video post through your x.com session instead of the API,
which treg does not bill for. Automations never use the session.

## Links

x.com links stay inside the window. Google and Apple sign-in open a popup on the same session.
Any other site opens in your default browser.
