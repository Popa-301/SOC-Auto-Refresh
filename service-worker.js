/**
 * SOC Page Refresh & Keyword Monitor
 * Manifest V3 Service Worker
 */

const BADGE_COLOR_COUNTDOWN = '#06b6d4';
const BADGE_COLOR_MATCH = '#ec4899';
const BADGE_COLOR_IDLE = '#475569';

const NOTIFICATION_ID = 'soc_active_alert';

let countdownTicker = null;
let notificationDismissTimer = null;


/* =========================================================
   SESSION HELPERS
   ========================================================= */

function sessionKey(tabId) {
  return `session_${tabId}`;
}


function alarmName(tabId) {
  return `alarm_${tabId}`;
}


async function getTabSession(tabId) {
  if (!Number.isInteger(tabId)) {
    return null;
  }

  const key = sessionKey(tabId);

  const result =
    await chrome.storage.local.get(key);

  return result[key] || null;
}


async function saveTabSession(
  tabId,
  session
) {
  await chrome.storage.local.set({
    [sessionKey(tabId)]: session
  });
}


async function removeTabSession(tabId) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  await chrome.storage.local.remove(
    sessionKey(tabId)
  );

  try {
    await chrome.alarms.clear(
      alarmName(tabId)
    );
  } catch {
    // Alarm may not exist.
  }

  await clearBadge(tabId);
}


async function stopAllOtherSessions(
  currentTabId
) {
  const allData =
    await chrome.storage.local.get(null);

  for (
    const [key, storedValue]
    of Object.entries(allData)
  ) {
    if (!key.startsWith('session_')) {
      continue;
    }

    if (
      !storedValue ||
      storedValue.tabId === currentTabId
    ) {
      continue;
    }

    await stopSessionInternal(
      storedValue.tabId,
      true
    );
  }
}


/* =========================================================
   BADGE HELPERS
   ========================================================= */

async function setBadgeText(
  tabId,
  text,
  backgroundColor
) {
  try {
    await chrome.action.setBadgeText({
      tabId,
      text: String(text)
    });

    if (backgroundColor) {
      await chrome.action
        .setBadgeBackgroundColor({
          tabId,
          color: backgroundColor
        });
    }
  } catch {
    // Tab may have closed.
  }
}


async function clearBadge(tabId) {
  try {
    await chrome.action.setBadgeText({
      tabId,
      text: ''
    });
  } catch {
    // Tab may no longer exist.
  }
}


/* =========================================================
   LIGHTWEIGHT COUNTDOWN DISPLAY
   ========================================================= */

function ensureTickerRunning() {
  if (countdownTicker !== null) {
    return;
  }

  countdownTicker = setInterval(
    () => {
      updateActiveCountdowns()
        .catch(() => {});
    },
    1000
  );
}


async function updateActiveCountdowns() {
  const allData =
    await chrome.storage.local.get(null);

  const now = Date.now();

  let hasRunningSession = false;

  for (
    const [key, session]
    of Object.entries(allData)
  ) {
    if (!key.startsWith('session_')) {
      continue;
    }

    if (!session || !session.running) {
      continue;
    }

    hasRunningSession = true;

    const tabId = session.tabId;

    /*
     * The page is currently reloading or waiting
     * for content.js to complete its scan.
     */
    if (
      session.waitingForPageLoad ||
      !session.nextRefreshTimestamp
    ) {
      await setBadgeText(
        tabId,
        '...',
        BADGE_COLOR_COUNTDOWN
      );

      continue;
    }

    const remainingMilliseconds =
      Math.max(
        0,
        session.nextRefreshTimestamp - now
      );

    const remainingSeconds =
      Math.ceil(
        remainingMilliseconds / 1000
      );

    const displaySeconds =
      remainingSeconds < 100
        ? String(
            remainingSeconds
          ).padStart(2, '0')
        : '99';

    await setBadgeText(
      tabId,
      displaySeconds,
      BADGE_COLOR_COUNTDOWN
    );
  }

  /*
   * Stop the one-second display ticker when
   * there are no active sessions.
   */
  if (
    !hasRunningSession &&
    countdownTicker !== null
  ) {
    clearInterval(countdownTicker);

    countdownTicker = null;
  }
}


/* =========================================================
   REFRESH ALARM
   ========================================================= */

chrome.alarms.onAlarm.addListener(
  async (alarm) => {
    if (
      !alarm.name.startsWith('alarm_')
    ) {
      return;
    }

    const tabId = Number.parseInt(
      alarm.name.replace(
        'alarm_',
        ''
      ),
      10
    );

    if (!Number.isInteger(tabId)) {
      return;
    }

    const session =
      await getTabSession(tabId);

    if (
      !session ||
      !session.running
    ) {
      return;
    }

    /*
     * Prevent a second reload while the current
     * page is still loading or scanning.
     */
    if (session.waitingForPageLoad) {
      return;
    }

    /*
     * Extra finite-mode safety check.
     */
    if (
      session.runMode === 'finite' &&
      session.completedRefreshes >=
        session.finiteCount
    ) {
      await stopSessionInternal(
        tabId,
        false
      );

      await setBadgeText(
        tabId,
        'DONE',
        BADGE_COLOR_IDLE
      );

      return;
    }

    /*
     * Counter reached zero.
     *
     * Pause the next countdown until content.js
     * confirms that the refreshed page has loaded
     * and the keyword scan has completed.
     */
    session.waitingForPageLoad = true;
    session.nextRefreshTimestamp = null;
    session.completedRefreshes += 1;

    await saveTabSession(
      tabId,
      session
    );

    await setBadgeText(
      tabId,
      '...',
      BADGE_COLOR_COUNTDOWN
    );

    try {
      /*
       * Confirm that the tab still exists.
       */
      await chrome.tabs.get(tabId);

      /*
       * Reload the page.
       *
       * The next alarm is NOT created here.
       * PAGE_SCAN_COMPLETE creates it later.
       */
      await chrome.tabs.reload(
        tabId,
        {
          bypassCache: false
        }
      );
    } catch {
      await removeTabSession(tabId);
    }
  }
);


/* =========================================================
   TAB EVENTS
   ========================================================= */

chrome.tabs.onActivated.addListener(
  async ({ tabId }) => {
    const session =
      await getTabSession(tabId);

    if (
      !session ||
      !session.running
    ) {
      await clearBadge(tabId);
      return;
    }

    if (
      session.waitingForPageLoad ||
      !session.nextRefreshTimestamp
    ) {
      await setBadgeText(
        tabId,
        '...',
        BADGE_COLOR_COUNTDOWN
      );

      return;
    }

    const remainingSeconds =
      Math.max(
        0,
        Math.ceil(
          (
            session.nextRefreshTimestamp -
            Date.now()
          ) / 1000
        )
      );

    const displaySeconds =
      remainingSeconds < 100
        ? String(
            remainingSeconds
          ).padStart(2, '0')
        : '99';

    await setBadgeText(
      tabId,
      displaySeconds,
      BADGE_COLOR_COUNTDOWN
    );
  }
);


chrome.tabs.onRemoved.addListener(
  async (tabId) => {
    await removeTabSession(tabId);
  }
);


/* =========================================================
   MESSAGE DISPATCHER
   ========================================================= */

chrome.runtime.onMessage.addListener(
  (
    message,
    sender,
    sendResponse
  ) => {
    if (
      !message ||
      !message.action
    ) {
      return false;
    }

    /*
     * Popup or content.js requests the
     * session for the current tab.
     */
    if (
      message.action === 'GET_SESSION'
    ) {
      const resolvedTabId =
        sender?.tab?.id ??
        message.tabId;

      getTabSession(resolvedTabId)
        .then(
          (session) => {
            sendResponse(session);
          }
        )
        .catch(
          () => {
            sendResponse(null);
          }
        );

      return true;
    }

    /*
     * User presses START SESSION.
     */
    if (
      message.action === 'START_SESSION'
    ) {
      handleStartSession(
        message.payload
      )
        .then(
          (result) => {
            sendResponse(result);
          }
        )
        .catch(
          (error) => {
            sendResponse({
              success: false,
              error: error.message
            });
          }
        );

      return true;
    }

    /*
     * User presses HALT.
     */
    if (
      message.action === 'STOP_SESSION'
    ) {
      handleStopSession(
        message.payload?.tabId
      )
        .then(
          (result) => {
            sendResponse(result);
          }
        )
        .catch(
          (error) => {
            sendResponse({
              success: false,
              error: error.message
            });
          }
        );

      return true;
    }

    /*
     * content.js sends this only after
     * page loading and scanning completes.
     */
    if (
      message.action ===
      'PAGE_SCAN_COMPLETE'
    ) {
      const resolvedTabId =
        sender?.tab?.id ??
        message.payload?.tabId;

      handlePageScanComplete(
        resolvedTabId,
        message.payload,
        sender
      )
        .then(
          (result) => {
            sendResponse(result);
          }
        )
        .catch(
          (error) => {
            sendResponse({
              success: false,
              error: error.message
            });
          }
        );

      return true;
    }

    return false;
  }
);


/* =========================================================
   START SESSION
   ========================================================= */

async function handleStartSession(payload) {
  if (
    !payload ||
    !Number.isInteger(payload.tabId)
  ) {
    throw new Error(
      'Invalid tab ID.'
    );
  }

  const intervalSeconds =
    Number(payload.intervalSeconds);

  if (
    !Number.isFinite(
      intervalSeconds
    ) ||
    intervalSeconds < 5
  ) {
    throw new Error(
      'Refresh interval must be at least 5 seconds.'
    );
  }

  /*
   * Keep only one monitored tab active.
   */
  await stopAllOtherSessions(
    payload.tabId
  );

  /*
   * Remove an old title prefix or overlay
   * before beginning a new session.
   */
  await resetTabMonitorUI(
    payload.tabId
  );

  const nextRefreshTimestamp =
    Date.now() +
    intervalSeconds * 1000;

  const session = {
    tabId: payload.tabId,

    running: true,

    intervalSeconds,

    runMode: payload.runMode,

    finiteCount:
      payload.runMode === 'finite'
        ? Number(
            payload.finiteCount
          )
        : 0,

    completedRefreshes: 0,

    nextRefreshTimestamp,

    waitingForPageLoad: false,

    keywordConfig:
      payload.keywordConfig || {
        enabled: false,
        keyword: '',
        customMessage: '',
        notifyUser: false,
        caseSensitive: false,
        scope: 'text'
      },

    lastMatchCount: 0,

    lastScanTimestamp: null
  };

  await saveTabSession(
    payload.tabId,
    session
  );

  /*
   * Schedule the first refresh.
   */
  chrome.alarms.create(
    alarmName(payload.tabId),
    {
      when: nextRefreshTimestamp
    }
  );

  ensureTickerRunning();

  await setBadgeText(
    payload.tabId,
    String(
      intervalSeconds
    ).padStart(2, '0'),
    BADGE_COLOR_COUNTDOWN
  );

  return {
    success: true,
    session
  };
}


/* =========================================================
   STOP SESSION
   ========================================================= */

async function handleStopSession(tabId) {
  if (!Number.isInteger(tabId)) {
    return {
      success: false,
      error: 'Invalid tab ID.'
    };
  }

  await stopSessionInternal(
    tabId,
    false
  );

  return {
    success: true
  };
}


async function stopSessionInternal(
  tabId,
  removeStoredSession
) {
  const session =
    await getTabSession(tabId);

  if (
    session &&
    !removeStoredSession
  ) {
    session.running = false;
    session.waitingForPageLoad = false;
    session.nextRefreshTimestamp = null;
    session.lastMatchCount = 0;

    await saveTabSession(
      tabId,
      session
    );
  }

  if (removeStoredSession) {
    await chrome.storage.local.remove(
      sessionKey(tabId)
    );
  }

  try {
    await chrome.alarms.clear(
      alarmName(tabId)
    );
  } catch {
    // Alarm may already be absent.
  }

  /*
   * Remove any active desktop notification.
   */
  await clearDesktopNotification();

  /*
   * Immediately remove:
   * - [X MATCHES] from tab title
   * - in-page notification overlay
   */
  await resetTabMonitorUI(tabId);

  await clearBadge(tabId);
}


/* =========================================================
   PAGE LOAD AND SCAN COMPLETE
   ========================================================= */

async function handlePageScanComplete(
  tabId,
  payload,
  sender
) {
  if (
    !Number.isInteger(tabId) ||
    !payload
  ) {
    return {
      success: false
    };
  }

  const session =
    await getTabSession(tabId);

  /*
   * Ignore messages arriving after HALT.
   * This prevents a delayed scan from
   * restarting the timer.
   */
  if (
    !session ||
    !session.running
  ) {
    return {
      success: false,
      stopped: true
    };
  }

  session.lastMatchCount =
    Number(payload.count) || 0;

  session.lastScanTimestamp =
    Date.now();

  session.waitingForPageLoad =
    false;

  const finiteLimitReached =
    session.runMode === 'finite' &&
    session.completedRefreshes >=
      session.finiteCount;

  /*
   * Stop after the configured number
   * of completed refreshes.
   */
  if (finiteLimitReached) {
    session.running = false;
    session.nextRefreshTimestamp = null;

    await saveTabSession(
      tabId,
      session
    );

    try {
      await chrome.alarms.clear(
        alarmName(tabId)
      );
    } catch {
      // Alarm may already be absent.
    }

    await clearDesktopNotification();

    await resetTabMonitorUI(tabId);

    await setBadgeText(
      tabId,
      'DONE',
      BADGE_COLOR_IDLE
    );

    return {
      success: true,
      completed: true,
      session
    };
  }

  /*
   * Page is now loaded and scanned.
   *
   * Only now start the next complete
   * refresh countdown.
   */
  session.nextRefreshTimestamp =
    Date.now() +
    session.intervalSeconds * 1000;

  await saveTabSession(
    tabId,
    session
  );

  chrome.alarms.create(
    alarmName(tabId),
    {
      when:
        session.nextRefreshTimestamp
    }
  );

  ensureTickerRunning();

  if (
    session.lastMatchCount > 0
  ) {
    await setBadgeText(
      tabId,
      `${session.lastMatchCount}F`,
      BADGE_COLOR_MATCH
    );

    if (payload.notifyUser) {
      await createMatchNotification(
        tabId,
        payload,
        sender
      );
    }
  } else {
    await setBadgeText(
      tabId,
      String(
        session.intervalSeconds
      ).padStart(2, '0'),
      BADGE_COLOR_COUNTDOWN
    );
  }

  return {
    success: true,
    session
  };
}


/* =========================================================
   DESKTOP NOTIFICATION
   ========================================================= */

async function createMatchNotification(
  tabId,
  payload
) {
  const [activeTab] =
    await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });

  let lastFocusedWindow = null;

  try {
    lastFocusedWindow =
      await chrome.windows
        .getLastFocused();
  } catch {
    /*
     * Continue without window-focus
     * information.
     */
  }

  const userIsViewingTab =
    Boolean(
      activeTab &&
      activeTab.id === tabId &&
      lastFocusedWindow &&
      lastFocusedWindow.focused
    );

  /*
   * Do not display a desktop notification
   * while the monitored tab is visible.
   *
   * content.js already shows the in-page
   * custom-message overlay.
   */
  if (userIsViewingTab) {
    return;
  }

  const customMessage =
    String(
      payload.customMessage || ''
    ).trim();

  const fallbackMessage =
    `Found "${payload.keyword}" on the monitored page.`;

  /*
   * Reuse one notification ID so
   * notifications never stack.
   */
  await clearDesktopNotification();

  await chrome.notifications.create(
    NOTIFICATION_ID,
    {
      type: 'basic',

      iconUrl:
        chrome.runtime.getURL(
          'icons/icon128.png'
        ),

      title: 'SOC Monitor Alert',

      message:
        customMessage ||
        fallbackMessage,

      priority: 2,

      requireInteraction: false
    }
  );

  notificationDismissTimer =
    setTimeout(
      () => {
        chrome.notifications
          .clear(
            NOTIFICATION_ID
          )
          .catch(() => {});

        notificationDismissTimer =
          null;
      },
      3000
    );
}


async function clearDesktopNotification() {
  if (
    notificationDismissTimer !== null
  ) {
    clearTimeout(
      notificationDismissTimer
    );

    notificationDismissTimer =
      null;
  }

  try {
    await chrome.notifications.clear(
      NOTIFICATION_ID
    );
  } catch {
    /*
     * Notification may not exist.
     */
  }
}


/* =========================================================
   RESET TAB TITLE AND OVERLAY
   ========================================================= */

async function resetTabMonitorUI(tabId) {
  /*
   * First ask the running content script
   * to perform its own cleanup.
   */
  try {
    await chrome.tabs.sendMessage(
      tabId,
      {
        action:
          'RESET_MONITOR_UI'
      }
    );

    return;
  } catch {
    /*
     * The content script may not currently
     * be available while the page loads.
     */
  }

  /*
   * Fallback cleanup.
   *
   * manifest.json must contain:
   * "scripting"
   */
  try {
    await chrome.scripting
      .executeScript({
        target: {
          tabId
        },

        func: () => {
          document.title =
            String(
              document.title || ''
            ).replace(
              /^\[\d+\s+MATCH(?:ES)?\]\s*/i,
              ''
            );

          const overlay =
            document.getElementById(
              '__soc_monitor_overlay_host'
            );

          if (overlay) {
            overlay.remove();
          }
        }
      });
  } catch {
    /*
     * The tab may be closed, loading,
     * or on a restricted Chrome page.
     */
  }
}