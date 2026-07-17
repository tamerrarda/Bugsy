# Bugsy — Privacy Policy

_Last updated: 18 July 2026_

Bugsy is a browser game. It shows you code snippets and you click the buggy line. This page says exactly what it stores, why, and what it does not touch.

Publish this at a stable public URL and paste that URL into the Chrome Web Store listing. A privacy policy is **required** for any extension that handles user data, and Bugsy does — it has accounts.

## What Bugsy stores

Only if you sign in with GitHub:

| Data | Why | Where |
|---|---|---|
| GitHub username | To put a name next to your score on the leaderboard | Supabase (Postgres) |
| GitHub avatar URL | To put a face next to it | Supabase |
| Your attempts (which line you clicked, whether it was right, how long it took, points) | To score you, keep your streak, and rank you | Supabase |
| Streaks and badges | The game | Supabase |

If you **don't** sign in, Bugsy stores nothing about you anywhere. Guest mode keeps a practice streak in your own browser (`chrome.storage`), and that never leaves your machine.

## What Bugsy does not do

- **It does not read the pages you visit.** Bugsy has no content scripts and no access to your tabs, your history, or anything on any website. The code snippets are Bugsy's own; they come from our server, not from your browser.
- **It does not read your code.** Bugsy has never seen a line you wrote.
- **It does not track you.** No analytics, no advertising, no third-party trackers, no fingerprinting.
- **It does not sell or share your data.** With anyone, for any purpose.

## Permissions, and why each one exists

The Chrome Web Store shows these when you install. Here is what each is actually for:

- **storage** — remembers your session, your settings, and your guest practice streak.
- **alarms** — checks once an hour whether a new day's challenge has started.
- **notifications** — the daily reminder, and a badge-earned pop-up. Both can be turned off in Settings, and turning the reminder off stops it for good.
- **identity** — signing in with GitHub. This opens GitHub's own login window; Bugsy never sees your GitHub password.

Bugsy asks for no host permissions beyond its own backend. It cannot see any website you visit.

## Deleting your data

Ask, and it is deleted — profile, attempts, streaks, badges, all of it. Email **tamerarda16860@gmail.com**. There is no dark pattern here and no waiting period.

Signing out just ends the session on your machine; it does not delete anything on the server. Say so explicitly if that is what you want.

## Where the data lives

Supabase (Postgres), hosted in the EU. Access is locked down with row-level security: your attempts, streaks and badges are readable only by you. The leaderboard exposes exactly four fields — username, avatar, points, rank — and nothing else.

## Children

Bugsy is aimed at developers and is not directed at children under 13.

## Changes

If this policy changes in a way that affects what is collected, the extension will say so before the change takes effect.

## Contact

**tamerarda16860@gmail.com**
