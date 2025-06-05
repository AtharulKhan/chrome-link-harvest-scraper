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
  brokenLinks: [],
  keywordData: {},
  crawlsByDomain: new Map(), // Store results by domain for individual file saving
};

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startCrawl") {
    startCrawling(message.settings);
  } else if (message.action === "validateSitemaps") {
    validateSitemaps(message.urls).then((result) => {
      sendResponse(result);
    });
    return true; // Keep message channel open for async response
  } else if (message.action === "extractSitemapContent") {
    extractSitemapContent(message.urls, message.settings).then((result) => {
      sendResponse(result);
    });
    return true; // Keep message channel open for async response
  }
});

// Function to extract URLs from Google search results
async function extractGoogleSearchUrls(searchUrl) {
  try {
    updateCurrentAction(`Fetching Google search results from ${searchUrl}`);

    const response = await fetch(searchUrl);
    const html = await response.text();

    // Extract all links from search results
    const urls = [];

    // Pattern to match Google search result links
    // Google uses various patterns, we'll try to catch the main ones
    const linkPatterns = [/<a[^>]+href="([^"]+)"[^>]*>/gi, /href="([^"]+)"/gi];

    for (const pattern of linkPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];

        // Clean up the URL
        if (url.startsWith("/url?q=")) {
          // Extract actual URL from Google redirect
          const actualUrl = url.match(/\/url\?q=([^&]+)/);
          if (actualUrl && actualUrl[1]) {
            const decodedUrl = decodeURIComponent(actualUrl[1]);
            if (isValidNonGoogleUrl(decodedUrl)) {
              urls.push(decodedUrl);
            }
          }
        } else if (isValidNonGoogleUrl(url)) {
          urls.push(url);
        }
      }
    }

    // Remove duplicates and normalize URLs (remove query strings and fragments)
    const normalizedUrls = urls.map((url) => {
      try {
        const urlObj = new URL(url);
        // Remove query parameters and fragments
        urlObj.search = "";
        urlObj.hash = "";
        return urlObj.href;
      } catch (e) {
        return url;
      }
    });

    // Remove duplicates
    const uniqueUrls = [...new Set(normalizedUrls)];

    updateCurrentAction(
      `Found ${uniqueUrls.length} non-Google URLs in search results`
    );
    return uniqueUrls;
  } catch (error) {
    console.error("Error extracting Google search URLs:", error);
    throw error;
  }
}

// Helper function to check if URL is valid and not from Google
function isValidNonGoogleUrl(url) {
  if (!url || typeof url !== "string") return false;

  // Must be a full URL
  if (!url.match(/^https?:\/\//i)) return false;

  // Exclude Google domains
  const googleDomains = [
    "google.com",
    "google.ca",
    "google.co.uk",
    "google.de",
    "google.fr",
    "google.es",
    "google.it",
    "google.nl",
    "google.se",
    "google.no",
    "google.dk",
    "google.fi",
    "google.co.jp",
    "google.com.au",
    "google.co.nz",
    "google.co.in",
    "google.com.br",
    "google.com.mx",
    "google.com.ar",
    "google.co.za",
    "googleapis.com",
    "googleusercontent.com",
    "googlevideo.com",
    "gstatic.com",
    "youtube.com",
    "youtu.be",
  ];

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Check if it's a Google domain
    for (const googleDomain of googleDomains) {
      if (hostname === googleDomain || hostname.endsWith("." + googleDomain)) {
        return false;
      }
    }

    return true;
  } catch (e) {
    return false;
  }
}

// Function to validate sitemaps and extract URLs
async function validateSitemaps(urls) {
  const sitemapData = {};
  let totalUrls = 0;
  let validSitemaps = 0;

  try {
    for (const baseUrl of urls) {
      const sitemapUrls = [
        `${baseUrl}/sitemap.xml`,
        `${baseUrl}/sitemap_index.xml`,
        `${baseUrl}/sitemap.xml.gz`,
      ];

      let found = false;

      for (const sitemapUrl of sitemapUrls) {
        try {
          console.log(`Checking sitemap: ${sitemapUrl}`);
          const response = await fetch(sitemapUrl);

          if (response.ok) {
            const text = await response.text();
            const extractedUrls = [];

            // Check if it's a sitemap index
            if (text.includes("<sitemapindex")) {
              const sitemapsList = extractSitemapsFromIndex(text);

              // Fetch each sitemap in the index
              for (const subSitemapUrl of sitemapsList) {
                try {
                  const subResponse = await fetch(subSitemapUrl);
                  if (subResponse.ok) {
                    const subText = await subResponse.text();
                    const subUrls = extractUrlsFromSitemap(subText);
                    extractedUrls.push(...subUrls);
                  }
                } catch (e) {
                  console.warn(
                    `Error fetching sub-sitemap ${subSitemapUrl}:`,
                    e
                  );
                }
              }
            } else {
              // Regular sitemap
              const urls = extractUrlsFromSitemap(text);
              extractedUrls.push(...urls);
            }

            if (extractedUrls.length > 0) {
              sitemapData[baseUrl] = {
                sitemapUrl: sitemapUrl,
                urls: extractedUrls,
              };
              totalUrls += extractedUrls.length;
              validSitemaps++;
              found = true;
              break;
            }
          }
        } catch (error) {
          console.error(`Error checking ${sitemapUrl}:`, error);
        }
      }

      if (!found) {
        sitemapData[baseUrl] = {
          sitemapUrl: null,
          urls: [],
        };
      }
    }

    return {
      success: true,
      sitemapData: sitemapData,
      totalUrls: totalUrls,
      validSitemaps: validSitemaps,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Main function to start the crawling process
async function startCrawling(settings) {
  // Reset the crawl state
  activeCrawl = {
    inProgress: true,
    processed: 0,
    total: 0,
    queue: [],
    visited: new Set(),
    results: [],
    brokenLinks: [],
    keywordData: {},
    crawlsByDomain: new Map(),
    perUrlProcessed: new Map(), // Track pages processed per base URL
    settings: settings,
  };

  // Update UI
  sendProgressUpdate("Starting crawl");

  try {
    // Handle Google search mode
    if (settings.urlMode === "google") {
      let urlsToScrape = [];

      if (settings.googleMode === "currentPage") {
        // Extract URLs from current Google search page
        const googleUrl = settings.urls[0];
        updateCurrentAction(`Extracting URLs from Google search page`);
        urlsToScrape = await extractGoogleSearchUrls(googleUrl);
      } else {
        // Process multiple search queries
        for (const query of settings.urls) {
          updateCurrentAction(`Searching Google for: ${query}`);
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
            query
          )}`;
          const searchResults = await extractGoogleSearchUrls(searchUrl);
          urlsToScrape.push(...searchResults);

          // Add delay between Google searches to avoid rate limiting
          if (settings.delayMs > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, settings.delayMs)
            );
          }
        }
      }

      // Remove duplicates
      urlsToScrape = [...new Set(urlsToScrape)];

      updateCurrentAction(
        `Found ${urlsToScrape.length} unique non-Google URLs to scrape`
      );

      // Now update settings to process these URLs
      settings.urls = urlsToScrape;
      settings.urlMode = "list"; // Process as list mode
      settings.maxDepth = 0; // No depth for Google results
    }

    // Process each base URL separately with its own max pages limit
    for (const baseUrl of settings.urls) {
      updateCurrentAction(`Processing base URL: ${baseUrl}`);

      // Initialize counter for this base URL
      activeCrawl.perUrlProcessed.set(baseUrl, 0);

      // Create a queue for this specific base URL
      const urlQueue = [];

      // Check if we should crawl sitemap
      if (settings.crawlSitemap) {
        const sitemapUrls = await getSitemapUrls(baseUrl, settings);
        // Add sitemap URLs to this URL's queue with depth calculated from base URL
        sitemapUrls.forEach((url) => {
          if (!activeCrawl.visited.has(url)) {
            const depth = calculateDepthFromBase(baseUrl, url);
            urlQueue.push({ url: url, depth: depth, baseUrl: baseUrl });
          }
        });
      } else if (settings.urlMode === "list") {
        // In list mode, only add this specific URL with depth 0
        if (!activeCrawl.visited.has(baseUrl)) {
          urlQueue.push({ url: baseUrl, depth: 0, baseUrl: baseUrl });
        }
      } else {
        // Add base URL to queue
        if (!activeCrawl.visited.has(baseUrl)) {
          urlQueue.push({ url: baseUrl, depth: 0, baseUrl: baseUrl });
        }
      }

      // Process this URL's queue up to maxPages per URL
      while (
        urlQueue.length > 0 &&
        activeCrawl.perUrlProcessed.get(baseUrl) < settings.maxPages
      ) {
        const { url, depth, baseUrl: currentBaseUrl } = urlQueue.shift();

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
          const pageData = await processPage(url, settings, depth);
          pageData.baseUrl = currentBaseUrl; // Add base URL reference
          activeCrawl.results.push(pageData);

          // Store by domain if individual files option is enabled
          if (settings.saveIndividualFiles) {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;
            if (!activeCrawl.crawlsByDomain.has(domain)) {
              activeCrawl.crawlsByDomain.set(domain, []);
            }
            activeCrawl.crawlsByDomain.get(domain).push(pageData);
          }

          // Extract links if we're not at max depth and not in list mode
          if (depth < settings.maxDepth && settings.urlMode !== "list") {
            updateCurrentAction(`Extracting links from ${url}`);
            const newLinks = await extractLinks(pageData.html, url, settings);

            // Add new links to the queue for this base URL
            newLinks.forEach((link) => {
              if (
                !activeCrawl.visited.has(link) &&
                !urlQueue.some((item) => item.url === link) &&
                activeCrawl.perUrlProcessed.get(currentBaseUrl) <
                  settings.maxPages
              ) {
                const linkDepth = calculateDepthFromBase(currentBaseUrl, link);

                // Only add links that are within the allowed depth and valid
                if (linkDepth >= 0 && linkDepth <= settings.maxDepth) {
                  urlQueue.push({
                    url: link,
                    depth: linkDepth,
                    baseUrl: currentBaseUrl,
                  });
                }
              }
            });
          }

          // Update progress
          activeCrawl.processed++;
          activeCrawl.perUrlProcessed.set(
            currentBaseUrl,
            activeCrawl.perUrlProcessed.get(currentBaseUrl) + 1
          );
          activeCrawl.total = settings.urls.length * settings.maxPages;
          sendProgressUpdate(`Processed ${url}`);

          // Respect the rate limit
          if (settings.delayMs > 0 && urlQueue.length > 0) {
            updateCurrentAction(`Rate limiting (${settings.delayMs}ms delay)`);
            await new Promise((resolve) =>
              setTimeout(resolve, settings.delayMs)
            );
          }
        } catch (error) {
          console.error(`Error processing ${url}:`, error);

          // Track broken links if option is enabled
          if (settings.brokenLinkChecker && error.message.includes("404")) {
            activeCrawl.brokenLinks.push({
              url: url,
              error: error.message,
              statusCode: 404,
            });
          }

          activeCrawl.processed++;
          activeCrawl.perUrlProcessed.set(
            currentBaseUrl,
            activeCrawl.perUrlProcessed.get(currentBaseUrl) + 1
          );
          sendProgressUpdate(`Error processing ${url}: ${error.message}`);
        }
      }
    }

    // Perform analysis if enabled
    if (settings.keywordDensity || settings.brokenLinkChecker) {
      updateCurrentAction("Performing analysis");
      performAnalysis(settings);
    }

    // Generate outputs
    updateCurrentAction("Generating outputs");

    // Generate master text file
    const masterOutput = generateTextOutput(settings);
    downloadTextOutput(masterOutput, "master");

    // Generate CSV reports if CSV export is enabled
    if (settings.csvExport) {
      generateCSVReports(settings);
    }

    // Generate individual files if enabled
    if (settings.saveIndividualFiles) {
      await saveIndividualFiles();
    }

    // Send webhook notification if configured
    if (settings.webhookUrl) {
      await sendWebhookNotification(settings.webhookUrl);
    }

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

// Helper function to calculate depth from base URL
function calculateDepthFromBase(baseUrl, targetUrl) {
  try {
    const base = new URL(baseUrl);
    const target = new URL(targetUrl);

    // Must be same origin
    if (base.origin !== target.origin) {
      return -1;
    }

    // Normalize paths - ensure they end without trailing slash for comparison
    const basePath = base.pathname.replace(/\/$/, "");
    const targetPath = target.pathname.replace(/\/$/, "");

    // Target must start with the base path
    if (!targetPath.startsWith(basePath)) {
      return -1; // Not under base URL
    }

    // If it's the exact same path, depth is 0
    if (targetPath === basePath) {
      return 0;
    }

    // Get the remaining path after the base
    let remainingPath = targetPath.substring(basePath.length);

    // Remove leading slash if present
    if (remainingPath.startsWith("/")) {
      remainingPath = remainingPath.substring(1);
    }

    // If no remaining path, it's the same URL (depth 0)
    if (!remainingPath) {
      return 0;
    }

    // Count the path segments in the remaining path
    const segments = remainingPath.split("/").filter((s) => s.length > 0);
    return segments.length;
  } catch (e) {
    return -1;
  }
}

// Get sitemap URLs for a base URL
async function getSitemapUrls(baseUrl, settings) {
  const urls = [];

  try {
    const sitemapUrls = [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemap_index.xml`,
      `${baseUrl}/sitemap.xml.gz`,
    ];

    for (const sitemapUrl of sitemapUrls) {
      try {
        updateCurrentAction(`Checking for sitemap at ${sitemapUrl}`);
        const response = await fetch(sitemapUrl);

        if (response.ok) {
          const text = await response.text();

          // Check if it's a sitemap index (contains other sitemaps)
          if (text.includes("<sitemapindex")) {
            const sitemapUrls = extractSitemapsFromIndex(text);
            updateCurrentAction(
              `Found sitemap index with ${sitemapUrls.length} sitemaps`
            );

            // Process each sitemap in the index
            for (const sitemapUrl of sitemapUrls) {
              try {
                const sitemapResponse = await fetch(sitemapUrl);
                if (sitemapResponse.ok) {
                  const sitemapText = await sitemapResponse.text();
                  const extractedUrls = extractUrlsFromSitemap(sitemapText);
                  urls.push(...extractedUrls);
                }
              } catch (e) {
                console.warn(`Error fetching sitemap ${sitemapUrl}:`, e);
              }
            }
          } else {
            // Regular sitemap with URLs
            const extractedUrls = extractUrlsFromSitemap(text);
            urls.push(...extractedUrls);
            updateCurrentAction(
              `Found ${extractedUrls.length} URLs in sitemap`
            );
          }

          return urls; // Successfully found and processed sitemap
        }
      } catch (e) {
        // Try next sitemap URL
        continue;
      }
    }

    updateCurrentAction(`No sitemap found for ${baseUrl}`);
  } catch (error) {
    console.error(`Error getting sitemap URLs for ${baseUrl}:`, error);
  }

  return urls;
}

// Function to crawl sitemap.xml
async function crawlSitemap(baseUrl, settings) {
  try {
    const sitemapUrls = [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemap_index.xml`,
      `${baseUrl}/sitemap.xml.gz`,
    ];

    let sitemapFound = false;

    for (const sitemapUrl of sitemapUrls) {
      try {
        updateCurrentAction(`Checking for sitemap at ${sitemapUrl}`);
        const response = await fetch(sitemapUrl);

        if (response.ok) {
          const text = await response.text();

          // Check if it's a sitemap index (contains other sitemaps)
          if (text.includes("<sitemapindex")) {
            const sitemapUrls = extractSitemapsFromIndex(text);
            updateCurrentAction(
              `Found sitemap index with ${sitemapUrls.length} sitemaps`
            );

            // Process each sitemap in the index
            for (const sitemapUrl of sitemapUrls) {
              try {
                const sitemapResponse = await fetch(sitemapUrl);
                if (sitemapResponse.ok) {
                  const sitemapText = await sitemapResponse.text();
                  const urls = extractUrlsFromSitemap(sitemapText);

                  // Add URLs to queue
                  urls.forEach((url) => {
                    if (!activeCrawl.visited.has(url)) {
                      activeCrawl.queue.push({ url: url, depth: 0 });
                      activeCrawl.total++;
                    }
                  });
                }
              } catch (e) {
                console.warn(`Error fetching sitemap ${sitemapUrl}:`, e);
              }
            }
          } else {
            // Regular sitemap with URLs
            const urls = extractUrlsFromSitemap(text);
            updateCurrentAction(`Found ${urls.length} URLs in sitemap`);

            // Add sitemap URLs to queue
            urls.forEach((url) => {
              if (!activeCrawl.visited.has(url)) {
                activeCrawl.queue.push({ url: url, depth: 0 });
                activeCrawl.total++;
              }
            });
          }

          sitemapFound = true;
          return; // Successfully found and processed sitemap
        }
      } catch (e) {
        // Try next sitemap URL
        continue;
      }
    }

    // No sitemap found - only add base URL if sitemap crawl option is not enabled
    if (!sitemapFound) {
      updateCurrentAction(`No sitemap found for ${baseUrl}`);
      // Since crawlSitemap option is checked, don't add base URL
      // The user specifically wants to crawl from sitemap only
    }
  } catch (error) {
    console.error(`Error crawling sitemap for ${baseUrl}:`, error);
    // Don't fall back to regular crawling when sitemap option is checked
  }
}

// Extract sitemap URLs from sitemap index
function extractSitemapsFromIndex(xml) {
  const urls = [];
  const sitemapRegex =
    /<sitemap>[\s\S]*?<loc>(.*?)<\/loc>[\s\S]*?<\/sitemap>/gi;
  let match;

  while ((match = sitemapRegex.exec(xml)) !== null) {
    if (match[1]) {
      urls.push(match[1].trim());
    }
  }

  return urls;
}

// Extract URLs from sitemap XML
function extractUrlsFromSitemap(xml) {
  const urls = [];
  const urlRegex = /<loc>(.*?)<\/loc>/gi;
  let match;

  while ((match = urlRegex.exec(xml)) !== null) {
    if (match[1]) {
      urls.push(match[1].trim());
    }
  }

  return urls;
}

// Process a single page
async function processPage(url, settings, depth = 0) {
  updateCurrentAction(`Fetching content from ${url}`);

  try {
    // Fetch the page
    const response = await fetch(url);

    // Check for 404 or other errors
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Extract data based on settings
    const result = {
      url: url,
      timestamp: new Date().toISOString(),
      depth: depth,
      title: extractTitle(html) || "",
    };

    // Always store HTML for link extraction
    result.html = html;

    // Perform SEO analysis
    result.seoAnalysis = performSeoAnalysis(html, result.title);

    // Extract links with anchor text
    const linkAnalysis = extractLinksWithAnchorText(html, url);
    result.internalLinks = linkAnalysis.internal;
    result.externalLinks = linkAnalysis.external;
    result.linkStats = linkAnalysis.stats;

    if (settings.extractText) {
      updateCurrentAction(`Extracting text content from ${url}`);
      // Extract structured text content
      result.text = extractStructuredText(html, url);

      // Calculate keyword density if enabled
      if (settings.keywordDensity && result.text) {
        result.keywordDensity = calculateKeywordDensity(result.text);
        result.ngramAnalysis = calculateNgramAnalysis(result.text);
      }
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

    // Check for broken links if enabled
    if (settings.brokenLinkChecker) {
      await checkPageForBrokenLinks(html, url);
    }

    return result;
  } catch (error) {
    console.error(`Error in processPage for ${url}:`, error);
    throw error;
  }
}

// Calculate keyword density
function calculateKeywordDensity(text) {
  // Common stop words to exclude
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "up",
    "about",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "under",
    "again",
    "further",
    "then",
    "once",
    "here",
    "there",
    "when",
    "where",
    "why",
    "how",
    "all",
    "both",
    "each",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "nor",
    "not",
    "only",
    "own",
    "same",
    "so",
    "than",
    "too",
    "very",
    "can",
    "will",
    "just",
    "should",
    "could",
    "would",
    "may",
    "might",
    "must",
    "shall",
    "should",
    "now",
    "is",
    "am",
    "are",
    "was",
    "were",
    "be",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "can",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "them",
    "their",
    "what",
    "which",
    "who",
    "whom",
    "this",
    "that",
    "these",
    "those",
    "myself",
    "yourself",
    "himself",
    "herself",
    "itself",
    "ourselves",
    "themselves",
    "its",
    "our",
    "your",
    "his",
    "her",
    "my",
    "me",
    "him",
    "us",
  ]);

  // Clean and split text into words
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word)); // Ignore short words and stop words

  // Count word frequency
  const wordCount = {};
  const totalWords = words.length;

  words.forEach((word) => {
    wordCount[word] = (wordCount[word] || 0) + 1;
  });

  // Calculate density and sort by frequency
  const keywordDensity = Object.entries(wordCount)
    .map(([word, count]) => ({
      word,
      count,
      density: ((count / totalWords) * 100).toFixed(2) + "%",
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20); // Top 20 keywords

  return keywordDensity;
}

// Perform SEO analysis on the page
function performSeoAnalysis(html, title) {
  const analysis = {
    titleIssues: [],
    metaDescriptionIssues: [],
    headingIssues: [],
  };

  // Analyze title
  if (!title) {
    analysis.titleIssues.push("Missing title tag");
  } else {
    if (title.length < 30) {
      analysis.titleIssues.push(
        `Title too short (${title.length} chars, recommended: 30-60)`
      );
    } else if (title.length > 60) {
      analysis.titleIssues.push(
        `Title too long (${title.length} chars, recommended: 30-60)`
      );
    }
  }

  // Analyze meta description
  const metaDescription = extractMetaContent(html, "description");
  if (!metaDescription) {
    analysis.metaDescriptionIssues.push("Missing meta description");
  } else {
    if (metaDescription.length < 120) {
      analysis.metaDescriptionIssues.push(
        `Meta description too short (${metaDescription.length} chars, recommended: 120-160)`
      );
    } else if (metaDescription.length > 160) {
      analysis.metaDescriptionIssues.push(
        `Meta description too long (${metaDescription.length} chars, recommended: 120-160)`
      );
    }
  }

  // Analyze H1 tags
  const h1Matches = html.match(/<h1[^>]*>.*?<\/h1>/gi) || [];
  if (h1Matches.length === 0) {
    analysis.headingIssues.push("Missing H1 tag");
  } else if (h1Matches.length > 1) {
    analysis.headingIssues.push(`Multiple H1 tags found (${h1Matches.length})`);
  }

  return analysis;
}

// Extract links with anchor text and calculate statistics
function extractLinksWithAnchorText(html, baseUrl) {
  const linkRegex =
    /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  const internal = [];
  const external = [];
  const anchorTexts = new Map();
  let match;

  try {
    const base = new URL(baseUrl);

    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const anchorContent = match[2];

      // Extract text from anchor content (might contain HTML)
      const anchorText = anchorContent
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        try {
          const linkUrl = new URL(href, baseUrl);
          const linkInfo = {
            url: linkUrl.href,
            anchorText: cleanHtmlEntities(anchorText) || "[No anchor text]",
          };

          if (linkUrl.origin === base.origin) {
            internal.push(linkInfo);

            // Track anchor text diversity for internal links
            const key = anchorText.toLowerCase();
            anchorTexts.set(key, (anchorTexts.get(key) || 0) + 1);
          } else {
            external.push(linkInfo);
          }
        } catch (e) {
          // Invalid URL
        }
      }
    }
  } catch (e) {
    console.error("Error extracting links:", e);
  }

  // Calculate statistics
  const stats = {
    internalCount: internal.length,
    externalCount: external.length,
    ratio:
      internal.length > 0
        ? (external.length / internal.length).toFixed(2)
        : "N/A",
    anchorTextDiversity: anchorTexts.size,
    duplicateAnchors: Array.from(anchorTexts.entries())
      .filter(([text, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([text, count]) => ({ text, count })),
  };

  return { internal, external, stats };
}

// Calculate n-gram analysis (2-word and 3-word phrases)
function calculateNgramAnalysis(text) {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "up",
    "about",
    "into",
    "through",
    "during",
    "is",
    "am",
    "are",
    "was",
    "were",
    "be",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "can",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "them",
    "their",
    "what",
    "which",
    "who",
  ]);

  // Clean and tokenize text
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);

  // Generate 2-grams
  const bigrams = {};
  for (let i = 0; i < words.length - 1; i++) {
    if (!stopWords.has(words[i]) && !stopWords.has(words[i + 1])) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      bigrams[bigram] = (bigrams[bigram] || 0) + 1;
    }
  }

  // Generate 3-grams
  const trigrams = {};
  for (let i = 0; i < words.length - 2; i++) {
    // At least one word should not be a stop word
    const hasNonStopWord =
      !stopWords.has(words[i]) ||
      !stopWords.has(words[i + 1]) ||
      !stopWords.has(words[i + 2]);

    if (hasNonStopWord) {
      const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      trigrams[trigram] = (trigrams[trigram] || 0) + 1;
    }
  }

  // Sort and get top n-grams
  const topBigrams = Object.entries(bigrams)
    .filter(([phrase, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phrase, count]) => ({ phrase, count }));

  const topTrigrams = Object.entries(trigrams)
    .filter(([phrase, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phrase, count]) => ({ phrase, count }));

  return { bigrams: topBigrams, trigrams: topTrigrams };
}

// Check page for broken links
async function checkPageForBrokenLinks(html, baseUrl) {
  const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>/gi;
  const links = [];
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    if (match[1]) {
      try {
        const absoluteUrl = new URL(match[1], baseUrl).href;
        if (absoluteUrl.startsWith("http")) {
          links.push(absoluteUrl);
        }
      } catch (e) {
        // Invalid URL
      }
    }
  }

  // Check each link (limited to avoid too many requests)
  const linksToCheck = links.slice(0, 10); // Check first 10 links

  for (const link of linksToCheck) {
    try {
      const response = await fetch(link, { method: "HEAD" });
      if (!response.ok) {
        activeCrawl.brokenLinks.push({
          url: link,
          foundOn: baseUrl,
          statusCode: response.status,
        });
      }
    } catch (error) {
      // Network error, consider it broken
      activeCrawl.brokenLinks.push({
        url: link,
        foundOn: baseUrl,
        error: error.message,
      });
    }
  }
}

// Perform analysis
function performAnalysis(settings) {
  if (settings.keywordDensity) {
    // Aggregate keyword data across all pages
    const allKeywords = {};

    activeCrawl.results.forEach((page) => {
      if (page.keywordDensity) {
        page.keywordDensity.forEach((kw) => {
          if (!allKeywords[kw.word]) {
            allKeywords[kw.word] = 0;
          }
          allKeywords[kw.word] += kw.count;
        });
      }
    });

    // Sort and store top keywords
    activeCrawl.keywordData = Object.entries(allKeywords)
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
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
      // Only keep URLs from the same domain if not crawling multiple URLs
      try {
        const urlObj = new URL(url);

        // Check if URL belongs to any of the base URLs' domains
        const belongsToBaseDomain = settings.urls.some((baseUrl) => {
          try {
            const baseUrlObj = new URL(baseUrl);
            return urlObj.origin === baseUrlObj.origin;
          } catch (e) {
            return false;
          }
        });

        if (!belongsToBaseDomain) {
          return false;
        }

        // Apply URL filter based on mode
        if (settings.urlFilter && settings.urlFilter.mode !== "none") {
          if (settings.urlFilter.mode === "contains") {
            // Check if URL contains the specified text (case-insensitive)
            if (settings.urlFilter.contains) {
              const searchText = settings.urlFilter.contains.toLowerCase();
              if (!url.toLowerCase().includes(searchText)) {
                return false;
              }
            }
          } else if (settings.urlFilter.mode === "regex") {
            // Apply regex pattern filter
            if (settings.urlFilter.pattern) {
              try {
                const regex = new RegExp(settings.urlFilter.pattern);
                if (!regex.test(url)) {
                  return false;
                }
              } catch (e) {
                // Invalid regex, ignore the filter
                console.warn("Invalid URL pattern regex:", e);
              }
            }
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
        `<meta\\s+(?:[^>]*?\\s+)?property=["']${name}["']\\s+(?:[^>]*?\\s+)?content=["']([^"']*)['"'][^>]*>`,
        "i"
      );
      match = html.match(metaRegex);

      if (!match) {
        // Try with different order of attributes
        metaRegex = new RegExp(
          `<meta\\s+(?:[^>]*?\\s+)?content=["']([^"']*)['"']\\s+(?:[^>]*?\\s+)?property=["']${name}["'][^>]*>`,
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

    // Include SEO Analysis
    if (page.seoAnalysis) {
      output += "SEO ANALYSIS:\n";
      if (page.seoAnalysis.titleIssues.length > 0) {
        output += "Title Issues:\n";
        page.seoAnalysis.titleIssues.forEach((issue) => {
          output += `- ${issue}\n`;
        });
      }
      if (page.seoAnalysis.metaDescriptionIssues.length > 0) {
        output += "Meta Description Issues:\n";
        page.seoAnalysis.metaDescriptionIssues.forEach((issue) => {
          output += `- ${issue}\n`;
        });
      }
      if (page.seoAnalysis.headingIssues.length > 0) {
        output += "Heading Issues:\n";
        page.seoAnalysis.headingIssues.forEach((issue) => {
          output += `- ${issue}\n`;
        });
      }
      output += "\n";
    }

    // Include Link Statistics
    if (page.linkStats) {
      output += "LINK STATISTICS:\n";
      output += `- Internal Links: ${page.linkStats.internalCount}\n`;
      output += `- External Links: ${page.linkStats.externalCount}\n`;
      output += `- External/Internal Ratio: ${page.linkStats.ratio}\n`;
      output += `- Unique Anchor Texts: ${page.linkStats.anchorTextDiversity}\n`;

      if (page.linkStats.duplicateAnchors.length > 0) {
        output += "Top Duplicate Anchor Texts:\n";
        page.linkStats.duplicateAnchors.forEach((anchor) => {
          output += `  - "${anchor.text}": ${anchor.count} times\n`;
        });
      }
      output += "\n";
    }

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

    // Include n-gram analysis if enabled
    if (settings.keywordDensity && page.ngramAnalysis) {
      if (page.ngramAnalysis.bigrams.length > 0) {
        output += "TOP 2-WORD PHRASES:\n";
        page.ngramAnalysis.bigrams.forEach((ngram) => {
          output += `- "${ngram.phrase}": ${ngram.count} times\n`;
        });
        output += "\n";
      }

      if (page.ngramAnalysis.trigrams.length > 0) {
        output += "TOP 3-WORD PHRASES:\n";
        page.ngramAnalysis.trigrams.forEach((ngram) => {
          output += `- "${ngram.phrase}": ${ngram.count} times\n`;
        });
        output += "\n";
      }
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

  // Collect all files first
  const allFiles = [];

  for (const [domain, pages] of activeCrawl.crawlsByDomain.entries()) {
    const domainFolder = domain.replace(/[^a-z0-9]/gi, "_");

    // Process each page
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

      // Store file data
      allFiles.push({
        domain: domainFolder,
        filename: filename,
        content: content,
      });
    }
  }

  // Download files with delay to avoid Chrome's download limit
  updateCurrentAction(`Preparing to save ${allFiles.length} individual files`);

  for (let i = 0; i < allFiles.length; i++) {
    const file = allFiles[i];
    const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(
      file.content
    )}`;
    const fullFilename = `LinkHarvest/${file.domain}/${file.filename}.txt`;

    // Create download with delay
    await new Promise((resolve) => {
      chrome.downloads.download(
        {
          url: dataUrl,
          filename: fullFilename,
          saveAs: false,
          conflictAction: "uniquify",
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error(
              `Error downloading ${fullFilename}:`,
              chrome.runtime.lastError
            );
          }
          // Add a small delay between downloads to avoid Chrome's download limit
          setTimeout(resolve, 100);
        }
      );
    });

    // Update progress
    updateCurrentAction(`Saved file ${i + 1} of ${allFiles.length}`);
  }

  updateCurrentAction("All individual files saved successfully");
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

// Function to extract content from sitemap URLs
async function extractSitemapContent(urls, settings) {
  try {
    // First get all sitemap URLs
    const sitemapData = await validateSitemaps(urls);

    if (!sitemapData.success || sitemapData.totalUrls === 0) {
      return {
        success: false,
        error: "No valid sitemap URLs found",
      };
    }

    // Collect all URLs from all sitemaps
    const allUrls = [];
    for (const [baseUrl, data] of Object.entries(sitemapData.sitemapData)) {
      if (data.urls && data.urls.length > 0) {
        allUrls.push(...data.urls);
      }
    }

    // Limit to maxPages
    const urlsToProcess = allUrls.slice(0, settings.maxPages);

    // Process each URL
    const results = [];
    let processed = 0;

    for (const url of urlsToProcess) {
      try {
        updateCurrentAction(
          `Extracting content from ${url} (${processed + 1}/${
            urlsToProcess.length
          })`
        );

        const pageData = await processPage(url, settings, 0);
        results.push(pageData);
        processed++;

        // Respect rate limit
        if (settings.delayMs > 0 && processed < urlsToProcess.length) {
          await new Promise((resolve) => setTimeout(resolve, settings.delayMs));
        }
      } catch (error) {
        console.error(`Error processing ${url}:`, error);
        processed++;
      }
    }

    // Generate output
    const output = generateSitemapTextOutput(settings, results, sitemapData);

    // Download the file
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `sitemap_extract_${timestamp}.txt`;

    const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(
      output
    )}`;

    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true,
    });

    return {
      success: true,
      totalUrls: processed,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Generate text output for sitemap extraction
function generateSitemapTextOutput(settings, results, sitemapData) {
  let output = "";

  // Add header
  output += "SITEMAP CONTENT EXTRACTION RESULTS\n";
  output += "==================================\n\n";
  output += `Extraction Date: ${new Date().toLocaleString()}\n`;
  output += `Total Pages Extracted: ${results.length}\n\n`;

  // Add sitemap info
  output += "SITEMAPS PROCESSED:\n";
  output += "-" * 20 + "\n";
  for (const [baseUrl, data] of Object.entries(sitemapData.sitemapData)) {
    if (data.sitemapUrl) {
      output += `Base URL: ${baseUrl}\n`;
      output += `Sitemap: ${data.sitemapUrl}\n`;
      output += `URLs found: ${data.urls.length}\n\n`;
    }
  }

  output += "=" * 50 + "\n\n";

  // Process each page
  results.forEach((page, index) => {
    output += `PAGE ${index + 1} OF ${results.length}\n`;
    output += "-" * 40 + "\n";
    output += `URL: ${page.url}\n`;
    output += `Title: ${page.title || "No title"}\n`;
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

    output += "=" * 50 + "\n\n";
  });

  return output;
}

// Generate CSV reports for analysis data
function generateCSVReports(settings) {
  updateCurrentAction("Generating CSV reports");

  const timestamp = new Date().toISOString().slice(0, 10);
  const baseUrl = new URL(activeCrawl.settings.urls[0]);
  const hostname = baseUrl.hostname.replace(/[^a-z0-9]/gi, "_");

  // 1. SEO Analysis CSV
  if (activeCrawl.results.some((r) => r.seoAnalysis)) {
    const seoCSV = generateSEOAnalysisCSV();
    downloadCSV(seoCSV, `seo_analysis_${hostname}_${timestamp}.csv`);
  }

  // 2. Keyword Density CSV
  if (settings.keywordDensity) {
    const keywordCSV = generateKeywordDensityCSV();
    downloadCSV(keywordCSV, `keyword_density_${hostname}_${timestamp}.csv`);
  }

  // 3. N-gram Analysis CSV
  if (
    settings.keywordDensity &&
    activeCrawl.results.some((r) => r.ngramAnalysis)
  ) {
    const ngramCSV = generateNgramCSV();
    downloadCSV(ngramCSV, `ngram_analysis_${hostname}_${timestamp}.csv`);
  }

  // 4. Link Statistics CSV
  if (activeCrawl.results.some((r) => r.linkStats)) {
    const linkStatsCSV = generateLinkStatsCSV();
    downloadCSV(linkStatsCSV, `link_statistics_${hostname}_${timestamp}.csv`);
  }

  // 5. Broken Links CSV
  if (settings.brokenLinkChecker && activeCrawl.brokenLinks.length > 0) {
    const brokenLinksCSV = generateBrokenLinksCSV();
    downloadCSV(brokenLinksCSV, `broken_links_${hostname}_${timestamp}.csv`);
  }

  // 6. Scraped Text Content CSV
  if (settings.extractText) {
    const scrapedTextCSV = generateScrapedTextCSV();
    downloadCSV(scrapedTextCSV, `scraped_text_${hostname}_${timestamp}.csv`);
  }
}

// Generate SEO Analysis CSV
function generateSEOAnalysisCSV() {
  let csv =
    "URL,Title,Title Length,Title Issues,Meta Description Length,Meta Description Issues,H1 Count,H1 Issues\n";

  activeCrawl.results.forEach((page) => {
    if (page.seoAnalysis) {
      const titleIssues = page.seoAnalysis.titleIssues.join("; ") || "None";
      const metaIssues =
        page.seoAnalysis.metaDescriptionIssues.join("; ") || "None";
      const h1Issues = page.seoAnalysis.headingIssues.join("; ") || "None";
      const titleLength = page.title ? page.title.length : 0;
      const metaDesc = extractMetaContent(page.html, "description");
      const metaLength = metaDesc ? metaDesc.length : 0;
      const h1Count = (page.html.match(/<h1[^>]*>.*?<\/h1>/gi) || []).length;

      csv += `"${escapeCsvValue(page.url)}","${escapeCsvValue(
        page.title || ""
      )}",${titleLength},"${escapeCsvValue(
        titleIssues
      )}",${metaLength},"${escapeCsvValue(
        metaIssues
      )}",${h1Count},"${escapeCsvValue(h1Issues)}"\n`;
    }
  });

  return csv;
}

// Generate Keyword Density CSV
function generateKeywordDensityCSV() {
  let csv = "Keyword,Total Count,Average Density,Pages Found On\n";

  // Aggregate keyword data
  const aggregatedKeywords = {};

  activeCrawl.results.forEach((page) => {
    if (page.keywordDensity) {
      page.keywordDensity.forEach((kw) => {
        if (!aggregatedKeywords[kw.word]) {
          aggregatedKeywords[kw.word] = {
            totalCount: 0,
            pageCount: 0,
            densities: [],
          };
        }
        aggregatedKeywords[kw.word].totalCount += kw.count;
        aggregatedKeywords[kw.word].pageCount++;
        aggregatedKeywords[kw.word].densities.push(parseFloat(kw.density));
      });
    }
  });

  // Sort by total count and create CSV
  Object.entries(aggregatedKeywords)
    .sort((a, b) => b[1].totalCount - a[1].totalCount)
    .slice(0, 100) // Top 100 keywords
    .forEach(([word, data]) => {
      const avgDensity = (
        data.densities.reduce((a, b) => a + b, 0) / data.densities.length
      ).toFixed(2);
      csv += `"${escapeCsvValue(word)}",${data.totalCount},${avgDensity}%,${
        data.pageCount
      }\n`;
    });

  return csv;
}

// Generate N-gram Analysis CSV
function generateNgramCSV() {
  let csv = "Type,Phrase,Total Count,Pages Found On\n";

  // Aggregate n-gram data
  const aggregatedBigrams = {};
  const aggregatedTrigrams = {};

  activeCrawl.results.forEach((page) => {
    if (page.ngramAnalysis) {
      // Process bigrams
      page.ngramAnalysis.bigrams.forEach((ngram) => {
        if (!aggregatedBigrams[ngram.phrase]) {
          aggregatedBigrams[ngram.phrase] = {
            totalCount: 0,
            pageCount: 0,
          };
        }
        aggregatedBigrams[ngram.phrase].totalCount += ngram.count;
        aggregatedBigrams[ngram.phrase].pageCount++;
      });

      // Process trigrams
      page.ngramAnalysis.trigrams.forEach((ngram) => {
        if (!aggregatedTrigrams[ngram.phrase]) {
          aggregatedTrigrams[ngram.phrase] = {
            totalCount: 0,
            pageCount: 0,
          };
        }
        aggregatedTrigrams[ngram.phrase].totalCount += ngram.count;
        aggregatedTrigrams[ngram.phrase].pageCount++;
      });
    }
  });

  // Add bigrams to CSV
  Object.entries(aggregatedBigrams)
    .sort((a, b) => b[1].totalCount - a[1].totalCount)
    .slice(0, 50)
    .forEach(([phrase, data]) => {
      csv += `"2-gram","${escapeCsvValue(phrase)}",${data.totalCount},${
        data.pageCount
      }\n`;
    });

  // Add trigrams to CSV
  Object.entries(aggregatedTrigrams)
    .sort((a, b) => b[1].totalCount - a[1].totalCount)
    .slice(0, 50)
    .forEach(([phrase, data]) => {
      csv += `"3-gram","${escapeCsvValue(phrase)}",${data.totalCount},${
        data.pageCount
      }\n`;
    });

  return csv;
}

// Generate Link Statistics CSV
function generateLinkStatsCSV() {
  let csv =
    "URL,Internal Links,External Links,External/Internal Ratio,Unique Anchor Texts,Most Duplicated Anchor\n";

  activeCrawl.results.forEach((page) => {
    if (page.linkStats) {
      const mostDuplicated =
        page.linkStats.duplicateAnchors.length > 0
          ? `${page.linkStats.duplicateAnchors[0].text} (${page.linkStats.duplicateAnchors[0].count})`
          : "None";

      csv += `"${escapeCsvValue(page.url)}",${page.linkStats.internalCount},${
        page.linkStats.externalCount
      },"${page.linkStats.ratio}",${
        page.linkStats.anchorTextDiversity
      },"${escapeCsvValue(mostDuplicated)}"\n`;
    }
  });

  return csv;
}

// Generate Broken Links CSV
function generateBrokenLinksCSV() {
  let csv = "Broken URL,Found On,Status Code,Error Message\n";

  activeCrawl.brokenLinks.forEach((link) => {
    const statusCode = link.statusCode || "N/A";
    const error = link.error || "N/A";
    csv += `"${escapeCsvValue(link.url)}","${escapeCsvValue(
      link.foundOn || ""
    )}","${statusCode}","${escapeCsvValue(error)}"\n`;
  });

  return csv;
}

// Generate Scraped Text Content CSV
function generateScrapedTextCSV() {
  let csv = "URL,Title,Text Content,Word Count\n";

  activeCrawl.results.forEach((page) => {
    if (page.text) {
      // Clean text for CSV - remove newlines and limit length
      const cleanedText = page.text
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 5000); // Limit to 5000 chars per cell for CSV compatibility

      const wordCount = page.text
        .split(/\s+/)
        .filter((word) => word.length > 0).length;

      csv += `"${escapeCsvValue(page.url)}","${escapeCsvValue(
        page.title || ""
      )}","${escapeCsvValue(cleanedText)}",${wordCount}\n`;
    }
  });

  return csv;
}

// Helper function to escape CSV values
function escapeCsvValue(value) {
  if (typeof value !== "string") {
    value = String(value);
  }
  // Replace quotes with double quotes and wrap in quotes if contains comma, newline, or quotes
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return value.replace(/"/g, '""');
  }
  return value;
}

// Download CSV file
function downloadCSV(csvContent, filename) {
  try {
    const dataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(
      csvContent
    )}`;

    chrome.downloads.download(
      {
        url: dataUrl,
        filename: filename,
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error("CSV download error:", chrome.runtime.lastError);
        }
      }
    );
  } catch (error) {
    console.error("Error creating CSV download:", error);
  }
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
