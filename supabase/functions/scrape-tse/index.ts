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

// ── Estratégia 1: API da Câmara dos Deputados (cargo 6) ──────────────────────
async function fetchFromCamara(state: string, log: string[]): Promise<Candidate[]> {
  const result: Candidate[] = []
  try {
    let page = 1
    while (true) {
      const params = new URLSearchParams({
        siglaUf: state, itens: '100', pagina: String(page),
        ordem: 'ASC', ordenarPor: 'nome',
      })
      const url = `https://dadosabertos.camara.leg.br/api/v2/deputados?${params}`
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) { log.push(`Câmara HTTP ${res.status}`); break }
      const data = await res.json()
      const batch: any[] = data.dados || []
      for (const d of batch) {
        const name = (d.nome || '').trim().toUpperCase()
        if (!name) continue
        result.push({
          name,
          candidate_number: '',
          party: (d.siglaPartido || '').toUpperCase(),
          role: 'Deputado Federal',
          state: (d.siglaUf || state).toUpperCase(),
          photo_url: d.urlFoto || null,
          score: 50,
          status: 'warning',
        })
      }
      if (batch.length < 100) break
      page++
      if (page > 10) break
    }
    log.push(`✓ Câmara: ${result.length} deputados federais de ${state}`)
  } catch (e) {
    log.push(`Câmara falhou: ${(e as Error).message}`)
  }
  return result
}

// ── Estratégia 2: API do Senado Federal (cargo 5) ────────────────────────────
async function fetchFromSenado(state: string, log: string[]): Promise<Candidate[]> {
  try {
    const res = await fetch('https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) { log.push(`Senado HTTP ${res.status}`); return [] }
    const data = await res.json()
    const all: any[] = data.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar || []
    const filtered = state ? all.filter((s: any) =>
      s.IdentificacaoParlamentar?.UfParlamentar === state
    ) : all
    log.push(`✓ Senado: ${filtered.length} senadores de ${state || 'BR'}`)
    return filtered.map((s: any) => ({
      name: (s.IdentificacaoParlamentar?.NomeParlamentar || '').trim().toUpperCase(),
      candidate_number: '',
      party: (s.IdentificacaoParlamentar?.SiglaPartidoParlamentar || '').toUpperCase(),
      role: 'Senador',
      state: (s.IdentificacaoParlamentar?.UfParlamentar || state).toUpperCase(),
      photo_url: s.IdentificacaoParlamentar?.UrlFotoParlamentar || null,
      score: 50,
      status: 'warning',
    }))
  } catch (e) {
    log.push(`Senado falhou: ${(e as Error).message}`)
    return []
  }
}

// Códigos de eleição conhecidos do TSE (extraídos das URLs de resultado)
// Eleições gerais (Presidente, Governador, Senador, Dep. Federal, Dep. Estadual): 2022=544, 2018=376
// Eleições municipais (Prefeito, Vereador): 2024=619, 2020=548
const ELECTION_CODES: Record<string, string> = {
  '2022': '544', // Eleição geral federal + estadual
  '2018': '376',
  '2026': '',    // Ainda não disponível
  '2024': '619', // Eleição municipal — SEM dep. estadual/federal
  '2020': '548',
}

// ── Estratégia 3: TSE DivulgaCand (cargos 1, 3, 7) ──────────────────────────
async function fetchFromTSE(year: string, state: string, cargo: string, log: string[]): Promise<Candidate[]> {
  const role = CARGO_ROLE_MAP[cargo] || 'Outro'
  const uf = cargo === '1' ? 'BR' : state

  // Validação: Dep. Estadual e cargos gerais não existem em eleições municipais (2024, 2020)
  const isMunicipalYear = year === '2024' || year === '2020'
  if (isMunicipalYear && ['3', '5', '6', '7'].includes(cargo)) {
    log.push(`⚠ ${role} não é eleito em ${year} (eleição municipal). Use 2022 ou 2018.`)
    return []
  }

  // Passo 1: descobrir o código da eleição
  let codigoEleicao = ELECTION_CODES[year] || ''

  if (!codigoEleicao) {
    // Tenta descobrir dinamicamente via TSE
    const endpoints = [
      `https://divulgacandcontas.tse.jus.br/divulga/rest/v1/eleicao/listar?ano=${year}`,
      `https://divulgacandcontas.tse.jus.br/divulga/rest/v1/eleicao/listar/${year}`,
    ]
    for (const elecUrl of endpoints) {
      try {
        log.push(`TSE Eleições → ${elecUrl}`)
        const elecRes = await fetch(elecUrl, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        })
        if (elecRes.ok) {
          const elecData = await elecRes.json()
          const eleicoes: any[] = elecData.eleicoes || elecData || []
          for (const e of eleicoes) {
            const sgUf = (e.sgUFEleicao || '').toUpperCase()
            if (cargo === '1' && (sgUf === 'BR' || sgUf === '')) {
              codigoEleicao = String(e.cdEleicao || e.codigo || '')
              break
            } else if (cargo !== '1' && (sgUf === uf.toUpperCase() || sgUf === 'BR')) {
              codigoEleicao = String(e.cdEleicao || e.codigo || '')
              break
            }
          }
          if (!codigoEleicao && eleicoes.length > 0) {
            codigoEleicao = String(eleicoes[0].cdEleicao || eleicoes[0].codigo || '')
          }
          if (codigoEleicao) break
        } else {
          log.push(`TSE Eleições HTTP ${elecRes.status}`)
        }
      } catch (e) {
        log.push(`TSE Eleições falhou: ${(e as Error).message}`)
      }
    }
  }

  if (!codigoEleicao) {
    log.push(`Código da eleição não encontrado para ${year}. Tente o ano 2022 para cargos estaduais.`)
    return []
  }

  log.push(`Código da eleição: ${codigoEleicao}`)

  // Passo 2: buscar candidatos
  try {
    const candUrl = `https://divulgacandcontas.tse.jus.br/divulga/rest/v1/candidatura/listar/${year}/${uf}/${codigoEleicao}/${cargo}/candidatos`
    log.push(`TSE Candidatos → ${candUrl}`)
    const candRes = await fetch(candUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!candRes.ok) { log.push(`TSE Candidatos HTTP ${candRes.status}`); return [] }
    const candData = await candRes.json()
    const lista: any[] = candData.candidatos || candData.dados || candData || []
    log.push(`✓ TSE DivulgaCand: ${lista.length} candidatos para ${role} / ${uf}`)
    return lista
      .map((c: any) => ({
        name: (c.nomeUrna || c.nomeCompleto || c.nome || '').trim().toUpperCase(),
        candidate_number: String(c.numero || c.numeroUrna || ''),
        party: (c.partido?.sigla || c.siglaPartido || '').toUpperCase(),
        role,
        state: uf.toUpperCase(),
        photo_url: c.id ? `https://divulgacandcontas.tse.jus.br/divulga/rest/v1/candidatura/buscar/foto/2/${c.id}/${codigoEleicao}` : null,
        score: 50,
        status: 'warning',
      }))
      .filter((c: Candidate) => c.name.length > 0)
  } catch (e) {
    log.push(`TSE Candidatos falhou: ${(e as Error).message}`)
    return []
  }
}

// ── Serve ────────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const log: string[] = []

  try {
    const { year, state, cargo } = await req.json()
    log.push(`Iniciando: ${CARGO_ROLE_MAP[cargo] || cargo} / ${state || 'BR'} / ${year}`)

    let candidates: Candidate[] = []

    if (cargo === '6') {
      // Deputado Federal → API da Câmara dos Deputados (confiável)
      candidates = await fetchFromCamara(state, log)
    } else if (cargo === '5') {
      // Senador → API do Senado Federal (confiável)
      candidates = await fetchFromSenado(state, log)
    } else {
      // Presidente / Governador / Deputado Estadual → TSE DivulgaCand
      candidates = await fetchFromTSE(year, state, cargo, log)
    }

    const final = candidates.slice(0, 200)
    log.push(`✓ ${final.length} candidatos prontos para importação`)

    return new Response(
      JSON.stringify({ candidates: final, log }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    log.push(`Erro geral: ${(err as Error).message}`)
    return new Response(
      JSON.stringify({ candidates: [], log, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
