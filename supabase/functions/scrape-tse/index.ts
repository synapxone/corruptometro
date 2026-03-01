import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CARGO_ROLE_MAP: Record<string, string> = {
  '1': 'Presidente',
  '3': 'Governador',
  '5': 'Senador',
  '6': 'Deputado Federal',
  '7': 'Deputado Estadual',
}

interface Candidate {
  name: string
  candidate_number: string
  party: string
  role: string
  state: string
  photo_url: string | null
  score: number
  status: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCandidate(c: any, cargo: string, state: string): Candidate {
  return {
    name: (c.NM_CANDIDATO || c.nmCandidato || c.nome || '').trim().toUpperCase(),
    candidate_number: String(c.NR_CANDIDATO || c.nrCandidato || c.numero || ''),
    party: (c.SG_PARTIDO || c.sgPartido || c.siglaPartido || '').toUpperCase(),
    role: CARGO_ROLE_MAP[cargo] || 'Outro',
    state: (c.SG_UF || c.sgUF || state || '').toUpperCase(),
    photo_url: c.foto || c.urlFoto || null,
    score: 50,
    status: 'warning',
  }
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const log: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let candidates: any[] = []

  try {
    const { year, state, cargo } = await req.json()

    log.push(`Iniciando raspagem: cargo=${cargo} estado=${state || 'BR'} ano=${year}`)

    // ── Tentativa 1: TSE Candidaturas API ──────────────────────────────────
    try {
      const url = [
        'https://candidaturas.tse.jus.br/oficialApp/rest/candidatura/listarCandidatosByUF',
        `?sgUE=${year}&sgUF=${state || 'BR'}&cdCargo=${cargo}`,
        `&indFiltroCertidaoCrime=N&sgPartido=&nrCandidato=&nmCandidato=&nrCPF=`,
      ].join('')

      log.push(`TSE Candidaturas → ${url.slice(0, 90)}...`)

      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; CorruptometroBot/1.0)',
        },
        signal: AbortSignal.timeout(12000),
      })

      if (res.ok) {
        const data = await res.json()
        const list = Array.isArray(data) ? data : (data.candidatos || data.data || [])
        candidates = list
        log.push(`✓ TSE Candidaturas: ${candidates.length} candidatos encontrados`)
      } else {
        log.push(`TSE Candidaturas: HTTP ${res.status} ${res.statusText}`)
      }
    } catch (e) {
      log.push(`TSE Candidaturas falhou: ${(e as Error).message}`)
    }

    // ── Tentativa 2: TSE Dados Abertos (CKAN) ─────────────────────────────
    if (candidates.length === 0) {
      try {
        const url = `https://dadosabertos.tse.jus.br/api/3/action/datastore_search?resource_id=consulta_cand_${year}&limit=100&q=${state || ''}&filters={"CD_CARGO":"${cargo}"}`
        log.push(`TSE CKAN → ${url.slice(0, 90)}...`)

        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CorruptometroBot/1.0)' },
          signal: AbortSignal.timeout(12000),
        })

        if (res.ok) {
          const data = await res.json()
          candidates = data.result?.records || []
          log.push(`✓ TSE CKAN: ${candidates.length} registros`)
        } else {
          log.push(`TSE CKAN: HTTP ${res.status}`)
        }
      } catch (e) {
        log.push(`TSE CKAN falhou: ${(e as Error).message}`)
      }
    }

    // ── STF: verificar acessibilidade e buscar condenações ─────────────────
    let stfAccessible = false
    try {
      log.push('STF → verificando jurisprudência pública...')
      const stfUrl = `https://jurisprudencia.stf.jus.br/api/pesquisa/facets?query=acao+penal+candidato+${state || ''}&classeProcessual=AP&limit=5`
      const stfRes = await fetch(stfUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CorruptometroBot/1.0)' },
        signal: AbortSignal.timeout(8000),
      })
      stfAccessible = stfRes.ok
      log.push(stfAccessible ? '✓ STF acessível — cruzamento disponível' : `STF: HTTP ${stfRes.status}`)
    } catch (e) {
      log.push(`STF: ${(e as Error).message}`)
    }

    // ── Mapeamento final ───────────────────────────────────────────────────
    const mapped: Candidate[] = candidates
      .slice(0, 200)
      .map((c) => mapCandidate(c, cargo, state || ''))
      .filter((c) => c.name.length > 0)

    log.push(`✓ ${mapped.length} candidatos prontos para importação`)

    return new Response(
      JSON.stringify({ candidates: mapped, log, stfAccessible }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    log.push(`Erro geral: ${(err as Error).message}`)
    return new Response(
      JSON.stringify({ candidates: [], log, stfAccessible: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
