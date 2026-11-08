const MNB_ENDPOINT = "http://www.mnb.hu/arfolyamok.asmx";
const ALLOWED_ORIGINS = new Set([
  "https://e5muhely.web.app",
  "https://e5muhely.firebaseapp.com",
  "http://127.0.0.1:5000",
  "http://localhost:5000",
]);

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=3600",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function extractRate(xml, currency) {
  const pattern = new RegExp(
    `&lt;(?:\\w+:)?Rate[^>]*curr=["']${currency}["'][^&]*&gt;([^&]+)&lt;`,
    "i",
  );
  const match = xml.match(pattern);
  const value = Number(match?.[1]?.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers,
      });
    }

    try {
      const soapBody = `<?xml version="1.0" encoding="utf-8"?>
        <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
          <soap:Body>
            <GetCurrentExchangeRates xmlns="http://www.mnb.hu/webservices/" />
          </soap:Body>
        </soap:Envelope>`;
      const response = await fetch(MNB_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: "http://www.mnb.hu/webservices/MNBArfolyamServiceSoap/GetCurrentExchangeRates",
        },
        body: soapBody,
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
      if (!response.ok) {
        throw new Error(`MNB request failed with status ${response.status}`);
      }

      const xml = await response.text();
      const rates = {
        EUR: extractRate(xml, "EUR"),
        USD: extractRate(xml, "USD"),
      };
      if (!rates.EUR || !rates.USD) {
        throw new Error("MNB response did not contain EUR and USD rates");
      }

      return new Response(JSON.stringify({
        source: "MNB",
        fetchedAt: new Date().toISOString(),
        rates,
      }), { headers });
    } catch (error) {
      console.error("MNB exchange-rate proxy error", error);
      return new Response(JSON.stringify({ error: "Exchange rates unavailable" }), {
        status: 502,
        headers,
      });
    }
  },
};
