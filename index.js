//newone

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const NodeCache = require("node-cache");
const axiosRetry = require("axios-retry").default;
const Queue = require("better-queue");

const app = express();
const port = process.env.PORT || 3001;
const API_VERSION = "1.0.0";
const CMC_API_KEY = process.env.CMC_API_KEY;
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 15 minutes

const getTimestamp = () => new Date().getTime();

// Increase payload size limit
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// CORS configuration
const corsOptions = {
  origin: ["https://webthreeworld.com", "http://localhost:3000"],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 50 requests per windowMs
});
app.use(limiter);

// Cache control headers
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  next();
});

//retry
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
});

const apiQueue = new Queue(
  async (task, callback) => {
    try {
      const response = await axios.get(
        `https://pro-api.coinmarketcap.com/v1/${task.endpoint}`,
        {
          headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
          params:
            task.endpoint === "exchange/info"
              ? task.params
              : { ...task.params, convert: "USD" },
        }
      );
      callback(null, response.data);
    } catch (error) {
      callback(error);
    }
  },
  { concurrent: 1, interval: 1000 }
);

// Helper function for CoinMarketCap API calls
async function fetchFromCMC(endpoint, params = {}) {
  const cacheKey = `${endpoint}-${JSON.stringify(params)}`;
  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    return cachedData;
  }

  try {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await delay(1000);
    const response = await axios.get(
      `https://pro-api.coinmarketcap.com/v1/${endpoint}`,
      {
        headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
        params:
          endpoint === "exchange/info" ? params : { ...params, convert: "USD" },
      }
    );
    cache.set(cacheKey, response.data);
    return response.data;
  } catch (error) {
    console.error(
      `Error fetching data from CoinMarketCap API (${endpoint}):`,
      error
    );

    // If the direct request fails, try using the queue as a fallback
    return new Promise((resolve, reject) => {
      apiQueue.push({ endpoint, params }, (err, result) => {
        if (err) {
          console.error(
            `Queue error fetching data from CoinMarketCap API (${endpoint}):`,
            err
          );
          reject(err);
        } else {
          cache.set(cacheKey, result);
          resolve(result);
        }
      });
    });
  }
}

// Fetch latest cryptocurrency data
app.get("/api/cryptocurrencies", async (req, res) => {
  try {
    const data = await fetchFromCMC("cryptocurrency/listings/latest", {
      start: 1,
      limit: 100,
    });

    data.data.forEach((crypto) => {
      crypto.logo = `https://s2.coinmarketcap.com/static/img/coins/64x64/${crypto.id}.png`;
    });

    res.json(data);
  } catch (error) {
    console.error("Error fetching data from CoinMarketCap API:", error.message);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// Fetch trending cryptocurrency data
app.get("/api/trending", async (req, res) => {
  try {
    const data = await fetchFromCMC("cryptocurrency/listings/latest", {
      start: 1,
      limit: 100,
    });

    const trendingData = data.data
      .sort(
        (a, b) =>
          b.quote.USD.percent_change_24h - a.quote.USD.percent_change_24h
      )
      .slice(0, 10)
      .map((crypto) => ({
        ...crypto,
        logo: `https://s2.coinmarketcap.com/static/img/coins/64x64/${crypto.id}.png`,
      }));

    res.json({
      version: API_VERSION,
      timestamp: getTimestamp(),
      data: trendingData,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch trending data",
      message: error.message,
      timestamp: getTimestamp(),
    });
  }
});

// Fetch top gainers
app.get("/api/top-gainers", async (req, res) => {
  try {
    const data = await fetchFromCMC("cryptocurrency/listings/latest", {
      start: 1,
      limit: 3,
      sort: "percent_change_24h",
      sort_dir: "desc",
    });

    const topGainers = data.data.map((crypto) => ({
      id: crypto.id,
      name: crypto.name,
      symbol: crypto.symbol,
      logo: `https://s2.coinmarketcap.com/static/img/coins/64x64/${crypto.id}.png`,
      changePercent24Hr: crypto.quote.USD.percent_change_24h,
    }));

    res.json({
      version: API_VERSION,
      timestamp: getTimestamp(),
      data: topGainers,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch top gainers",
      message: error.message,
      timestamp: getTimestamp(),
    });
  }
});

// Fetch top losers
app.get("/api/top-losers", async (req, res) => {
  try {
    const data = await fetchFromCMC("cryptocurrency/listings/latest", {
      start: 1,
      limit: 3,
      sort: "percent_change_24h",
      sort_dir: "asc",
    });

    const topLosers = data.data.map((crypto) => ({
      id: crypto.id,
      name: crypto.name,
      symbol: crypto.symbol,
      logo: `https://s2.coinmarketcap.com/static/img/coins/64x64/${crypto.id}.png`,
      changePercent24Hr: crypto.quote.USD.percent_change_24h,
    }));

    res.json({
      version: API_VERSION,
      timestamp: getTimestamp(),
      data: topLosers,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch top losers",
      message: error.message,
      timestamp: getTimestamp(),
    });
  }
});

// Fetch details for a specific cryptocurrency by ID
app.get("/api/cryptocurrencies/:id", async (req, res) => {
  const cryptoId = req.params.id;
  try {
    const data = await fetchFromCMC("cryptocurrency/listings/latest", {
      start: 1,
      limit: 100,
    });

    const crypto = data.data.find((c) => c.id == cryptoId);

    if (crypto) {
      crypto.logo = `https://s2.coinmarketcap.com/static/img/coins/64x64/${cryptoId}.png`;
      res.json({
        version: API_VERSION,
        timestamp: getTimestamp(),
        data: crypto,
      });
    } else {
      res
        .status(404)
        .json({ error: "Cryptocurrency not found", timestamp: getTimestamp() });
    }
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch cryptocurrency details",
      message: error.message,
      timestamp: getTimestamp(),
    });
  }
});

// Fetch price performance data
app.get("/api/price-performance/:id", async (req, res) => {
  const cryptoId = req.params.id.toLowerCase();

  if (!cryptoId) {
    return res.status(400).json({ error: "Invalid cryptocurrency ID" });
  }

  try {
    const apiUrl = `https://api.coincap.io/v2/assets/${cryptoId}`;
    console.log(`Fetching data from API: ${apiUrl}`);

    const response = await axios.get(apiUrl);
    console.log("API Response Data:", response.data);

    const crypto = response.data.data;

    if (crypto) {
      const pricePerformance = {
        price: parseFloat(crypto.priceUsd).toFixed(2),
        change_24h: parseFloat(crypto.changePercent24Hr).toFixed(2),
        market_cap: parseFloat(crypto.marketCapUsd).toFixed(2),
        volume_24h: parseFloat(crypto.volumeUsd24Hr).toFixed(2),
        supply: parseFloat(crypto.supply).toFixed(2),
        maxSupply: crypto.maxSupply
          ? parseFloat(crypto.maxSupply).toFixed(2)
          : "N/A",
      };
      console.log("Price Performance Data:", pricePerformance);

      res.json({
        version: API_VERSION,
        timestamp: getTimestamp(),
        data: pricePerformance,
      });
    } else {
      res
        .status(404)
        .json({ error: "Cryptocurrency not found", timestamp: getTimestamp() });
    }
  } catch (error) {
    console.error("Error fetching price performance data:", error.message);
    if (error.response) {
      console.error("Response data:", error.response.data);
      console.error("Response status:", error.response.status);
      console.error("Response headers:", error.response.headers);
    } else if (error.request) {
      console.error("No response received:", error.request);
    } else {
      console.error("Error details:", error.message);
    }
    res.status(500).json({
      error: "Failed to fetch price performance data",
      message: error.message,
      timestamp: getTimestamp(),
    });
  }
});

// Fetch exchange data from CoinGecko API
app.get("/api/exchanges", async (req, res) => {
  const cacheKey = "exchanges";
  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    return res.json({
      version: API_VERSION,
      timestamp: getTimestamp(),
      data: cachedData,
    });
  }

  try {
    const url = "https://api.coingecko.com/api/v3/exchanges";
    const response = await fetchFromCoinGecko(url);

    // Transform the response to match your expected format if needed
    const exchangeData = response.map((exchange) => ({
      id: exchange.id,
      name: exchange.name,
      year_established: exchange.year_established,
      country: exchange.country,
      description: exchange.description,
      url: exchange.url,
      image: exchange.image,
      has_trading_incentive: exchange.has_trading_incentive,
      trust_score: exchange.trust_score,
      trust_score_rank: exchange.trust_score_rank,
      trade_volume_24h_btc: exchange.trade_volume_24h_btc,
      trade_volume_24h_btc_normalized: exchange.trade_volume_24h_btc_normalized,
    }));

    // Cache the data
    cache.set(cacheKey, exchangeData);

    res.json({
      version: API_VERSION,
      timestamp: getTimestamp(),
      data: exchangeData,
    });
  } catch (error) {
    console.error(
      "Error fetching exchange data from CoinGecko API:",
      error.message
    );
    res.status(500).json({
      error: "Failed to fetch exchange data",
      message: error.message,
      timestamp: getTimestamp(),
    });
  }
});
// Add a simple endpoint to check API freshness
app.get("/api/fresh", (req, res) => {
  res.json({
    version: API_VERSION,
    timestamp: getTimestamp(),
    message: "If you see this message, you're getting fresh data!",
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "An error occurred",
    message: err.message,
    timestamp: getTimestamp(),
    path: req.path,
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
