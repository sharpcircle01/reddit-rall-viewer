// Content script: Injects r/all feed with slide-in post viewer

(function () {
  'use strict';

  let isShowingAll = false;
  let savedHomeFeed = null;
  let afterToken = null;
  let isLoading = false;
  let postCount = 0;
  let currentSort = 'hot';
  let feedScrollPos = 0;

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

  function getFullImage(post) {
    if (post.preview && post.preview.images && post.preview.images[0]) {
      return decodeHTML(post.preview.images[0].source.url);
    }
    if (post.url && /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(post.url)) {
      return post.url;
    }
    return getThumb(post);
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

  // Simple markdown-ish rendering for selftext
  function renderSelfText(text) {
    if (!text) return '';
    let html = escapeHTML(text);
    // Paragraphs
    html = html.split('\n\n').map(p => `<p>${p.trim()}</p>`).join('');
    // Single newlines
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  // ── Fetch helpers ──

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

  async function fetchPostAndComments(permalink) {
    try {
      const url = `https://www.reddit.com${permalink}.json?raw_json=1&limit=100`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const postData = data[0].data.children[0].data;
      const commentsData = data[1].data.children;
      return { post: postData, comments: commentsData };
    } catch (err) {
      console.error('[r/all Extension] Post fetch error:', err);
      return null;
    }
  }

  // ── Build feed post card ──

  function buildPostHTML(post, rank) {
    const thumb = getThumb(post);
    const title = escapeHTML(decodeHTML(post.title));
    const nsfwTag = post.over_18 ? `<span class="rall-nsfw">NSFW</span> ` : '';
    const postType = getPostType(post);
    const selfText = getPostText(post);

    const typeBadges = {
      video: '▶ Video', image: '🖼 Image', gallery: '📷 Gallery',
      link: '🔗 Link', text: '📝 Text'
    };
    const typeBadge = `<span class="rall-post-type rall-post-type--${postType}">${typeBadges[postType] || ''}</span>`;

    const imageHTML = thumb
      ? `<div class="rall-post-image"><img src="${thumb}" alt="" loading="lazy"></div>`
      : '';

    const textPreviewHTML = (!thumb && selfText)
      ? `<div class="rall-post-preview">${selfText}</div>`
      : (thumb && selfText)
        ? `<div class="rall-post-preview rall-post-preview--short">${escapeHTML(decodeHTML(post.selftext.substring(0, 150)))}${post.selftext.length > 150 ? '...' : ''}</div>`
        : '';

    const domain = post.domain && !post.domain.startsWith('self.') && !post.domain.startsWith('i.redd') && !post.domain.startsWith('v.redd')
      ? `<span class="rall-post-domain">${post.domain}</span>`
      : '';

    // data-permalink for the click handler
    return `
      <div class="rall-post" data-permalink="${post.permalink}">
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
      </div>
    `;
  }

  // ── Build comment HTML (recursive for threading) ──

  function buildCommentHTML(comment, depth) {
    if (comment.kind !== 't1') return '';
    const c = comment.data;
    if (!c.body) return '';

    const maxDepth = 6;
    const indent = Math.min(depth, maxDepth);
    const bodyHTML = renderSelfText(c.body);

    let repliesHTML = '';
    if (c.replies && c.replies.data && c.replies.data.children) {
      repliesHTML = c.replies.data.children
        .map(child => buildCommentHTML(child, depth + 1))
        .join('');
    }

    return `
      <div class="rall-comment" style="margin-left: ${indent * 16}px !important;">
        <div class="rall-comment-header">
          <span class="rall-comment-author">u/${escapeHTML(c.author)}</span>
          <span class="rall-comment-score">▲ ${formatScore(c.score)}</span>
          <span class="rall-comment-time">${timeAgo(c.created_utc)}</span>
        </div>
        <div class="rall-comment-body">${bodyHTML}</div>
        ${repliesHTML}
      </div>
    `;
  }

  // ── Post detail panel ──

  function createDetailPanel() {
    if (document.getElementById('rall-detail-panel')) {
      return document.getElementById('rall-detail-panel');
    }

    const panel = document.createElement('div');
    panel.id = 'rall-detail-panel';
    panel.innerHTML = `
      <div class="rall-detail-header">
        <button id="rall-detail-back" class="rall-detail-back">← Back to feed</button>
        <a id="rall-detail-reddit-link" class="rall-detail-reddit-link" href="#" target="_blank" rel="noopener">Open on Reddit ↗</a>
      </div>
      <div id="rall-detail-content" class="rall-detail-content"></div>
    `;

    document.getElementById('rall-overlay').appendChild(panel);

    document.getElementById('rall-detail-back').addEventListener('click', closeDetailPanel);

    return panel;
  }

  async function openDetailPanel(permalink) {
    const panel = createDetailPanel();
    const content = document.getElementById('rall-detail-content');
    const redditLink = document.getElementById('rall-detail-reddit-link');

    redditLink.href = `https://www.reddit.com${permalink}`;

    // Save scroll position of feed
    const feed = document.getElementById('rall-feed');
    if (feed) feedScrollPos = feed.scrollTop;

    // Push a history state so the mouse back button closes the panel
    history.pushState({ rallDetail: true }, '');

    // Show panel, hide feed
    panel.style.display = 'flex';
    feed.style.display = 'none';
    document.getElementById('rall-load-more-wrap').style.display = 'none';

    // Loading state
    content.innerHTML = '<div class="rall-loading"><div class="rall-spinner"></div><span>Loading post...</span></div>';

    // Fetch post + comments
    const result = await fetchPostAndComments(permalink);
    if (!result) {
      content.innerHTML = '<div class="rall-loading">⚠️ Failed to load post.</div>';
      return;
    }

    const { post, comments } = result;
    const fullImage = getFullImage(post);
    const title = escapeHTML(decodeHTML(post.title));
    const nsfwTag = post.over_18 ? `<span class="rall-nsfw">NSFW</span> ` : '';

    // Detect if this is a video/gif post
    const isVideo = post.is_video && post.media && post.media.reddit_video;
    const isRedditGif = isVideo && post.media.reddit_video.is_gif;

    // Post image -- skip for video posts to avoid duplicate thumbnail
    const imageHTML = (fullImage && !isVideo)
      ? `<div class="rall-detail-image"><img src="${fullImage}" alt="" loading="lazy"></div>`
      : '';

    // Self text (full)
    const selfTextHTML = post.selftext
      ? `<div class="rall-detail-selftext">${renderSelfText(post.selftext)}</div>`
      : '';

    // Video embed with audio sync for non-gif Reddit videos
    let videoHTML = '';
    if (isVideo) {
      const rv = post.media.reddit_video;
      const videoUrl = rv.fallback_url;
      const videoId = 'rall-vid-' + Math.random().toString(36).slice(2, 8);

      if (isRedditGif) {
        // GIFs: loop, muted, no audio track exists
        videoHTML = `<div class="rall-detail-video"><video controls loop muted preload="metadata" src="${videoUrl}" style="width:100% !important; max-height:500px !important; border-radius:8px !important;"></video></div>`;
      } else {
        // Real videos: render video now, audio will be loaded via JS below
        videoHTML = `
          <div class="rall-detail-video">
            <video id="${videoId}" controls preload="metadata" src="${videoUrl}" style="width:100% !important; max-height:500px !important; border-radius:8px !important;"></video>
          </div>`;
      }
    }

    // External link
    const isExternal = post.domain && !post.domain.startsWith('self.') && !post.domain.startsWith('i.redd') && !post.domain.startsWith('v.redd') && !post.domain.startsWith('reddit');
    const externalLinkHTML = isExternal
      ? `<div class="rall-detail-link"><a href="${escapeHTML(post.url)}" target="_blank" rel="noopener">🔗 ${escapeHTML(post.domain)} ↗</a></div>`
      : '';

    // Comments
    const commentsHTML = comments
      .filter(c => c.kind === 't1')
      .map(c => buildCommentHTML(c, 0))
      .join('');

    content.innerHTML = `
      <div class="rall-detail-post">
        <div class="rall-detail-post-meta">
          <span class="rall-post-sub">${post.subreddit_name_prefixed}</span>
          <span class="rall-post-author">u/${escapeHTML(post.author)}</span>
          <span class="rall-post-time">${timeAgo(post.created_utc)}</span>
        </div>
        <div class="rall-detail-title">${nsfwTag}${title}</div>
        ${imageHTML}
        ${videoHTML}
        ${selfTextHTML}
        ${externalLinkHTML}
        <div class="rall-detail-stats">
          <span class="rall-post-score">▲ ${formatScore(post.score)}</span>
          <span class="rall-post-comments">💬 ${formatScore(post.num_comments)} comments</span>
        </div>
      </div>
      <div class="rall-detail-comments-header">Comments</div>
      <div class="rall-detail-comments">
        ${commentsHTML || '<div class="rall-no-comments">No comments yet.</div>'}
      </div>
    `;

    // Wire up audio sync for video posts with sound
    if (isVideo && !isRedditGif) {
      const vid = content.querySelector('video[id^="rall-vid-"]');
      if (vid) {
        const videoUrl = post.media.reddit_video.fallback_url;
        // Extract base URL: https://v.redd.it/{id}/
        const baseMatch = videoUrl.match(/(https?:\/\/v\.redd\.it\/[^/]+\/)/);
        if (baseMatch) {
          const baseUrl = baseMatch[1];
          // Try audio URLs in order: CMAF (current), DASH (legacy), bare /audio (oldest)
          const audioCandidates = [
            baseUrl + 'CMAF_AUDIO_128.mp4',
            baseUrl + 'CMAF_AUDIO_64.mp4',
            baseUrl + 'DASH_AUDIO_128.mp4',
            baseUrl + 'DASH_AUDIO_64.mp4',
            baseUrl + 'audio'
          ];

          // Try each candidate until one works
          (async function tryAudio() {
            let workingUrl = null;
            for (const url of audioCandidates) {
              try {
                const resp = await fetch(url, { method: 'HEAD' });
                if (resp.ok) { workingUrl = url; break; }
              } catch (e) { /* try next */ }
            }
            if (!workingUrl) return; // No audio track available

            const aud = document.createElement('audio');
            aud.preload = 'metadata';
            aud.src = workingUrl;
            vid.parentElement.appendChild(aud);

            vid.addEventListener('play', () => { aud.currentTime = vid.currentTime; aud.play().catch(() => {}); });
            vid.addEventListener('pause', () => { aud.pause(); });
            vid.addEventListener('seeked', () => { aud.currentTime = vid.currentTime; });
            vid.addEventListener('volumechange', () => { aud.volume = vid.volume; aud.muted = vid.muted; });
            vid.addEventListener('ratechange', () => { aud.playbackRate = vid.playbackRate; });
            vid.addEventListener('timeupdate', () => {
              if (Math.abs(vid.currentTime - aud.currentTime) > 0.3) { aud.currentTime = vid.currentTime; }
            });
          })();
        }
      }
    }

    content.scrollTop = 0;
  }

  function closeDetailPanel() {
    const panel = document.getElementById('rall-detail-panel');
    const feed = document.getElementById('rall-feed');
    const loadMore = document.getElementById('rall-load-more-wrap');

    // Pause any playing video/audio
    if (panel) {
      panel.querySelectorAll('video, audio').forEach(el => { el.pause(); });
    }

    if (panel) panel.style.display = 'none';
    if (feed) {
      feed.style.display = 'block';
      feed.scrollTop = feedScrollPos;
    }
    if (loadMore && afterToken) loadMore.style.display = 'block';
  }

  // ── Click handler for posts ──

  function handlePostClick(e) {
    const postEl = e.target.closest('.rall-post');
    if (!postEl) return;

    const permalink = postEl.getAttribute('data-permalink');
    if (!permalink) return;

    e.preventDefault();
    e.stopPropagation();
    openDetailPanel(permalink);
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

    // Delegate click handler for posts
    document.getElementById('rall-feed').addEventListener('click', handlePostClick);

    return overlay;
  }

  async function showOverlay() {
    const overlay = createOverlay();
    const feed = document.getElementById('rall-feed');
    feed.style.display = 'block';
    feed.innerHTML = '<div class="rall-loading"><div class="rall-spinner"></div><span>Loading r/all…</span></div>';
    overlay.style.display = 'flex';
    document.getElementById('rall-load-more-wrap').style.display = 'none';

    // Hide detail panel if open
    const detail = document.getElementById('rall-detail-panel');
    if (detail) detail.style.display = 'none';

    const mainContent = findMainFeed();
    if (mainContent && !savedHomeFeed) {
      savedHomeFeed = { el: mainContent, display: mainContent.style.display };
      mainContent.style.display = 'none';
    }

    isShowingAll = true;
    postCount = 0;
    afterToken = null;
    updateFABState();

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

    feed.scrollTop = 0;
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
      fab.title = 'Showing r/all -- click to go back';
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

  // Mouse back button support: close detail panel on popstate
  window.addEventListener('popstate', (e) => {
    const panel = document.getElementById('rall-detail-panel');
    if (panel && panel.style.display !== 'none') {
      closeDetailPanel();
    }
  });

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
