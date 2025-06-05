# LinkHarvest Chrome Extension

A powerful Chrome extension that allows you to crawl websites and download their content as structured JSON data. Perfect for research, content analysis, site backups, and SEO work.

## Features

- **One-click website crawling** with configurable depth and page limits
- **Intelligent link discovery** that respects domain boundaries
- **Content extraction** with options for HTML, plain text, and metadata
- **Rate limiting** to avoid overloading target websites
- **Pattern filtering** with regex support to target specific content
- **Progress tracking** with detailed status updates
- **Context menu integration** to start crawling from any page
- **Automatic JSON export** when crawling is complete

## Installation

### From Chrome Web Store (Coming Soon)

1. Visit the Chrome Web Store page (link coming soon)
2. Click "Add to Chrome"
3. Confirm the installation

### Manual Installation (Developer Mode)

1. Download or clone this repository
2. Run `node create_icons.js` to generate the icon files
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable "Developer mode" in the top right
5. Click "Load unpacked" and select the folder containing this extension
6. The LinkHarvest extension will now be available in your browser

## How to Use

### Basic Usage

1. Click the LinkHarvest icon in your Chrome toolbar
2. Enter the URL of the website you want to crawl
3. Configure the crawl depth and page limit
4. Select what content to extract (HTML, text, metadata)
5. Click "Start Harvesting"
6. When crawling is complete, the JSON file will automatically download

### Advanced Options

- **URL Pattern**: Use regex patterns to filter which URLs to crawl
- **Content Selector**: Specify CSS selectors to target specific page elements
- **Rate Limit**: Set a delay between requests to avoid overloading servers

### Context Menu

You can also right-click on any page or link and select "Harvest links from this page" to start crawling from that URL.

## Technical Details

### Data Structure

The JSON output includes:

- Base URL and crawl date
- Settings used for the crawl
- Statistics (pages processed, total discovered)
- Page data including:
  - URL and timestamp
  - Page title
  - HTML content (if selected)
  - Plain text content (if selected)
  - Metadata (if selected)
  - Outgoing links

### Permissions

This extension requires the following permissions:

- **activeTab**: To access the current tab
- **storage**: To save your settings
- **downloads**: To save the crawled data
- **contextMenus**: To add the right-click menu option
- **scripting**: To inject scripts for page analysis
- **host_permissions** for all URLs: To fetch content from websites

## Privacy and Ethical Use

LinkHarvest is designed for personal research and legitimate content analysis. Please use it responsibly:

- Always respect robots.txt and website terms of service
- Use rate limiting to avoid overloading websites
- Do not use for scraping personal or private information
- Consider the server load impact of your crawling

## License

MIT License. See LICENSE file for details.
