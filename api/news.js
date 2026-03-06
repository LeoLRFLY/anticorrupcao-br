// Vercel Edge Function — proxy para Google News RSS
// Endpoint: /api/news?q=Nome+Parlamentar
export const config = { runtime: "edge" };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET",
    "Content-Type": "application/json",
  };

  if (!q) return new Response(JSON.stringify([]), { headers });

  try {
    const query  = encodeURIComponent(`"${q}"`);
    const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

    const r = await fetch(rssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" }
    });

    const xml = await r.text();

    // Parse manual do XML
    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = regex.exec(xml)) !== null && items.length < 8) {
      const item = match[1];
      const get  = (tag) => item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim() ?? "";

      const titulo_raw = get("title");
      const fonte      = get("source") || titulo_raw.match(/ - ([^-]+)$/)?.[1] || "Google News";
      const titulo     = titulo_raw.replace(/ - [^-]+$/, "").trim();
      const link       = get("link");
      const data       = get("pubDate").slice(0, 16);
      const descricaoRaw = get("description")
        .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"')
        .replace(/<[^>]+>/g, "").trim();
      const descricao  = descricaoRaw.slice(0, 180);

      if (titulo) items.push({ titulo, fonte, link, data, descricao });
    }

    return new Response(JSON.stringify(items), { headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers,
    });
  }
}
