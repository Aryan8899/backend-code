const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
const PORT = 5000;


//umVoRpkC50LuPpLh
// Middleware
app.use(cors());
app.use(express.json()); // Parse JSON bodies

// MongoDB Connection
require("dotenv").config();
const uri =
  "mongodb+srv://aryanpandita003:i5rEpY08BANOZ6TL@news.jb66uan.mongodb.net/";

const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

mongoose
  .connect(uri, options)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log("MongoDB connection error", err));
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => {
  console.log("Connected to MongoDB database");
});

// News Schema
const newsSchema = new mongoose.Schema({
  title: String,
  image: String,
  date: String,
});

// News Model
const News = mongoose.model("News", newsSchema);

// Routes

// Get all news items
app.get("/news", async (req, res) => {
  try {
    const newsItems = await News.find();
    res.json(newsItems);
  } catch (error) {
    console.error("Error fetching news data:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Create a new news item
app.post("/news", async (req, res) => {
  const { title, image, date } = req.body;
  try {
    const newNews = new News({ title, image, date });
    await newNews.save();
    res.status(201).json(newNews);
  } catch (error) {
    console.error("Error creating news item:", error);
    res.status(500).json({ message: "Failed to create news item" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
