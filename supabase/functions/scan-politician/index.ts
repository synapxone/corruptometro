/**
 * scan-politician — Supabase Edge Function
 *
 * V37: SEM LIMITES DE NOTÍCIAS + VOTOS ILIMITADOS (paginação completa Câmara)
 * - Categorias: CONDENAÇÃO (Regex), INVESTIGAÇÃO, MENÇÃO.
 * - Módulo VOTOS: via API da Câmara, todas as páginas.
 * - Módulo PROJETOS: via Google News.
 * - Módulo VÍDEOS: via YouTube (canais autoridade).
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const getCondenacaoRegex = (name: string) => {
  const parts = name.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  return new RegExp(`(${name}|${firstName}\\s+${lastName})\\s+(é|foi|será|está|vai|deve|é|preso|levado|recolhido)\\s+(preso|prisão|cela|cadeia|xadrez)`, "i");
}

const INVESTIGACAO_KEYWORDS = ["investigado", "indiciado", "réu", "acusado", "alvo de operação", "buscas", "inquérito", "citado", "delação", "pf", "ministério público", "mpf", "lava-jato", "lava jato", "operaçāo"]

async function getChamberId(name: string): Promise<number | null> {
  try {
    const res = await fetch(`https://dadosabertos.camara.leg.br/api/v2/deputados?nome=${encodeURIComponent(name)}&ordem=ASC&ordenarPor=nome`);
    const data = await res.json();
    return data.dados?.[0]?.id || null;
  } catch { return null; }
}

// Busca TODAS as votações do deputado paginando a API da Câmara (sem limite)
async function getAllVotes(chamberId: number, log: string[]): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  const PAGE_SIZE = 100;
  while (true) {
    try {
      const url = `https://dadosabertos.camara.leg.br/api/v2/deputados/${chamberId}/votacoes?ordem=DESC&ordenarPor=dataHoraRegistro&itens=${PAGE_SIZE}&pagina=${page}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) { log.push(`⚠ Câmara Votos HTTP ${res.status} (página ${page})`); break; }
      const data = await res.json();
      const batch: any[] = data.dados || [];
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break; // última página
      page++;
      if (page > 50) { log.push(`ℹ️ Limite de segurança atingido: 50 páginas de votos.`); break; } // proteção contra loop infinito
    } catch (e: any) {
      log.push(`⚠ Votos página ${page} falhou: ${e.message}`);
      break;
    }
  }
  log.push(`✓ Câmara Votos: ${all.length} votações encontradas (${page} página(s))`);
  return all;
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
    log.push(`[SCAN-V37] Varredura completa para: ${name}`)
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

    // 1. VOTOS — API da Câmara com paginação completa (deputados federais)
    const chamberId = await getChamberId(name);
    if (chamberId) {
      log.push(`✓ ID Câmara: ${chamberId}`);
      const rawVotes = await getAllVotes(chamberId, log);
      for (const v of rawVotes) {
        const dateStr = v.dataHoraRegistro?.split('T')[0] || new Date().toISOString().split('T')[0];
        votes.push({
          politician_id: politicianId,
          title: `VOTAÇÃO: ${v.proposicaoDescricao || 'Matéria Legislativa'}`,
          caption: `Voto: ${v.tipoVoto || 'Não Registrado'} — Data: ${dateStr}`,
          news_url: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${v.idVotacao?.split('-')[0]}&votoId=${v.idVotacao}`,
          is_positive: true,
          severity: "low",
          date_occurrence: dateStr,
        })
      }
    }

    // 1B. Fallback: votos via imprensa (Senadores, Governadores, etc.)
    if (votes.length === 0) {
      log.push(`ℹ️ Buscando votos reportados na imprensa...`);
      const qVotes = `"${name}" ("votou sim" OR "votou não" OR "votou a favor" OR "votou contra")`
      const resVotes = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(qVotes)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`)
      if (resVotes.ok) {
        const items = (await resVotes.text()).match(/<item>([\s\S]*?)<\/item>/g) || []
        for (const item of items) {
          const title = (item.match(/<title>([^<]*)<\/title>/)?.[1] || "").split(' - ')[0]
          const link = item.match(/<link>([^<]*)<\/link>/)?.[1] || ""
          const dateStr = item.match(/<pubDate>([^<]*)<\/pubDate>/)?.[1] || new Date().toISOString()
          const tLower = title.toLowerCase();

          let voteType = "NÃO IDENTIFICADO";
          if (tLower.includes("votou sim") || tLower.includes("votou a favor") || tLower.includes("vota sim") || tLower.includes("vota a favor")) voteType = "SIM";
          else if (tLower.includes("votou não") || tLower.includes("votou contra") || tLower.includes("vota não") || tLower.includes("vota contra") || tLower.includes("votou nao")) voteType = "NÃO";

          if (voteType !== "NÃO IDENTIFICADO") {
            votes.push({
              politician_id: politicianId,
              title: `VOTAÇÃO: ${title.length > 80 ? title.substring(0, 80) + '...' : title}`,
              caption: `Voto: ${voteType} — Data: ${new Date(dateStr).toISOString().split('T')[0]}`,
              news_url: link,
              is_positive: true,
              severity: "low",
              date_occurrence: new Date(dateStr).toISOString().split('T')[0],
            })
          }
        }
        log.push(`✓ Votos via imprensa: ${votes.length} encontrados`);
      }
    }

    // 2. NOTÍCIAS — sem limite de quantidade
    const qNews = `"${name}" (corrupção OR propina OR desvio OR prisão OR investigado OR "aumento de impostos" OR "lava-jato" OR imposto OR impostos)`
    const resNews = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(qNews)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`)
    if (resNews.ok) {
      const text = await resNews.text()
      const items = text.match(/<item>([\s\S]*?)<\/item>/g) || []
      const condenacaoRegex = getCondenacaoRegex(name);
      log.push(`ℹ️ Notícias encontradas no RSS: ${items.length}`);
      for (const item of items) { // sem slice — processa todos
        const title = (item.match(/<title>([^<]*)<\/title>/)?.[1] || "").split(' - ')[0]
        const link = item.match(/<link>([^<]*)<\/link>/)?.[1] || ""
        const dateStr = item.match(/<pubDate>([^<]*)<\/pubDate>/)?.[1] || new Date().toISOString()

        let severity: "critical" | "high" | "medium" | "ignore" = "ignore";
        let caption = "";

        if (condenacaoRegex.test(title)) { severity = "critical"; caption = "Prisão ou condenação direta."; }
        else if (INVESTIGACAO_KEYWORDS.some(k => title.toLowerCase().includes(k))) { severity = "high"; caption = "Alvo de investigação oficial."; }
        else { severity = "medium"; caption = "Citação em imprensa / Mídia."; }

        scandals.push({ politician_id: politicianId, title, news_url: link, severity, caption, is_positive: false, date_occurrence: new Date(dateStr).toISOString().split('T')[0] })
      }
    }

    // 3. YOUTUBE VIDEOS (Apenas Portais Autoridade: G1, GloboNews, Jovem Pan, SBT)
    const qYt = `"${name}" (corrupção OR desvio OR investigado OR "lava-jato" OR propina) youtube ("g1" OR "globonews" OR "jovem pan" OR "jovempan" OR "sbt" OR "sbt news")`
    const resYt = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(qYt)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`)
    if (resYt.ok) {
      const items = (await resYt.text()).match(/<item>([\s\S]*?)<\/item>/g) || []
      for (const item of items.slice(0, 20)) { // YT mantém limite pois é complemento
        const title = (item.match(/<title>([^<]*)<\/title>/)?.[1] || "").split(' - ')[0]
        const link = item.match(/<link>([^<]*)<\/link>/)?.[1] || ""
        const dateStr = item.match(/<pubDate>([^<]*)<\/pubDate>/)?.[1] || new Date().toISOString()
        scandals.push({ politician_id: politicianId, title, news_url: link, is_positive: false, severity: "medium", caption: "📹 Vídeo Localizado no YouTube", date_occurrence: new Date(dateStr).toISOString().split('T')[0] })
      }
    }

    // 4. PROJETOS
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

    const rawFinal = [...scandals.filter(s => s.severity !== "ignore"), ...projects, ...votes];

    // Deduplicação interna (mesmo scan)
    const uniqueMap = new Map();
    rawFinal.forEach(s => uniqueMap.set(s.news_url, s));
    const finalResult = Array.from(uniqueMap.values());

    log.push(`ℹ️ Total após deduplicação: ${finalResult.length} registros (${votes.length} votos, ${scandals.filter(s => s.severity !== "ignore").length} notícias, ${projects.length} projetos)`);

    if (saveToDb && politicianId) {
      // Atualiza score baseado na qtd de negativos
      const negativeRecords = finalResult.filter(s => !s.is_positive).length;
      let pScore = 100;
      if (negativeRecords <= 5) pScore = 100 - (negativeRecords * 5);
      else if (negativeRecords <= 15) pScore = Math.max(50, 75 - ((negativeRecords - 5) * 2.5));
      else if (negativeRecords <= 25) pScore = Math.max(25, 50 - ((negativeRecords - 15) * 2.5));
      else pScore = Math.max(0, 25 - ((negativeRecords - 25)));
      pScore = Math.round(pScore);

      let status = 'safe';
      if (pScore < 25) status = 'critical';
      else if (pScore < 50) status = 'danger';
      else if (pScore < 75) status = 'warning';

      await db.from('politicians').update({ score: pScore, status }).eq('id', politicianId);

      if (finalResult.length > 0) {
        const { data: ext } = await db.from("scandals").select("news_url").eq("politician_id", politicianId)
        const links = new Set((ext || []).map((s: any) => s.news_url))
        const uni = finalResult.filter((s: any) => !links.has(s.news_url))
        if (uni.length > 0) await db.from("scandals").insert(uni)
        log.push(`✓ Sincronizado: ${uni.length} novos registros. | Placar Recalculado: ${pScore}/100.`);
      }
    }

    return new Response(JSON.stringify({ scandals: finalResult, lawsuits, log }), { headers: { ...cors, "Content-Type": "application/json" } })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } })
  }
})
