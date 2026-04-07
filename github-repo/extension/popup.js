const API_BASE = 'https://www.reddit.com/r/all';
const postsContainer = document.getElementById('posts-container');
const sortSelect = document.getElementById('sort-select');
const refreshBtn = document.getElementById('refresh-btn');
const loadMoreBtn = document.getElementById('load-more-btn');

let afterToken = null;
let currentSort = 'hot';
let postIndex = 0;
let isLoading = false;

// ── Helpers ──

function timeAgo(utcSeconds) {
  const diff = Math.floor(Date.now() / 1000) - utcSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 2592000)}mo`;
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

function getThumb(post) {
  // Try to get a usable thumbnail
  if (post.preview && post.preview.images && post.preview.images[0]) {
    const resolutions = post.preview.images[0].resolutions;
    if (resolutions && resolutions.length > 0) {
      // Pick the smallest resolution that's at least 100px
      const good = resolutions.find(r => r.width >= 100) || resolutions[resolutions.length - 1];
      return decodeHTML(good.url);
    }
    return decodeHTML(post.preview.images[0].source.url);
  }
  if (post.thumbnail && post.thumbnail.startsWith('http')) {
    return post.thumbnail;
  }
  return null;
}

// ── Rendering ──

function renderPost(post, rank) {
  const el = document.createElement('div');
  el.className = 'post';

  const thumb = getThumb(post);
  const thumbHTML = thumb
    ? `<img src="${thumb}" alt="" loading="lazy">`
    : `<span class="post-thumb-placeholder">📄</span>`;

  const nsfwTag = post.over_18 ? '<span class="nsfw-tag">NSFW</span>' : '';
  const title = decodeHTML(post.title);

  el.innerHTML = `
    <div class="post-rank">${rank}</div>
    <div class="post-thumb">${thumbHTML}</div>
    <div class="post-body">
      <div class="post-title">${nsfwTag}${escapeHTML(title)}</div>
      <div class="post-meta">
        <span class="post-sub">${post.subreddit_name_prefixed}</span>
        <span class="post-score">
          <svg viewBox="0 0 12 12" fill="currentColor"><path d="M6 0l5 8H1z"/></svg>
          ${formatScore(post.score)}
        </span>
        <span class="post-comments">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14v9H4l-3 3V2z"/></svg>
          ${formatScore(post.num_comments)}
        </span>
        <span class="post-time">${timeAgo(post.created_utc)}</span>
      </div>
    </div>
  `;

  el.addEventListener('click', () => {
    const url = `https://www.reddit.com${post.permalink}`;
    window.open(url, '_blank');
  });

  return el;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showLoading() {
  postsContainer.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <span>Loading r/all&hellip;</span>
    </div>
  `;
}

function showError(msg) {
  postsContainer.innerHTML = `
    <div class="error">
      <div class="error-icon">⚠️</div>
      <div class="error-msg">${msg}</div>
      <button class="retry-btn" id="retry-btn">Try again</button>
    </div>
  `;
  document.getElementById('retry-btn').addEventListener('click', () => fetchPosts(true));
}

// ── Data fetching ──

async function fetchPosts(fresh = false) {
  if (isLoading) return;
  isLoading = true;

  if (fresh) {
    afterToken = null;
    postIndex = 0;
    showLoading();
    loadMoreBtn.style.display = 'none';
  } else {
    loadMoreBtn.textContent = 'Loading…';
    loadMoreBtn.disabled = true;
  }

  try {
    let url = `${API_BASE}/${currentSort}.json?limit=25&raw_json=1`;
    if (afterToken) url += `&after=${afterToken}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const posts = data.data.children.map(c => c.data);
    afterToken = data.data.after;

    if (fresh) postsContainer.innerHTML = '';

    posts.forEach(post => {
      postIndex++;
      postsContainer.appendChild(renderPost(post, postIndex));
    });

    if (afterToken) {
      loadMoreBtn.style.display = 'block';
      loadMoreBtn.textContent = 'Load more';
      loadMoreBtn.disabled = false;
    } else {
      loadMoreBtn.style.display = 'none';
    }
  } catch (err) {
    console.error('Fetch error:', err);
    if (postIndex === 0) {
      showError('Could not load r/all. Reddit may be down or blocking requests.');
    }
  } finally {
    isLoading = false;
  }
}

// ── Events ──

sortSelect.addEventListener('change', () => {
  currentSort = sortSelect.value;
  fetchPosts(true);
});

refreshBtn.addEventListener('click', () => fetchPosts(true));
loadMoreBtn.addEventListener('click', () => fetchPosts(false));

// ── Init ──
fetchPosts(true);
