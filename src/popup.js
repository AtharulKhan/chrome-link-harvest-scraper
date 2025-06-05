// LinkHarvest Popup Script
// Handles the UI for configuring and starting crawls

document.addEventListener("DOMContentLoaded", () => {
  // Initialize UI elements
  const startButton = document.getElementById("startButton");
  const urlsContainer = document.getElementById("urlsContainer");
  const depthInput = document.getElementById("depthInput");
  const maxPagesInput = document.getElementById("maxPagesInput");
  const extractHtmlCheck = document.getElementById("extractHtml");
  const extractTextCheck = document.getElementById("extractText");
  const extractMetadataCheck = document.getElementById("extractMetadata");
  const saveIndividualFilesCheck = document.getElementById(
    "saveIndividualFiles"
  );
  const crawlSitemapCheck = document.getElementById("crawlSitemap");
  const sitemapButtons = document.getElementById("sitemapButtons");
  const runSitemapButton = document.getElementById("runSitemapButton");
  const extractSitemapButton = document.getElementById("extractSitemapButton");
  const urlPatternInput = document.getElementById("urlPattern");
  const singleUrlMode = document.getElementById("singleUrlMode");
  const listUrlMode = document.getElementById("listUrlMode");
  const urlListTextarea = document.getElementById("urlListTextarea");
  const selectorInput = document.getElementById("selector");
  const rateDelayInput = document.getElementById("rateDelay");
  const webhookUrlInput = document.getElementById("webhookUrl");
  const keywordDensityCheck = document.getElementById("keywordDensity");
  const brokenLinkCheckerCheck = document.getElementById("brokenLinkChecker");
  const csvExportCheck = document.getElementById("csvExport");
  const progressContainer = document.getElementById("progressContainer");
  const progressBar = document.getElementById("progressBar");
  const progressText = document.getElementById("progressText");
  const statusText = document.getElementById("statusText");
  const currentActionText = document.getElementById("currentActionText");
  const useCurrentPageButton = document.getElementById("useCurrentPageButton");
  const currentPageOnlyButton = document.getElementById(
    "currentPageOnlyButton"
  );
  const googleSearchMode = document.getElementById("googleSearchMode");
  const googleQueriesMode = document.getElementById("googleQueriesMode");
  const googleCurrentPageMode = document.getElementById(
    "googleCurrentPageMode"
  );
  const googleQueriesTextarea = document.getElementById(
    "googleQueriesTextarea"
  );
  const urlFilterContains = document.getElementById("urlFilterContains");
  const urlFilterRegex = document.getElementById("urlFilterRegex");
  const urlContainsText = document.getElementById("urlContainsText");

  // Load saved settings
  loadSettings();

  // Setup event handlers for multiple URLs
  setupUrlHandlers();

  // Get current tab URL for the "Current Page" button
  useCurrentPageButton.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        const firstUrlInput = urlsContainer.querySelector(".url-input");
        if (firstUrlInput) {
          firstUrlInput.value = tabs[0].url;
        }
      }
    });
  });

  // Current page only button - crawl just the current page
  currentPageOnlyButton.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        const firstUrlInput = urlsContainer.querySelector(".url-input");
        if (firstUrlInput) {
          firstUrlInput.value = tabs[0].url;
        }
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
      const firstUrlInput = urlsContainer.querySelector(".url-input");
      if (firstUrlInput) {
        firstUrlInput.value = message.url;
      }
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

  // Handle URL mode toggle
  document.querySelectorAll('input[name="urlMode"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (e.target.value === "single") {
        singleUrlMode.classList.remove("hidden");
        listUrlMode.classList.add("hidden");
        googleSearchMode.classList.add("hidden");
      } else if (e.target.value === "list") {
        singleUrlMode.classList.add("hidden");
        listUrlMode.classList.remove("hidden");
        googleSearchMode.classList.add("hidden");
      } else if (e.target.value === "google") {
        singleUrlMode.classList.add("hidden");
        listUrlMode.classList.add("hidden");
        googleSearchMode.classList.remove("hidden");
      }
      saveSettings();
    });
  });

  // Handle Google mode toggle
  document.querySelectorAll('input[name="googleMode"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (e.target.value === "queries") {
        googleQueriesMode.classList.remove("hidden");
        googleCurrentPageMode.classList.add("hidden");
      } else {
        googleQueriesMode.classList.add("hidden");
        googleCurrentPageMode.classList.remove("hidden");

        // Check if current tab is Google search
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (
            tabs[0] &&
            tabs[0].url &&
            tabs[0].url.includes("google.com/search")
          ) {
            currentActionText.textContent =
              "Ready to scrape Google search results from current tab";
            currentActionText.style.color = "#34a853";
          } else {
            currentActionText.textContent =
              "Please navigate to a Google search results page";
            currentActionText.style.color = "#d93025";
          }
        });
      }
      saveSettings();
    });
  });

  // Handle URL filter mode toggle
  document.querySelectorAll('input[name="urlFilterMode"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      urlFilterContains.classList.add("hidden");
      urlFilterRegex.classList.add("hidden");

      if (e.target.value === "contains") {
        urlFilterContains.classList.remove("hidden");
      } else if (e.target.value === "regex") {
        urlFilterRegex.classList.remove("hidden");
      }
      saveSettings();
    });
  });

  // Show/hide sitemap buttons when crawl sitemap is checked
  crawlSitemapCheck.addEventListener("change", () => {
    if (crawlSitemapCheck.checked) {
      sitemapButtons.classList.remove("hidden");
    } else {
      sitemapButtons.classList.add("hidden");
    }
    saveSettings();
  });

  // Run sitemap validation (just list URLs)
  runSitemapButton.addEventListener("click", async () => {
    handleSitemapAction(false);
  });

  // Extract sitemap content (list URLs and scrape content)
  extractSitemapButton.addEventListener("click", async () => {
    handleSitemapAction(true);
  });

  // Common function for sitemap actions
  async function handleSitemapAction(extractContent) {
    const urls = getAllUrls();

    if (urls.length === 0) {
      showError("Please enter at least one valid URL");
      return;
    }

    const button = extractContent ? extractSitemapButton : runSitemapButton;
    button.disabled = true;
    button.textContent = extractContent ? "Extracting..." : "Checking...";

    try {
      // Send message to background script
      chrome.runtime.sendMessage(
        {
          action: extractContent ? "extractSitemapContent" : "validateSitemaps",
          urls: urls,
          settings: {
            extractText: extractTextCheck.checked,
            extractMetadata: extractMetadataCheck.checked,
            extractHtml: extractHtmlCheck.checked,
            delayMs: parseInt(rateDelayInput.value) || 0,
            maxPages: parseInt(maxPagesInput.value) || 100,
          },
        },
        (response) => {
          button.disabled = false;
          button.textContent = extractContent ? "Extract" : "Run";

          if (response && response.success) {
            if (extractContent) {
              // For extract, download the content file
              showError(
                `Successfully extracted content from ${response.totalUrls} sitemap URLs. Check your downloads folder.`,
                "success"
              );
            } else {
              // For run, download the URL list
              downloadSitemapUrlList(response.sitemapData);
              showError(
                `Found ${response.totalUrls} URLs across ${response.validSitemaps} valid sitemaps. Check your downloads folder for the URL list.`,
                "success"
              );
            }
          } else {
            showError(response ? response.error : "Failed to process sitemaps");
          }
        }
      );
    } catch (error) {
      button.disabled = false;
      button.textContent = extractContent ? "Extract" : "Run";
      showError("Error processing sitemaps: " + error.message);
    }
  }

  // For all input fields, save settings on change
  document.querySelectorAll("input, select, textarea").forEach((input) => {
    // Skip URL mode radios and other radios that already have specific handlers
    if (
      input.type === "radio" &&
      (input.name === "urlMode" ||
        input.name === "googleMode" ||
        input.name === "urlFilterMode")
    ) {
      return;
    }
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

  // Function to setup URL input handlers
  function setupUrlHandlers() {
    // Handler for existing add button
    urlsContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("add-url-button")) {
        addUrlInput();
      } else if (e.target.classList.contains("remove-url-button")) {
        removeUrlInput(e.target);
      }
    });

    // Make sure first URL input can't be removed
    updateRemoveButtons();
  }

  // Function to add a new URL input
  function addUrlInput() {
    const urlInputContainer = document.createElement("div");
    urlInputContainer.className = "url-input-container";
    urlInputContainer.innerHTML = `
      <input
        type="url"
        class="url-input"
        placeholder="https://example.com"
        required
      />
      <button
        type="button"
        class="remove-url-button"
        title="Remove this URL"
      >
        ×
      </button>
    `;

    // Change the previous last input's button to remove
    const allContainers = urlsContainer.querySelectorAll(
      ".url-input-container"
    );
    const lastContainer = allContainers[allContainers.length - 1];
    const lastButton = lastContainer.querySelector(".add-url-button");
    if (lastButton) {
      lastButton.className = "remove-url-button";
      lastButton.textContent = "×";
      lastButton.title = "Remove this URL";
    }

    // Add the new container with add button
    const newButton = urlInputContainer.querySelector(".remove-url-button");
    newButton.className = "add-url-button";
    newButton.textContent = "+";
    newButton.title = "Add another URL";

    urlsContainer.appendChild(urlInputContainer);
    updateRemoveButtons();

    // Add change listener to new input
    const newInput = urlInputContainer.querySelector(".url-input");
    newInput.addEventListener("change", saveSettings);
  }

  // Function to remove a URL input
  function removeUrlInput(button) {
    const container = button.closest(".url-input-container");
    if (container) {
      container.remove();
      updateRemoveButtons();
      saveSettings();
    }
  }

  // Function to update remove button visibility
  function updateRemoveButtons() {
    const allContainers = urlsContainer.querySelectorAll(
      ".url-input-container"
    );

    // Make sure the last container has an add button
    allContainers.forEach((container, index) => {
      const button = container.querySelector("button");
      if (index === allContainers.length - 1) {
        button.className = "add-url-button";
        button.textContent = "+";
        button.title = "Add another URL";
      } else {
        button.className = "remove-url-button";
        button.textContent = "×";
        button.title = "Remove this URL";
      }
    });
  }

  // Function to get all URLs
  function getAllUrls() {
    const urlMode = document.querySelector(
      'input[name="urlMode"]:checked'
    ).value;

    if (urlMode === "list") {
      // Get URLs from textarea
      const urls = [];
      const lines = urlListTextarea.value.split("\n");
      lines.forEach((line) => {
        const url = line.trim();
        if (url && url.match(/^https?:\/\//i)) {
          urls.push(url);
        }
      });
      return urls;
    } else if (urlMode === "google") {
      // Google search mode
      const googleMode = document.querySelector(
        'input[name="googleMode"]:checked'
      ).value;

      if (googleMode === "currentPage") {
        // Return current tab URL if it's a Google search page
        return []; // Will be handled specially in startCrawl
      } else {
        // Return Google search queries
        const queries = [];
        const lines = googleQueriesTextarea.value.split("\n");
        lines.forEach((line) => {
          const query = line.trim();
          if (query) {
            queries.push(query);
          }
        });
        return queries;
      }
    } else {
      // Get URLs from single inputs
      const urlInputs = urlsContainer.querySelectorAll(".url-input");
      const urls = [];
      urlInputs.forEach((input) => {
        const url = input.value.trim();
        if (url && url.match(/^https?:\/\//i)) {
          urls.push(url);
        }
      });
      return urls;
    }
  }

  // Function to start the crawl
  function startCrawl() {
    // Get URL mode first
    const urlMode = document.querySelector(
      'input[name="urlMode"]:checked'
    ).value;

    // Handle Google search mode specially
    if (urlMode === "google") {
      const googleMode = document.querySelector(
        'input[name="googleMode"]:checked'
      ).value;

      if (googleMode === "currentPage") {
        // Check if current page is a Google search page
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (
            tabs[0] &&
            tabs[0].url &&
            tabs[0].url.includes("google.com/search")
          ) {
            const settings = {
              urls: [tabs[0].url],
              urlMode: "google",
              googleMode: "currentPage",
              maxDepth: 0, // No depth for Google search scraping
              maxPages: parseInt(maxPagesInput.value) || 50,
              extractHtml: extractHtmlCheck.checked,
              extractText: extractTextCheck.checked,
              extractMetadata: extractMetadataCheck.checked,
              saveIndividualFiles: saveIndividualFilesCheck.checked,
              crawlSitemap: false, // No sitemap for Google search
              urlPattern: urlPatternInput.value.trim(),
              selector: selectorInput.value.trim(),
              delayMs: parseInt(rateDelayInput.value) || 0,
              webhookUrl: webhookUrlInput.value.trim(),
              keywordDensity: keywordDensityCheck.checked,
              brokenLinkChecker: brokenLinkCheckerCheck.checked,
              csvExport: csvExportCheck.checked,
            };

            startCrawlWithSettings(settings);
          } else {
            showError(
              "Current page is not a Google search page. Please navigate to a Google search results page."
            );
          }
        });
        return;
      } else {
        // Handle queries mode
        const queries = getAllUrls(); // This returns queries when in google mode
        if (queries.length === 0) {
          showError("Please enter at least one search query");
          return;
        }

        const settings = {
          urls: queries, // These are actually queries
          urlMode: "google",
          googleMode: "queries",
          maxDepth: 0, // No depth for Google search scraping
          maxPages: parseInt(maxPagesInput.value) || 50,
          extractHtml: extractHtmlCheck.checked,
          extractText: extractTextCheck.checked,
          extractMetadata: extractMetadataCheck.checked,
          saveIndividualFiles: saveIndividualFilesCheck.checked,
          crawlSitemap: false, // No sitemap for Google search
          urlPattern: urlPatternInput.value.trim(),
          selector: selectorInput.value.trim(),
          delayMs: parseInt(rateDelayInput.value) || 0,
          webhookUrl: webhookUrlInput.value.trim(),
          keywordDensity: keywordDensityCheck.checked,
          brokenLinkChecker: brokenLinkCheckerCheck.checked,
          csvExport: csvExportCheck.checked,
        };

        startCrawlWithSettings(settings);
      }
    } else {
      // Normal URL crawling
      const urls = getAllUrls();

      // Validate URLs
      if (urls.length === 0) {
        showError(
          "Please enter at least one valid URL starting with http:// or https://"
        );
        return;
      }

      // Get URL filter settings
      const urlFilterMode =
        document.querySelector('input[name="urlFilterMode"]:checked')?.value ||
        "none";

      let urlFilterSettings = { mode: urlFilterMode };
      if (urlFilterMode === "contains") {
        urlFilterSettings.contains = urlContainsText.value.trim();
      } else if (urlFilterMode === "regex") {
        urlFilterSettings.pattern = urlPatternInput.value.trim();
      }

      // Get settings
      const settings = {
        urls: urls,
        urlMode: urlMode,
        maxDepth: urlMode === "list" ? 0 : parseInt(depthInput.value) || 0,
        maxPages: parseInt(maxPagesInput.value) || 50,
        extractHtml: extractHtmlCheck.checked,
        extractText: extractTextCheck.checked,
        extractMetadata: extractMetadataCheck.checked,
        saveIndividualFiles: saveIndividualFilesCheck.checked,
        crawlSitemap: crawlSitemapCheck.checked,
        urlFilter: urlFilterSettings,
        selector: selectorInput.value.trim(),
        delayMs: parseInt(rateDelayInput.value) || 0,
        webhookUrl: webhookUrlInput.value.trim(),
        keywordDensity: keywordDensityCheck.checked,
        brokenLinkChecker: brokenLinkCheckerCheck.checked,
        csvExport: csvExportCheck.checked,
      };

      startCrawlWithSettings(settings);
    }
  }

  // Helper function to start crawl with settings
  function startCrawlWithSettings(settings) {
    // Save settings
    saveSettings();

    // Show progress UI
    progressContainer.classList.remove("hidden");
    startButton.disabled = true;
    currentPageOnlyButton.disabled = true;
    useCurrentPageButton.disabled = true;

    // Initialize the action text
    if (settings.urlMode === "google") {
      if (settings.googleMode === "queries") {
        updateCurrentAction(
          `Starting Google search crawl for ${settings.urls.length} queries`
        );
      } else {
        updateCurrentAction(`Starting Google search page crawl`);
      }
    } else {
      updateCurrentAction(`Starting crawl of ${settings.urls.length} URL(s)`);
    }

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
    try {
      console.log("Saving settings...");
      const urls = getAllUrls();
      const urlMode = document.querySelector(
        'input[name="urlMode"]:checked'
      ).value;

      // Log the CSV export state before saving
      console.log("CSV Export checkbox state:", csvExportCheck.checked);

      const settings = {
        urls: urls,
        urlMode: urlMode,
        urlListText: urlListTextarea.value,
        depth: depthInput.value,
        maxPages: maxPagesInput.value,
        extractHtml: extractHtmlCheck.checked,
        extractText: extractTextCheck.checked,
        extractMetadata: extractMetadataCheck.checked,
        saveIndividualFiles: saveIndividualFilesCheck.checked,
        crawlSitemap: crawlSitemapCheck.checked,
        urlPattern: urlPatternInput.value,
        selector: selectorInput.value,
        rateDelay: rateDelayInput.value,
        webhookUrl: webhookUrlInput.value,
        keywordDensity: keywordDensityCheck.checked,
        brokenLinkChecker: brokenLinkCheckerCheck.checked,
        csvExport: csvExportCheck.checked,
      };

      console.log("Settings to save:", settings);

      // Check storage size
      const settingsString = JSON.stringify(settings);
      console.log("Settings size:", settingsString.length, "bytes");

      chrome.storage.sync.set({ harvestSettings: settings }, () => {
        if (chrome.runtime.lastError) {
          console.error("Error saving settings:", chrome.runtime.lastError);
          // Don't reload settings on error as it causes checkbox to uncheck
          alert("Error saving settings: " + chrome.runtime.lastError.message);
        } else {
          console.log("Settings saved successfully");
        }
      });
    } catch (error) {
      console.error("Error in saveSettings:", error);
    }
  }

  // Function to load settings from chrome.storage
  function loadSettings() {
    chrome.storage.sync.get("harvestSettings", (data) => {
      if (data.harvestSettings) {
        const settings = data.harvestSettings;

        // Apply settings to form
        if (settings.urls && settings.urls.length > 0) {
          // Clear existing inputs and add saved URLs
          urlsContainer.innerHTML = "";
          settings.urls.forEach((url, index) => {
            const urlInputContainer = document.createElement("div");
            urlInputContainer.className = "url-input-container";
            urlInputContainer.innerHTML = `
              <input
                type="url"
                class="url-input"
                placeholder="https://example.com"
                value="${url}"
                required
              />
              <button
                type="button"
                class="${
                  index === settings.urls.length - 1
                    ? "add-url-button"
                    : "remove-url-button"
                }"
                title="${
                  index === settings.urls.length - 1
                    ? "Add another URL"
                    : "Remove this URL"
                }"
              >
                ${index === settings.urls.length - 1 ? "+" : "×"}
              </button>
            `;
            urlsContainer.appendChild(urlInputContainer);
          });
        } else if (settings.url) {
          // Legacy single URL support
          const firstUrlInput = urlsContainer.querySelector(".url-input");
          if (firstUrlInput) {
            firstUrlInput.value = settings.url;
          }
        }

        if (settings.depth) depthInput.value = settings.depth;
        if (settings.maxPages) maxPagesInput.value = settings.maxPages;
        if (settings.extractHtml !== undefined)
          extractHtmlCheck.checked = settings.extractHtml;
        if (settings.extractText !== undefined)
          extractTextCheck.checked = settings.extractText;
        if (settings.extractMetadata !== undefined)
          extractMetadataCheck.checked = settings.extractMetadata;
        if (settings.saveIndividualFiles !== undefined)
          saveIndividualFilesCheck.checked = settings.saveIndividualFiles;
        if (settings.crawlSitemap !== undefined) {
          crawlSitemapCheck.checked = settings.crawlSitemap;
          // Show/hide sitemap buttons based on saved setting
          if (settings.crawlSitemap) {
            sitemapButtons.classList.remove("hidden");
          } else {
            sitemapButtons.classList.add("hidden");
          }
        }
        if (settings.urlMode) {
          document.querySelector(
            `input[name="urlMode"][value="${settings.urlMode}"]`
          ).checked = true;
          if (settings.urlMode === "list") {
            singleUrlMode.classList.add("hidden");
            listUrlMode.classList.remove("hidden");
          }
        }
        if (settings.urlListText) {
          urlListTextarea.value = settings.urlListText;
        }
        if (settings.urlPattern) urlPatternInput.value = settings.urlPattern;
        if (settings.selector) selectorInput.value = settings.selector;
        if (settings.rateDelay) rateDelayInput.value = settings.rateDelay;
        if (settings.webhookUrl) webhookUrlInput.value = settings.webhookUrl;
        if (settings.keywordDensity !== undefined)
          keywordDensityCheck.checked = settings.keywordDensity;
        if (settings.brokenLinkChecker !== undefined)
          brokenLinkCheckerCheck.checked = settings.brokenLinkChecker;
        if (settings.csvExport !== undefined)
          csvExportCheck.checked = settings.csvExport;
      }

      // Add change listeners to all URL inputs
      const urlInputs = urlsContainer.querySelectorAll(".url-input");
      urlInputs.forEach((input) => {
        input.addEventListener("change", saveSettings);
      });

      // Check if we're already on a page we can crawl
      loadCurrentPageUrl();
    });
  }

  // Function to pre-fill URL with current page when popup opens
  function loadCurrentPageUrl() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url && tabs[0].url.match(/^https?:\/\//i)) {
        // Only pre-fill if URL input is empty
        const firstUrlInput = urlsContainer.querySelector(".url-input");
        if (firstUrlInput && !firstUrlInput.value) {
          firstUrlInput.value = tabs[0].url;
        }
      }
    });
  }

  // Function to download sitemap URL list
  function downloadSitemapUrlList(sitemapData) {
    let content = "SITEMAP URL EXTRACTION RESULTS\n";
    content += "==============================\n\n";
    content += `Extraction Date: ${new Date().toLocaleString()}\n\n`;

    let totalUrls = 0;

    for (const [baseUrl, data] of Object.entries(sitemapData)) {
      content += `\nBase URL: ${baseUrl}\n`;
      content += `-`.repeat(baseUrl.length + 10) + `\n`;

      if (data.sitemapUrl) {
        content += `Sitemap: ${data.sitemapUrl}\n`;
        content += `URLs found: ${data.urls.length}\n\n`;

        data.urls.forEach((url, index) => {
          content += `${index + 1}. ${url}\n`;
        });

        totalUrls += data.urls.length;
      } else {
        content += `No valid sitemap found\n`;
      }

      content += `\n${"=".repeat(50)}\n`;
    }

    content += `\nTOTAL URLS FOUND: ${totalUrls}\n`;

    // Create blob and download
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sitemap_urls_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Function to show error message
  function showError(message, type = "error") {
    const errorElement = document.getElementById("errorMessage");
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.classList.remove("hidden");

      // Apply appropriate styling based on type
      if (type === "success") {
        errorElement.style.backgroundColor = "#34a853";
      } else {
        errorElement.style.backgroundColor = "#d93025";
      }

      // Hide after 5 seconds
      setTimeout(() => {
        errorElement.classList.add("hidden");
      }, 5000);
    }
  }
});
