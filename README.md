# Reddit r/all Viewer

A lightweight Chrome extension that brings back **r/all** on Reddit. Reddit has been progressively hiding r/all from the UI and redirecting users back to the home feed -- this extension bypasses that entirely by fetching r/all data directly from Reddit's JSON API and injecting it into the page.

![Chrome Extension](https://img.shields.io/badge/Platform-Chrome-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## Features

- **In-page r/all feed** -- click the floating button on Reddit to replace your home feed with r/all content, fetched directly via the API (no redirects to intercept)
- **Large card layout** -- full-width image previews, readable titles, text previews for self-posts, and colour-coded post type badges (image, video, gallery, text, link)
- **Built-in post viewer** -- click any post to open it in a slide-in panel with the full image, self-text, video, and threaded comments, all without leaving the page
- **Mouse back button support** -- press your mouse back button or browser back to return from a post to the feed, preserving your scroll position
- **Sort options** -- switch between Hot, New, Top, and Rising
- **Load more** -- paginated loading so you can keep scrolling through r/all
- **Toolbar popup** -- click the extension icon for a quick-glance r/all viewer without leaving your current page
- **NSFW tagging** -- clearly marked NSFW posts
- **Works on all Reddit versions** -- new Reddit, old Reddit, and sh.reddit
- **Zero tracking** -- no analytics, no telemetry, no data collection

## Installation

Since this is not on the Chrome Web Store, you will need to install it manually:

1. **Download** this repository (click the green `Code` button, then `Download ZIP`) or clone it:
   ```bash
   git clone https://github.com/sharpcircle01/reddit-rall-viewer.git
   ```
2. Open **Chrome** and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked**
5. Select the `extension` folder inside this repository
6. The extension icon should appear in your toolbar -- you are good to go

## How It Works

The extension has three main components:

### Feed Overlay (on-page)
When you are on Reddit, a small floating orange button appears in the bottom left. Clicking it:
- Hides Reddit's native home feed
- Fetches posts from `reddit.com/r/all/{sort}.json` using Reddit's public JSON API
- Renders them as large cards in a full-page overlay with a clean dark theme
- Each card shows the full thumbnail image, title, subreddit, author, score, comment count, post type, and a text preview for self-posts

### Post Viewer (slide-in panel)
Click any post card in the feed to open it in a built-in viewer:
- Fetches the full post content and comments from Reddit's JSON API
- Displays the full-resolution image, complete self-text, embedded video, or external link
- Shows threaded comments with nested replies, author, score, and timestamps
- Press "Back to feed" or use your mouse back button to return to the feed at the same scroll position
- "Open on Reddit" link available if you want to view the original page

### Popup Viewer (toolbar)
Click the extension icon in your Chrome toolbar to open a compact r/all viewer. This works independently of the content script and can be used from any tab.

## Privacy

This extension:
- Makes **no external requests** other than to `reddit.com` to fetch post data
- Stores **no user data** whatsoever
- Requires **no login or authentication**
- Uses Reddit's public JSON API (appending `.json` to Reddit URLs)
- Contains **no analytics, tracking, or telemetry**

## Permissions

| Permission | Why |
|---|---|
| `host_permissions: reddit.com` | Required to inject the content script and floating button on Reddit pages |

No other permissions are requested.

## File Structure

```
extension/
  manifest.json       # Chrome extension manifest (V3)
  content.js          # Injected into Reddit pages -- feed overlay, post viewer, and comments
  content.css         # Styles for the overlay, cards, detail panel, and comments
  popup.html          # Toolbar popup markup
  popup.css           # Toolbar popup styles
  popup.js            # Toolbar popup logic (fetches and renders r/all)
  icons/
    icon16.png
    icon48.png
    icon128.png
```

## Known Limitations

- Reddit's public JSON API has rate limits. If you hit them, posts may fail to load temporarily.
- The extension does not handle Reddit authentication, so any content filtered by your Reddit account preferences will not apply.
- Thumbnails depend on Reddit's preview data -- some posts (especially text-only) will not have thumbnails.
- Video posts with audio use Reddit's fallback video URL which does not include audio. For full video with audio, use the "Open on Reddit" link.
- Comment threads are limited to the top 100 comments per post.

## Contributing

Contributions are welcome. Feel free to open an issue or submit a pull request.

## License

MIT License. See [LICENSE](LICENSE) for details.
