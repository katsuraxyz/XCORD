(() => {
  const PROCESSED_ATTR = 'data-xcord-processed';
  const RESERVED = new Set([
    'home', 'explore', 'notifications', 'messages', 'i', 'settings',
    'search', 'compose', 'login', 'signup', 'intent', 'share',
    'hashtag', 'tos', 'privacy'
  ]);

  const ICONS = {
    follow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M19 8v6M16 11h6"/></svg>',
    like: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg>',
    repost: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 23-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
    spinner: '<svg class="xcord-spinner" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>'
  };

  function parseXLink(urlString) {
    try {
      const url = new URL(urlString, location.href);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'x.com' && host !== 'twitter.com') return null;

      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (!parts.length) return null;

      if (
        parts.length >= 3 &&
        parts[1].toLowerCase() === 'status' &&
        /^[A-Za-z0-9_]{1,15}$/.test(parts[0]) &&
        /^\d+$/.test(parts[2])
      ) {
        return {
          kind: 'tweet',
          username: parts[0],
          statusId: parts[2],
          url: `https://x.com/${parts[0]}/status/${parts[2]}`
        };
      }

      if (parts.length === 1) {
        const username = parts[0];
        if (RESERVED.has(username.toLowerCase())) return null;
        if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) return null;

        return {
          kind: 'profile',
          username,
          url: `https://x.com/${username}`
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  function renderButton(btn, iconName, label) {
    const icon = document.createElement('span');
    icon.className = 'xcord-action-icon';
    icon.innerHTML = ICONS[iconName] || ICONS.alert;

    const text = document.createElement('span');
    text.className = 'xcord-action-label';
    text.textContent = label;

    btn.replaceChildren(icon, text);
  }

  function setState(btn, state, label, title = '') {
    btn.dataset.state = state;
    const iconName = state === 'working'
      ? 'spinner'
      : state === 'done'
        ? 'check'
        : state === 'error'
          ? 'alert'
          : btn.dataset.icon;

    renderButton(btn, iconName, label);
    btn.title = title;
    btn.disabled = state === 'working' || state === 'done';
  }

  function stopDiscordEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function wireButton(btn, handler) {
    for (const eventName of ['pointerdown', 'mousedown']) {
      btn.addEventListener(eventName, stopDiscordEvent, true);
    }

    btn.addEventListener('click', (event) => {
      stopDiscordEvent(event);
      handler();
    }, true);
  }

  function errorLabel(reason, fallback) {
    if (/log.?in|sign.?in|not logged/i.test(reason)) return 'Sign in to X';
    if (/rate|limit/i.test(reason)) return 'Rate limited';
    return fallback;
  }

  async function runFollow(btn, profile) {
    if (btn.dataset.state === 'working' || btn.dataset.state === 'done') return;

    setState(btn, 'working', `Following @${profile.username}`, 'Following this profile on X in the background');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'XCORD_FOLLOW',
        username: profile.username,
        url: profile.url
      });

      if (response?.ok) {
        setState(
          btn,
          'done',
          `Following @${profile.username}`,
          response.message || ''
        );
        return;
      }

      const reason = response?.error || 'Unknown error';
      setState(btn, 'error', errorLabel(reason, 'Retry follow'), reason);
      btn.disabled = false;
      console.error('[XCORD / Follow]', reason);
    } catch (err) {
      const reason = err?.message || String(err);
      setState(btn, 'error', 'Retry follow', reason);
      btn.disabled = false;
      console.error('[XCORD / Follow]', err);
    }
  }

  async function runTweetAction(btn, tweet, action) {
    if (btn.dataset.state === 'working' || btn.dataset.state === 'done') return;

    const isLike = action === 'like';
    setState(
      btn,
      'working',
      isLike ? 'Liking' : 'Reposting',
      isLike ? 'Liking this post on X in the background' : 'Reposting this post on X in the background'
    );

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'XCORD_TWEET_ACTION',
        action,
        username: tweet.username,
        statusId: tweet.statusId,
        url: tweet.url
      });

      if (response?.ok) {
        setState(
          btn,
          'done',
          isLike ? 'Liked' : 'Reposted',
          response.message || ''
        );
        return;
      }

      const reason = response?.error || 'Unknown error';
      setState(btn, 'error', errorLabel(reason, isLike ? 'Retry like' : 'Retry repost'), reason);
      btn.disabled = false;
      console.error(`[XCORD / ${action}]`, reason);
    } catch (err) {
      const reason = err?.message || String(err);
      setState(btn, 'error', isLike ? 'Retry like' : 'Retry repost', reason);
      btn.disabled = false;
      console.error(`[XCORD / ${action}]`, err);
    }
  }

  function makeButton(label, extraClass, title, iconName) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `xcord-action-btn ${extraClass}`;
    btn.title = title;
    btn.dataset.state = 'idle';
    btn.dataset.icon = iconName;
    renderButton(btn, iconName, label);
    return btn;
  }

  function enhanceAnchor(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.hasAttribute(PROCESSED_ATTR)) return;

    const info = parseXLink(anchor.href);
    if (!info) return;

    anchor.setAttribute(PROCESSED_ATTR, '1');

    if (info.kind === 'profile') {
      const group = document.createElement('span');
      group.className = 'xcord-action-group';

      const followBtn = makeButton(
        `Follow @${info.username}`,
        'xcord-follow-btn',
        `Follow @${info.username} on X without leaving Discord`,
        'follow'
      );
      wireButton(followBtn, () => runFollow(followBtn, info));

      group.appendChild(followBtn);
      anchor.insertAdjacentElement('afterend', group);
      return;
    }

    if (info.kind === 'tweet') {
      const group = document.createElement('span');
      group.className = 'xcord-action-group';

      const likeBtn = makeButton('Like', 'xcord-like-btn', 'Like this post on X without leaving Discord', 'like');
      const repostBtn = makeButton('Repost', 'xcord-repost-btn', 'Repost this post on X without leaving Discord', 'repost');

      wireButton(likeBtn, () => runTweetAction(likeBtn, info, 'like'));
      wireButton(repostBtn, () => runTweetAction(repostBtn, info, 'retweet'));

      group.append(likeBtn, repostBtn);
      anchor.insertAdjacentElement('afterend', group);
    }
  }

  function scan(root = document) {
    if (root instanceof HTMLAnchorElement) enhanceAnchor(root);
    root.querySelectorAll?.('a[href]').forEach(enhanceAnchor);
  }

  scan();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        scan(node);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
