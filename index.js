
const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

app.post("/scrape", async (req, res) => {
  const url = req.body.url;
  if (!url) return res.status(400).json({ error: "Missing URL" });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    await page.waitForTimeout(2000);

    const articleText = await page.evaluate(() => {
      const article = document.querySelector("article");
      return article ? article.innerText : document.body.innerText;
    });

    res.json({ url, text: articleText });
  } catch (err) {
    console.error("Scraping error:", err);
    res.status(500).json({ error: "Failed to scrape article", detail: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Playwright API server running on port ${PORT}`);
});
