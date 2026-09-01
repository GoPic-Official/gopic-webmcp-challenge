import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGIN = "https://webmcp.gopic.app";
const MAX_BYTES = 12 * 1024 * 1024;
const MODEL = "gemini-2.5-flash-lite";
const RATE_LIMIT = 30;
const RATE_WINDOW_SECONDS = 3600;

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function originAllowed(req: Request): boolean {
  return req.headers.get("origin") === ALLOWED_ORIGIN;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")?.trim()
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")?.trim()
    || "unknown";
}

async function checkRateLimit(req: Request): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!supabaseUrl || !serviceRole) return false;

  const key = await sha256(`webmcp:${clientIp(req)}`);

  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/webmcp_demo_rate_limit_check`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
      },
      body: JSON.stringify({
        p_client_key: key,
        p_limit: RATE_LIMIT,
        p_window_seconds: RATE_WINDOW_SECONDS,
      }),
    },
  );

  if (!response.ok) {
    console.error(
      "[webmcp-analyze-sign] rate_limit_rpc_failed",
      response.status,
    );
    return false;
  }

  return (await response.json()) === true;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    if (!originAllowed(req)) {
      return new Response(null, { status: 403 });
    }

    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (!originAllowed(req)) {
    return json({ error: "origin_not_allowed" }, 403);
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    if (!(await checkRateLimit(req))) {
      return json({ error: "rate_limited" }, 429);
    }

    const apiKey = (
      Deno.env.get("GOPIC_WEBMCP_GEMINI_API_KEY") || ""
    ).trim();

    if (!apiKey) {
      return json({ error: "server_config_error" }, 500);
    }

    const form = await req.formData();
    const image = form.get("image");
    const locationHint = String(
      form.get("locationHint") || "",
    ).trim().slice(0, 180);

    if (!(image instanceof File)) {
      return json({ error: "image_required" }, 400);
    }

    if (image.size <= 0 || image.size > MAX_BYTES) {
      return json({ error: "invalid_image_size" }, 400);
    }

    const mime = image.type.toLowerCase();

    if (![
      "image/jpeg",
      "image/png",
      "image/webp",
    ].includes(mime)) {
      return json({ error: "unsupported_image_type" }, 400);
    }

    const bytes = new Uint8Array(await image.arrayBuffer());
    let binary = "";

    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(
        ...bytes.subarray(
          i,
          Math.min(i + 0x8000, bytes.length),
        ),
      );
    }

    const imageB64 = btoa(binary);

    const prompt =
      `You are the visual analysis component of GoPic for Agents.\nRead the visible storefront/sign text and identify useful place-search candidates.\nPreserve visible text exactly whenever possible. Do not translate, autocorrect, or invent missing characters. Use the location hint only as context. Return at most 2 candidates.\n\nLocation hint:\n${locationHint}`;

    const schema = {
      type: "object",
      properties: {
        ocrText: {
          type: "string",
        },
        candidates: {
          type: "array",
          maxItems: 2,
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              location: {
                type: "string",
              },
              reason: {
                type: "string",
              },
            },
            required: [
              "name",
              "location",
              "reason",
            ],
          },
        },
        verifiedPlace: {
          type: "string",
        },
      },
      required: [
        "ocrText",
        "candidates",
        "verifiedPlace",
      ],
    };

    const provider = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt,
                },
                {
                  inline_data: {
                    mime_type: mime,
                    data: imageB64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 768,
            responseMimeType: "application/json",
            responseJsonSchema: schema,
          },
        }),
      },
    );

    const raw = await provider.text();

    if (!provider.ok) {
      console.error(
        "[webmcp-analyze-sign] provider_status",
        provider.status,
        raw.slice(0, 500),
      );

      return json({ error: "provider_request_failed" }, 502);
    }

    const decoded = JSON.parse(raw) as Record<string, unknown>;
    const candidates = Array.isArray(decoded.candidates)
      ? decoded.candidates
      : [];

    const first = (candidates[0] || {}) as Record<string, unknown>;
    const content = (first.content || {}) as Record<string, unknown>;
    const parts = Array.isArray(content.parts)
      ? content.parts
      : [];

    const text = parts
      .map((p: unknown) =>
        typeof (p as Record<string, unknown>)?.text === "string"
          ? String((p as Record<string, unknown>).text)
          : ""
      )
      .join("")
      .trim();

    if (!text) {
      return json({ error: "provider_output_missing" }, 502);
    }

    const result = JSON.parse(text) as Record<string, unknown>;

    return json({
      ocrText: String(result.ocrText || "").trim(),
      candidates: Array.isArray(result.candidates)
        ? result.candidates.slice(0, 2)
        : [],
      verifiedPlace: String(result.verifiedPlace || "").trim(),
      meta: {
        engine: MODEL,
        locationHint,
        source:
          "GoPic WebMCP Challenge web demo via Supabase Edge Function",
      },
    });
  } catch (error) {
    console.error(
      "[webmcp-analyze-sign] unhandled",
      error instanceof Error ? error.message : "unknown",
    );

    return json({ error: "internal_error" }, 500);
  }
});
