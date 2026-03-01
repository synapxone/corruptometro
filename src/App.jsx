import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, ShieldAlert, CheckCircle,
  ExternalLink, X, User, Loader2,
  Trophy, Share2, ZoomIn, Menu
} from 'lucide-react'
import { supabase } from './supabase'
import { toPng } from 'html-to-image'
import Admin from './Admin'

const BRAZIL_STATES = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

const roleLengths = { presidente: 2, governador: 2, senador1: 3, senador2: 3, depFederal: 4, depEstadual: 5 }
const roleLabels = {
  presidente: 'Presidente', governador: 'Governador', senador1: 'Senador 1', senador2: 'Senador 2', depFederal: 'Deputado Federal', depEstadual: 'Deputado Estadual'
}

// Helper para burlar bloqueio de imagem (CORS/Hotlink) de sites do governo
const proxyImage = (url) => {
  if (!url) return null
  if (url.includes('wsrv.nl') || url.includes('supabase.co') || url.includes('divulgacandcontas.tse.jus.br')) return url
  try {
    // Normaliza para evitar double-encoding (ex: %25C3%25A1 em vez de %C3%A1)
    const normalized = decodeURIComponent(url)
    return `https://wsrv.nl/?url=${encodeURIComponent(normalized)}`
  } catch (e) {
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}`
  }
}

export default function App() {
  const [selectedPolitician, setSelectedPolitician] = useState(null)
  const [scandals, setScandals] = useState([])
  const [lawsuits, setLawsuits] = useState([])
  const [loadingScandals, setLoadingScandals] = useState(false)

  const [searchingRole, setSearchingRole] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [filterState, setFilterState] = useState('')
  const [activeTab, setActiveTab] = useState('lawsuits')
  const [showSidebar, setShowSidebar] = useState(false)

  // Persistence: Load from localStorage or defaults
  const [inputs, setInputs] = useState(() => {
    const saved = localStorage.getItem('corruptometro_inputs')
    return saved ? JSON.parse(saved) : {
      presidente: '', governador: '', senador1: '', senador2: '', depFederal: '', depEstadual: ''
    }
  })
  const [colinha, setColinha] = useState(() => {
    const saved = localStorage.getItem('corruptometro_colinha')
    return saved ? JSON.parse(saved) : {
      presidente: null, governador: null, senador1: null, senador2: null, depFederal: null, depEstadual: null
    }
  })

  useEffect(() => {
    if (selectedPolitician && !loadingScandals) {
      if (lawsuits.length > 0) setActiveTab('lawsuits')
      else if (scandals.some(s => s.is_positive && !s.title.includes('VOTAÇÃO:'))) setActiveTab('projects')
      else if (scandals.some(s => s.is_positive && s.title.includes('VOTAÇÃO:'))) setActiveTab('votes')
      else setActiveTab('noticias')
    }
  }, [selectedPolitician, loadingScandals, lawsuits.length, scandals.length])

  // Persistence: Save to localStorage on change
  useEffect(() => {
    localStorage.setItem('corruptometro_inputs', JSON.stringify(inputs))
  }, [inputs])
  useEffect(() => {
    localStorage.setItem('corruptometro_colinha', JSON.stringify(colinha))
  }, [colinha])

  // Track user session with persistence
  useRef(() => {
    let id = localStorage.getItem('corruptometro_session_id')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('corruptometro_session_id', id)
    }
    return id
  })

  const colinhaRef = useRef(null)
  const [showAdmin, setShowAdmin] = useState(false)
  const adminClicksRef = useRef(0)
  const adminTimerRef = useRef(null)

  const handleLogoClick = () => {
    adminClicksRef.current += 1
    clearTimeout(adminTimerRef.current)
    if (adminClicksRef.current >= 5) {
      adminClicksRef.current = 0
      setShowAdmin(true)
    } else {
      adminTimerRef.current = setTimeout(() => { adminClicksRef.current = 0 }, 2000)
    }
  }

  const fetchPoliticianByNumber = async (role, number) => {
    if (!number || number.length < 2) {
      setColinha(prev => ({ ...prev, [role]: null }))
      return
    }

    let query = supabase
      .from('politicians')
      .select('*')
      .eq('candidate_number', number)
      .eq('role', roleLabels[role].replace(/\s\d$/, ''))

    // Filtro de estado para cargos não nacionais
    if (role !== 'presidente' && filterState) {
      query = query.eq('state', filterState)
    }

    const { data } = await query.maybeSingle()

    if (data) setColinha(prev => ({ ...prev, [role]: data }))
    else setColinha(prev => ({ ...prev, [role]: null }))
  }

  const handleInputChange = (role, value) => {
    const numValue = value.replace(/\D/g, '')
    setInputs(prev => ({ ...prev, [role]: numValue }))
    if (numValue.length === roleLengths[role]) fetchPoliticianByNumber(role, numValue)
    else setColinha(prev => ({ ...prev, [role]: null }))
  }

  const selectPoliticianFromSearch = (p) => {
    const role = searchingRole;
    if (!role) return;

    setColinha(prev => ({ ...prev, [role]: p }))
    setInputs(prev => ({ ...prev, [role]: String(p.candidate_number || '') }))
    setSearchingRole(null)
    setSearchQuery('')
    setFilterState('')
    setSearchResults([])
  }

  const removePolitician = (role) => {
    setColinha(prev => ({ ...prev, [role]: null }))
    setInputs(prev => ({ ...prev, [role]: '' }))
  }

  const searchPoliticians = useCallback(async () => {
    if (!searchingRole) return
    setIsSearching(true)
    let dbRole = roleLabels[searchingRole].replace(/\s\d$/, '')
    let query = supabase.from('politicians').select('*').ilike('role', dbRole)
    if (searchQuery) query = query.ilike('name', `%${searchQuery}%`)
    if (filterState && searchingRole !== 'presidente') query = query.eq('state', filterState)
    const { data, error } = await query.limit(50)
    if (error) console.error('[searchPoliticians] Supabase error:', error)
    console.log(`[searchPoliticians] role="${dbRole}" → ${data?.length ?? 'null'} resultados`)
    setSearchResults(data || [])
    setIsSearching(false)
  }, [searchingRole, searchQuery, filterState])

  useEffect(() => {
    const timer = setTimeout(() => { if (searchingRole) searchPoliticians(); }, 400)
    return () => clearTimeout(timer)
  }, [searchQuery, filterState, searchingRole, searchPoliticians])

  useEffect(() => {
    if (!selectedPolitician) return

    const fetchData = async () => {
      setLoadingScandals(true)
      setScandals([])
      setLawsuits([])

      const { data: scans } = await supabase
        .from('scandals')
        .select('*')
        .eq('politician_id', selectedPolitician.id)
        .order('date_occurrence', { ascending: false })

      const { data: laws } = await supabase
        .from('lawsuits')
        .select('*')
        .eq('politician_id', selectedPolitician.id)
        .order('date_judgment', { ascending: false })

      if (scans) setScandals(scans)
      if (laws) setLawsuits(laws)

      console.log(`Loaded ${scans?.length || 0} scandals and ${laws?.length || 0} lawsuits for ${selectedPolitician.name}`)

      setLoadingScandals(false)
    }
    fetchData()
  }, [selectedPolitician])

  const stats = (() => {
    const politicians = Object.values(colinha).filter(p => p !== null)
    if (politicians.length === 0) return null
    const avg = Math.round(politicians.reduce((acc, p) => acc + (p.score || 50), 0) / politicians.length)
    return { score: avg, status: avg < 40 ? 'danger' : avg < 75 ? 'warning' : 'safe' }
  })()

  const positionsFilled = Object.values(colinha).filter(p => p !== null).length
  const totalPositions = Object.keys(colinha).length
  const progress = (positionsFilled / totalPositions) * 100

  const handleShare = async () => {
    if (!colinhaRef.current) return
    try {
      const dataUrl = await toPng(colinhaRef.current, {
        cacheBust: true,
        backgroundColor: '#030609',
        style: { borderRadius: '0' }
      })
      const link = document.createElement('a')
      link.download = 'minha-colinha-brasilx.png'
      link.href = dataUrl
      link.click()
    } catch (err) {
      console.error('Erro ao gerar imagem:', err)
    }
  }

  const getStatusColor = (score) => {
    if (score >= 75) return 'text-emerald-400'
    if (score >= 40) return 'text-amber-400'
    return 'text-rose-500'
  }

  const getStatusBg = (score) => {
    if (score >= 75) return 'bg-emerald-400'
    if (score >= 40) return 'bg-amber-400'
    return 'bg-rose-500'
  }

  return (
    <div className="premium-bg min-h-screen pb-48 text-slate-200 overflow-x-hidden" style={{ backgroundColor: '#030609' }}>

      {/* BRANDING & NAV */}
      <nav className="p-4 sm:p-6 flex items-center justify-between bg-black/80 border-b border-white/5 backdrop-blur-xl sticky top-0 z-50">
        <button onClick={() => setShowSidebar(true)} className="text-slate-400 hover:text-white transition-colors cursor-pointer p-1">
          <Menu size={24} />
        </button>
        <div className="flex items-center gap-3 cursor-pointer select-none group" onClick={handleLogoClick}>
          <div className="relative">
            <Trophy className="text-indigo-500 group-hover:scale-110 transition-transform" size={24} />
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-rose-500 rounded-full animate-ping" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-white italic tracking-tighter group-hover:text-indigo-400 transition-colors">CORRUPTÔMETRO</h1>
          <div className="px-1.5 py-0.5 rounded-[4px] bg-rose-500/10 border border-rose-500/20 text-[7px] font-black text-rose-500 uppercase tracking-widest hidden sm:block">LIVE</div>
        </div>
        <div className="w-6" /> {/* Placeholder helper */}
      </nav>

      {/* SIDEBAR OVERLAY */}
      {showSidebar && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm" onClick={() => setShowSidebar(false)}>
          <div className="fixed top-0 left-0 bottom-0 w-64 bg-[#0a0d10] border-r border-white/5 flex flex-col animate-in slide-in-from-left duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-white/5 mb-4">
              <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2"><Menu size={16} /> Menu</h2>
              <button onClick={() => setShowSidebar(false)} className="text-slate-500 hover:text-white p-1">
                <X size={20} />
              </button>
            </div>
            <div className="flex flex-col gap-2 px-4">
              <button onClick={() => { setShowAdmin(true); setShowSidebar(false); }} className="text-left p-3 rounded-[6px] text-xs font-black text-slate-400 hover:bg-white/5 hover:text-indigo-400 uppercase tracking-widest flex items-center gap-3 transition-colors">
                <ShieldAlert size={16} /> Área Admin
              </button>
              <a href="https://github.com/synapxone/corruptometro" target="_blank" rel="noopener noreferrer" className="p-3 rounded-[6px] text-xs font-black text-slate-400 hover:bg-white/5 hover:text-indigo-400 uppercase tracking-widest flex items-center gap-3 transition-colors">
                <ExternalLink size={16} /> GitHub do Projeto
              </a>
            </div>

            <div className="mt-auto p-6 text-[10px] font-bold text-slate-600 uppercase tracking-widest border-t border-white/5">
              Corruptômetro © {new Date().getFullYear()}
            </div>
          </div>
        </div>
      )}

      <main className="max-w-xl mx-auto px-4 py-8 space-y-12">

        {/* DASHBOARD */}
        <section className="animate-in fade-in slide-in-from-top-4 duration-700">
          {stats ? (
            <div className="flex flex-col items-center space-y-6">
              <div className="p-4 sm:p-8 glass-surface rounded-[6px] shadow-2xl flex items-center border border-white/10 bg-black/40 w-full justify-center relative overflow-hidden">
                {/* Decorative background glow */}
                <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 blur-[60px] opacity-20 ${getStatusBg(stats.score)}`} />

                <div className="flex items-center gap-4 sm:gap-10 relative z-10">
                  {/* Vertical Thermometer (Improved) */}
                  <div className="w-4 sm:w-5 h-28 sm:h-36 bg-black/60 rounded-full overflow-hidden border border-white/10 relative flex flex-col justify-end p-[1px]">
                    <div
                      className={`w-full rounded-full transition-all duration-1000 liquid-wave ${getStatusBg(stats.score)} shadow-[0_0_20px_rgba(255,255,255,0.1)]`}
                      style={{ height: `${stats.score}%` }}
                    />
                  </div>

                  <span className={`text-6xl sm:text-9xl font-black leading-none ${getStatusColor(stats.score)} font-mono tracking-tighter ${stats.status === 'safe' ? 'glow-safe' : stats.status === 'warning' ? 'glow-warning' : 'glow-danger'}`}>
                    {stats.score}
                  </span>

                  <div className="text-left py-2 border-l border-white/10 pl-4 sm:pl-10">
                    <span className={`text-xl sm:text-3xl font-black uppercase block tracking-tighter ${getStatusColor(stats.score)}`}>
                      {stats.status === 'safe' ? 'CONFIÁVEL' : stats.status === 'warning' ? 'ATENÇÃO' : 'ALERTA'}
                    </span>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mt-1">RAIO-X DA URNA</p>
                  </div>
                </div>
              </div>

              <div className="bg-rose-500/10 border border-rose-500/20 p-5 rounded-[6px] text-center w-full shadow-lg">
                <p className="text-xs font-black text-rose-500 uppercase tracking-widest flex items-center justify-center gap-3">
                  <ShieldAlert size={16} /> Vote com Consciência: O Futuro está em suas mãos.
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 px-4 animate-in zoom-in duration-1000">
              <div className="inline-block p-1 px-3 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[9px] font-black uppercase tracking-[0.3em] text-indigo-400 mb-6">Eleições 2026</div>
              <h2 className="text-5xl sm:text-7xl font-black text-white leading-[0.9] tracking-tighter mb-6">RAIO-X <br /><span className="text-indigo-500 italic">DA URNA.</span></h2>
              <p className="text-slate-500 text-sm font-medium max-w-xs mx-auto leading-relaxed">Analise antecedentes, escândalos e processos judiciais em tempo real.</p>
            </div>
          )}
        </section>

        {/* SHARE BUTTON ABOVE COLINHA */}
        {positionsFilled === totalPositions && (
          <div className="flex justify-center -mb-8 relative z-10 animate-in fade-in zoom-in duration-500">
            <button
              onClick={handleShare}
              className="px-8 py-4 flex items-center gap-3 btn-premium text-white rounded-[6px] font-black uppercase tracking-widest text-xs shadow-2xl active:scale-[0.98]"
            >
              <Share2 size={16} /> Compartilhar p/ Instagram
            </button>
          </div>
        )}

        {/* INPUTS GRID (Capturable Container) */}
        <div ref={colinhaRef} className="space-y-10">
          {Object.entries({ Executivo: ["presidente", "governador"], Legislativo: ["senador1", "senador2", "depFederal", "depEstadual"] }).map(([label, keys]) => (
            <div key={label} className="space-y-4">
              <header className="flex items-center gap-3 px-1 uppercase text-[10px] font-black tracking-[0.4em] text-indigo-500/50">
                <span>{label}</span>
                <div className="h-[1px] flex-1 bg-white/5"></div>
              </header>
              <div className="grid gap-3">
                {keys.map(key => {
                  const p = colinha[key]
                  const maxLength = roleLengths[key]
                  return (
                    <div key={key} className="glass-surface p-4 rounded-[6px] border border-white/10 shadow-lg space-y-4 bg-black/30 hover:bg-black/40 transition-all poll-card">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{roleLabels[key]}</span>
                        <div className="flex gap-1">
                          {p && (
                            <button
                              onClick={() => setSelectedPolitician(p)}
                              className="flex items-center gap-1.5 px-2 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-[4px] border border-indigo-500/10 transition-all group-hover:scale-105"
                            >
                              <span className="text-[8px] font-black uppercase tracking-widest whitespace-nowrap">Ver Dossiê</span>
                              <ZoomIn size={12} />
                            </button>
                          )}
                          <button onClick={() => { setSearchingRole(key); setSearchQuery(''); setFilterState(''); setSearchResults([]); }} className="text-slate-500 hover:text-white p-2 hover:bg-white/5 rounded-[6px] transition-all"><Search size={16} /></button>
                        </div>
                      </div>
                      <div className="flex gap-2 items-center overflow-hidden">
                        <input
                          style={{ backgroundColor: '#000000', color: '#ffffff', border: '1px solid rgba(255,255,255,0.05)' }}
                          className="w-14 sm:w-20 h-14 sm:h-16 shrink-0 rounded-[6px] text-2xl sm:text-3xl font-black text-center focus:border-indigo-500 outline-none transition-all placeholder:text-slate-900 shadow-inner"
                          maxLength={maxLength} value={inputs[key]} onChange={(e) => handleInputChange(key, e.target.value)}
                          placeholder={"0".repeat(maxLength)}
                        />
                        <div className="flex-1 min-w-0 min-h-[4rem] flex items-center overflow-hidden">
                          {p ? (
                            <div className="flex items-center w-full gap-2 bg-black/60 border border-white/5 rounded-[6px] p-2 shadow-xl overflow-hidden relative">
                              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-[4px] overflow-hidden bg-slate-900 shrink-0 border border-white/10 relative">
                                {p.photo_url && (
                                  <img
                                    src={proxyImage(p.photo_url)}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover absolute inset-0 transition-opacity duration-300"
                                    onError={e => {
                                      if (!e.target.dataset.retried) {
                                        e.target.dataset.retried = 'true';
                                        e.target.src = p.photo_url; // tenta carregar a imagem real direto
                                      } else {
                                        e.target.style.display = 'none';
                                        const fallback = e.currentTarget.parentElement.querySelector('.fallback-icon');
                                        if (fallback) fallback.style.display = 'block';
                                      }
                                    }}
                                  />
                                )}
                                <User className="w-full h-full p-2 text-slate-800 absolute inset-0 fallback-icon" style={{ display: p.photo_url ? 'none' : 'block' }} />
                              </div>
                              <div className="flex-1 min-w-0 overflow-hidden">
                                <button
                                  onClick={() => setSelectedPolitician(p)}
                                  className="text-[11px] font-black text-white hover:text-indigo-400 hover:underline truncate uppercase tracking-tight mb-0.5 text-left w-full cursor-pointer"
                                >
                                  {p.name}
                                </button>
                                <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                                  <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider truncate min-w-0">{p.party}{p.state && ` • ${p.state}`}</div>
                                  <div className="flex-1 h-1 bg-black/40 rounded-full overflow-hidden border border-white/5 shrink-0 w-8">
                                    <div className={`h-full ${getStatusBg(p.score)} transition-all duration-1000`} style={{ width: `${p.score}%` }} />
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-0 shrink-0">
                                <span className={`text-lg font-black ${getStatusColor(p.score)} font-mono leading-none mb-1`}>{p.score}</span>
                                <button
                                  onClick={() => removePolitician(key)}
                                  className="p-1 hover:bg-rose-500/10 rounded-full text-rose-500/40 hover:text-rose-500 transition-colors"
                                >
                                  <X size={10} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center w-full h-14 border-2 border-dashed border-white/5 rounded-[6px] px-4 text-slate-800 text-[10px] font-black uppercase tracking-widest opacity-30">
                              PESQUISAR...
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {/* Credits in share image */}
          <div className="text-center pt-8 pb-4 opacity-30">
            <p className="text-[9px] font-black uppercase tracking-[0.4em]">WWW.CORRUPTOMETRO.COM.BR</p>
          </div>
        </div>
      </main>

      {/* FOOTER (Sutler) */}
      <footer className="fixed bottom-0 inset-x-0 p-6 z-[60] pointer-events-none">
        <div className="max-w-xl mx-auto glass-surface p-4 rounded-[6px] shadow-2xl border border-white/10 pointer-events-auto flex items-center justify-between gap-6 backdrop-blur-3xl bg-black/80">
          <div className="flex-1">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[9px] font-black text-white uppercase tracking-widest">PROGRESSO DA COLINHA</span>
              <span className="text-xs font-black text-indigo-400 font-mono">{positionsFilled}/{totalPositions}</span>
            </div>
            <div className="h-2 bg-black rounded-full overflow-hidden border border-white/5 p-0.5">
              <div className="h-full bg-indigo-500 rounded-full transition-all duration-1000" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        </div>
      </footer>

      {/* MODAL SEARCH */}
      {searchingRole && (
        <div className="fixed inset-0 z-[120] flex flex-col bg-black/98 backdrop-blur-md animate-in fade-in duration-300">
          <div className="max-w-xl mx-auto w-full flex-1 flex flex-col p-6 overflow-hidden">
            <header className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-2xl font-black text-white tracking-tighter uppercase">Buscar {roleLabels[searchingRole]}</h2>
                <div className="h-1 w-12 bg-indigo-500 mt-1"></div>
              </div>
              <button onClick={() => { setSearchingRole(null); setSearchQuery(''); setFilterState(''); setSearchResults([]); }} className="p-3 bg-white/5 hover:bg-rose-500 hover:text-white text-slate-400 rounded-[6px] transition-all"><X size={20} /></button>
            </header>
            <div className="space-y-4 mb-8">
              <div className="relative group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-700" size={18} />
                <input autoFocus style={{ backgroundColor: '#000000', color: '#fff' }} className="w-full p-4 pl-12 rounded-[6px] border border-white/10 text-white text-lg outline-none focus:border-indigo-500 transition-all" placeholder="Nome do candidato..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
              {searchingRole !== 'presidente' && (
                <select style={{ backgroundColor: '#000000', color: '#fff' }} className="w-full p-4 rounded-[6px] border border-white/10 text-white text-sm outline-none appearance-none focus:border-indigo-500 shadow-xl" value={filterState} onChange={(e) => setFilterState(e.target.value)}>
                  <option value="">FILTRAR POR ESTADO (BRASIL)</option>
                  {BRAZIL_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              )}
            </div>
            {/* SEARCH RESULTS SCROLLABLE */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scroll scrollbar-indigo">
              {isSearching ? <div className="text-center p-20"><Loader2 className="animate-spin text-indigo-500 mx-auto" size={32} /></div> :
                searchResults.length === 0 ? <div className="text-center p-20 text-slate-800 font-black uppercase tracking-widest text-[10px]">Sem resultados</div> :
                  searchResults.map(p => (
                    <button key={p.id} onClick={() => selectPoliticianFromSearch(p)} className="flex items-center gap-4 p-4 bg-white/5 rounded-[6px] border border-white/5 hover:bg-indigo-500/10 hover:border-indigo-500/20 transition-all text-left poll-card">
                      <div className="w-12 h-12 rounded-[6px] overflow-hidden bg-slate-900 border border-white/10 shrink-0 relative">
                        {p.photo_url && (
                          <img
                            src={proxyImage(p.photo_url)}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover absolute inset-0"
                            onError={e => {
                              e.target.style.display = 'none';
                              const fallback = e.currentTarget.parentElement.querySelector('.fallback-icon');
                              if (fallback) fallback.style.display = 'block';
                            }}
                          />
                        )}
                        <User className="w-full h-full p-2.5 text-slate-700 absolute inset-0 fallback-icon" style={{ display: p.photo_url ? 'none' : 'block' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-black text-sm truncate uppercase tracking-tight mb-1">{p.name}</div>
                        <div className="flex items-center gap-3">
                          <div className="text-[9px] text-slate-600 font-bold uppercase tracking-widest shrink-0">{p.party} • {p.state || 'BRA'}</div>
                          <div className="w-full h-1 bg-black/40 rounded-full overflow-hidden border border-white/5 max-w-[80px]">
                            <div className={`h-full ${getStatusBg(p.score)}`} style={{ width: `${p.score}%` }} />
                          </div>
                        </div>
                      </div>
                      <div className={`text-xl font-black font-mono ${getStatusColor(p.score)}`}>{p.score}</div>
                    </button>
                  ))
              }
            </div>
          </div>
        </div>
      )}

      {/* MODAL DOSSIER */}
      {selectedPolitician && (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center sm:p-4 bg-black/90 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full sm:max-w-lg bg-[#0a0d10] rounded-t-2xl sm:rounded-[6px] border-t border-x sm:border border-white/20 flex flex-col shadow-2xl overflow-hidden" style={{ height: '92dvh', maxHeight: '92dvh' }}>
            <div className={`h-1 shrink-0 ${getStatusBg(selectedPolitician.score)}`} />

            {/* COMPACT BAR — sempre visível no topo */}
            <div className="flex items-center gap-3 px-4 py-3 bg-black/70 border-b border-white/5 shrink-0 backdrop-blur-md">
              <div className="w-9 h-9 rounded-[4px] overflow-hidden bg-slate-900 shrink-0 border border-white/10 relative">
                {selectedPolitician.photo_url && (
                  <img src={proxyImage(selectedPolitician.photo_url)} referrerPolicy="no-referrer" className="w-full h-full object-cover absolute inset-0 transition-opacity duration-300"
                    onError={e => {
                      if (!e.target.dataset.retried) {
                        e.target.dataset.retried = 'true';
                        e.target.src = selectedPolitician.photo_url;
                      } else {
                        e.target.style.display = 'none';
                      }
                    }} />
                )}
                <User className="w-full h-full p-2 text-slate-700 absolute inset-0" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-black text-white truncate uppercase tracking-tight">{selectedPolitician.name}</div>
                <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider truncate">{selectedPolitician.party}{selectedPolitician.role && ` · ${selectedPolitician.role}`}</div>
              </div>
              <div className={`w-9 h-9 rounded-full border-2 border-black flex items-center justify-center text-[11px] font-black text-black shrink-0 ${getStatusBg(selectedPolitician.score)}`}>
                {selectedPolitician.score}
              </div>
              <button onClick={() => setSelectedPolitician(null)} className="p-2 bg-white/5 hover:bg-rose-500 rounded-[6px] transition-all shrink-0">
                <X size={18} />
              </button>
            </div>

            {/* ÁREA DE SCROLL ÚNICA */}
            <div className="flex-1 overflow-y-auto custom-scroll">

              {/* HERO — rola e some */}
              <div className="px-6 pt-8 pb-6 text-center bg-black/30 border-b border-white/5">
                <div className="relative inline-block mb-4">
                  <div className="w-20 h-20 rounded-[6px] mx-auto shadow-2xl border-2 border-indigo-500 overflow-hidden bg-slate-900 relative">
                    {selectedPolitician.photo_url && (
                      <img src={proxyImage(selectedPolitician.photo_url)} referrerPolicy="no-referrer"
                        className="w-full h-full object-cover absolute inset-0 transition-opacity duration-300" alt={selectedPolitician.name}
                        onError={e => {
                          if (!e.target.dataset.retried) {
                            e.target.dataset.retried = 'true';
                            e.target.src = selectedPolitician.photo_url;
                          } else {
                            e.target.style.display = 'none';
                            const f = e.currentTarget.parentElement.querySelector('.fallback-icon');
                            if (f) f.style.display = 'block';
                          }
                        }} />
                    )}
                    <User className="w-full h-full p-4 text-slate-700 absolute inset-0 fallback-icon" style={{ display: selectedPolitician.photo_url ? 'none' : 'block' }} />
                  </div>
                </div>
                <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-3">{selectedPolitician.name}</h2>
                {(() => {
                  const total = scandals.length + lawsuits.length
                  const getAlertColor = () => {
                    if (total <= 5) return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    if (total <= 15) return 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                    if (total <= 25) return 'bg-orange-500/10 border-orange-500/20 text-orange-400'
                    return 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                  }
                  if (total === 0) return (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-[6px] p-3 max-w-[280px] mx-auto">
                      <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Nenhum registro público localizado</p>
                    </div>
                  )
                  return (
                    <div className={`${getAlertColor()} border rounded-[6px] p-3 max-w-[280px] mx-auto`}>
                      <p className="text-[9px] font-black uppercase tracking-widest">{total} registros vinculados ao histórico</p>
                    </div>
                  )
                })()}
              </div>

              {/* ABAS — sticky dentro do scroll */}
              {!loadingScandals && (
                <div className="sticky top-0 z-10 bg-[#0a0d10]/95 backdrop-blur-sm border-b border-white/5 px-3 py-2 shrink-0">
                  <div className="flex gap-1 bg-black/60 p-1 rounded-[6px] border border-white/5 overflow-x-auto no-scrollbar">
                    {[
                      { id: 'lawsuits', label: '⚖️ Jurídico', show: lawsuits.length > 0 },
                      { id: 'projects', label: '🏆 Projetos', show: scandals.some(s => s.is_positive && !s.title.includes('VOTAÇÃO:')) },
                      { id: 'votes', label: '🗳️ Votos', show: selectedPolitician.role !== 'Presidente' && scandals.some(s => s.is_positive && s.title.includes('VOTAÇÃO:')) },
                      { id: 'noticias', label: '📰 Notícias', show: scandals.some(s => !s.is_positive) }
                    ].filter(t => t.show).map(tab => (
                      <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 min-w-[72px] py-2 px-2 text-[9px] font-black uppercase tracking-wider rounded-[4px] transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* CONTEÚDO DAS ABAS */}
              {loadingScandals ? (
                <div className="flex flex-col items-center justify-center p-16 space-y-4">
                  <Loader2 className="animate-spin text-indigo-500" size={32} />
                  <span className="text-[10px] font-black text-slate-500 uppercase">Consultando histórico...</span>
                </div>
              ) : (
                <div className="p-4 sm:p-6 space-y-4">
                  {/* ABA: JURÍDICO */}
                  {activeTab === 'lawsuits' && lawsuits.length > 0 && (
                    <div className="space-y-4 animate-in slide-in-from-top-2 duration-200">
                      {lawsuits.map((l, i) => (
                        <div key={i} className="p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-[6px]">
                          <div className="flex justify-between items-start mb-2">
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 text-white rounded-[4px] shadow-sm ${l.court === 'STF' ? 'bg-amber-600' : l.court === 'JUSBRASIL' ? 'bg-emerald-600' : 'bg-indigo-500'}`}>{l.court}</span>
                            <span className="text-[9px] text-slate-500 font-mono font-bold truncate max-w-[120px]" title={l.process_number}>{l.process_number}</span>
                          </div>
                          <p className="text-white text-xs font-bold mb-2">{l.description}</p>
                          <div className="flex justify-between items-center mt-3">
                            <div className="px-2 py-1 bg-white/5 rounded-[4px] text-[8px] font-black text-slate-400 uppercase tracking-widest border border-white/5">{l.status}</div>
                            {l.news_url && (
                              <a href={l.news_url} target="_blank" rel="noopener noreferrer" className="text-[8px] text-indigo-400 font-black uppercase hover:underline flex items-center gap-1">
                                Ver Detalhes <ExternalLink size={8} />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ABA: PROJETOS */}
                  {activeTab === 'projects' && (
                    <div className="space-y-4 animate-in slide-in-from-top-2 duration-200">
                      {scandals.filter(s => s.is_positive && !s.title.startsWith('VOTAÇÃO:')).map((p, i) => (
                        <a key={i} href={p.news_url} target="_blank" rel="noopener noreferrer" className="group block bg-emerald-500/5 border border-emerald-500/10 p-5 rounded-[6px] hover:border-emerald-500/30 transition-all">
                          <h4 className="text-[12px] font-black text-emerald-100 leading-tight mb-2 group-hover:text-emerald-300 uppercase tracking-tight">{p.title}</h4>
                          <p className="text-[10px] text-emerald-400/60 font-black uppercase tracking-widest flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> {p.caption || 'Sugestão Legislativa'}
                          </p>
                          <div className="mt-4 flex justify-end">
                            <span className="text-[8px] font-black uppercase text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-[3px]">Ver Projeto</span>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}

                  {/* ABA: VOTOS */}
                  {activeTab === 'votes' && (
                    <div className="space-y-3 animate-in slide-in-from-top-2 duration-200">
                      {scandals.filter(s => s.is_positive && s.title.includes('VOTAÇÃO:')).map((v, i) => {
                        const voteType = v.caption.split('-')[0].replace('Voto:', '').trim().toUpperCase()
                        const isSim = voteType.includes('SIM')
                        const isNao = voteType.includes('NÃO')
                        return (
                          <div key={i} className="bg-black/40 border border-white/5 p-4 rounded-[6px] flex flex-col gap-3 group hover:border-indigo-500/30 transition-all">
                            <div className="flex justify-between items-start gap-4">
                              <h4 className="text-[11px] font-black text-slate-100 uppercase tracking-tight leading-tight flex-1">{v.title.replace('VOTAÇÃO:', '').trim()}</h4>
                              <div className={`shrink-0 px-3 py-1.5 rounded-[4px] text-[10px] font-black border ${isSim ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : isNao ? 'bg-rose-500/10 border-rose-500/20 text-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.2)]' : 'bg-slate-700/50 border-white/10 text-slate-400'}`}>
                                VOTO: {voteType}
                              </div>
                            </div>
                            <div className="flex justify-between items-center pt-2 border-t border-white/5">
                              <span className="text-[9px] font-bold text-slate-600 font-mono uppercase tracking-widest">{v.caption.split('-')[1]?.trim() || 'Data não informada'}</span>
                              <a href={v.news_url} target="_blank" rel="noopener noreferrer" className="text-[9px] font-black text-indigo-400 hover:text-indigo-300 flex items-center gap-1 uppercase tracking-widest">
                                Detalhes <ExternalLink size={10} />
                              </a>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* ABA: NOTÍCIAS */}
                  {activeTab === 'noticias' && (
                    <div className="space-y-4 animate-in slide-in-from-top-2 duration-200">
                      {scandals.filter(s => !s.is_positive).map((s, i) => {
                        const getCat = () => {
                          if (s.severity === 'critical') return { label: 'CONDENAÇÃO', color: 'bg-rose-600 text-white shadow-[0_0_15px_rgba(225,29,72,0.4)]' };
                          if (s.severity === 'high') return { label: 'INVESTIGAÇÃO', color: 'bg-orange-600 text-white' };
                          return { label: 'MENÇÃO', color: 'bg-slate-700 text-slate-300' };
                        }
                        const cat = getCat();
                        return (
                          <a key={i} href={s.news_url} target="_blank" rel="noopener noreferrer" className="block p-5 bg-black/40 border border-white/5 rounded-[6px] hover:border-white/20 hover:bg-black/60 transition-all group">
                            <div className="flex justify-between items-center mb-3">
                              <span className={`text-[7px] font-black uppercase px-2 py-1 rounded-[4px] shadow-lg ${cat.color}`}>{cat.label}</span>
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] text-slate-600 font-bold font-mono">{new Date(s.date_occurrence).toLocaleDateString('pt-BR')}</span>
                                <button className="text-slate-500 hover:text-indigo-400 transition-colors" title="Compartilhar notícia" onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (navigator.share) {
                                    navigator.share({ title: s.title, text: 'Veja esta notícia no Corruptômetro:', url: s.news_url }).catch(() => { });
                                  } else {
                                    navigator.clipboard.writeText(s.news_url);
                                    alert('Link copiado!');
                                  }
                                }}>
                                  <Share2 size={12} />
                                </button>
                                <ExternalLink size={12} className="text-slate-600 group-hover:text-indigo-400 transition-colors" />
                              </div>
                            </div>
                            <h4 className="text-white text-sm font-black leading-tight mb-2 uppercase tracking-tight group-hover:text-indigo-300 transition-colors">{s.title}</h4>
                            <p className="text-slate-500 text-[10px] line-clamp-3 leading-relaxed font-medium italic">{s.caption}</p>
                          </a>
                        )
                      })}
                    </div>
                  )}

                  {/* ESTADO VAZIO */}
                  {(activeTab === 'lawsuits' && lawsuits.length === 0) && (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4 opacity-40">
                      <div className="w-16 h-16 rounded-full border border-emerald-500/30 flex items-center justify-center">
                        <CheckCircle size={32} className="text-emerald-500" />
                      </div>
                      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-500">Nenhum Registro Localizado</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAdmin && <Admin onClose={() => setShowAdmin(false)} />}
    </div>
  )
}
