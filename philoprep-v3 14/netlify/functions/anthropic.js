exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    (typeof Netlify !== "undefined" && Netlify.env && typeof Netlify.env.get === "function"
      ? Netlify.env.get("ANTHROPIC_API_KEY")
      : "");
  if (!apiKey) {
    console.error("[anthropic] ANTHROPIC_API_KEY is not set");
    return {
      statusCode: 500,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "API key not configured (ANTHROPIC_API_KEY missing)" } }),
    };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ error: { message: "Invalid JSON" } }) };
  }

  const payload = {
    model: body.model || "claude-sonnet-4-20250514",
    max_tokens: Number(body.max_tokens || 1200),
    system: body.system || undefined,
    messages: Array.isArray(body.messages) ? body.messages : [],
    stream: !!body.stream,
  };

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    if (payload.stream) {
      const txt = await resp.text();
      if (resp.status === 401) {
        console.error("[anthropic] 401 Unauthorized from Anthropic (stream). Check API key validity.");
      }
      return {
        statusCode: resp.status,
        headers: {
          ...headers,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
        body: txt,
      };
    }

    const raw = await resp.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = { raw }; }
    if (resp.status === 401) {
      console.error("[anthropic] 401 Unauthorized from Anthropic. Check API key validity/permissions.");
      return {
        statusCode: 401,
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          error: {
            message: "Anthropic authentication failed (401). Verify ANTHROPIC_API_KEY in Netlify env.",
            upstream: data && data.error ? data.error : data,
          },
        }),
      };
    }
    return {
      statusCode: resp.status,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: e.message || "Anthropic proxy error" } }),
    };
  }
};

