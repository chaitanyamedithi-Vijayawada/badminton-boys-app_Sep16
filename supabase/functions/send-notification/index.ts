import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const OS_APP_ID = "d4b596d7-2437-46e4-b883-cf06b43bc590";
const OS_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (!OS_API_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "ONESIGNAL_REST_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();

    const payload: Record<string, unknown> = {
      app_id: OS_APP_ID,
      headings: body.headings || { en: "Badminton Boys" },
      contents: body.contents || { en: body.message || "" },
      url: body.url || "https://langleybadmintonboys.netlify.app",
    };

    if (body.filters) {
      payload.filters = body.filters;
    } else {
      payload.included_segments = body.included_segments || ["All"];
    }

    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${OS_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
