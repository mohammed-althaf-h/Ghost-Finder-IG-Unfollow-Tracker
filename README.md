# 👻 Ghost Finder — Instagram Unfollow Tracker

> A Chrome extension that finds who unfollowed your friend on Instagram — people they still follow who no longer follow them back.

![Version](https://img.shields.io/badge/version-1.4-blueviolet)
![Manifest](https://img.shields.io/badge/manifest-v3-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Chrome-yellow)

---

## What It Does

Ghost Finder scrapes the **Followers** and **Following** lists from any public Instagram profile you have access to, then computes the difference:

```
Ghosts = Following − Followers
```

In plain English: **people your friend is still following who quietly unfollowed them.**

### Features

- **Live scraping** — watches the modal scroll in real time, collects every username as it loads
- **Persistent storage** — data survives page refreshes and popup closes; pick up where you left off
- **Multi-session accumulation** — Instagram lazy-loads ~200 users per session; refresh and scrape again to collect more, new entries merge automatically with zero duplicates
- **Ghost analysis** — once both lists are collected, instantly shows the unfollow list with mutual count
- **Search & filter** — filter the ghost list by username or display name
- **Export** — download ghosts as JSON or CSV
- **Profile-scoped** — data is stored per username, so you can track multiple friends separately
- **Completion tracking** — shows `247 / 340` progress so you know when collection is complete

---

## Installation

> **Requires Google Chrome** (or any Chromium-based browser that supports Manifest V3)

### Step 1 — Download

Download the latest release ZIP from the [Releases](../../releases) page and unzip it. You'll get a folder called `ig-ghost-finder-v2`.

### Step 2 — Load in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `ig-ghost-finder-v2` folder

The Ghost Finder icon will appear in your Chrome toolbar.

### Step 3 — Pin it (optional but recommended)

Click the puzzle piece icon in the toolbar → click the pin icon next to Ghost Finder so it's always visible.

---

## How to Use

### Collecting Followers

1. Go to your friend's Instagram profile (e.g. `instagram.com/username/`)
2. Hard refresh the page: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
3. Click the **Followers** count on their profile — the modal must be open and visible
4. Click the Ghost Finder extension icon
5. You'll see the **Followers** tab — press **▶ Scrape Followers**
6. Watch the activity log: the modal will scroll automatically and collect usernames
7. When it stops, the count is saved. Close the modal.

### Collecting Following

Repeat the same process for the **Following** list:

1. Click the **Following** count on their profile
2. Switch to the **Following** tab in the extension
3. Press **▶ Scrape Following**

### Dealing with Instagram's Load Limit

Instagram typically loads only ~200 users per scroll session before stopping. If your friend has 500+ followers, you'll need multiple sessions:

1. After the scraper stops, **close the modal**
2. **Refresh** the Instagram page (`Ctrl+R`)
3. Open the modal again → open the extension → press Scrape again
4. New usernames are automatically merged — no duplicates

Repeat until the collected count matches the total shown on their profile.

### Viewing Ghosts

Once both Followers and Following have been collected, click the **👻 Ghosts** tab. You'll see:

- Total ghost count
- Mutual followers count
- A searchable list of every person your friend follows who doesn't follow back
- Download buttons for JSON and CSV export
- A warning banner if either list is incomplete (results may not be 100% accurate yet)

---

## File Structure

```
ig-ghost-finder-v2/
├── manifest.json      # Extension config (Manifest V3, no auto-injection)
├── popup.html         # Extension UI (CSP-compliant, zero inline handlers)
├── popup.js           # UI controller, storage logic, ghost analysis engine
├── content.js         # Scraping engine injected into Instagram on demand
├── background.js      # Service worker — message relay + file downloads
├── icon16.png
├── icon48.png
└── icon128.png
```

---

## How It Works (Technical)

### Architecture

```
popup.js  ──START_SCRAPE──▶  content.js (injected into Instagram tab)
                                    │
                              scrapes DOM
                                    │
                          SCRAPER_BATCH / SCRAPER_DONE
                                    │
                             background.js (relay)
                                    │
                              popup.js (updates UI + saves to chrome.storage.local)
```

### Scraping Strategy

The scraper runs entirely inside the Instagram tab using `chrome.scripting.executeScript`. It:

1. Locates the open `div[role="dialog"]` (the followers/following modal)
2. Finds the scrollable container inside by checking `overflowY` and `scrollHeight`
3. Loops: scrolls to the bottom → waits for Instagram to load the next batch → harvests all `a[href^="/username/"]` links
4. Sends batches back to the popup incrementally so the UI updates live
5. Stops when the count is stable for 10 consecutive scroll attempts

### Storage

Data is stored in `chrome.storage.local` under per-profile keys:

```
gf_username_followers  →  { entries: [...], total: N, sessions: N, updatedAt: ISO }
gf_username_following  →  { entries: [...], total: N, sessions: N, updatedAt: ISO }
```

Each entry contains `username`, `displayName`, `avatarUrl`, and `profileUrl`.

### Ghost Computation

```js
Ghosts = Following.filter(user => !Followers.has(user.username))
```

Pure set difference. Runs in the popup, no network requests.

### Double-Injection Guard

Since the popup force-injects `content.js` on every scrape, the script uses a `window.__gfLoaded` flag to ensure the message listener and scrape logic only register once, even if injected multiple times.

---

## Permissions Used

| Permission | Why |
|---|---|
| `activeTab` | Read the current Instagram tab |
| `scripting` | Inject the scraping engine into the page |
| `storage` | Persist collected data across sessions |
| `downloads` | Save JSON/CSV exports to disk |
| `tabs` | Get the active tab URL to detect which profile you're on |
| `host_permissions: instagram.com` | Required to inject scripts into Instagram pages |

No data is sent to any server. Everything stays local in your browser.

---

## Limitations & Known Issues

- **Instagram DOM changes** — Instagram frequently updates its HTML structure. If the scraper stops collecting after a Chrome or Instagram update, open an issue with your browser version and a screenshot of the console.
- **Private accounts** — Only works on profiles you can already see. If you can't see someone's followers list manually, the extension can't either.
- **~200 user session limit** — This is an Instagram restriction, not a bug. Refresh and scrape again to accumulate more.
- **Display names** — Occasionally the display name captured may include button text like "Follow" if Instagram's DOM nests it unexpectedly. The username is always accurate.
- **Avatars** — Profile pictures are captured as blob URLs valid only for the current session; they won't render in downloaded JSON.

---

## Ethics & Legal

- **Consent required** — Only use this on profiles where you have the account owner's consent.
- **Personal use only** — Do not use this for mass scraping, building marketing lists, or any commercial purpose.
- **Instagram ToS** — Automated scraping may violate [Instagram's Terms of Use](https://help.instagram.com/581066165581870). Use responsibly and at your own risk.
- **No login bypassing** — The extension only reads data from pages you are already logged into and can view manually.

---

## Contributing

Pull requests are welcome. Common areas for improvement:

- Improved scrollable container detection if Instagram updates their DOM
- Firefox port (requires minor manifest adjustments)
- Auto-retry logic for sessions that end early
- Unfollow timeline tracking (compare snapshots over time)

---

## License

MIT — do whatever you want, just don't be evil about it.

---

*Built because sometimes you just want to know who ghosted your friend.*
