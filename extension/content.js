// Content script: Injects r/all feed directly into the Reddit page,
// bypassing Reddit's redirect/suppression of /r/all.

(function () {
  'use strict';

  let isShowingAll = false;
  let savedHomeFeed = null;
  let afterToken = null;
  let isLoading = false;
  let postCount = 0;

  // ── Helpers ──

  function timeAgo(utcSeconds) {
    const diff = Math.floor(Date.now() / 1000) - utcSeconds;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return `${Math.floor(diff / 2592000)}mo ago`;
  }

  function formatScore(score) {
    if (score >= 100000) return `${(score / 1000).toFixed(0)}k`;
    if (score >= 1000) return `${(score / 1000).toFixed(1)}k`;
    return score.toString();
  }

  function decodeHTML(html) {
    const txt = document.createElement('textarea');
    txt.innerHTML = html;
    return txt.value;
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getThumb(post) {
    if (post.preview && post.preview.images && post.preview.images[0]) {
      const resolutions = post.preview.images[0].resolutions;
      if (resolutions && resolutions.length > 0) {
        // Grab the largest available resolution for big cards
        const good = resolutions.find(r => r.width >= 600) || resolutions[resolutions.length - 1];
        return decodeHTML(good.url);
      }
      return decodeHTML(post.preview.images[0].source.url);
    }
    if (post.thumbnail && post.thumbnail.startsWith('http')) {
      return post.thumbnail;
    }
    return null;
  }

  function getPostText(post) {
    if (post.selftext && post.selftext.length > 0) {
      const clean = escapeHTML(post.selftext.substring(0, 300));
      return clean + (post.selftext.length > 300 ? '...' : '');
    }
    return null;
  }

  function getPostType(post) {
    if (post.is_video) return 'video';
    if (post.post_hint === 'image') return 'image';
    if (post.post_hint === 'hosted:video' || post.post_hint === 'rich:video') return 'video';
    if (post.is_gallery) return 'gallery';
    if (post.post_hint === 'link') return 'link';
    if (post.selftext && post.selftext.length > 0) return 'text';
    return 'link';
  }

  // ── Fetch r/all ──

  async function fetchRAll(fresh = false) {
    if (isLoading) return [];
    isLoading = true;
    if (fresh) afterToken = null;

    try {
      let url = `https://www.reddit.com/r/all/hot.json?limit=25&raw_json=1`;
      if (afterToken) url += `&after=${afterToken}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      afterToken = data.data.after;
      return data.data.children.map(c => c.data);
    } catch (err) {
      console.error('[r/all Extension] Fetch error:', err);
      return null;
    } finally {
      isLoading = false;
    }
  }

  // ── Build a post card ──

  function buildPostHTML(post, rank) {
    const thumb = getThumb(post);
    const title = escapeHTML(decodeHTML(post.title));
    const nsfwTag = post.over_18 ? `<span class="rall-nsfw">NSFW</span> ` : '';
    const postType = getPostType(post);
    const selfText = getPostText(post);

    // Type badge
    const typeBadges = {
      video: '▶ Video',
      image: '🖼 Image',
      gallery: '📷 Gallery',
      link: '🔗 Link',
      text: '📝 Text'
    };
    const typeBadge = `<span class="rall-post-type rall-post-type--${postType}">${typeBadges[postType] || ''}</span>`;

    // Large image block (if available)
    const imageHTML = thumb
      ? `<div class="rall-post-image"><img src="${thumb}" alt="" loading="lazy"></div>`
      : '';

    // Self text preview (for text posts)
    const textPreviewHTML = (!thumb && selfText)
      ? `<div class="rall-post-preview">${selfText}</div>`
      : (thumb && selfText)
        ? `<div class="rall-post-preview rall-post-preview--short">${escapeHTML(decodeHTML(post.selftext.substring(0, 150)))}${post.selftext.length > 150 ? '...' : ''}</div>`
        : '';

    // External link display
    const domain = post.domain && !post.domain.startsWith('self.') && !post.domain.startsWith('i.redd') && !post.domain.startsWith('v.redd')
      ? `<span class="rall-post-domain">${post.domain}</span>`
      : '';

    return `
      <a href="https://www.reddit.com${post.permalink}" class="rall-post" target="_blank" rel="noopener">
        <div class="rall-post-header">
          <span class="rall-post-rank">#${rank}</span>
          <span class="rall-post-sub">${post.subreddit_name_prefixed}</span>
          <span class="rall-post-author">u/${post.author}</span>
          <span class="rall-post-time">${timeAgo(post.created_utc)}</span>
          ${domain}
        </div>
        <div class="rall-post-title">${nsfwTag}${title}</div>
        ${imageHTML}
        ${textPreviewHTML}
        <div class="rall-post-footer">
          ${typeBadge}
          <span class="rall-post-score">▲ ${formatScore(post.score)}</span>
          <span class="rall-post-comments">💬 ${formatScore(post.num_comments)}</span>
        </div>
      </a>
    `;
  }

  // ── Overlay ──

  function createOverlay() {
    if (document.getElementById('rall-overlay')) return document.getElementById('rall-overlay');

    const overlay = document.createElement('div');
    overlay.id = 'rall-overlay';
    overlay.innerHTML = `
      <div class="rall-overlay-header">
        <div class="rall-overlay-title">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="11" fill="#FF4500"/>
            <text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold" font-family="sans-serif">all</text>
          </svg>
          <span>r/all</span>
        </div>
        <div class="rall-overlay-controls">
          <select id="rall-sort-select" class="rall-sort-select">
            <option value="hot">Hot</option>
            <option value="new">New</option>
            <option value="top">Top</option>
            <option value="rising">Rising</option>
          </select>
          <button id="rall-close-btn" class="rall-close-btn" title="Back to Home feed">✕ Close</button>
        </div>
      </div>
      <div id="rall-feed" class="rall-feed"></div>
      <div id="rall-load-more-wrap" class="rall-load-more-wrap">
        <button id="rall-load-more" class="rall-load-more">Load more posts</button>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('rall-close-btn').addEventListener('click', hideOverlay);
    document.getElementById('rall-load-more').addEventListener('click', loadMore);
    document.getElementById('rall-sort-select').addEventListener('change', async (e) => {
      currentSort = e.target.value;
      await showOverlay();
    });

    return overlay;
  }

  let currentSort = 'hot';

  async function showOverlay() {
    const overlay = createOverlay();
    const feed = document.getElementById('rall-feed');
    feed.innerHTML = '<div class="rall-loading"><div class="rall-spinner"></div><span>Loading r/all…</span></div>';
    overlay.style.display = 'flex';
    document.getElementById('rall-load-more-wrap').style.display = 'none';

    // Hide the real Reddit feed
    const mainContent = findMainFeed();
    if (mainContent && !savedHomeFeed) {
      savedHomeFeed = { el: mainContent, display: mainContent.style.display };
      mainContent.style.display = 'none';
    }

    isShowingAll = true;
    postCount = 0;
    afterToken = null;
    updateFABState();

    // Update the fetch URL with current sort
    const posts = await fetchRAllWithSort(currentSort, true);
    if (posts === null) {
      feed.innerHTML = '<div class="rall-loading">⚠️ Failed to load r/all. Try again later.</div>';
      return;
    }

    feed.innerHTML = '';
    posts.forEach(post => {
      postCount++;
      feed.insertAdjacentHTML('beforeend', buildPostHTML(post, postCount));
    });

    if (afterToken) {
      document.getElementById('rall-load-more-wrap').style.display = 'block';
    }

    overlay.scrollTop = 0;
  }

  async function fetchRAllWithSort(sort, fresh) {
    if (isLoading) return [];
    isLoading = true;
    if (fresh) afterToken = null;

    try {
      let url = `https://www.reddit.com/r/all/${sort}.json?limit=25&raw_json=1`;
      if (afterToken) url += `&after=${afterToken}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      afterToken = data.data.after;
      return data.data.children.map(c => c.data);
    } catch (err) {
      console.error('[r/all Extension] Fetch error:', err);
      return null;
    } finally {
      isLoading = false;
    }
  }

  async function loadMore() {
    const btn = document.getElementById('rall-load-more');
    btn.textContent = 'Loading…';
    btn.disabled = true;

    const posts = await fetchRAllWithSort(currentSort, false);
    if (posts && posts.length > 0) {
      const feed = document.getElementById('rall-feed');
      posts.forEach(post => {
        postCount++;
        feed.insertAdjacentHTML('beforeend', buildPostHTML(post, postCount));
      });
    }

    if (!afterToken) {
      document.getElementById('rall-load-more-wrap').style.display = 'none';
    }

    btn.textContent = 'Load more posts';
    btn.disabled = false;
  }

  function hideOverlay() {
    const overlay = document.getElementById('rall-overlay');
    if (overlay) overlay.style.display = 'none';

    if (savedHomeFeed) {
      savedHomeFeed.el.style.display = savedHomeFeed.display || '';
      savedHomeFeed = null;
    }

    isShowingAll = false;
    updateFABState();
  }

  // ── Find main feed ──

  function findMainFeed() {
    const selectors = [
      'shreddit-feed',
      'div[data-testid="frontpage-feed"]',
      '.ListingLayout-outerContainer',
      '#siteTable',
      'main',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // ── FAB ──

  function updateFABState() {
    const fab = document.getElementById('rall-ext-fab');
    if (!fab) return;
    if (isShowingAll) {
      fab.classList.add('rall-fab-active');
      fab.title = 'Showing r/all — click to go back';
    } else {
      fab.classList.remove('rall-fab-active');
      fab.title = 'Show r/all';
    }
  }

  function createFAB() {
    if (document.getElementById('rall-ext-fab')) return;

    const btn = document.createElement('button');
    btn.id = 'rall-ext-fab';
    btn.title = 'Show r/all';
    btn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="11" fill="#FF4500"/>
        <text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold" font-family="sans-serif">all</text>
      </svg>
    `;

    btn.addEventListener('click', () => {
      if (isShowingAll) {
        hideOverlay();
      } else {
        showOverlay();
      }
    });

    document.body.appendChild(btn);
  }

  // ── Init ──

  function init() {
    createFAB();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Handle SPA navigation
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isShowingAll) hideOverlay();
      init();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
