// Node: Prepare RSS Sources
// Position: After Compute Derived Metrics
// Output: 16 items — 2 RSS feeds per niche, each item carries the niche metadata
// The HTTP Request node processes these 16 items sequentially.

const RSS_FEEDS = {
  cybersecurity: [
    'https://www.darkreading.com/rss.xml',
    'https://feeds.feedburner.com/TheHackersNews',
  ],
  defense: [
    'https://www.defensenews.com/arc/outboundfeeds/rss/',
    'https://breakingdefense.com/feed/',
  ],
  nuclear_uranium: [
    'https://world-nuclear-news.org/rss',
    'https://www.resourceworld.com/feed/',   // mining.com/category/uranium returned 404
  ],
  copper_minerals: [
    'https://www.mining.com/feed/',
    'https://oilprice.com/rss/main',
  ],
  ai_semiconductors: [
    'https://semianalysis.com/feed/',
    'https://feeds.arstechnica.com/arstechnica/technology-lab',
  ],
  cloud_hyperscalers: [
    'https://thenewstack.io/feed/',
    'https://siliconangle.com/feed/',
  ],
  oil_gas: [
    'https://oilprice.com/rss/main',
    'https://seekingalpha.com/sector/energy.xml',
  ],
  data_centers: [
    'https://www.datacenterdynamics.com/en/rss/',
    'https://www.datacenterknowledge.com/rss.xml',
  ],
};

const items = [];
let globalIndex = 0;

for (const [niche, feeds] of Object.entries(RSS_FEEDS)) {
  for (let feedIndex = 0; feedIndex < feeds.length; feedIndex++) {
    items.push({
      json: {
        niche,
        feed_url:     feeds[feedIndex],
        feed_index:   feedIndex,
        global_index: globalIndex,
      }
    });
    globalIndex++;
  }
}

return items;
// Output order: cybersecurity[0], cybersecurity[1], defense[0], defense[1], ...
// The Build Specialist Inputs node matches responses back to niches using this index order.
