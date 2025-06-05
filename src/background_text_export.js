// LinkHarvest Background Script
// Handles the crawling process and data extraction

// Initialize context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "harvestCurrentPage",
    title: "Harvest this page",
    contexts: ["page"],
  });

  chrome.contextMenus.create({
    id: "harvestLink",
    title: "Harvest from this link",
    contexts: ["link"],
  });
});

// Listen for context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "harvestCurrentPage") {
    // Start crawling the current page
    if (tab && tab.url) {
      // Open the popup with this URL
      openPopupWithUrl(tab.url);
    }
  } else if (info.menuItemId === "harvestLink" && info.linkUrl) {
    // Start crawling from the clicked link
    openPopupWithUrl(info.linkUrl);
  }
});

// Function to open the popup with a pre-filled URL
function openPopupWithUrl(url) {
  // First open the popup
  chrome.action.openPopup();

  // Then send a message to set the URL
  setTimeout(() => {
    chrome.runtime.sendMessage({
      action: "setTargetUrl",
      url: url,
    });
  }, 300); // Small delay to ensure popup is open
}

// Store active crawl state
let activeCrawl = {
  inProgress: false,
  processed: 0,
  total: 0,
  queue: [],
  visited: new Set(),
  results: [],
};

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startCrawl") {
    startCrawling(message.settings);
  }
});

// Main function to start the crawling process
async function startCrawling(settings) {
  // Reset the crawl state
  activeCrawl = {
    inProgress: true,
    processed: 0,
    total: 1, // Start with at least the base URL
    queue: [settings.baseUrl],
    visited: new Set(),
    results: [],
    settings: settings,
  };

  // Update UI
  sendProgressUpdate("Starting crawl");

  try {
    // Process the queue until it's empty or we reach the maximum pages
    while (
      activeCrawl.queue.length > 0 &&
      activeCrawl.processed < settings.maxPages
    ) {
      const url = activeCrawl.queue.shift();

      // Skip if already visited
      if (activeCrawl.visited.has(url)) {
        continue;
      }

      // Mark as visited
      activeCrawl.visited.add(url);

      // Update current action
      updateCurrentAction(`Fetching ${url}`);

      // Process the page
      try {
        const pageData = await processPage(url, settings);
        activeCrawl.results.push(pageData);

        // Extract links if we're not at max depth
        if (pageData.depth < settings.maxDepth) {
          updateCurrentAction(`Extracting links from ${url}`);
          const newLinks = await extractLinks(pageData.html, url, settings);

          // Add new links to the queue
          newLinks.forEach((link) => {
            if (
              !activeCrawl.visited.has(link) &&
              !activeCrawl.queue.includes(link) &&
              activeCrawl.queue.length + activeCrawl.visited.size <
                settings.maxPages
            ) {
              activeCrawl.queue.push(link);
              activeCrawl.total++;
            }
          });
        }

        // Update progress
        activeCrawl.processed++;
        sendProgressUpdate(`Processed ${url}`);

        // Respect the rate limit
        if (settings.delayMs > 0 && activeCrawl.queue.length > 0) {
          updateCurrentAction(`Rate limiting (${settings.delayMs}ms delay)`);
          await new Promise((resolve) => setTimeout(resolve, settings.delayMs));
        }
      } catch (error) {
        console.error(`Error processing ${url}:`, error);
        activeCrawl.processed++;
        sendProgressUpdate(`Error processing ${url}: ${error.message}`);
      }
    }

    // Crawl completed, generate output
    updateCurrentAction("Generating text output");
    const output = generateTextOutput();

    // Trigger download
    downloadTextOutput(output);

    // Mark crawl as complete
    activeCrawl.inProgress = false;
    sendProgressUpdate("Crawl complete");
    updateCurrentAction("Crawl completed successfully");
  } catch (error) {
    console.error("Crawl failed:", error);
    sendCrawlError(error.message);
    activeCrawl.inProgress = false;
  }
}

// Process a single page
async function processPage(url, settings) {
  updateCurrentAction(`Fetching content from ${url}`);

  try {
    // Fetch the page
    const response = await fetch(url);
    const html = await response.text();

    // Extract data based on settings
    const result = {
      url: url,
      timestamp: new Date().toISOString(),
      depth: getUrlDepth(url, settings.baseUrl),
      title: extractTitle(html) || "",
    };

    // Always store HTML for link extraction
    result.html = html;

    if (settings.extractText) {
      updateCurrentAction(`Extracting text content from ${url}`);
      // Extract structured text content
      result.text = extractStructuredText(html, url);
    }

    if (settings.extractMetadata) {
      updateCurrentAction(`Extracting metadata from ${url}`);
      // Extract metadata from meta tags
      result.metadata = {
        description: extractMetaContent(html, "description"),
        keywords: extractMetaContent(html, "keywords"),
        ogTitle: extractMetaContent(html, "og:title"),
        ogDescription: extractMetaContent(html, "og:description"),
        ogImage: extractMetaContent(html, "og:image"),
      };
    }

    return result;
  } catch (error) {
    console.error(`Error in processPage for ${url}:`, error);
    throw error;
  }
}

// Extract title from HTML
function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? cleanHtmlEntities(titleMatch[1].trim()) : "";
}

// Function to clean HTML entities
function cleanHtmlEntities(text) {
  if (!text) return text;

  // Common HTML entities
  const entities = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&#038;": "&",
    "&nbsp;": " ",
    "&ndash;": "–",
    "&mdash;": "—",
    "&hellip;": "...",
    "&copy;": "©",
    "&reg;": "®",
    "&trade;": "™",
    "&euro;": "€",
    "&pound;": "£",
    "&yen;": "¥",
    "&cent;": "¢",
    "&raquo;": "»",
    "&laquo;": "«",
    "&deg;": "°",
    "&plusmn;": "±",
    "&frac12;": "½",
    "&frac14;": "¼",
    "&frac34;": "¾",
    "&times;": "×",
    "&divide;": "÷",
    "&alpha;": "α",
    "&beta;": "β",
    "&gamma;": "γ",
    "&delta;": "δ",
    "&omega;": "ω",
    "&pi;": "π",
    "&sigma;": "σ",
    "&mu;": "μ",
    "&lambda;": "λ",
    "&theta;": "θ",
  };

  // Replace HTML entities
  let cleaned = text;
  for (const entity in entities) {
    cleaned = cleaned.replace(new RegExp(entity, "gi"), entities[entity]);
  }

  // Replace numeric entities
  cleaned = cleaned.replace(/&#(\d+);/g, (match, dec) => {
    return String.fromCharCode(parseInt(dec, 10));
  });

  // Replace hex entities
  cleaned = cleaned.replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });

  return cleaned;
}

// Extract structured text with title, description, headers, content, and links
function extractStructuredText(html, url) {
  const result = {
    title: extractTitle(html),
    description: extractMetaContent(html, "description"),
    headers: [],
    content: [],
    internalLinks: [],
    externalLinks: [],
  };

  // Find the first h1 tag position
  const h1Match = html.match(/<h1[^>]*>.*?<\/h1>/i);

  if (!h1Match || !h1Match.index) {
    // If no h1 found, try to extract from main content areas
    return extractStructuredFromContainers(html, url, result);
  }

  // Get the section of HTML starting from the h1
  const contentStartPos = h1Match.index;
  let contentHtml = html.substring(contentStartPos);

  // Try to find where content ends (at footer, comments, etc.)
  const endMarkers = [
    /<footer[^>]*>/i,
    /<div[^>]*class=["'][^"']*footer[^"']*["']/i,
    /<div[^>]*id=["']footer["']/i,
    /<div[^>]*class=["'][^"']*comments[^"']*["']/i,
    /<div[^>]*id=["']comments["']/i,
    /<section[^>]*class=["'][^"']*footer[^"']*["']/i,
  ];

  for (const marker of endMarkers) {
    const match = contentHtml.match(marker);
    if (match && match.index) {
      contentHtml = contentHtml.substring(0, match.index);
    }
  }

  // Extract headers
  const headerRegex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
  let match;
  while ((match = headerRegex.exec(contentHtml)) !== null) {
    const level = match[1];
    const content = match[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (content) {
      result.headers.push(`H${level}: ${cleanHtmlEntities(content)}`);
    }
  }

  // Extract paragraphs
  const paragraphRegex = /<p[^>]*>(.*?)<\/p>/gi;
  while ((match = paragraphRegex.exec(contentHtml)) !== null) {
    const content = match[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (content && content.length > 20) {
      // Skip very short paragraphs
      result.content.push(cleanHtmlEntities(content));
    }
  }

  // Extract links
  const linkRegex =
    /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  const baseUrl = new URL(url);

  while ((match = linkRegex.exec(contentHtml)) !== null) {
    const href = match[1];
    const text = match[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (href && text) {
      try {
        const linkUrl = new URL(href, url);
        const linkEntry = `${cleanHtmlEntities(text)} -> ${linkUrl.href}`;

        // Check if internal or external
        if (linkUrl.origin === baseUrl.origin) {
          result.internalLinks.push(linkEntry);
        } else {
          result.externalLinks.push(linkEntry);
        }
      } catch (e) {
        // Skip invalid URLs
      }
    }
  }

  // Format the result as a string
  let formattedText = "";

  if (result.title) {
    formattedText += `Title: ${result.title}\n\n`;
  }

  if (result.description) {
    formattedText += `Description: ${result.description}\n\n`;
  }

  if (result.headers.length > 0) {
    formattedText += "Headers:\n" + result.headers.join("\n") + "\n\n";
  }

  if (result.content.length > 0) {
    formattedText += "Content:\n" + result.content.join("\n\n") + "\n\n";
  }

  if (result.internalLinks.length > 0) {
    formattedText +=
      "Internal Links:\n" + result.internalLinks.join("\n") + "\n\n";
  }

  if (result.externalLinks.length > 0) {
    formattedText += "External Links:\n" + result.externalLinks.join("\n");
  }

  return formattedText.trim();
}

// Helper function for when no h1 is found
function extractStructuredFromContainers(html, url, result) {
  // Clean the HTML first
  const cleanHtml = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, "")
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "");

  // Try to find main content containers
  const contentSelectors = [
    "main",
    "article",
    "#content",
    ".content",
    "#main",
    ".main",
    "#main-content",
    ".main-content",
    ".post-content",
    ".entry-content",
    ".page-content",
  ];

  let contentHtml = "";

  for (const selector of contentSelectors) {
    let regex;

    if (selector.startsWith("#")) {
      const id = selector.substring(1);
      regex = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\/`, "i");
    } else if (selector.startsWith(".")) {
      const className = selector.substring(1);
      regex = new RegExp(
        `<[^>]+class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\/`,
        "i"
      );
    } else {
      regex = new RegExp(`<${selector}[^>]*>([\\s\\S]*?)<\/${selector}>`, "i");
    }

    const match = html.match(regex);
    if (match && match[1]) {
      contentHtml = match[1];
      break;
    }
  }

  // If still no content, use the cleaned HTML
  if (!contentHtml) {
    contentHtml = cleanHtml;
  }

  // Extract headers
  const headerRegex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
  let match;
  while ((match = headerRegex.exec(contentHtml)) !== null) {
    const level = match[1];
    const content = match[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (content) {
      result.headers.push(`H${level}: ${cleanHtmlEntities(content)}`);
    }
  }

  // Extract paragraphs
  const paragraphRegex = /<p[^>]*>(.*?)<\/p>/gi;
  while ((match = paragraphRegex.exec(contentHtml)) !== null) {
    const content = match[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (content && content.length > 20) {
      result.content.push(cleanHtmlEntities(content));
    }
  }

  // Extract links
  const linkRegex =
    /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  const baseUrl = new URL(url);

  while ((match = linkRegex.exec(contentHtml)) !== null) {
    const href = match[1];
    const text = match[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (href && text) {
      try {
        const linkUrl = new URL(href, url);
        const linkEntry = `${cleanHtmlEntities(text)} -> ${linkUrl.href}`;

        if (linkUrl.origin === baseUrl.origin) {
          result.internalLinks.push(linkEntry);
        } else {
          result.externalLinks.push(linkEntry);
        }
      } catch (e) {
        // Skip invalid URLs
      }
    }
  }

  // Format the result
  let formattedText = "";

  if (result.title) {
    formattedText += `Title: ${result.title}\n\n`;
  }

  if (result.description) {
    formattedText += `Description: ${result.description}\n\n`;
  }

  if (result.headers.length > 0) {
    formattedText += "Headers:\n" + result.headers.join("\n") + "\n\n";
  }

  if (result.content.length > 0) {
    formattedText += "Content:\n" + result.content.join("\n\n") + "\n\n";
  }

  if (result.internalLinks.length > 0) {
    formattedText +=
      "Internal Links:\n" + result.internalLinks.join("\n") + "\n\n";
  }

  if (result.externalLinks.length > 0) {
    formattedText += "External Links:\n" + result.externalLinks.join("\n");
  }

  return formattedText.trim();
}

// Extract links from HTML
function extractLinks(html, baseUrl, settings) {
  updateCurrentAction(`Finding links in ${baseUrl}`);

  try {
    // Extract all links using regex
    const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>/gi;
    const links = [];
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      if (match[1]) {
        try {
          // Convert relative URLs to absolute
          const absoluteUrl = new URL(match[1], baseUrl).href;
          links.push(absoluteUrl);
        } catch (e) {
          // Skip invalid URLs
        }
      }
    }

    // Filter links based on settings
    return links.filter((url) => {
      // Only keep URLs from the same domain
      try {
        const urlObj = new URL(url);
        const baseUrlObj = new URL(baseUrl);

        // Must be same origin
        if (urlObj.origin !== baseUrlObj.origin) {
          return false;
        }

        // Skip anchors on the same page
        if (urlObj.pathname === baseUrlObj.pathname && urlObj.hash) {
          return false;
        }

        // Apply URL pattern filter if specified
        if (settings.urlPattern) {
          try {
            const regex = new RegExp(settings.urlPattern);
            if (!regex.test(url)) {
              return false;
            }
          } catch (e) {
            // Invalid regex, ignore the filter
            console.warn("Invalid URL pattern regex:", e);
          }
        }

        return true;
      } catch (e) {
        return false;
      }
    });
  } catch (error) {
    console.error("Error extracting links:", error);
    return [];
  }
}

// Helper function to get meta tag content
function extractMetaContent(html, name) {
  try {
    // Try standard meta name
    let metaRegex = new RegExp(
      `<meta\\s+(?:[^>]*?\\s+)?name=["']${name}["']\\s+(?:[^>]*?\\s+)?content=["']([^"']*)["'][^>]*>`,
      "i"
    );
    let match = html.match(metaRegex);

    if (!match) {
      // Try with different order of attributes
      metaRegex = new RegExp(
        `<meta\\s+(?:[^>]*?\\s+)?content=["']([^"']*)["']\\s+(?:[^>]*?\\s+)?name=["']${name}["'][^>]*>`,
        "i"
      );
      match = html.match(metaRegex);
    }

    if (match && match[1]) {
      return cleanHtmlEntities(match[1].trim());
    }

    // Try Open Graph (og:) properties
    if (name.startsWith("og:")) {
      metaRegex = new RegExp(
        `<meta\\s+(?:[^>]*?\\s+)?property=["']${name}["']\\s+(?:[^>]*?\\s+)?content=["']([^"']*)["'][^>]*>`,
        "i"
      );
      match = html.match(metaRegex);

      if (!match) {
        // Try with different order of attributes
        metaRegex = new RegExp(
          `<meta\\s+(?:[^>]*?\\s+)?content=["']([^"']*)["']\\s+(?:[^>]*?\\s+)?property=["']${name}["'][^>]*>`,
          "i"
        );
        match = html.match(metaRegex);
      }

      if (match && match[1]) {
        return cleanHtmlEntities(match[1].trim());
      }
    }
  } catch (e) {
    console.warn(`Error extracting meta content for ${name}:`, e);
  }

  return "";
}

// Helper function to calculate URL depth relative to base URL
function getUrlDepth(url, baseUrl) {
  try {
    const urlObj = new URL(url);
    const baseUrlObj = new URL(baseUrl);

    // If different domains, return max depth
    if (urlObj.hostname !== baseUrlObj.hostname) {
      return 999;
    }

    // Calculate path depth difference
    const urlPath = urlObj.pathname.split("/").filter(Boolean);
    const basePath = baseUrlObj.pathname.split("/").filter(Boolean);

    // Calculate how many segments deeper we are than the base URL
    let depth = 0;
    for (let i = 0; i < urlPath.length; i++) {
      if (i >= basePath.length || urlPath[i] !== basePath[i]) {
        depth++;
      }
    }

    return depth;
  } catch (e) {
    return 0;
  }
}

// Generate the final output as plain text
function generateTextOutput() {
  let output = "";

  // Add metadata header
  output += "LINKHARVEST EXTRACTION RESULTS\n";
  output += "==============================\n\n";
  output += `Base URL: ${activeCrawl.settings.baseUrl}\n`;
  output += `Crawl Date: ${new Date().toLocaleString()}\n`;
  output += `Total Pages Processed: ${activeCrawl.processed}\n`;
  output += "\n";
  output += "CRAWL SETTINGS:\n";
  output += `- Max Depth: ${activeCrawl.settings.maxDepth}\n`;
  output += `- Max Pages: ${activeCrawl.settings.maxPages}\n`;
  output += `- Extract HTML: ${
    activeCrawl.settings.extractHtml ? "Yes" : "No"
  }\n`;
  output += `- Extract Text: ${
    activeCrawl.settings.extractText ? "Yes" : "No"
  }\n`;
  output += `- Extract Metadata: ${
    activeCrawl.settings.extractMetadata ? "Yes" : "No"
  }\n`;
  if (activeCrawl.settings.urlPattern) {
    output += `- URL Pattern Filter: ${activeCrawl.settings.urlPattern}\n`;
  }
  output += "\n";
  output += "=" * 50 + "\n\n";

  // Process each page
  activeCrawl.results.forEach((page, index) => {
    output += `PAGE ${index + 1} OF ${activeCrawl.results.length}\n`;
    output += "-" * 40 + "\n";
    output += `URL: ${page.url}\n`;
    output += `Timestamp: ${new Date(page.timestamp).toLocaleString()}\n\n`;

    // Include text content if extracted
    if (activeCrawl.settings.extractText && page.text) {
      output += page.text + "\n\n";
    }

    // Include metadata if extracted
    if (activeCrawl.settings.extractMetadata && page.metadata) {
      const hasMetadata = Object.values(page.metadata).some((v) => v);
      if (hasMetadata) {
        output += "METADATA:\n";
        if (page.metadata.description) {
          output += `Description: ${page.metadata.description}\n`;
        }
        if (page.metadata.keywords) {
          output += `Keywords: ${page.metadata.keywords}\n`;
        }
        if (page.metadata.ogTitle) {
          output += `OG Title: ${page.metadata.ogTitle}\n`;
        }
        if (page.metadata.ogDescription) {
          output += `OG Description: ${page.metadata.ogDescription}\n`;
        }
        if (page.metadata.ogImage) {
          output += `OG Image: ${page.metadata.ogImage}\n`;
        }
        output += "\n";
      }
    }

    output += "=" * 50 + "\n\n";
  });

  return output;
}

// Download the output as a text file
function downloadTextOutput(textContent) {
  updateCurrentAction("Preparing text file for download");

  try {
    // Create a data URL for text file
    const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(
      textContent
    )}`;
    const baseUrl = new URL(activeCrawl.settings.baseUrl);
    const hostname = baseUrl.hostname.replace(/[^a-z0-9]/gi, "_");
    const filename = `linkharvest_${hostname}_${new Date()
      .toISOString()
      .slice(0, 10)}.txt`;

    chrome.downloads.download(
      {
        url: dataUrl,
        filename: filename,
        saveAs: true,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error("Download error:", chrome.runtime.lastError);
          updateCurrentAction(
            "Error creating download: " + chrome.runtime.lastError.message
          );
        } else {
          updateCurrentAction("Text file download started successfully");
        }
      }
    );
  } catch (error) {
    console.error("Download creation error:", error);
    updateCurrentAction("Error creating download: " + error.message);
  }
}

// Send progress updates to the popup
function sendProgressUpdate(status) {
  chrome.runtime.sendMessage({
    action: "updateProgress",
    processed: activeCrawl.processed,
    total: activeCrawl.total,
    status: status,
  });
}

// Send error message to the popup
function sendCrawlError(error) {
  chrome.runtime.sendMessage({
    action: "crawlError",
    error: error,
  });
}

// Update the current action text in the popup and overlay
function updateCurrentAction(text) {
  // Update popup
  chrome.runtime.sendMessage({
    action: "updateCurrentAction",
    text: text,
  });

  // Also update overlay in any active tabs
  chrome.tabs.query({ active: true }, (tabs) => {
    for (const tab of tabs) {
      try {
        if (tab && tab.id) {
          chrome.tabs.sendMessage(
            tab.id,
            {
              type: "UPDATE_HARVEST_STATUS",
              status: text,
            },
            // Add callback to suppress errors
            (response) => {
              if (chrome.runtime.lastError) {
                // Suppress errors about receiving end not existing
                // This is normal if the content script isn't loaded on the page
              }
            }
          );
        }
      } catch (e) {
        // Ignore errors from tabs that can't receive messages
        console.log("Error sending status update to tab:", e.message);
      }
    }
  });
}
