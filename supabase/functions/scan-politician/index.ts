/**
 * scan-politician — Supabase Edge Function
 *
 * Busca escândalos e notícias de um político usando:
 *   1. STF Jurisprudência (gratuito)
 *   2. SerpAPI / Google (requer SERPAPI_KEY)
 *   3. NewsAPI (requer NEWS_API_KEY)
 *   4. Google Custom Search (requer GOOGLE_API_KEY + GOOGLE_CSE_ID)
 *
 * Supabase Secrets necessários:
 *   supabase secrets set SERPAPI_KEY=<sua_chave>
 *   supabase secrets set NEWS_API_KEY=<sua_chave>
 *   supabase secrets set GOOGLE_API_KEY=<sua_chave>   (alternativo ao SerpAPI)
 *   supabase secrets set GOOGLE_CSE_ID=<seu_id>       (alternativo ao SerpAPI)
 *
 * Body aceito:
 *   { name: string, politicianId: string, saveToDb?: boolean }
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Returns false only if server explicitly returns 404/410.
// Other errors (timeout, network) = assume OK (server may have CORS restrictions).
async function urlAlive(url: string): Promise<boolean> {
  if (!url || !url.startsWith("http")) return false
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CorruptometroBot/1.0)" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    })
    return res.status !== 404 && res.status !== 410 && res.status !== 451
  } catch {
    return true // network/timeout = assume alive
  }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// ── Palavras que indicam escândalo grave ──────────────────────────────────────
const HIGH_KEYWORDS = [
  "preso", "condenado", "réu", "indiciado", "investigado", "operação",
  "corrupção", "propina", "lavagem", "desvio", "fraude", "caixa dois",
  "mandado de prisão", "delação", "denúncia", "STF", "STJ", "TRF",
  "improbidade", "peculato", "extorsão", "crime", "criminal",
]

function severity(text: string): "high" | "medium" {
  const lower = text.toLowerCase()
  return HIGH_KEYWORDS.some((k) => lower.includes(k)) ? "high" : "medium"
}

function today() {
  return new Date().toISOString().split("T")[0]
}

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface Scandal {
  politician_id: string
  title: string
  caption: string
  severity: "high" | "medium"
  news_url: string
  date_occurrence: string
}

// ── Handler ───────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  const log: string[] = []
  const scandals: Scandal[] = []
  const seen = new Set<string>() // dedup by URL

  async function addScandal(s: Scandal) {
    if (s.news_url && seen.has(s.news_url)) return
    // Validate URL — skip if 404/410/dead
    if (s.news_url) {
      const alive = await urlAlive(s.news_url)
      if (!alive) {
        log.push(`⊘ URL descartada (404/morta): ${s.news_url.slice(0, 60)}`)
        return
      }
      seen.add(s.news_url)
    }
    scandals.push(s)
  }

  try {
    const { name, politicianId, saveToDb = false } = await req.json()

    const SERPAPI_KEY    = Deno.env.get("SERPAPI_KEY")
    const NEWS_API_KEY   = Deno.env.get("NEWS_API_KEY")
    const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY")
    const GOOGLE_CSE_ID  = Deno.env.get("GOOGLE_CSE_ID")

    log.push(`[SCAN] ${name}`)

    // ── 1. STF Jurisprudência ────────────────────────────────────────────────
    try {
      log.push("STF → processos criminais (Ação Penal)...")
      const url =
        `https://jurisprudencia.stf.jus.br/api/pesquisa/jurisprudencias` +
        `?query=${encodeURIComponent(name)}&classeProcessual=AP&limit=10&offset=0`

      const res = await fetch(url, {
        headers: { "Accept": "application/json", "User-Agent": "CorruptometroBot/1.0" },
        signal: AbortSignal.timeout(12000),
      })

      if (res.ok) {
        const data = await res.json()
        const hits = data.hits?.hits || data.result || []
        for (const h of hits.slice(0, 10)) {
          const s = h._source || h
          await addScandal({
            politician_id: politicianId,
            title: `STF — Ação Penal: ${s.numeroProcesso || s.numero || "s/n"}`,
            caption: s.ementa?.slice(0, 500) || "Processo criminal no Supremo Tribunal Federal.",
            severity: "high",
            news_url: `https://portal.stf.jus.br/processos/detalhe.asp?incidente=${s.incidente || ""}`,
            date_occurrence: (s.dataJulgamento || s.data || today()).split("T")[0],
          })
        }
        log.push(`✓ STF: ${hits.length} processos → ${scandals.length} importados`)
      } else {
        log.push(`STF: HTTP ${res.status}`)
      }
    } catch (e) {
      log.push(`STF: ${(e as Error).message}`)
    }

    // ── 2. SerpAPI (Google Search) ───────────────────────────────────────────
    if (SERPAPI_KEY) {
      const queries = [
        `"${name}" escandalo OR corrupção OR preso OR condenado`,
        `"${name}" operação policial OR delação OR réu`,
        `"${name}" lavagem dinheiro OR propina OR desvio`,
      ]
      log.push(`SerpAPI → ${queries.length} buscas no Google...`)

      for (const q of queries) {
        try {
          const url =
            `https://serpapi.com/search.json?engine=google` +
            `&q=${encodeURIComponent(q)}&hl=pt&gl=br&num=10` +
            `&api_key=${SERPAPI_KEY}`

          const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
          if (!res.ok) { log.push(`SerpAPI HTTP ${res.status} para: ${q}`); continue }

          const data = await res.json()
          for (const r of (data.organic_results || []).slice(0, 5)) {
            if (!r.link) continue
            await addScandal({
              politician_id: politicianId,
              title: r.title || "(sem título)",
              caption: r.snippet || "",
              severity: severity(r.title + " " + r.snippet),
              news_url: r.link,
              date_occurrence: r.date ? new Date(r.date).toISOString().split("T")[0] : today(),
            })
          }
        } catch (e) {
          log.push(`SerpAPI query falhou: ${(e as Error).message}`)
        }
      }
      log.push(`✓ SerpAPI: ${scandals.length} resultados acumulados`)
    } else {
      log.push("SerpAPI não configurada (secret SERPAPI_KEY ausente)")
    }

    // ── 3. NewsAPI ───────────────────────────────────────────────────────────
    if (NEWS_API_KEY) {
      try {
        log.push("NewsAPI → notícias recentes...")
        const q = encodeURIComponent(`${name} escandalo corrupção`)
        const url =
          `https://newsapi.org/v2/everything?q=${q}` +
          `&language=pt&sortBy=relevancy&pageSize=20&apiKey=${NEWS_API_KEY}`

        const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
        if (res.ok) {
          const data = await res.json()
          for (const a of (data.articles || []).slice(0, 10)) {
            if (!a.url || a.url.includes("newsapi.org")) continue
            await addScandal({
              politician_id: politicianId,
              title: a.title || "(sem título)",
              caption: a.description || a.content?.slice(0, 400) || "",
              severity: severity(a.title + " " + (a.description || "")),
              news_url: a.url,
              date_occurrence: a.publishedAt ? a.publishedAt.split("T")[0] : today(),
            })
          }
          log.push(`✓ NewsAPI: ${data.articles?.length || 0} artigos`)
        } else {
          log.push(`NewsAPI: HTTP ${res.status}`)
        }
      } catch (e) {
        log.push(`NewsAPI: ${(e as Error).message}`)
      }
    } else {
      log.push("NewsAPI não configurada (secret NEWS_API_KEY ausente)")
    }

    // ── 4. Google Custom Search (fallback se não tem SerpAPI) ────────────────
    if (GOOGLE_API_KEY && GOOGLE_CSE_ID && !SERPAPI_KEY) {
      try {
        log.push("Google CSE → buscando...")
        const q = encodeURIComponent(`"${name}" escandalo corrupção`)
        const url =
          `https://www.googleapis.com/customsearch/v1` +
          `?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${q}&lr=lang_pt&num=10`

        const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
        if (res.ok) {
          const data = await res.json()
          for (const item of (data.items || []).slice(0, 5)) {
            await addScandal({
              politician_id: politicianId,
              title: item.title,
              caption: item.snippet || "",
              severity: severity(item.title + " " + item.snippet),
              news_url: item.link,
              date_occurrence: today(),
            })
          }
          log.push(`✓ Google CSE: ${data.items?.length || 0} resultados`)
        }
      } catch (e) {
        log.push(`Google CSE: ${(e as Error).message}`)
      }
    }

    // ── 5. Salvar no banco + recalcular score ────────────────────────────────
    if (saveToDb && scandals.length > 0 && politicianId) {
      try {
        const db = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        )

        // Insert only non-duplicate titles for this politician
        const { data: existing } = await db
          .from("scandals")
          .select("news_url")
          .eq("politician_id", politicianId)

        const existingUrls = new Set((existing || []).map((s: { news_url: string }) => s.news_url))
        const fresh = scandals.filter((s) => !existingUrls.has(s.news_url))

        if (fresh.length > 0) {
          const { error } = await db.from("scandals").insert(fresh)
          if (error) {
            log.push(`Erro ao salvar: ${error.message}`)
          } else {
            log.push(`✓ ${fresh.length} escândalos novos salvos no banco`)

            // Recalculate score
            const { data: allScans } = await db
              .from("scandals")
              .select("severity")
              .eq("politician_id", politicianId)

            let score = 100
            for (const s of allScans || []) {
              score -= s.severity === "high" ? 25 : 10
            }
            score = Math.max(0, score)
            const status = score >= 75 ? "safe" : score >= 40 ? "warning" : "danger"
            await db.from("politicians").update({ score, status }).eq("id", politicianId)
            log.push(`✓ Score recalculado: ${score} (${status})`)
          }
        } else {
          log.push("Nenhum escândalo novo (todos já estavam no banco)")
        }
      } catch (e) {
        log.push(`Erro DB: ${(e as Error).message}`)
      }
    }

    log.push(`[FIM] ${scandals.length} escândalos totais para ${name}`)

    return new Response(
      JSON.stringify({ scandals, log, total: scandals.length }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ scandals: [], log: [`Erro fatal: ${(err as Error).message}`], total: 0 }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    )
  }
})
