const DEFAULT_RAID_PRESETS = [
  'Nice one 🔥',
  'Love this.',
  'This looks interesting.',
  'Let’s go 🚀',
  'Great update.',
  'Solid work.'
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabReady(tabId, timeoutMs = 30000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await sleep(250);
  }

  throw new Error('X page took too long to load.');
}

async function withBackgroundXTab(url, runner) {
  let tabId = null;

  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    if (!tabId) throw new Error('Could not create background X tab.');

    await waitForTabReady(tabId, 30000);
    await sleep(900);
    return await runner(tabId);
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch {}
    }
  }
}

function cleanPresets(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 100);
}

async function getRaidPresets() {
  const data = await chrome.storage.local.get('raidPresets');
  const presets = cleanPresets(data.raidPresets);
  return presets.length ? presets : DEFAULT_RAID_PRESETS.slice();
}

function secureRandomIndex(length) {
  if (!Number.isInteger(length) || length <= 0) throw new Error('No Raid presets are configured.');
  const range = 0x100000000;
  const limit = range - (range % length);
  const value = new Uint32Array(1);

  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);

  return value[0] % length;
}

async function saveReplyLink(statusId, replyUrl, preset) {
  if (!replyUrl || !/^https:\/\/x\.com\//i.test(replyUrl)) return;

  const data = await chrome.storage.local.get('replyLinks');
  const replyLinks = data.replyLinks && typeof data.replyLinks === 'object' ? data.replyLinks : {};
  replyLinks[statusId] = {
    url: replyUrl,
    preset: preset || '',
    createdAt: Date.now()
  };

  const entries = Object.entries(replyLinks);
  if (entries.length > 500) {
    entries
      .sort((a, b) => (b[1]?.createdAt || 0) - (a[1]?.createdAt || 0))
      .slice(500)
      .forEach(([key]) => delete replyLinks[key]);
  }

  await chrome.storage.local.set({ replyLinks });
}

async function getReplyLink(statusId) {
  const data = await chrome.storage.local.get('replyLinks');
  const entry = data.replyLinks?.[statusId];
  return entry?.url || null;
}

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get('raidPresets');
  if (!Array.isArray(data.raidPresets)) {
    await chrome.storage.local.set({ raidPresets: DEFAULT_RAID_PRESETS.slice() });
  }
});

async function runFollowScript(tabId, username) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [username],
    func: async (expectedUsername) => {
      const sleepLocal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const expectedPath = `/${expectedUsername}`.toLowerCase();

      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      }

      function text(el) {
        return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      }

      function isProfilePath() {
        return location.pathname.replace(/\/$/, '').toLowerCase() === expectedPath;
      }

      function pageNeedsLogin() {
        const p = location.pathname.toLowerCase();
        if (p.includes('/login') || p.includes('/i/flow/login')) return true;
        if (document.querySelector('input[autocomplete="username"]')) return true;

        const body = text(document.body);
        return body.includes('sign in to x') ||
               body.includes('log in to x') ||
               body.includes('masuk ke x') ||
               body.includes('login ke x');
      }

      function findByTestIdEnding(suffix) {
        return [...document.querySelectorAll('[data-testid]')]
          .filter(visible)
          .find((el) => (el.getAttribute('data-testid') || '').endsWith(suffix)) || null;
      }

      function alreadyFollowing() {
        if (findByTestIdEnding('-unfollow')) return true;

        return [...document.querySelectorAll('button, [role="button"]')]
          .filter(visible)
          .some((el) => {
            const t = text(el);
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const tid = (el.getAttribute('data-testid') || '').toLowerCase();
            return tid.endsWith('-unfollow') ||
                   t === 'following' ||
                   t === 'mengikuti' ||
                   aria.includes('unfollow') ||
                   aria.includes('berhenti mengikuti');
          });
      }

      function findFollowButton() {
        const byTestId = findByTestIdEnding('-follow');
        if (byTestId) return byTestId;

        const candidates = [...document.querySelectorAll('button, [role="button"]')].filter(visible);
        const byAria = candidates.find((el) => {
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          return aria === `follow @${expectedUsername}`.toLowerCase() ||
                 aria === `follow ${expectedUsername}`.toLowerCase() ||
                 aria.includes(`follow @${expectedUsername}`.toLowerCase());
        });
        if (byAria) return byAria;

        return candidates.find((el) => {
          const t = text(el);
          return t === 'follow' || t === 'ikuti';
        }) || null;
      }

      function realClick(el) {
        const options = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
        try { el.dispatchEvent(new PointerEvent('pointerover', options)); } catch {}
        try { el.dispatchEvent(new PointerEvent('pointerdown', options)); } catch {}
        try { el.dispatchEvent(new MouseEvent('mousedown', options)); } catch {}
        try { el.dispatchEvent(new PointerEvent('pointerup', options)); } catch {}
        try { el.dispatchEvent(new MouseEvent('mouseup', options)); } catch {}
        el.click();
      }

      for (let i = 0; i < 80; i++) {
        if (pageNeedsLogin()) {
          return { ok: false, error: 'You are not logged in to X in this Chrome profile.' };
        }

        if (!isProfilePath()) {
          await sleepLocal(250);
          continue;
        }

        if (alreadyFollowing()) {
          return { ok: true, already: true, message: `Already following @${expectedUsername}` };
        }

        const btn = findFollowButton();
        if (btn) {
          btn.scrollIntoView({ block: 'center', inline: 'center' });
          await sleepLocal(300);
          realClick(btn);

          for (let j = 0; j < 40; j++) {
            await sleepLocal(250);
            if (pageNeedsLogin()) {
              return { ok: false, error: 'X asked you to log in before following.' };
            }
            if (alreadyFollowing()) {
              return { ok: true, already: false, message: `Followed @${expectedUsername}` };
            }
          }

          return {
            ok: false,
            error: 'The Follow button was clicked, but X did not change it to Following. X may have shown a rate-limit or confirmation dialog.'
          };
        }

        await sleepLocal(250);
      }

      return {
        ok: false,
        error: 'Could not find the Follow button. The account may not exist, may be restricted, or X changed its page structure.'
      };
    }
  });

  return results?.[0]?.result || { ok: false, error: 'No result returned from the X page.' };
}

async function runTweetActionScript(tabId, action, statusId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [action, statusId],
    func: async (requestedAction, expectedStatusId) => {
      const sleepLocal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      }

      function text(el) {
        return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      }

      function pageNeedsLogin() {
        const p = location.pathname.toLowerCase();
        if (p.includes('/login') || p.includes('/i/flow/login')) return true;
        if (document.querySelector('input[autocomplete="username"]')) return true;

        const body = text(document.body);
        return body.includes('sign in to x') ||
               body.includes('log in to x') ||
               body.includes('masuk ke x') ||
               body.includes('login ke x');
      }

      function isExpectedStatusPath() {
        return location.pathname.toLowerCase().includes(`/status/${expectedStatusId}`.toLowerCase());
      }

      function realClick(el) {
        const options = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
        try { el.dispatchEvent(new PointerEvent('pointerover', options)); } catch {}
        try { el.dispatchEvent(new PointerEvent('pointerdown', options)); } catch {}
        try { el.dispatchEvent(new MouseEvent('mousedown', options)); } catch {}
        try { el.dispatchEvent(new PointerEvent('pointerup', options)); } catch {}
        try { el.dispatchEvent(new MouseEvent('mouseup', options)); } catch {}
        el.click();
      }

      function hrefMatchesStatus(href) {
        try {
          const u = new URL(href, location.href);
          return u.pathname.toLowerCase().includes(`/status/${expectedStatusId}`.toLowerCase());
        } catch {
          return false;
        }
      }

      function findTargetTweet() {
        const articles = [...document.querySelectorAll('article[data-testid="tweet"]')].filter(visible);
        for (const article of articles) {
          const links = [...article.querySelectorAll('a[href]')];
          if (links.some((a) => hrefMatchesStatus(a.href))) return article;
        }
        return articles[0] || null;
      }

      function findActionElement(testId) {
        const article = findTargetTweet();
        const inArticle = article?.querySelector(`[data-testid="${testId}"]`);
        if (inArticle && visible(inArticle)) return inArticle;
        return [...document.querySelectorAll(`[data-testid="${testId}"]`)].find(visible) || null;
      }

      function findConfirmRetweet() {
        const byTestId = [...document.querySelectorAll('[data-testid="retweetConfirm"]')].find(visible);
        if (byTestId) return byTestId;

        const items = [...document.querySelectorAll('[role="menuitem"], [role="button"]')].filter(visible);
        return items.find((el) => {
          const t = text(el);
          return t === 'repost' || t === 'retweet' || t === 'posting ulang' || t === 'retweet ulang';
        }) || null;
      }

      const target = requestedAction === 'like'
        ? { idle: 'like', done: 'unlike', verb: 'Like' }
        : { idle: 'retweet', done: 'unretweet', verb: 'Repost' };

      for (let i = 0; i < 100; i++) {
        if (pageNeedsLogin()) {
          return { ok: false, error: 'You are not logged in to X in this Chrome profile.' };
        }

        if (!isExpectedStatusPath()) {
          await sleepLocal(250);
          continue;
        }

        if (findActionElement(target.done)) {
          return {
            ok: true,
            already: true,
            message: requestedAction === 'like' ? 'Post is already liked.' : 'Post is already reposted.'
          };
        }

        const actionBtn = findActionElement(target.idle);
        if (!actionBtn) {
          await sleepLocal(250);
          continue;
        }

        actionBtn.scrollIntoView({ block: 'center', inline: 'center' });
        await sleepLocal(300);
        realClick(actionBtn);

        if (requestedAction === 'retweet') {
          let confirm = null;
          for (let j = 0; j < 24; j++) {
            await sleepLocal(200);
            if (findActionElement('unretweet')) {
              return { ok: true, already: false, message: 'Reposted the post.' };
            }
            confirm = findConfirmRetweet();
            if (confirm) break;
          }
          if (confirm) realClick(confirm);
        }

        for (let j = 0; j < 48; j++) {
          await sleepLocal(250);
          if (pageNeedsLogin()) {
            return { ok: false, error: `X asked you to log in before ${target.verb.toLowerCase()}ing.` };
          }
          if (findActionElement(target.done)) {
            return {
              ok: true,
              already: false,
              message: requestedAction === 'like' ? 'Liked the post.' : 'Reposted the post.'
            };
          }
        }

        return {
          ok: false,
          error: requestedAction === 'like'
            ? 'The Like button was clicked, but X did not show the post as liked. X may have blocked the action or shown an error.'
            : 'The Repost button was clicked, but X did not show the post as reposted. X may have blocked the action, changed the menu, or shown an error.'
        };
      }

      return {
        ok: false,
        error: requestedAction === 'like'
          ? 'Could not find the Like button for this post. X may have changed its page structure.'
          : 'Could not find the Repost button for this post. X may have changed its page structure.'
      };
    }
  });

  return results?.[0]?.result || { ok: false, error: 'No result returned from the X page.' };
}

async function runRaidScript(tabId, statusId, replyText) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [statusId, replyText],
    func: async (expectedStatusId, presetText) => {
      const sleepLocal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let capturedReplyId = null;
      let capturedUsername = null;

      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      }

      function normalizedText(el) {
        return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      }

      function pageNeedsLogin() {
        const p = location.pathname.toLowerCase();
        if (p.includes('/login') || p.includes('/i/flow/login')) return true;
        if (document.querySelector('input[autocomplete="username"]')) return true;
        const body = normalizedText(document.body);
        return body.includes('sign in to x') || body.includes('log in to x') || body.includes('masuk ke x') || body.includes('login ke x');
      }

      function isExpectedStatusPath() {
        return location.pathname.toLowerCase().includes(`/status/${expectedStatusId}`.toLowerCase());
      }

      function realClick(el) {
        const options = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
        try { el.dispatchEvent(new PointerEvent('pointerover', options)); } catch {}
        try { el.dispatchEvent(new PointerEvent('pointerdown', options)); } catch {}
        try { el.dispatchEvent(new MouseEvent('mousedown', options)); } catch {}
        try { el.dispatchEvent(new PointerEvent('pointerup', options)); } catch {}
        try { el.dispatchEvent(new MouseEvent('mouseup', options)); } catch {}
        el.click();
      }

      function hrefMatchesStatus(href) {
        try {
          const u = new URL(href, location.href);
          return u.pathname.toLowerCase().includes(`/status/${expectedStatusId}`.toLowerCase());
        } catch {
          return false;
        }
      }

      function findTargetTweet() {
        const articles = [...document.querySelectorAll('article[data-testid="tweet"]')].filter(visible);
        for (const article of articles) {
          const links = [...article.querySelectorAll('a[href]')];
          if (links.some((a) => hrefMatchesStatus(a.href))) return article;
        }
        return articles[0] || null;
      }

      function findCurrentUsername() {
        const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"][href]');
        if (profileLink) {
          const part = new URL(profileLink.href, location.href).pathname.split('/').filter(Boolean)[0];
          if (/^[A-Za-z0-9_]{1,15}$/.test(part || '')) return part;
        }

        const accountButton = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
        const match = (accountButton?.innerText || '').match(/@([A-Za-z0-9_]{1,15})/);
        return match?.[1] || null;
      }

      capturedUsername = findCurrentUsername();

      function findTweetCandidate(node) {
        if (!node || typeof node !== 'object') return null;
        if (Array.isArray(node)) {
          for (const item of node) {
            const found = findTweetCandidate(item);
            if (found) return found;
          }
          return null;
        }

        if (typeof node.rest_id === 'string' && /^\d+$/.test(node.rest_id)) {
          const fullText = node.legacy?.full_text || node.legacy?.text || '';
          if (!fullText || fullText.includes(presetText)) return node;
        }

        for (const value of Object.values(node)) {
          if (value && typeof value === 'object') {
            const found = findTweetCandidate(value);
            if (found) return found;
          }
        }
        return null;
      }

      function findScreenName(node) {
        if (!node || typeof node !== 'object') return null;
        if (typeof node.screen_name === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(node.screen_name)) return node.screen_name;
        for (const value of Object.values(node)) {
          if (value && typeof value === 'object') {
            const found = findScreenName(value);
            if (found) return found;
          }
        }
        return null;
      }

      function inspectCreateTweetPayload(payload) {
        try {
          const candidate = findTweetCandidate(payload);
          if (!candidate) return;
          capturedReplyId = candidate.rest_id || capturedReplyId;
          capturedUsername = findScreenName(candidate) || findScreenName(payload) || capturedUsername;
        } catch {}
      }

      const originalFetch = window.fetch;
      window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try {
          const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
          if (/CreateTweet/i.test(requestUrl)) {
            const payload = await response.clone().json();
            inspectCreateTweetPayload(payload);
          }
        } catch {}
        return response;
      };

      try {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
          this.__xcordUrl = String(url || '');
          return originalOpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function (...args) {
          if (/CreateTweet/i.test(this.__xcordUrl || '')) {
            this.addEventListener('load', () => {
              try { inspectCreateTweetPayload(JSON.parse(this.responseText)); } catch {}
            }, { once: true });
          }
          return originalSend.apply(this, args);
        };
      } catch {}

      function findReplyButton() {
        const article = findTargetTweet();
        const inArticle = article?.querySelector('[data-testid="reply"]');
        if (inArticle && visible(inArticle)) return inArticle;
        return [...document.querySelectorAll('[data-testid="reply"]')].find(visible) || null;
      }

      function findComposer() {
        const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible);
        const selectors = [
          '[data-testid="tweetTextarea_0"][contenteditable="true"]',
          '[data-testid^="tweetTextarea_"][contenteditable="true"]',
          '[contenteditable="true"][role="textbox"]'
        ];
        for (const selector of selectors) {
          const inDialog = dialog?.querySelector(selector);
          if (inDialog && visible(inDialog)) return inDialog;
          const global = [...document.querySelectorAll(selector)].find(visible);
          if (global) return global;
        }
        return null;
      }

      function fillComposer(composer, value) {
        composer.focus();
        try {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(composer);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        } catch {}

        let inserted = false;
        try { inserted = document.execCommand('insertText', false, value); } catch {}
        if (!inserted || !normalizedText(composer)) {
          composer.textContent = value;
          try {
            composer.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              composed: true,
              inputType: 'insertText',
              data: value
            }));
          } catch {
            composer.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          }
        }
      }

      function findSendButton() {
        const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible);
        for (const testId of ['tweetButton', 'tweetButtonInline']) {
          const inDialog = dialog?.querySelector(`[data-testid="${testId}"]`);
          if (inDialog && visible(inDialog)) return inDialog;
        }
        return [...document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')].find(visible) || null;
      }

      function isEnabledButton(btn) {
        if (!btn) return false;
        if (btn.disabled) return false;
        if (btn.getAttribute('aria-disabled') === 'true') return false;
        return true;
      }

      function findReplyUrlInToast() {
        const toast = [...document.querySelectorAll('[data-testid="toast"]')].find(visible);
        const links = [...(toast?.querySelectorAll('a[href*="/status/"]') || [])];
        for (const link of links) {
          try {
            const u = new URL(link.href, location.href);
            const match = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
            if (match && match[2] !== expectedStatusId) return `https://x.com/${match[1]}/status/${match[2]}`;
          } catch {}
        }
        return null;
      }

      for (let i = 0; i < 100; i++) {
        if (pageNeedsLogin()) return { ok: false, error: 'You are not logged in to X in this Chrome profile.' };
        if (!isExpectedStatusPath()) {
          await sleepLocal(250);
          continue;
        }

        const replyButton = findReplyButton();
        if (!replyButton) {
          await sleepLocal(250);
          continue;
        }

        replyButton.scrollIntoView({ block: 'center', inline: 'center' });
        await sleepLocal(250);
        realClick(replyButton);

        let composer = null;
        for (let j = 0; j < 40; j++) {
          await sleepLocal(200);
          if (pageNeedsLogin()) return { ok: false, error: 'X asked you to log in before replying.' };
          composer = findComposer();
          if (composer) break;
        }

        if (!composer) return { ok: false, error: 'Could not open the X reply composer.' };

        fillComposer(composer, presetText);

        let sendButton = null;
        for (let j = 0; j < 30; j++) {
          await sleepLocal(150);
          sendButton = findSendButton();
          if (isEnabledButton(sendButton)) break;
        }

        if (!isEnabledButton(sendButton)) {
          return { ok: false, error: 'The reply text was entered, but X did not enable the Reply button.' };
        }

        realClick(sendButton);

        for (let j = 0; j < 60; j++) {
          await sleepLocal(200);
          if (pageNeedsLogin()) return { ok: false, error: 'X asked you to log in before posting the reply.' };

          const toastUrl = findReplyUrlInToast();
          if (toastUrl) return { ok: true, replyUrl: toastUrl, message: 'Reply posted and link captured.' };

          if (capturedReplyId) {
            const replyUrl = capturedUsername
              ? `https://x.com/${capturedUsername}/status/${capturedReplyId}`
              : `https://x.com/i/web/status/${capturedReplyId}`;
            return { ok: true, replyUrl, message: 'Reply posted and link captured.' };
          }
        }

        const composerStillOpen = !!findComposer();
        if (!composerStillOpen) {
          return { ok: true, replyUrl: null, message: 'Reply posted, but XCORD could not capture its link.' };
        }

        return { ok: false, error: 'X did not confirm that the reply was posted.' };
      }

      return { ok: false, error: 'Could not find the Reply button for this post. X may have changed its page structure.' };
    }
  });

  return results?.[0]?.result || { ok: false, error: 'No result returned from the X page.' };
}

async function followAccount(username, url) {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) {
    return { ok: false, error: 'Invalid X username.' };
  }

  return withBackgroundXTab(
    url || `https://x.com/${username}`,
    (tabId) => runFollowScript(tabId, username)
  );
}

async function actOnTweet(action, username, statusId, url) {
  if (action !== 'like' && action !== 'retweet') {
    return { ok: false, error: 'Invalid tweet action.' };
  }

  if (!/^[A-Za-z0-9_]{1,15}$/.test(username || '')) {
    return { ok: false, error: 'Invalid X username.' };
  }

  if (!/^\d+$/.test(statusId || '')) {
    return { ok: false, error: 'Invalid X status ID.' };
  }

  return withBackgroundXTab(
    url || `https://x.com/${username}/status/${statusId}`,
    (tabId) => runTweetActionScript(tabId, action, statusId)
  );
}

async function raidTweet(username, statusId, url) {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username || '')) {
    return { ok: false, error: 'Invalid X username.' };
  }
  if (!/^\d+$/.test(statusId || '')) {
    return { ok: false, error: 'Invalid X status ID.' };
  }

  const presets = await getRaidPresets();
  if (!presets.length) return { ok: false, error: 'No Raid presets are configured. Open XCORD and add at least one preset.' };

  const preset = presets[secureRandomIndex(presets.length)];
  const result = await withBackgroundXTab(
    url || `https://x.com/${username}/status/${statusId}`,
    (tabId) => runRaidScript(tabId, statusId, preset)
  );

  if (result?.ok && result.replyUrl) {
    await saveReplyLink(statusId, result.replyUrl, preset);
  }

  return { ...result, preset };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'XCORD_FOLLOW') {
    followAccount(message.username, message.url)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (message?.type === 'XCORD_TWEET_ACTION') {
    actOnTweet(message.action, message.username, message.statusId, message.url)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (message?.type === 'XCORD_RAID') {
    raidTweet(message.username, message.statusId, message.url)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (message?.type === 'XCORD_GET_REPLY_LINK') {
    getReplyLink(message.statusId)
      .then((url) => sendResponse({ ok: true, url }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  return false;
});
