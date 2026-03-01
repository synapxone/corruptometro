import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, ShieldAlert, AlertTriangle, CheckCircle,
  ExternalLink, Heart, ChevronRight, X, User, Loader2,
  Filter, Trophy, Scale, Shield, Landmark, BarChart3,
  Share2, ZoomIn, Info
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

  const [inputs, setInputs] = useState({
    presidente: '', governador: '', senador1: '', senador2: '', depFederal: '', depEstadual: ''
  })

  const [colinha, setColinha] = useState({
    presidente: null, governador: null, senador1: null, senador2: null, depFederal: null, depEstadual: null
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
    <div className="premium-bg min-h-screen pb-48 text-slate-200" style={{ backgroundColor: '#030609' }}>

      {/* BRANDING */}
      <nav className="p-6 text-center bg-black/80 border-b border-white/5 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-center gap-2 cursor-pointer select-none" onClick={handleLogoClick}>
          <Trophy className="text-indigo-500" size={24} />
          <h1 className="text-2xl font-black text-white italic tracking-tighter">CORRUPTÔMETRO</h1>
        </div>
      </nav>

      <main className="max-w-xl mx-auto px-4 py-8 space-y-12">

        {/* DASHBOARD */}
        <section className="animate-in fade-in duration-700">
          {stats ? (
            <div className="flex flex-col items-center space-y-6">
              <div className="p-8 glass-surface rounded-[6px] shadow-2xl flex items-center border border-white/10 bg-black/40 w-full justify-center">
                <div className="flex items-center gap-8 relative">
                  {/* Vertical Thermometer */}
                  <div className="w-4 h-32 bg-slate-900 rounded-full overflow-hidden border border-white/5 relative flex flex-col justify-end">
                    <div
                      className={`w-full transition-all duration-1000 ${getStatusBg(stats.score)} shadow-[0_0_15px_rgba(255,255,255,0.2)]`}
                      style={{ height: `${stats.score}%` }}
                    />
                  </div>

                  <span className={`text-8xl font-black leading-none ${getStatusColor(stats.score)} font-mono`}>
                    {stats.score}
                  </span>

                  <div className="text-left py-2 border-l border-white/10 pl-8">
                    <span className={`text-2xl font-black uppercase block tracking-tighter ${getStatusColor(stats.score)}`}>
                      {stats.status === 'safe' ? 'CONFIÁVEL' : stats.status === 'warning' ? 'ATENÇÃO' : 'ALERTA'}
                    </span>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mt-1">NOTA GERAL DA COLINHA</p>
                  </div>
                </div>
              </div>

              <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-[6px] text-center w-full">
                <p className="text-xs font-black text-rose-500 uppercase tracking-widest flex items-center justify-center gap-2">
                  <ShieldAlert size={14} /> Vote com Consciência: O Futuro do Brasil está em suas mãos.
                </p>
              </div>

              {positionsFilled === totalPositions && (
                <button
                  onClick={handleShare}
                  className="w-full flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white p-6 rounded-[6px] font-black uppercase tracking-widest text-sm transition-all shadow-xl active:scale-[0.98]"
                >
                  <Share2 size={20} /> Compartilhar Colinha (Instagram)
                </button>
              )}
            </div>
          ) : (
            <div className="text-center py-6 px-4">
              <h2 className="text-5xl font-black text-white leading-[0.95] tracking-tighter mb-4">RAIO-X <br /><span className="text-indigo-500 italic">DA URNA.</span></h2>
              <p className="text-slate-500 text-sm font-medium max-w-xs mx-auto leading-relaxed">Transparência total e antecedentes criminais dos seus candidatos.</p>
            </div>
          )}
        </section>

        {/* INPUTS GRID (Capturable Container) */}
        <div ref={colinhaRef} className="space-y-12">
          {Object.entries({ Executivo: ["presidente", "governador"], Legislativo: ["senador1", "senador2", "depFederal", "depEstadual"] }).map(([label, keys]) => (
            <div key={label} className="space-y-4">
              <header className="flex items-center gap-3 px-1 uppercase text-[10px] font-black tracking-[0.4em] text-indigo-500/50">
                <span>{label}</span>
                <div className="h-[1px] flex-1 bg-white/5"></div>
              </header>
              <div className="grid gap-4">
                {keys.map(key => {
                  const p = colinha[key]
                  const maxLength = roleLengths[key]
                  return (
                    <div key={key} className="glass-surface p-4 rounded-[6px] border border-white/10 shadow-lg space-y-4 bg-black/30 hover:bg-black/40 transition-all">
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
                      <div className="flex gap-4 items-center">
                        <input
                          style={{ backgroundColor: '#000000', color: '#ffffff', border: '1px solid #1e293b' }}
                          className="w-20 h-16 rounded-[6px] text-3xl font-black text-center focus:border-indigo-500 outline-none transition-all placeholder:text-slate-900 shadow-inner"
                          maxLength={maxLength} value={inputs[key]} onChange={(e) => handleInputChange(key, e.target.value)}
                          placeholder={"0".repeat(maxLength)}
                        />
                        <div className="flex-1 min-h-[4rem] flex items-center">
                          {p ? (
                            <div className="flex items-center w-full gap-3 bg-black/60 border border-white/5 rounded-[6px] p-2 pr-4 shadow-xl">
                              <div className="w-12 h-12 rounded-[6px] overflow-hidden bg-slate-900 shrink-0 border border-white/10">
                                {p.photo_url ? <img src={p.photo_url} className="w-full h-full object-cover" /> : <User className="w-full h-full p-2 text-slate-800" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-black text-white truncate uppercase tracking-tight">{p.name}</div>
                                <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">{p.party} {p.state && ` • ${p.state}`}</div>
                              </div>

                              <div className="flex flex-col items-end gap-1">
                                <div className="flex items-center gap-3">
                                  {/* Micro Thermometer (Horizontal Bar) */}
                                  <div className="w-12 h-1.5 bg-slate-900 rounded-full overflow-hidden border border-white/5">
                                    <div className={`h-full ${getStatusBg(p.score)}`} style={{ width: `${p.score}%` }}></div>
                                  </div>
                                  <span className={`text-xl font-black ${getStatusColor(p.score)} font-mono`}>{p.score}</span>
                                </div>
                                <button
                                  onClick={() => removePolitician(key)}
                                  className="text-[9px] font-bold text-rose-500/60 hover:text-rose-500 transition-colors uppercase tracking-widest"
                                >
                                  REMOVER [X]
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center w-full h-16 border-2 border-dashed border-white/5 rounded-[6px] px-6 text-slate-800 text-[10px] font-black uppercase tracking-widest opacity-30">
                              AGUARDANDO...
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
                    <button key={p.id} onClick={() => selectPoliticianFromSearch(p)} className="flex items-center gap-4 p-4 bg-white/5 rounded-[6px] border border-white/5 hover:bg-indigo-500/10 hover:border-indigo-500/20 transition-all text-left">
                      <div className="w-12 h-12 rounded-[6px] overflow-hidden bg-slate-900 border border-white/10 shrink-0">
                        {p.photo_url && <img src={p.photo_url} className="w-full h-full object-cover" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-black text-sm truncate uppercase tracking-tight">{p.name}</div>
                        <div className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">{p.party} • {p.state || 'BRA'}</div>
                      </div>
                      <div className={`text-lg font-black font-mono ${getStatusColor(p.score)}`}>{p.score}</div>
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
          <div className="w-full max-w-lg glass-surface rounded-[6px] border border-white/10 overflow-hidden flex flex-col shadow-2xl h-[80vh]">
            <div className="p-8 text-center bg-black/40 border-b border-white/5 relative">
              <header className="absolute top-6 right-6"><button onClick={() => setSelectedPolitician(null)} className="p-2 bg-white/5 hover:bg-rose-500 rounded-[6px] transition-all"><X size={18} /></button></header>
              <div className="relative inline-block">
                <img src={selectedPolitician.photo_url || 'https://via.placeholder.com/200'} className="w-20 h-20 rounded-[6px] mx-auto object-cover border-2 border-indigo-500 mb-4 shadow-xl" alt={selectedPolitician.name} />
                <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-black flex items-center justify-center text-[10px] font-black text-black ${getStatusBg(selectedPolitician.score)}`}>
                  !
                </div>
              </div>
              <h2 className="text-2xl font-black text-white uppercase tracking-tighter">{selectedPolitician.name}</h2>
              <div className="mt-3 flex justify-center gap-2">
                <span className="px-3 py-1 bg-white/5 rounded-[4px] text-[8px] font-black text-slate-400 uppercase tracking-widest border border-white/5">{selectedPolitician.party}</span>
                <span className="px-3 py-1 bg-white/5 rounded-[4px] text-[8px] font-black text-slate-400 uppercase tracking-widest border border-white/5">{selectedPolitician.role}</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-black/20 custom-scroll">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-2">
                <ShieldAlert className="text-rose-500" size={14} /> Dossiê de Antecedentes
              </h3>
              {loadingScandals ? <div className="flex justify-center p-12"><Loader2 className="animate-spin text-indigo-500" /></div> :
                scandals.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 space-y-4 opacity-40">
                    <CheckCircle size={40} className="text-emerald-500" />
                    <p className="text-[11px] font-black uppercase tracking-widest text-emerald-500">Nenhum escândalo localizado</p>
                  </div>
                ) :
                  scandals.map((s, i) => (
                    <a key={i} href={s.news_url} target="_blank" rel="noopener noreferrer" className="block p-5 bg-white/3 border border-white/5 rounded-[6px] hover:bg-white/5 transition-all">
                      <div className="flex justify-between items-center mb-2">
                        <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-[4px] ${s.severity === 'high' ? 'bg-rose-500 text-white' : 'bg-amber-500 text-black'}`}>{s.severity}</span>
                        <span className="text-[9px] text-slate-600 font-bold">{new Date(s.date_occurrence).getFullYear()}</span>
                      </div>
                      <h4 className="text-white text-sm font-black leading-snug mb-2 uppercase tracking-tight">{s.title}</h4>
                      <p className="text-slate-500 text-[11px] line-clamp-3 leading-relaxed">{s.caption}</p>
                    </a>
                  ))
              }
            </div>
          </div>
        </div>
      )}

      {showAdmin && <Admin onClose={() => setShowAdmin(false)} />}
    </div>
  )
}
