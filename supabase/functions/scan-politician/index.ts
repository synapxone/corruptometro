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

// Verifica se URL existe — detecta hard 404 E soft 404 (redirect para erro).
async function urlAlive(url: string): Promise<boolean> {
  if (!url || !url.startsWith("http")) return false
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CorruptometroBot/1.0)" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    })

    // Hard 404 / removido / bloqueado legalmente
    if (res.status === 404 || res.status === 410 || res.status === 451) return false

    // Soft 404: servidor redirecionou para URL completamente diferente
    // (ex: G1 manda para homepage ou página de busca quando artigo não existe)
    if (res.redirected && res.url) {
      try {
        const orig = new URL(url)
        const final = new URL(res.url)

        // Redirecionou para domínio diferente = provavelmente soft 404
        if (final.hostname !== orig.hostname) return false

        // Redirecionou para homepage, busca ou padrões de "não encontrado"
        const fp = final.pathname.toLowerCase()
        const softPatterns = [
          /^\/?$/, /^\/index\.html?$/, /\/404/, /\/not.?found/,
          /\/nao.?encontrad/, /\/erro/, /\/error/, /\/pagina.?nao/,
          /\/busca/, /\/search/, /\/tag\//, /\/$/, // redirect to root or tag = 404
        ]
        // Só aplica o padrão de "/" se a URL original tinha um path longo
        const origPathLong = orig.pathname.split("/").length > 3
        if (softPatterns.some((p, i) => {
          if (i === 0 && !origPathLong) return false // ignora "/" em URLs curtas
          return p.test(fp)
        })) return false

        // URL encurtou drasticamente (ex: /noticia/2025/08/15/artigo → /noticia)
        const origSegments = orig.pathname.split("/").filter(Boolean).length
        const finalSegments = final.pathname.split("/").filter(Boolean).length
        if (origSegments >= 3 && finalSegments <= 1) return false
      } catch { /* URL parse error — ignora */ }
    }

    return true
  } catch {
    return true // timeout / network = assume alive
  }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// ── Classificação de gravidade em 4 níveis ────────────────────────────────────
const CRITICAL_KEYWORDS = [
  "condenado", "cumprindo pena", "pena privativa", "transitou em julgado",
  "sentença condenatória", "preso preventivo", "preso em flagrante",
  "preso definitivo", "cumpre pena", "executando pena",
]
const HIGH_KEYWORDS = [
  "réu", "indiciado", "denúncia criminal", "operação policial", "operação da pf",
  "lavagem de dinheiro", "improbidade", "peculato", "corrupção passiva",
  "corrupção ativa", "extorsão", "caixa dois", "delação premiada",
  "mandado de prisão", "STF", "STJ", "TRF", "crime", "criminal",
]
const MEDIUM_KEYWORDS = [
  "investigado", "suspeito", "inquérito", "corrupção", "propina",
  "desvio", "fraude", "operação", "cpi", "preso",
]

type Severity = "critical" | "high" | "medium" | "low"

function severity(text: string): Severity {
  const lower = text.toLowerCase()
  if (CRITICAL_KEYWORDS.some((k) => lower.includes(k))) return "critical"
  if (HIGH_KEYWORDS.some((k) => lower.includes(k))) return "high"
  if (MEDIUM_KEYWORDS.some((k) => lower.includes(k))) return "medium"
  return "low"
}

// ── Recência: escândalos antigos pesam menos ──────────────────────────────────
function recencyMultiplier(dateStr: string): number {
  const years = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24 * 365.25)
  if (years < 1) return 1.0
  if (years < 2) return 0.85
  if (years < 4) return 0.65
  return 0.40
}

// ── Pesos por nível ────────────────────────────────────────────────────────────
const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 35,
  high: 20,
  medium: 10,
  low: 5,
}

function today() {
  return new Date().toISOString().split("T")[0]
}

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface Scandal {
  politician_id: string
  title: string
  caption: string
  severity: Severity
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
            severity: "critical", // Processo criminal no STF = nível máximo
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

            // Recalculate score (4 levels + recency)
            const { data: allScans } = await db
              .from("scandals")
              .select("severity, date_occurrence")
              .eq("politician_id", politicianId)

            let score = 100
            for (const s of allScans || []) {
              const weight = SEVERITY_WEIGHT[s.severity] ?? 10
              const mult = recencyMultiplier(s.date_occurrence || today())
              score -= weight * mult
            }
            score = Math.max(0, Math.round(score))
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
