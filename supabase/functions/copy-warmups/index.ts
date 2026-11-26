// Retired: one-time warm-up image copy is complete. Safe to delete from the dashboard.
Deno.serve(() => new Response(JSON.stringify({ error: "retired" }), { status: 410, headers: { "Content-Type": "application/json" } }));
