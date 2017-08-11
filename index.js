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
const CONNCURENCY = 10;                  // Number of concurrent page loads
const DEPTH = 3;                        // Number of levels deep to crawl pages
const words = [
    'cost taxpayer',
    'darts',
    'harvard',
    'harvard golfer',
    'harvard golfer loses dart match'
];
const SEARCH_LINKS = false;
const SEARCH_BODY = true;

/**
 * Parse the html document into a string containing the content of
 * the page and a list of links with the url and title
 * @param {string} html - String with html content of the page
 */
const process = (html) => {


    const $$ = cheerio.load(html);
    // const links1 = $$('a');
    $$('a').remove();
    const htmlWithoutLinks = $$.html();

    // Convert the content of the page to a string   
    const content = htmlToText.fromString(htmlWithoutLinks);
    const body = nowhitespace(content);

    // Get the sentiment of the body text
    const score = sentiment(body).score;

    // Get all the links on the page
    var $ = cheerio.load(html);

    const links = $('a[href]').map((i, l) => {
        const link = $(l);
        const title = nowhitespace(link.text());
        if (!title) { return null; }
        const href = link.attr("href") || '';
        const linkScore = sentiment(title).score;
        return { href, title, score: linkScore };
    }).get();

    const page = { body, score, links }
    return page;
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

function nowhitespace(text) {
    return text.replace(/[\s\t\n]+/g,' ')
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
    const links = $("a[href]").get();

    const searchLinks = links.map(l => {
        const text = parse($(l).text());
        const hits = ac.search(text);
        const hasHits = hits.length;
        return { l, hasHits, text };
    });
    const sorted = _.orderBy(searchLinks, ['hasHits'], ['desc']);
    // console.log(sorted.map(sl => ({ 
    //     t: sl.text, 
    //     hasHits: sl.hasHits
    // })));
    const hrefs = sorted.map(sl => $(sl.l).attr('href'));
    return hrefs;
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
    console.log('search page: ', queueItem.url);




    // Search the entire page content
    if (SEARCH_BODY === true) {
        const body = parse(page.body);
        const matches = _(ac.search(body)).compact().uniq().value();
        if (matches.length > 0) {
            console.log(matches, page.score? `Sentiment: ${page.score}` : '');
        }
    }

    if (SEARCH_LINKS === true ){
        const linkMatches = _(page.links).map(link => {
            const title = parse(link.title);
            const results = ac.search(title);
            if (results.length === 0) { return null; }
            return { link, results };
        }).compact().value();
        
        if (linkMatches.length > 0){
            linkMatches.forEach(m => {
                console.log('link url: ', m.link.href);
                console.log('link text: ', m.link.title);
                if (m.link.score) { console.log('link sentiment: ', m.link.score); }
                console.log(m.results);
            });
        }
    }
});

// Start crawling the site
crawler.start();