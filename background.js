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

        // Permalink pages normally render the target tweet first.
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
        ? { idle: 'like', done: 'unlike', verb: 'Like', doneVerb: 'Liked' }
        : { idle: 'retweet', done: 'unretweet', verb: 'Repost', doneVerb: 'Reposted' };

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

            // Sometimes X may immediately repost without a menu.
            if (findActionElement('unretweet')) {
              return { ok: true, already: false, message: 'Reposted the post.' };
            }

            confirm = findConfirmRetweet();
            if (confirm) break;
          }

          if (confirm) {
            realClick(confirm);
          }
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

  return false;
});
