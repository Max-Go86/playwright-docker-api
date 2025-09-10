const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Utiliser les binaires Playwright installés via node_modules
// (utile sur Render pour éviter les chemins système manquants)
process.env.PLAYWRIGHT_BROWSERS_PATH = "0";

// --- Lancement unique du navigateur (singleton) ---
let browserPromise;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-accelerated-2d-canvas",
        // ⚠️ On évite "--single-process" et "--no-zygote" qui causent des plantages sur certaines plateformes
        // ⚠️ On évite "--disable-web-security" (inutile pour du scraping et potentiellement problématique)
      ],
      timeout: 120000, // 120s max pour démarrer au boot (ne s'applique qu'une fois)
    });
  }
  return browserPromise;
}

// Pré-chauffage au démarrage pour éviter le cold start sur la 1re requête
getBrowser().catch((err) => console.error("Warmup failed:", err));

// Healthcheck pour Render
app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/scrape", async (req, res) => {
  const url = req.body?.url;
  const wait = Number(req.body?.wait ?? 30000);
  if (!url) return res.status(400).json({ error: "Missing URL" });

  let context, page;
  const t0 = Date.now();

  try {
    const browser = await getBrowser();

    // Un contexte/page par requête (bon isolement, réutilise le même browser)
    context = await browser.newContext({
      locale: "fr-BE",
      timezoneId: "Europe/Brussels",
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
    });

    page = await context.newPage();
    page.setDefaultNavigationTimeout(wait);

    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Petite pause si la page injecte du contenu juste après domcontentloaded
    await page.waitForTimeout(1500);

    // Extraction : article si présent, sinon fallback body
    const articleText = await page.evaluate(() => {
      const pickText = (el) =>
        (el?.innerText || el?.textContent || "").replace(/\s+\n/g, "\n").trim();

      // Priorité aux <article> et aux blocs éditoriaux courants
      const article =
        document.querySelector("article") ||
        document.querySelector('[role="main"]') ||
        document.querySelector("main");

      const candidates = [
        article,
        document.querySelector('[itemprop="articleBody"]'),
        document.querySelector('[class*="content"]'),
        document.querySelector('[class*="article"]'),
      ].filter(Boolean);

      for (const el of candidates) {
        const txt = pickText(el);
        if (txt && txt.length > 400) return txt; // un minimum de contenu
      }

      // Fallback global
      return pickText(document.body);
    });

    res.json({
      ok: true,
      url,
      ms: Date.now() - t0,
      length: articleText?.length || 0,
      text: articleText || "",
    });
  } catch (err) {
    console.error("Scraping error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to scrape article",
      detail: err?.message,
      name: err?.name,
      stack: String(err?.stack || "")
        .split("\n")
        .slice(0, 5),
    });
  } finally {
    // Toujours fermer page & contexte (on garde le browser pour les requêtes suivantes)
    try {
      if (page) await page.close();
    } catch {}
    try {
      if (context) await context.close();
    } catch {}
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Playwright API server running on port ${PORT}`);
});
