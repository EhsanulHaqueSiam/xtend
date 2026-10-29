# Accounts

Xtend can hold several X accounts. Everything is scoped to one account at a time: drafts, slots,
lists, rules, scores, observations, spend.

## Add one

In Settings, on the Account page, give the new account a label (and its handle if you know
it) and **Add**. **Switch** on its row rebuilds the window on that account's own x.com,
signed out the first time; sign in there. Each account has its own cookie store, so switching
never signs you out of the other.

## Switch

With more than one account, the switcher is at the top of the sidebar. A switch reloads every
open window and tool onto the new account; a browser client connected to the same service
reloads too.

A switch is refused while a draft of the current account is posting, since the rest of its
thread would go out through the new account.

## What runs for which account

Scheduled work (queued drafts, agent and rule ticks, the morning jobs) runs for the current
account. Observations captured by a session are filed under the account that captured them,
even if you switch while they are in flight.
