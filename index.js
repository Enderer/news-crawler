const Crawler = require('simplecrawler');
const cheerio = require('cheerio');
const htmlToText = require('html-to-text');
const AhoCorasick = require('node-aho-corasick');
const natural = require('natural');
const sentiment = require('sentiment');
const _ = require('lodash');

/** Settings */
const URL = 'https://www.boston.com';   // Starting Url
const DELAY = 500;                      // Delay between page loads
const CONNCURENCY = 2;                  // Number of concurrent page loads
const DEPTH = 3;                        // Number of levels deep to crawl pages
const words = [
    'cost taxpayer',
    'darts',
    'harvard',
    'harvard golfer',
    'harvard golfer loses dart match'
];

/**
 * Parse the html document into a string containing the content of
 * the page and a list of links with the url and title
 * @param {string} html - String with html content of the page
 */
const process = (html) => {
    // Convert the content of the page to a string   
    const content = htmlToText.fromString(html);
    const body = parse(content);

    // Get the sentiment of the body text
    const bodyScore = sentiment(body).score;

    // Get all the links on the page
    var $ = cheerio.load(html);
    const links = $('a[href]').map((i, l) => {
        const link = $(l);
        const title = parse(link.text());
        if (!title) { return null; }
        const href = link.attr("href") || '';
        const linkScore = sentiment(title).score;
        return { href, title, score: linkScore };
    }).get();

    return { body, score: bodyScore, links }
}

/**
 * Tokenize a string into words
 * @param {string} text 
 */
function parse(text) {
    const words = tokenizer.tokenize(text);
    const stemmed = words.map(natural.PorterStemmer.stem);
    const lower = stemmed.map(w => w.toLowerCase());
    return lower.join(' ');
}

// Tokenizer for parsing string content into words
const tokenizer = new natural.WordTokenizer();

// Build the database of words to search
ac = new AhoCorasick();
words.forEach(w => ac.add(parse(w)));
ac.build();

// Create the crawler to load pages
var crawler = Crawler(URL);
crawler.interval = DELAY;                 // Delay between http calls
crawler.maxConcurrency = CONNCURENCY;     // Maximum pages to fetch in parallel
crawler.maxDepth = DEPTH;                 // How deep to fetch child pages

// Get all child links to follow on a page
crawler.discoverResources = function(buffer, queueItem) {
    var $ = cheerio.load(buffer.toString("utf8"));
    return $("a[href]").map(function () {
        return $(this).attr("href");
    }).get();
};

// Only crawl pages on the same host as the starting link
crawler.addFetchCondition(function(queueItem, referrerQueueItem, callback) {
    callback(null, queueItem.host === crawler.host);
});

// Only load links to html pages on the same host less than a certain size
crawler.addDownloadCondition(function(queueItem, response, callback) {
    callback(null,
        queueItem.host === crawler.host &&
        /text\/html/.test(queueItem.stateData.contentType) &&
        queueItem.stateData.contentLength < 5 * 1000 * 1000
    );
});

/**
 * Page has been fetched. Search the page for keywords
 */
crawler.on("fetchcomplete", function(queueItem, responseBuffer, response) {
    const html = responseBuffer.toString("utf8");
    const page = process(html);

    // Search the entire page content
    const matches = _(ac.search(page.body)).compact().uniq().value();
    if (matches.length > 0) {
        console.log('\n');
        console.log(queueItem.url);
        console.log(matches, page.score? `Sentiment: ${page.score}` : '');
    }

    // Search links only 
    /** Uncomment to search only links **/
    // const matches = _(page.links).map(link => {
    //     const results = ac.search(link.title);
    //     if (results.length === 0) { return null; }
    //     return { link, results };
    // }).compact().value();
    // if (matches.length > 0){
    //     console.log();
    //     console.log('page: ', queueItem.url);
    //     matches.forEach(m => {
    //         console.log('link url: ', m.link.href);
    //         console.log('link text: ', m.link.title);
    //         if (m.link.score) { console.log('sentiment: ', m.link.score); }
    //         console.log(m.results);
    //     });
    // }
});

// Start crawling the site
crawler.start();