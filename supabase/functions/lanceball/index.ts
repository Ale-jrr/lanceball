import bundled from "../_shared/catalog-bundled.json" with { type: "json" };
import { edgeHandler } from "../_shared/edge-handler.mjs";
import { supabaseStore } from "../_shared/supabase-store.mjs";

const url = Deno.env.get("SUPABASE_URL");
const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !secret) throw new Error("Credenciais do Supabase indisponíveis.");

Deno.serve(edgeHandler(supabaseStore(url, secret), (task: Promise<unknown>) => {
  EdgeRuntime.waitUntil(task);
}, bundled));
