// Additional functions for background.js (to be appended)

// Helper function to get meta tag content (continued)
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

// Generate the final output as plain text
function generateTextOutput(settings) {
  let output = "";

  // Add metadata header
  output += "LINKHARVEST EXTRACTION RESULTS\n";
  output += "==============================\n\n";
  output += `Base URLs: ${settings.urls.join(", ")}\n`;
  output += `Crawl Date: ${new Date().toLocaleString()}\n`;
  output += `Total Pages Processed: ${activeCrawl.processed}\n`;
  output += "\n";
  output += "CRAWL SETTINGS:\n";
  output += `- Max Depth: ${settings.maxDepth}\n`;
  output += `- Max Pages: ${settings.maxPages}\n`;
  output += `- Extract HTML: ${settings.extractHtml ? "Yes" : "No"}\n`;
  output += `- Extract Text: ${settings.extractText ? "Yes" : "No"}\n`;
  output += `- Extract Metadata: ${settings.extractMetadata ? "Yes" : "No"}\n`;
  if (settings.urlPattern) {
    output += `- URL Pattern Filter: ${settings.urlPattern}\n`;
  }
  if (settings.crawlSitemap) {
    output += `- Crawl Sitemap: Yes\n`;
  }
  if (settings.keywordDensity) {
    output += `- Keyword Density Analysis: Yes\n`;
  }
  if (settings.brokenLinkChecker) {
    output += `- Broken Link Check: Yes\n`;
  }
  output += "\n";
  output += "=" * 50 + "\n\n";

  // Add analysis results if enabled
  if (settings.keywordDensity && activeCrawl.keywordData.length > 0) {
    output += "TOP KEYWORDS ACROSS ALL PAGES:\n";
    output += "-" * 30 + "\n";
    activeCrawl.keywordData.slice(0, 20).forEach((kw) => {
      output += `${kw.word}: ${kw.count} occurrences\n`;
    });
    output += "\n";
    output += "=" * 50 + "\n\n";
  }

  if (settings.brokenLinkChecker && activeCrawl.brokenLinks.length > 0) {
    output += "BROKEN LINKS FOUND:\n";
    output += "-" * 20 + "\n";
    activeCrawl.brokenLinks.forEach((link) => {
      output += `URL: ${link.url}\n`;
      if (link.foundOn) {
        output += `Found on: ${link.foundOn}\n`;
      }
      if (link.statusCode) {
        output += `Status Code: ${link.statusCode}\n`;
      }
      if (link.error) {
        output += `Error: ${link.error}\n`;
      }
      output += "\n";
    });
    output += "=" * 50 + "\n\n";
  }

  // Process each page
  activeCrawl.results.forEach((page, index) => {
    output += `PAGE ${index + 1} OF ${activeCrawl.results.length}\n`;
    output += "-" * 40 + "\n";
    output += `URL: ${page.url}\n`;
    output += `Timestamp: ${new Date(page.timestamp).toLocaleString()}\n\n`;

    // Include text content if extracted
    if (settings.extractText && page.text) {
      output += page.text + "\n\n";
    }

    // Include metadata if extracted
    if (settings.extractMetadata && page.metadata) {
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

    // Include keyword density for this page if enabled
    if (settings.keywordDensity && page.keywordDensity) {
      output += "TOP KEYWORDS FOR THIS PAGE:\n";
      page.keywordDensity.slice(0, 10).forEach((kw) => {
        output += `- ${kw.word}: ${kw.count} times (${kw.density})\n`;
      });
      output += "\n";
    }

    output += "=" * 50 + "\n\n";
  });

  return output;
}

// Download the output as a text file
function downloadTextOutput(textContent, type = "master") {
  updateCurrentAction("Preparing text file for download");

  try {
    // Create a data URL for text file
    const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(
      textContent
    )}`;

    let filename;
    if (type === "master") {
      const baseUrl = new URL(activeCrawl.settings.urls[0]);
      const hostname = baseUrl.hostname.replace(/[^a-z0-9]/gi, "_");
      filename = `linkharvest_${hostname}_${new Date()
        .toISOString()
        .slice(0, 10)}.txt`;
    } else {
      filename = type;
    }

    chrome.downloads.download(
      {
        url: dataUrl,
        filename: filename,
        saveAs: type === "master",
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

// Save individual files per domain
async function saveIndividualFiles() {
  updateCurrentAction("Saving individual files per domain");

  for (const [domain, pages] of activeCrawl.crawlsByDomain.entries()) {
    const domainFolder = domain.replace(/[^a-z0-9]/gi, "_");

    // Save each page
    for (const page of pages) {
      let filename = "";
      try {
        const urlObj = new URL(page.url);
        const pathname = urlObj.pathname === "/" ? "/index" : urlObj.pathname;
        filename = pathname.replace(/[^a-z0-9]/gi, "_");
        if (!filename) filename = "page";
      } catch (e) {
        filename = "page_" + Math.random().toString(36).substring(7);
      }

      let content = "";
      content += `URL: ${page.url}\n`;
      content += `Crawled: ${new Date(page.timestamp).toLocaleString()}\n`;
      content += `Title: ${page.title}\n`;
      content += "\n" + "=" * 50 + "\n\n";

      if (page.text) {
        content += page.text;
      }

      if (page.metadata && activeCrawl.settings.extractMetadata) {
        content += "\n\nMETADATA:\n";
        content += JSON.stringify(page.metadata, null, 2);
      }

      if (page.keywordDensity && activeCrawl.settings.keywordDensity) {
        content += "\n\nKEYWORD DENSITY:\n";
        page.keywordDensity.slice(0, 10).forEach((kw) => {
          content += `${kw.word}: ${kw.count} times (${kw.density})\n`;
        });
      }

      // Download individual file
      const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(
        content
      )}`;
      const fullFilename = `LinkHarvest/${domainFolder}/${filename}.txt`;

      chrome.downloads.download({
        url: dataUrl,
        filename: fullFilename,
        saveAs: false,
        conflictAction: "uniquify",
      });
    }
  }
}

// Send webhook notification
async function sendWebhookNotification(webhookUrl) {
  updateCurrentAction("Sending webhook notification");

  try {
    const summary = {
      timestamp: new Date().toISOString(),
      urls_crawled: activeCrawl.settings.urls,
      pages_processed: activeCrawl.processed,
      total_pages_found: activeCrawl.total,
      broken_links_found: activeCrawl.brokenLinks.length,
      crawl_settings: {
        max_depth: activeCrawl.settings.maxDepth,
        max_pages: activeCrawl.settings.maxPages,
        sitemap_crawl: activeCrawl.settings.crawlSitemap,
        keyword_analysis: activeCrawl.settings.keywordDensity,
        broken_link_check: activeCrawl.settings.brokenLinkChecker,
      },
    };

    if (activeCrawl.keywordData.length > 0) {
      summary.top_keywords = activeCrawl.keywordData.slice(0, 10);
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(summary),
    });

    if (!response.ok) {
      console.error("Webhook notification failed:", response.statusText);
    } else {
      updateCurrentAction("Webhook notification sent successfully");
    }
  } catch (error) {
    console.error("Error sending webhook:", error);
    updateCurrentAction("Failed to send webhook notification");
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
