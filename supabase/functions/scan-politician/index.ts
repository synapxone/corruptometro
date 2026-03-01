/**
 * scan-politician — Supabase Edge Function
 * 
 * V32: MOTOR TRANSPARÊNCIA TOTAL (VOTOS + PROJETOS + CRIMES)
 * - Categorias: CONDENAÇÃO (Regex), INVESTIGAÇÃO, MENÇÃO.
 * - Módulo VOTOS: Busca histórico de votações na API da Câmara (Dados Abertos).
 * - Módulo PROJETOS: Captura projetos de lei de autoria (PLs).
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const getCondenacaoRegex = (name: string) => {
  const parts = name.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  return new RegExp(`(${name}|${firstName}\\s+${lastName})\\s+(é|foi|será|está|vai|deve|é|preso|levado|recolhido)\\s+(preso|prisão|cela|cadeia|xadrez)`, "i");
}

const INVESTIGACAO_KEYWORDS = ["investigado", "indiciado", "réu", "acusado", "alvo de operação", "buscas", "inquérito", "citado", "delação", "pf", "ministério público", "mpf"]

async function getChamberId(name: string) {
  try {
    const res = await fetch(`https://dadosabertos.camara.leg.br/api/v2/deputados?nome=${encodeURIComponent(name)}&ordem=ASC&ordenarPor=nome`);
    const data = await res.json();
    return data.dados?.[0]?.id || null;
  } catch { return null; }
}

async function getVotes(chamberId: number) {
  try {
    const res = await fetch(`https://dadosabertos.camara.leg.br/api/v2/deputados/${chamberId}/votacoes?ordem=DESC&ordenarPor=dataHoraRegistro`);
    const data = await res.json();
    return (data.dados || []).slice(0, 10);
  } catch { return []; }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  const log: string[] = []
  const scandals: any[] = []
  const lawsuits: any[] = []
  const votes: any[] = []
  const projects: any[] = []

  try {
    const { name, politicianId, saveToDb = false } = await req.json()
    log.push(`[SCAN-V32.1] Transparência Legislativa para: ${name}`)
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

    // 1. VOTOS
    const chamberId = await getChamberId(name);
    if (chamberId) {
      log.push(`✓ ID Câmara: ${chamberId}`);
      const rawVotes = await getVotes(chamberId);
      for (const v of rawVotes) {
        votes.push({
          politician_id: politicianId,
          title: `VOTAÇÃO: ${v.proposicaoDescricao || 'Materia Legislativa'}`,
          caption: `Voto: ${v.tipoVoto || 'Não Registrado'} - Data: ${v.dataHoraRegistro.split('T')[0]}`,
          news_url: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${v.idVotacao.split('-')[0]}`,
          is_positive: true,
          severity: "low",
          date_occurrence: v.dataHoraRegistro.split('T')[0]
        })
      }
    }

    // 2. NOTÍCIAS
    const qNews = `"${name}" (corrupção OR propina OR desvio OR prisão OR investigado)`
    const resNews = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(qNews)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`)
    if (resNews.ok) {
      const text = await resNews.text()
      const items = text.match(/<item>([\s\S]*?)<\/item>/g) || []
      const condenacaoRegex = getCondenacaoRegex(name);
      for (const item of items.slice(0, 80)) {
        const title = (item.match(/<title>([^<]*)<\/title>/)?.[1] || "").split(' - ')[0]
        const link = item.match(/<link>([^<]*)<\/link>/)?.[1] || ""
        const dateStr = item.match(/<pubDate>([^<]*)<\/pubDate>/)?.[1] || ""

        let severity: "critical" | "high" | "medium" | "ignore" = "ignore";
        let caption = "";

        if (condenacaoRegex.test(title)) { severity = "critical"; caption = "Prisão ou condenação direta."; }
        else if (INVESTIGACAO_KEYWORDS.some(k => title.toLowerCase().includes(k))) { severity = "high"; caption = "Alvo de investigação oficial."; }
        else { severity = "medium"; caption = "Citação em contexto público."; }

        scandals.push({ politician_id: politicianId, title, news_url: link, severity, caption, is_positive: false, date_occurrence: new Date(dateStr).toISOString().split('T')[0] })
      }
    }

    // 3. PROJETOS
    const qProj = `"${name}" (Projeto de Lei OR PL) site:camara.leg.br OR site:senado.leg.br`
    const resProj = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(qProj)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`)
    if (resProj.ok) {
      const items = (await resProj.text()).match(/<item>([\s\S]*?)<\/item>/g) || []
      for (const item of items.slice(0, 10)) {
        const title = (item.match(/<title>([^<]*)<\/title>/)?.[1] || "").split(' - ')[0]
        const link = item.match(/<link>([^<]*)<\/link>/)?.[1] || ""
        projects.push({ politician_id: politicianId, title, news_url: link, is_positive: true, severity: "low", caption: "🏷️ PROJETO LOCALIZADO", date_occurrence: new Date().toISOString().split('T')[0] })
      }
    }

    const finalResult = [...scandals.filter(s => s.severity !== "ignore"), ...projects, ...votes];

    if (saveToDb && politicianId && finalResult.length > 0) {
      const { data: ext } = await db.from("scandals").select("news_url").eq("politician_id", politicianId)
      const links = new Set((ext || []).map((s: any) => s.news_url))
      const uni = finalResult.filter(s => !links.has(s.news_url))
      if (uni.length > 0) await db.from("scandals").insert(uni)
      log.push(`✓ Sincronizado: ${uni.length} novos registros.`);
    }

    return new Response(JSON.stringify({ scandals: finalResult, lawsuits, log }), { headers: { ...cors, "Content-Type": "application/json" } })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } })
  }
})
