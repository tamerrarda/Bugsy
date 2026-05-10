# Chrome Web Store listing

Copy-paste source for the listing form. Field names match the Developer Dashboard.

---

## Name (45 char max)

```
Bugsy — Spot the Bug
```

## Short description (132 char max)

```
Wordle for debugging. Three code snippets a day, one bug each. Find it before the timer does, keep your streak, climb the board.
```
(127 characters.)

## Category

Developer Tools

## Detailed description

```
Bugsy is a daily debugging game that lives in your toolbar.

Every day you get three short snippets of real-looking code — JavaScript or Python — and each one has exactly one bug in it. Your job is to click the line it's hiding on before the 60-second timer runs out. Get it right and Bugsy tells you why it was wrong; get it wrong and Bugsy tells you anyway. Either way you leave knowing something you didn't.

Everyone in the world gets the same three snippets each day, so you can argue about them.

WHY YOU'LL KEEP COMING BACK
• Streaks. Finish all three, keep the flame alive. Your streak sits on the toolbar icon, so you see it every time you open your browser.
• It's kind about it. Completing the day is what counts, not getting them all right. A bad day won't cost you a 60-day streak.
• Six badges to earn, from Rookie Hunter to Linus's Eye.
• A daily, weekly and all-time leaderboard.
• Share your result as a spoiler-free emoji grid. 🟩🟩🟥

WHY IT'S ACTUALLY USEFUL
Every single snippet comes with a written explanation of the bug: what the defect is, and what it actually does to the program at runtime. Not "line 3 is wrong" — but "slice's end index is exclusive, so the newest entry never appears in the feed."

The bugs are the ones that really bite: off-by-one errors, missing null checks, `==` where you meant `===`, a `var` in a loop, a missing `await`, a mutable default argument, a `sort()` that quietly reorders your caller's array. Real bugs, in code that looks like the code you review.

If you're prepping for interviews, Bugsy is drilling exactly the muscle those code-reading questions test.

NO ACCOUNT NEEDED TO TRY IT
Play Practice as a guest, immediately, with no sign-up. Sign in with GitHub when you want the daily challenge, points and the leaderboard.

WHAT BUGSY CAN'T SEE
Bugsy has no access to the pages you visit — no content scripts, no tab access, no history. It cannot read your code or your browsing. It stores your GitHub username, your avatar and your scores, and nothing else. No analytics, no trackers, no ads.

Happy hunting. 🐛
```

## Screenshots (1280×800 or 640×400 — 5 max)

Generated from the real popup by `node scripts/store-shots.mjs`:

1. `store/screenshots/1-daily.png` — the game screen: a syntax-highlighted snippet, timer running, clickable lines
2. `store/screenshots/2-result.png` — the reveal: the bug line in green, your miss in red, the explanation
3. `store/screenshots/3-summary.png` — the shareable emoji grid
4. `store/screenshots/4-leaderboard.png` — the leaderboard
5. `store/screenshots/5-profile.png` — the badge showcase

## Privacy

- **Single purpose:** "A daily code-debugging game. Bugsy shows the user code snippets containing one bug and the user clicks the line they believe is buggy."
- **Permission justifications:**
  - `storage` — persists the user's session, settings and guest practice streak.
  - `alarms` — hourly check for whether a new UTC day's challenge has begun.
  - `notifications` — the once-a-day reminder and badge-earned pop-ups. Both user-disableable.
  - `identity` — GitHub OAuth sign-in via `chrome.identity.launchWebAuthFlow`.
  - `host_permissions` — the Supabase backend only, to fetch challenges and submit attempts.
- **Remote code:** No. Everything executable ships in the package.
- **Data usage:** Collects "Authentication information" (GitHub identity) and "Website content"? **No** — Bugsy has no access to any website. It collects only the account identifier and gameplay results.
- **Privacy policy URL:** the published URL of `store/privacy-policy.md`.

## Launch posts

- **Show HN:** "Show HN: Bugsy – Wordle for debugging, as a Chrome extension"
- **Product Hunt:** tagline "Three bugs a day. Find them before the timer does."
- **r/webdev, r/learnprogramming:** lead with the explanation quality, not the streaks.
