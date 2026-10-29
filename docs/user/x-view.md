# x.com inside Xtend

The window is Xtend. x.com runs inside it as your own logged-in browser session: browsing it
costs nothing and looks to X like an ordinary tab. Xtend's sidebar is the navigation for both
X's pages and the tools.

## The sidebar

The X rows at the top open X's pages in the main area: Home, Notifications, Messages,
Bookmarks, Profile. Notifications shows X's unread count. The tools follow: Compose, Plan,
Library, Engage, Leads, Automate, Analyze, Scores, Seen, then Settings. Each tool's sections
show as rows under it once it is open. Compose counts queued drafts and Engage counts open
mentions.

Hover a tool for one line on what it does. The first time you open a tool, that line and the
open section's line sit under the header; × closes them for good and the ⓘ by the title brings
them back.

At the foot, the Today block shows the next queued post, how many are queued, this month's
spend against the budget, and whether the service is local, remote or offline. It opens
Settings.

## X beside a tool

On a tool, x.com docks as a panel on the right, so a post you are replying to or a profile you
are scoring stays in view. A post or profile you open from a tool (a mention, a saved post, a
lead) opens in this panel and the tool stays on screen. The panel bar has back, forward,
reload, pin, full size, open in your browser and close. Drag its left edge to resize it.

Pinned, the sidebar's X rows load into the panel and the open tool stays. Unpinned, they take
the main area.

`⌘\` toggles the panel. From X itself it returns you to the last tool with the panel open.
Closing the panel parks it; your place on X and your scroll position survive.

## The companion column

While X fills the main area and the window is wide enough, five cards sit where X's right
column was: Up next, Needs you, Mentions, Picks today and Best time (Good time now when your
audience usually peaks about now). They come from what Xtend already holds and cost nothing.
Each opens its tool, with X in the panel beside it unless you closed the panel; Best time
starts a new draft. In a narrower window the sidebar's Today block carries the same facts.

## Clean X

Settings, X session, has a **Clean X** group: one switch per part of x.com to hide. CSS only:
X's own code runs untouched and nothing is clicked or fetched on your behalf. Changes apply at
once and are a preference of this window.

| switch                                           | default |
| ------------------------------------------------ | ------- |
| Hide ads                                         | on      |
| Hide Grok                                        | on      |
| Hide Premium upsells                             | on      |
| Hide X's nav rail and right column               | on      |
| Hide Discover more and More posts under a thread | on      |
| Hide reply boosts and Subscribe                  | on      |
| Hide Communities, Jobs and Spaces                | on      |
| Hide the For you tab                             | off     |
| Hide view counts                                 | off     |
| Hide verified badges                             | off     |
| Quiet media until hover                          | off     |

**Restore defaults** on that page puts these back.

## What Xtend adds on top of X's pages

Three small pieces sit on X's pages, drawn from what X already rendered, never from a request:

- **Metrics row** under each post: views, engagement rate, views per hour, the author's
  followers and how the post compares to your average. Two actions: Save to the Library and
  Reply with AI, which opens Compose on a reply.
- **Schedule chip** in X's composer, before Post. Click it and what you typed moves into
  Compose, where it can be queued for a slot.
- **Hover card** on an author's avatar or name after a short pause: their followers and a
  Full report link that opens Scores on them.

The metrics row also carries marks for what you already did with the post or its author:
`replied` with when, `saved`, `lead` with their stage, `watching`, and `auto` with the rule
that acted on it. The same marks show in Seen and on Engage's posts. They are read from your
own data; nothing is fetched. A mark appears as soon as you Save.

`⌥O` hides and shows the metrics rows.

## What the app reads from your session

As you browse, the app reads the posts, authors and metrics that X sent to the page and stores
them in the service. That is where the Seen feed, the free parts of Engage and Analyze, and
the best-time suggestions come from. Nothing is replayed to X. Public posts can also go to the
shared pool behind Library's Trends while pool sharing is on (see [Settings](./settings.md)).

## Acting through the session

What you click can go through your own session, free. **Act through X for what I click**
(Settings, X session) is on by default:

- A reply you send from Engage goes through your session, one at a time at a human pace: at
  least 8 seconds apart and at most 30 an hour. Off, it goes through the X API at the price on
  the button.
- Posts with media always go through your session, since the API path has no media upload. With
  the switch off they land in Failed, saying session actions are off.

Everything else that writes (Post now and queued posts without media, likes, DMs) goes through
the X API at its price. Automations and agents never use the session.

## Links

x.com links stay inside the window. Google and Apple sign-in open a popup on the same session.
Any other site opens in your default browser.
