/**
 * SOC Monitor
 * Popup Controller
 */

'use strict';


document.addEventListener(
  'DOMContentLoaded',
  async () => {

    /* =========================================
       UI ELEMENTS
       ========================================= */

    const statusBadge =
      document.getElementById(
        'statusBadge'
      );

    const statusText =
      document.getElementById(
        'statusText'
      );

    const inputInterval =
      document.getElementById(
        'inputInterval'
      );

    const selectRunMode =
      document.getElementById(
        'selectRunMode'
      );

    const rowFiniteCount =
      document.getElementById(
        'rowFiniteCount'
      );

    const inputFiniteCount =
      document.getElementById(
        'inputFiniteCount'
      );

    const inputKeyword =
      document.getElementById(
        'inputKeyword'
      );

    const inputCustomMessage =
      document.getElementById(
        'inputCustomMessage'
      );

    const chkEnableKeyword =
      document.getElementById(
        'chkEnableKeyword'
      );

    const chkNotifyUser =
      document.getElementById(
        'chkNotifyUser'
      );

    const chkCaseSensitive =
      document.getElementById(
        'chkCaseSensitive'
      );

    const chkDomScope =
      document.getElementById(
        'chkDomScope'
      );

    const btnStart =
      document.getElementById(
        'btnStart'
      );

    const btnStop =
      document.getElementById(
        'btnStop'
      );

    const errorNotice =
      document.getElementById(
        'errorNotice'
      );


    let activeTabId = null;


    /* =========================================
       RUN MODE
       ========================================= */

    function updateRunModeUI() {

      if (
        selectRunMode.value ===
        'finite'
      ) {

        rowFiniteCount.style.display =
          'flex';

      } else {

        rowFiniteCount.style.display =
          'none';

      }
    }


    selectRunMode.addEventListener(
      'change',
      updateRunModeUI
    );


    /*
     * Set initial state.
     * Default is Infinite Loop.
     */

    updateRunModeUI();


    /* =========================================
       GET CURRENT TAB
       ========================================= */

    try {

      const tabs =
        await chrome.tabs.query({
          active: true,
          currentWindow: true
        });


      const tab =
        tabs[0];


      if (
        !tab ||
        !tab.id
      ) {

        showError(
          'Unable to identify the active tab.'
        );

        btnStart.disabled = true;

        return;

      }


      activeTabId =
        tab.id;


      /*
       * Only standard HTTP/HTTPS pages
       * can be monitored.
       */

      if (
        !tab.url ||
        (
          !tab.url.startsWith(
            'http://'
          ) &&
          !tab.url.startsWith(
            'https://'
          )
        )
      ) {

        showError(
          'SOC Monitor only runs on HTTP/HTTPS webpages.'
        );

        btnStart.disabled = true;

        return;

      }


      /*
       * Restore existing session settings.
       */

      chrome.runtime.sendMessage(
        {
          action: 'GET_SESSION',
          tabId: activeTabId
        },
        (session) => {

          if (
            chrome.runtime.lastError
          ) {
            return;
          }


          if (session) {

            applySessionToUI(
              session
            );

          }

        }
      );

    } catch (error) {

      showError(
        `Extension initialization failed: ${error.message}`
      );

      return;

    }


    /* =========================================
       RESTORE SESSION
       ========================================= */

    function applySessionToUI(
      session
    ) {

      if (
        session.intervalSeconds
      ) {

        inputInterval.value =
          session.intervalSeconds;

      }


      if (
        session.runMode ===
        'finite'
      ) {

        selectRunMode.value =
          'finite';

      } else {

        selectRunMode.value =
          'infinite';

      }


      updateRunModeUI();


      if (
        session.finiteCount
      ) {

        inputFiniteCount.value =
          session.finiteCount;

      }


      if (
        session.keywordConfig
      ) {

        inputKeyword.value =
          session.keywordConfig
            .keyword || '';


        inputCustomMessage.value =
          session.keywordConfig
            .customMessage || '';


        chkEnableKeyword.checked =
          Boolean(
            session.keywordConfig
              .enabled
          );


        chkNotifyUser.checked =
          Boolean(
            session.keywordConfig
              .notifyUser
          );


        chkCaseSensitive.checked =
          Boolean(
            session.keywordConfig
              .caseSensitive
          );


        chkDomScope.checked =
          session.keywordConfig
            .scope === 'html';

      }


      setUIRunning(
        Boolean(
          session.running
        )
      );

    }


    /* =========================================
       RUNNING / IDLE UI
       ========================================= */

    function setUIRunning(
      isRunning
    ) {

      if (isRunning) {

        statusBadge.className =
          'status-indicator status-running';

        statusText.textContent =
          'RUNNING';


        btnStart.disabled =
          true;

        btnStop.disabled =
          false;


        inputInterval.disabled =
          true;

        selectRunMode.disabled =
          true;

        inputFiniteCount.disabled =
          true;

        inputKeyword.disabled =
          true;

        inputCustomMessage.disabled =
          true;

        chkEnableKeyword.disabled =
          true;

        chkNotifyUser.disabled =
          true;

        chkCaseSensitive.disabled =
          true;

        chkDomScope.disabled =
          true;

      } else {

        statusBadge.className =
          'status-indicator status-idle';

        statusText.textContent =
          'IDLE';


        btnStart.disabled =
          false;

        btnStop.disabled =
          true;


        inputInterval.disabled =
          false;

        selectRunMode.disabled =
          false;

        inputFiniteCount.disabled =
          false;

        inputKeyword.disabled =
          false;

        inputCustomMessage.disabled =
          false;

        chkEnableKeyword.disabled =
          false;

        chkNotifyUser.disabled =
          false;

        chkCaseSensitive.disabled =
          false;

        chkDomScope.disabled =
          false;

      }

    }


    /* =========================================
       START SESSION
       ========================================= */

    btnStart.addEventListener(
      'click',
      () => {

        hideError();


        const interval =
          Number.parseInt(
            inputInterval.value,
            10
          );


        if (
          !Number.isInteger(interval) ||
          interval < 5
        ) {

          showError(
            'Minimum refresh interval is 5 seconds.'
          );

          return;

        }


        const runMode =
          selectRunMode.value;


        const finiteCount =
          Number.parseInt(
            inputFiniteCount.value,
            10
          );


        if (
          runMode === 'finite' &&
          (
            !Number.isInteger(
              finiteCount
            ) ||
            finiteCount < 1
          )
        ) {

          showError(
            'Max Refreshes must be at least 1.'
          );

          return;

        }


        const keyword =
          inputKeyword.value.trim();


        if (
          chkEnableKeyword.checked &&
          !keyword
        ) {

          showError(
            'Enter a Target String or disable keyword monitoring.'
          );

          return;

        }


        const payload = {

          tabId:
            activeTabId,

          intervalSeconds:
            interval,

          runMode,

          finiteCount:
            runMode === 'finite'
              ? finiteCount
              : 0,

          keywordConfig: {

            enabled:
              chkEnableKeyword.checked,

            keyword,

            customMessage:
              inputCustomMessage
                .value
                .trim(),

            notifyUser:
              chkNotifyUser.checked,

            caseSensitive:
              chkCaseSensitive.checked,

            scope:
              chkDomScope.checked
                ? 'html'
                : 'text'

          }

        };


        /*
         * Prevent duplicate clicks while
         * waiting for the service worker.
         */

        btnStart.disabled =
          true;


        chrome.runtime.sendMessage(
          {
            action: 'START_SESSION',
            payload
          },
          (response) => {

            if (
              chrome.runtime.lastError
            ) {

              btnStart.disabled =
                false;

              showError(
                'Unable to communicate with the service worker.'
              );

              return;

            }


            if (
              response &&
              response.success
            ) {

              setUIRunning(
                true
              );

              return;

            }


            btnStart.disabled =
              false;


            showError(
              response?.error ||
              'Unable to start monitoring session.'
            );

          }
        );

      }
    );


    /* =========================================
       HALT SESSION
       ========================================= */

    btnStop.addEventListener(
      'click',
      () => {

        hideError();


        /*
         * Prevent multiple HALT clicks.
         */

        btnStop.disabled =
          true;


        chrome.runtime.sendMessage(
          {

            action:
              'STOP_SESSION',

            payload: {
              tabId:
                activeTabId
            }

          },
          (response) => {

            if (
              chrome.runtime.lastError
            ) {

              btnStop.disabled =
                false;

              showError(
                'Unable to communicate with the service worker.'
              );

              return;

            }


            if (
              response &&
              response.success
            ) {

              setUIRunning(
                false
              );

              return;

            }


            btnStop.disabled =
              false;


            showError(
              response?.error ||
              'Unable to stop the monitoring session.'
            );

          }
        );

      }
    );


    /* =========================================
       ERROR DISPLAY
       ========================================= */

    function showError(
      message
    ) {

      errorNotice.textContent =
        message;

      errorNotice.style.display =
        'block';

    }


    function hideError() {

      errorNotice.textContent =
        '';

      errorNotice.style.display =
        'none';

    }

  }
);