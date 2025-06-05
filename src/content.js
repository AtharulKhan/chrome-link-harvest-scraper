// LinkHarvest Content Script
// Handles page interactions and overlay display

// Create and initialize overlay elements
let harvestOverlay = null;
let harvestStatus = null;

// Only initialize message listener if we're in a Chrome extension context
if (
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  chrome.runtime.onMessage
) {
  // Listen for messages from popup or background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "TOGGLE_HARVEST_OVERLAY") {
      toggleOverlay();
    }

    if (message.type === "UPDATE_HARVEST_STATUS" && message.status) {
      updateOverlayStatus(message.status);
    }

    // Always return false for non-async responses
    return false;
  });
}

// Function to create or toggle the overlay
function toggleOverlay() {
  // If overlay already exists, toggle it
  if (harvestOverlay) {
    if (harvestOverlay.style.display === "none") {
      harvestOverlay.style.display = "flex";
    } else {
      harvestOverlay.style.display = "none";
    }
    return;
  }

  // Create overlay
  harvestOverlay = document.createElement("div");
  harvestOverlay.id = "linkHarvestOverlay";
  harvestOverlay.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    background-color: rgba(66, 133, 244, 0.9);
    color: white;
    z-index: 999999;
    padding: 10px 15px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    border-bottom-left-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  `;

  // Create logo/title
  const title = document.createElement("div");
  title.style.cssText = `
    font-weight: bold;
    margin-bottom: 5px;
    display: flex;
    align-items: center;
    width: 100%;
    justify-content: space-between;
  `;
  title.textContent = "LinkHarvest Active";

  // Create close button
  const closeButton = document.createElement("span");
  closeButton.innerHTML = "×";
  closeButton.style.cssText = `
    cursor: pointer;
    font-size: 18px;
    margin-left: 10px;
  `;
  closeButton.addEventListener("click", () => {
    harvestOverlay.style.display = "none";
  });
  title.appendChild(closeButton);

  // Create status text
  harvestStatus = document.createElement("div");
  harvestStatus.style.cssText = `
    font-size: 12px;
  `;
  harvestStatus.textContent = "Crawling in progress...";

  // Assemble overlay
  harvestOverlay.appendChild(title);
  harvestOverlay.appendChild(harvestStatus);

  // Add to page
  document.body.appendChild(harvestOverlay);
}

// Function to update the overlay status
function updateOverlayStatus(status) {
  if (harvestOverlay && harvestStatus) {
    harvestStatus.textContent = status;
  }
}

// Function to extract content from the current page
function extractPageContent(selector = null) {
  const content = {
    url: window.location.href,
    title: document.title,
    html: document.documentElement.outerHTML,
    text: "",
  };

  // Extract text content
  if (selector) {
    const elements = document.querySelectorAll(selector);
    content.text = Array.from(elements)
      .map((el) => el.textContent.trim())
      .join("\n\n");
  } else {
    // Get text from body with some basic cleanup
    content.text = document.body
      ? document.body.textContent.replace(/\s+/g, " ").trim()
      : "";
  }

  // Extract metadata
  const metadata = {};

  // Get meta tags
  const metaTags = [
    "description",
    "keywords",
    "author",
    "viewport",
    "og:title",
    "og:description",
    "og:image",
    "og:url",
    "twitter:title",
    "twitter:description",
    "twitter:image",
  ];

  metaTags.forEach((name) => {
    let meta = document.querySelector(`meta[name="${name}"]`);
    if (!meta) meta = document.querySelector(`meta[property="${name}"]`);
    if (meta) metadata[name] = meta.getAttribute("content") || "";
  });

  content.metadata = metadata;

  return content;
}
