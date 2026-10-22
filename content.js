(() => {
  'use strict';

  const OVERLAY_HOST_ID = '__soc_monitor_overlay_host';
  const SCAN_DELAY_MS = 1200;

  let scanTimeoutId = null;

  // Listen for cleanup command when HALT is pressed
  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (message?.action === 'RESET_MONITOR_UI') {
        resetMonitorUI();

        sendResponse({
          success: true
        });
      }
    }
  );

  // Get current monitoring session
  chrome.runtime.sendMessage(
    {
      action: 'GET_SESSION'
    },
    (session) => {
      if (
        chrome.runtime.lastError ||
        !session ||
        !session.running ||
        !session.keywordConfig
      ) {
        return;
      }

      const config = session.keywordConfig;

      // Keyword monitor disabled or empty
      if (
        !config.enabled ||
        !config.keyword ||
        !config.keyword.trim()
      ) {
        reportPageReady(
          session.tabId,
          0,
          '',
          '',
          false
        );

        return;
      }

      /*
       * Wait briefly after page load.
       * This gives dynamic AIsaac content time to render.
       *
       * IMPORTANT:
       * No polling.
       * No MutationObserver.
       * Only one timer per page load.
       */
      scanTimeoutId = window.setTimeout(
        () => {
          scanTimeoutId = null;

          executeScan(
            config,
            session.tabId
          );
        },
        SCAN_DELAY_MS
      );
    }
  );

  function executeScan(config, tabId) {
    removeOverlay();

    const keyword = config.keyword.trim();

    const sourceContent =
      config.scope === 'html'
        ? getRawDomContent()
        : getVisiblePageText();

    const matchesCount =
      countExactOccurrences(
        sourceContent,
        keyword,
        config.caseSensitive
      );

    updatePageTitle(matchesCount);

    reportPageReady(
      tabId,
      matchesCount,
      keyword,
      config.customMessage || '',
      config.notifyUser
    );

    if (matchesCount > 0) {
      mountNotification(
        keyword,
        config.customMessage || '',
        config.scope
      );
    }
  }

  function reportPageReady(
    tabId,
    count,
    keyword,
    customMessage,
    notifyUser
  ) {
    chrome.runtime.sendMessage({
      action: 'PAGE_SCAN_COMPLETE',

      payload: {
        tabId,
        count,
        keyword,
        customMessage,
        notifyUser
      }
    });
  }

  function getVisiblePageText() {
    return document.body
      ? document.body.innerText || ''
      : '';
  }

  function getRawDomContent() {
    if (!document.documentElement) {
      return '';
    }

    /*
     * Clone the document before searching.
     * This prevents the extension overlay from
     * becoming part of its own Raw DOM result.
     */
    const clonedDocument =
      document.documentElement.cloneNode(true);

    const extensionOverlay =
      clonedDocument.querySelector(
        `#${OVERLAY_HOST_ID}`
      );

    if (extensionOverlay) {
      extensionOverlay.remove();
    }

    return clonedDocument.outerHTML || '';
  }

  function countExactOccurrences(
    text,
    searchValue,
    caseSensitive
  ) {
    if (!text || !searchValue) {
      return 0;
    }

    const escapedValue =
      escapeRegExp(searchValue);

    /*
     * Prevent "ago" from matching as part
     * of a larger word.
     */
    const expression =
      `(?<![\\p{L}\\p{N}_])` +
      escapedValue +
      `(?![\\p{L}\\p{N}_])`;

    const flags =
      caseSensitive
        ? 'gu'
        : 'giu';

    try {
      const results =
        text.match(
          new RegExp(
            expression,
            flags
          )
        );

      return results
        ? results.length
        : 0;
    } catch {
      return countLiteralOccurrences(
        text,
        searchValue,
        caseSensitive
      );
    }
  }

  function countLiteralOccurrences(
    text,
    searchValue,
    caseSensitive
  ) {
    const pool =
      caseSensitive
        ? text
        : text.toLowerCase();

    const target =
      caseSensitive
        ? searchValue
        : searchValue.toLowerCase();

    let count = 0;
    let position = 0;

    while (
      (
        position =
          pool.indexOf(
            target,
            position
          )
      ) !== -1
    ) {
      const previousCharacter =
        position > 0
          ? pool[position - 1]
          : '';

      const nextCharacter =
        pool[
          position +
          target.length
        ] || '';

      const previousIsWord =
        /[a-z0-9_]/i.test(
          previousCharacter
        );

      const nextIsWord =
        /[a-z0-9_]/i.test(
          nextCharacter
        );

      if (
        !previousIsWord &&
        !nextIsWord
      ) {
        count++;
      }

      position += Math.max(
        target.length,
        1
      );
    }

    return count;
  }

  function updatePageTitle(count) {
    const cleanTitle =
      removeMatchPrefix(
        document.title
      );

    if (count > 0) {
      const label =
        count === 1
          ? 'MATCH'
          : 'MATCHES';

      document.title =
        `[${count} ${label}] ${cleanTitle}`;
    } else {
      document.title =
        cleanTitle;
    }
  }

  function removeMatchPrefix(title) {
    return String(
      title || ''
    ).replace(
      /^\[\d+\s+MATCH(?:ES)?\]\s*/i,
      ''
    );
  }

  function resetMonitorUI() {
    if (scanTimeoutId !== null) {
      clearTimeout(
        scanTimeoutId
      );

      scanTimeoutId = null;
    }

    removeOverlay();

    document.title =
      removeMatchPrefix(
        document.title
      );
  }

  function removeOverlay() {
    const overlay =
      document.getElementById(
        OVERLAY_HOST_ID
      );

    if (overlay) {
      overlay.remove();
    }
  }

  function mountNotification(
    keyword,
    customMessage,
    scope
  ) {
    removeOverlay();

    const host =
      document.createElement(
        'div'
      );

    host.id =
      OVERLAY_HOST_ID;

    Object.assign(
      host.style,
      {
        position: 'fixed',
        bottom: '24px',
        left: '24px',
        zIndex: '2147483647'
      }
    );

    const shadow =
      host.attachShadow({
        mode: 'closed'
      });

    const banner =
      document.createElement(
        'div'
      );

    const scopeLabel =
      scope === 'html'
        ? 'Raw DOM'
        : 'Visible text';

    const displayMessage =
      customMessage.trim() ||
      `"${keyword}" detected`;

    banner.innerHTML = `
      <style>
        .soc-alert-banner {
          background: rgba(7, 11, 20, 0.95);
          border: 1px solid #00f0ff;
          border-radius: 8px;
          box-shadow:
            0 8px 30px
            rgba(0, 240, 255, 0.25);
          color: #ffffff;
          font-family:
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            Roboto,
            sans-serif;
          font-size: 13px;
          padding: 12px 18px;
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          user-select: none;
          max-width: 420px;
        }

        .soc-icon {
          color: #00f0ff;
          font-size: 18px;
        }

        .main-message {
          font-weight: 650;
          overflow-wrap: anywhere;
        }

        .sub-hint {
          display: block;
          color: #94a3b8;
          font-size: 10px;
          margin-top: 3px;
        }
      </style>

      <div class="soc-alert-banner">
        <div class="soc-icon">
          ⛨
        </div>

        <div>
          <span class="main-message">
            ${escapeHtml(displayMessage)}
          </span>

          <span class="sub-hint">
            ${scopeLabel} · Click or press Esc
          </span>
        </div>
      </div>
    `;

    shadow.appendChild(
      banner
    );

    document.documentElement
      .appendChild(host);

    const cleanup = () => {
      if (host.isConnected) {
        host.remove();
      }

      document.removeEventListener(
        'keydown',
        handleKey,
        true
      );
    };

    const handleKey =
      (event) => {
        if (
          event.key === 'Escape'
        ) {
          cleanup();
        }
      };

    setTimeout(
      () => {
        document.addEventListener(
          'click',
          cleanup,
          {
            capture: true,
            once: true
          }
        );

        document.addEventListener(
          'keydown',
          handleKey,
          true
        );
      },
      150
    );
  }

  function escapeRegExp(value) {
    return value.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );
  }

  function escapeHtml(value) {
    return String(
      value
    ).replace(
      /[&<>"']/g,
      (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      })[character]
    );
  }
})();