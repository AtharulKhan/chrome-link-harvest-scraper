// LinkHarvest Popup Script
// Handles the UI for configuring and starting crawls

document.addEventListener("DOMContentLoaded", () => {
  // Initialize UI elements
  const startButton = document.getElementById("startButton");
  const urlInput = document.getElementById("urlInput");
  const depthInput = document.getElementById("depthInput");
  const maxPagesInput = document.getElementById("maxPagesInput");
  const extractHtmlCheck = document.getElementById("extractHtml");
  const extractTextCheck = document.getElementById("extractText");
  const extractMetadataCheck = document.getElementById("extractMetadata");
  const urlPatternInput = document.getElementById("urlPattern");
  const selectorInput = document.getElementById("selector");
  const rateDelayInput = document.getElementById("rateDelay");
  const progressContainer = document.getElementById("progressContainer");
  const progressBar = document.getElementById("progressBar");
  const progressText = document.getElementById("progressText");
  const statusText = document.getElementById("statusText");
  const currentActionText = document.getElementById("currentActionText");
  const useCurrentPageButton = document.getElementById("useCurrentPageButton");
  const currentPageOnlyButton = document.getElementById(
    "currentPageOnlyButton"
  );

  // Load saved settings
  loadSettings();

  // Get current tab URL for the "Current Page" button
  useCurrentPageButton.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        urlInput.value = tabs[0].url;
      }
    });
  });

  // Current page only button - crawl just the current page
  currentPageOnlyButton.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        urlInput.value = tabs[0].url;
        // Set depth to 0 (just current page)
        depthInput.value = 0;
        // Start the crawl
        startCrawl();
      } else {
        showError("Could not detect current page URL.");
      }
    });
  });

  // Check if we have a URL passed from the context menu
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "setTargetUrl" && message.url) {
      urlInput.value = message.url;
    }

    if (message.action === "updateProgress") {
      updateProgressUI(message);
    }

    if (message.action === "crawlError") {
      showError(message.error);
    }

    if (message.action === "updateCurrentAction") {
      updateCurrentAction(message.text);
    }

    // Always return false for non-async responses
    return false;
  });

  // Event listeners
  startButton.addEventListener("click", startCrawl);

  // For all input fields, save settings on change
  document.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("change", saveSettings);
  });

  // Advanced settings toggle
  const advancedToggle = document.getElementById("advancedToggle");
  const advancedSettings = document.getElementById("advancedSettings");

  advancedToggle.addEventListener("click", () => {
    advancedSettings.classList.toggle("hidden");
    advancedToggle.textContent = advancedSettings.classList.contains("hidden")
      ? "Show Advanced Options ▼"
      : "Hide Advanced Options ▲";
  });

  // Function to start the crawl
  function startCrawl() {
    const url = urlInput.value.trim();

    // Validate URL
    if (!url || !url.match(/^https?:\/\//i)) {
      showError("Please enter a valid URL starting with http:// or https://");
      return;
    }

    // Get settings
    const settings = {
      baseUrl: url,
      maxDepth: parseInt(depthInput.value) || 0,
      maxPages: parseInt(maxPagesInput.value) || 50,
      extractHtml: extractHtmlCheck.checked,
      extractText: extractTextCheck.checked,
      extractMetadata: extractMetadataCheck.checked,
      urlPattern: urlPatternInput.value.trim(),
      selector: selectorInput.value.trim(),
      delayMs: parseInt(rateDelayInput.value) || 0,
    };

    // Save settings
    saveSettings();

    // Show progress UI
    progressContainer.classList.remove("hidden");
    startButton.disabled = true;
    currentPageOnlyButton.disabled = true;
    useCurrentPageButton.disabled = true;

    // Initialize the action text
    updateCurrentAction(`Starting crawl of ${url}`);

    // Send message to background script to start the crawl
    chrome.runtime.sendMessage({
      action: "startCrawl",
      settings: settings,
    });

    // Show overlay on the active tab if available
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0 && tabs[0].id) {
          try {
            chrome.tabs.sendMessage(
              tabs[0].id,
              { type: "TOGGLE_HARVEST_OVERLAY" },
              // Add a response callback to handle potential errors
              (response) => {
                if (chrome.runtime.lastError) {
                  // Suppress errors about receiving end not existing
                  console.log(
                    "Note: Content script may not be loaded on this page"
                  );
                }
              }
            );
          } catch (e) {
            console.log("Could not send message to content script:", e);
          }
        }
      });
    } catch (e) {
      console.log("Error accessing tabs:", e);
    }
  }

  // Function to update the progress UI
  function updateProgressUI(data) {
    if (!data) return;

    const { processed, total, status } = data;

    if (progressBar && progressText) {
      // Calculate percentage
      const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

      // Update UI
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${processed} of ${total} pages processed (${percent}%)`;

      if (status && statusText) {
        statusText.textContent = status;
      }

      // If completed, enable the start button again
      if (status && status.includes("complete")) {
        startButton.disabled = false;
        currentPageOnlyButton.disabled = false;
        useCurrentPageButton.disabled = false;
      }
    }
  }

  // Function to update the current action text
  function updateCurrentAction(text) {
    if (currentActionText) {
      currentActionText.textContent = text;
    }
  }

  // Function to save settings to chrome.storage
  function saveSettings() {
    const settings = {
      url: urlInput.value,
      depth: depthInput.value,
      maxPages: maxPagesInput.value,
      extractHtml: extractHtmlCheck.checked,
      extractText: extractTextCheck.checked,
      extractMetadata: extractMetadataCheck.checked,
      urlPattern: urlPatternInput.value,
      selector: selectorInput.value,
      rateDelay: rateDelayInput.value,
    };

    chrome.storage.sync.set({ harvestSettings: settings });
  }

  // Function to load settings from chrome.storage
  function loadSettings() {
    chrome.storage.sync.get("harvestSettings", (data) => {
      if (data.harvestSettings) {
        const settings = data.harvestSettings;

        // Apply settings to form
        if (settings.url) urlInput.value = settings.url;
        if (settings.depth) depthInput.value = settings.depth;
        if (settings.maxPages) maxPagesInput.value = settings.maxPages;
        if (settings.extractHtml !== undefined)
          extractHtmlCheck.checked = settings.extractHtml;
        if (settings.extractText !== undefined)
          extractTextCheck.checked = settings.extractText;
        if (settings.extractMetadata !== undefined)
          extractMetadataCheck.checked = settings.extractMetadata;
        if (settings.urlPattern) urlPatternInput.value = settings.urlPattern;
        if (settings.selector) selectorInput.value = settings.selector;
        if (settings.rateDelay) rateDelayInput.value = settings.rateDelay;
      }

      // Check if we're already on a page we can crawl
      loadCurrentPageUrl();
    });
  }

  // Function to pre-fill URL with current page when popup opens
  function loadCurrentPageUrl() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url && tabs[0].url.match(/^https?:\/\//i)) {
        // Only pre-fill if URL input is empty
        if (!urlInput.value) {
          urlInput.value = tabs[0].url;
        }
      }
    });
  }

  // Function to show error message
  function showError(message) {
    const errorElement = document.getElementById("errorMessage");
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.classList.remove("hidden");

      // Hide after 5 seconds
      setTimeout(() => {
        errorElement.classList.add("hidden");
      }, 5000);
    }
  }
});
