import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, ShieldAlert, CheckCircle,
  ExternalLink, X, User, Loader2,
  Trophy, Share2, ZoomIn
} from 'lucide-react'
import { supabase } from './supabase'
import { toPng } from 'html-to-image'
import Admin from './Admin'

const BRAZIL_STATES = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

const roleLengths = { presidente: 2, governador: 2, senador1: 3, senador2: 3, depFederal: 4, depEstadual: 5 }
const roleLabels = {
  presidente: 'Presidente', governador: 'Governador', senador1: 'Senador 1', senador2: 'Senador 2', depFederal: 'Deputado Federal', depEstadual: 'Deputado Estadual'
}

export default function App() {
  const [selectedPolitician, setSelectedPolitician] = useState(null)
  const [scandals, setScandals] = useState([])
  const [loadingScandals, setLoadingScandals] = useState(false)

  const [searchingRole, setSearchingRole] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [filterState, setFilterState] = useState('')

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

  // Persistence: Save to localStorage on change
  useEffect(() => {
    localStorage.setItem('corruptometro_inputs', JSON.stringify(inputs))
  }, [inputs])
  useEffect(() => {
    localStorage.setItem('corruptometro_colinha', JSON.stringify(colinha))
  }, [colinha])

  // Track user session with persistence
  const sessionId = useRef(() => {
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
    trackAction('input_search', { role: role, number })
    const { data } = await supabase
      .from('politicians')
      .select('*')
      .eq('candidate_number', number)
      .eq('role', roleLabels[role].replace(/\s\d$/, ''))
      .single()

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
  }

  const removePolitician = (role) => {
    setColinha(prev => ({ ...prev, [role]: null }))
    setInputs(prev => ({ ...prev, [role]: '' }))
  }

  const searchPoliticians = useCallback(async () => {
    if (!searchingRole) return
    setIsSearching(true)
    let dbRole = roleLabels[searchingRole].replace(/\s\d$/, '')
    let query = supabase.from('politicians').select('*').eq('role', dbRole)
    if (searchQuery) query = query.ilike('name', `%${searchQuery}%`)
    if (filterState && searchingRole !== 'presidente') query = query.eq('state', filterState)
    const { data } = await query.limit(20)
    setSearchResults(data || [])
    setIsSearching(false)
  }, [searchingRole, searchQuery, filterState])

  useEffect(() => {
    const timer = setTimeout(() => { if (searchingRole) searchPoliticians(); }, 400)
    return () => clearTimeout(timer)
  }, [searchQuery, filterState, searchingRole, searchPoliticians])

  useEffect(() => {
    if (selectedPolitician) {
      const fetchScandals = async () => {
        setLoadingScandals(true)
        setScandals([])
        const { data } = await supabase.from('scandals').select('*').eq('politician_id', selectedPolitician.id).order('date_occurrence', { ascending: false })
        if (data) setScandals(data)
        setLoadingScandals(false)
      }
      fetchScandals()
    }
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

      {/* BRANDING */}
      <nav className="p-6 text-center bg-black/80 border-b border-white/5 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-center gap-3 cursor-pointer select-none group" onClick={handleLogoClick}>
          <div className="relative">
            <Trophy className="text-indigo-500 group-hover:scale-110 transition-transform" size={24} />
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-rose-500 rounded-full animate-ping" />
          </div>
          <h1 className="text-2xl font-black text-white italic tracking-tighter group-hover:text-indigo-400 transition-colors">CORRUPTÔMETRO</h1>
          <div className="px-1.5 py-0.5 rounded-[4px] bg-rose-500/10 border border-rose-500/20 text-[7px] font-black text-rose-500 uppercase tracking-widest ml-1">LIVE</div>
        </div>
      </nav>

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
                            <button onClick={() => setSelectedPolitician(p)} className="text-indigo-400 hover:text-white p-2 hover:bg-indigo-500/10 rounded-[6px] transition-all" title="Ver detalhes">
                              <ZoomIn size={16} />
                            </button>
                          )}
                          <button onClick={() => setSearchingRole(key)} className="text-slate-500 hover:text-white p-2 hover:bg-white/5 rounded-[6px] transition-all"><Search size={16} /></button>
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
                                <User className="w-full h-full p-2 text-slate-800 absolute inset-0" />
                                {p.photo_url && <img src={p.photo_url} crossOrigin="anonymous" className="w-full h-full object-cover absolute inset-0" onError={e => e.target.remove()} />}
                              </div>
                              <div className="flex-1 min-w-0 overflow-hidden">
                                <div className="text-[11px] font-black text-white truncate uppercase tracking-tight mb-0.5">{p.name}</div>
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
              <button onClick={() => setSearchingRole(null)} className="p-3 bg-white/5 hover:bg-rose-500 hover:text-white text-slate-400 rounded-[6px] transition-all"><X size={20} /></button>
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
                        <User className="w-full h-full p-2.5 text-slate-700 absolute inset-0" />
                        {p.photo_url && <img src={p.photo_url} className="w-full h-full object-cover absolute inset-0" onError={e => e.target.remove()} />}
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

      {/* MODAL DOSSIER ( Lupinha Preview ) */}
      {selectedPolitician && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md animate-in fade-in zoom-in-95 duration-200">
          <div className="w-full max-w-lg glass-surface rounded-[6px] border border-white/20 overflow-hidden flex flex-col shadow-2xl h-[85vh] relative">
            <div className={`absolute top-0 inset-x-0 h-1 ${getStatusBg(selectedPolitician.score)}`} />

            <div className="p-8 text-center bg-black/40 border-b border-white/5 relative">
              <header className="absolute top-6 right-6"><button onClick={() => setSelectedPolitician(null)} className="p-2 bg-white/5 hover:bg-rose-500 rounded-[6px] transition-all"><X size={18} /></button></header>
              <div className="relative inline-block">
                <div className="w-24 h-24 rounded-[6px] mx-auto mb-4 shadow-2xl border-2 border-indigo-500 overflow-hidden bg-slate-900 relative">
                  <User className="w-full h-full p-4 text-slate-700 absolute inset-0" />
                  {selectedPolitician.photo_url && <img src={selectedPolitician.photo_url} className="w-full h-full object-cover absolute inset-0" alt={selectedPolitician.name} onError={e => e.target.remove()} />}
                </div>
                <div className={`absolute -bottom-1 -right-1 w-8 h-8 rounded-full border-4 border-black flex items-center justify-center text-[12px] font-black text-black shadow-xl ${getStatusBg(selectedPolitician.score)}`}>
                  {selectedPolitician.score}
                </div>
              </div>
              <h2 className="text-3xl font-black text-white uppercase tracking-tighter mb-1">{selectedPolitician.name}</h2>
              <div className="flex justify-center gap-2">
                <span className="px-3 py-1 bg-white/5 rounded-[4px] text-[10px] font-black text-slate-400 uppercase tracking-widest border border-white/5">{selectedPolitician.party}</span>
                <span className="px-3 py-1 bg-white/5 rounded-[4px] text-[10px] font-black text-slate-400 uppercase tracking-widest border border-white/5">{selectedPolitician.role}</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 bg-black/20 custom-scroll">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-white/5 pb-4">
                <ShieldAlert className="text-rose-500" size={14} /> Dossiê de Antecedentes Criminais
              </h3>
              {loadingScandals ? <div className="flex flex-col items-center justify-center p-12 space-y-4">
                <Loader2 className="animate-spin text-indigo-500" size={32} />
                <span className="text-[10px] font-black text-slate-500 uppercase">Consultando bases criminais...</span>
              </div> : (
                <div className="space-y-8">
                  {/* SEÇÃO: PROCESSOS JUDICIAIS */}
                  {lawsuits.length > 0 && (
                    <div className="space-y-4">
                      <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-white/5 pb-4">
                        <Scale className="text-indigo-400" size={14} /> Processos em Instâncias Superiores
                      </h3>
                      {lawsuits.map((l, i) => (
                        <div key={i} className="p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-[6px]">
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-indigo-500 text-white rounded-[4px]">{l.court}</span>
                            <span className="text-[9px] text-slate-500 font-mono font-bold">{l.process_number}</span>
                          </div>
                          <p className="text-white text-xs font-bold mb-2">{l.description}</p>
                          <div className="flex justify-between items-center mt-3">
                            <div className="px-2 py-1 bg-white/5 rounded-[4px] text-[8px] font-black text-slate-400 uppercase tracking-widest border border-white/5">{l.status}</div>
                            {l.news_url && (
                              <a href={l.news_url} target="_blank" rel="noopener noreferrer" className="text-[8px] text-indigo-400 font-black uppercase hover:underline flex items-center gap-1">
                                Ver Detalhes STF <ExternalLink size={8} />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* SEÇÃO: ESCÂNDALOS E NOTÍCIAS */}
                  <div className="space-y-4">
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-white/5 pb-4">
                      <ShieldAlert className="text-rose-500" size={14} /> Dossiê de Escândalos
                    </h3>
                    {scandals.length === 0 && lawsuits.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 space-y-4 opacity-40">
                        <div className="w-16 h-16 rounded-full border border-emerald-500/30 flex items-center justify-center">
                          <CheckCircle size={32} className="text-emerald-500" />
                        </div>
                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-500">Ficha Limpa Detectada</p>
                      </div>
                    ) : (
                      scandals.map((s, i) => (
                        <a key={i} href={s.news_url} target="_blank" rel="noopener noreferrer" className="block p-5 bg-black/40 border border-white/5 rounded-[6px] hover:border-white/20 hover:bg-black/60 transition-all group">
                          <div className="flex justify-between items-center mb-3">
                            <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-[4px] shadow-lg ${s.severity === 'high' ? 'bg-rose-500 text-white' : 'bg-amber-500 text-black'}`}>{s.severity === 'high' ? 'CRUCIAL' : 'MÉDIO'}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-600 font-bold font-mono">{new Date(s.date_occurrence).toLocaleDateString('pt-BR')}</span>
                              <ExternalLink size={12} className="text-slate-600 group-hover:text-indigo-400" />
                            </div>
                          </div>
                          <h4 className="text-white text-base font-black leading-tight mb-2 uppercase tracking-tight group-hover:text-indigo-300 transition-colors">{s.title}</h4>
                          <p className="text-slate-500 text-xs line-clamp-3 leading-relaxed font-medium">{s.caption}</p>
                        </a>
                      ))
                    )}
                  </div>
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
