import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import {
  X, Plus, Edit2, Trash2, RefreshCw, Search,
  Download, AlertTriangle, CheckCircle, Shield,
  ChevronDown, ChevronUp, Database, Zap, Activity, Globe
} from 'lucide-react'

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'admin2026'
const ROLES = ['Presidente', 'Governador', 'Senador', 'Deputado Federal', 'Deputado Estadual']
const SEVERITIES = [{ value: 'medium', label: 'Médio (−10pts)' }, { value: 'high', label: 'Alto (−25pts)' }]
const BRAZIL_STATES = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]
const TSE_CARGOS = [
  { value: '1', label: 'Presidente' },
  { value: '3', label: 'Governador' },
  { value: '5', label: 'Senador' },
  { value: '6', label: 'Deputado Federal' },
  { value: '7', label: 'Deputado Estadual' },
]
const CARGO_ROLE_MAP = { '1': 'Presidente', '3': 'Governador', '5': 'Senador', '6': 'Deputado Federal', '7': 'Deputado Estadual' }

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Returns true if URL exists (not 404). Fails silently for CORS/network errors.
async function urlExists(url) {
  if (!url) return true
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(6000), mode: 'no-cors' })
    // no-cors hides status but won't throw for existing pages; only 404 pages
    // that return proper JSON error responses will throw via the CORS proxy
    return true // no-cors always succeeds if server responds at all
  } catch {
    return false
  }
}

// Validates URL via a lightweight GET (reads first byte only)
async function checkUrlNotDead(url) {
  if (!url || !url.startsWith('http')) return { ok: false, reason: 'URL inválida' }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, { signal: ctrl.signal, mode: 'no-cors' })
    clearTimeout(timer)
    return { ok: true }
  } catch (e) {
    if (e.name === 'AbortError') return { ok: true } // timeout = server exists but slow
    return { ok: false, reason: 'Sem resposta do servidor' }
  }
}

function scoreToStatus(score) {
  const n = parseInt(score) || 50
  return n >= 75 ? 'safe' : n >= 40 ? 'warning' : 'danger'
}

function emptyPolitician() {
  return { id: null, name: '', candidate_number: '', party: '', role: 'Presidente', state: '', city: '', photo_url: '', score: 50 }
}

function emptyScandal() {
  return { id: null, politician_id: '', title: '', caption: '', severity: 'medium', news_url: '', date_occurrence: new Date().toISOString().split('T')[0] }
}

// ─── Field Components ─────────────────────────────────────────────────────────
function Field({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <div>
      <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest block mb-1.5">{label}</label>
      <input
        type={type} value={value || ''} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full p-3 bg-black border border-white/10 text-white text-sm rounded-[6px] outline-none focus:border-indigo-500 transition-colors"
      />
    </div>
  )
}

function TextArea({ label, value, onChange, rows = 3 }) {
  return (
    <div>
      <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest block mb-1.5">{label}</label>
      <textarea
        value={value || ''} rows={rows}
        onChange={e => onChange(e.target.value)}
        className="w-full p-3 bg-black border border-white/10 text-white text-sm rounded-[6px] outline-none focus:border-indigo-500 resize-none transition-colors"
      />
    </div>
  )
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest block mb-1.5">{label}</label>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full p-3 bg-black border border-white/10 text-white text-sm rounded-[6px] outline-none focus:border-indigo-500 appearance-none transition-colors"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// ─── Politician Form Modal ────────────────────────────────────────────────────
function PoliticianFormModal({ politician, onSave, onClose }) {
  const [form, setForm] = useState({ ...politician })
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="fixed inset-0 z-[220] bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-slate-950 border border-white/10 rounded-[6px] shadow-2xl overflow-hidden">
        <div className="flex justify-between items-center p-5 border-b border-white/10">
          <h2 className="text-xs font-black text-white uppercase tracking-widest">
            {form.id ? 'Editar' : 'Novo'} Político
          </h2>
          <button onClick={onClose}><X size={16} className="text-slate-600 hover:text-white transition-colors" /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          <Field label="Nome Completo" value={form.name} onChange={v => set('name', v)} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Número" value={form.candidate_number} onChange={v => set('candidate_number', v)} placeholder="Ex: 13" />
            <Field label="Partido" value={form.party} onChange={v => set('party', v)} placeholder="Ex: PT" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Cargo" value={form.role} onChange={v => set('role', v)}
              options={ROLES.map(r => ({ value: r, label: r }))} />
            <SelectField label="Estado" value={form.state} onChange={v => set('state', v)}
              options={[{ value: '', label: 'Nacional' }, ...BRAZIL_STATES.map(s => ({ value: s, label: s }))]} />
          </div>
          <Field label="URL da Foto" value={form.photo_url} onChange={v => set('photo_url', v)} placeholder="https://..." />

          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest block mb-1.5">Score (0–100)</label>
              <input
                type="number" min="0" max="100" value={form.score}
                onChange={e => set('score', e.target.value)}
                className="w-full p-3 bg-black border border-white/10 text-white text-sm rounded-[6px] outline-none focus:border-indigo-500"
              />
            </div>
            <div className="pb-0.5">
              {form.photo_url
                ? <img src={form.photo_url} className="w-12 h-12 rounded-[4px] object-cover border border-white/10" onError={e => e.target.style.display = 'none'} />
                : <div className="w-12 h-12 rounded-[4px] bg-slate-900 border border-white/5" />
              }
            </div>
          </div>
        </div>

        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 p-3 bg-white/5 hover:bg-white/10 text-slate-400 text-xs font-black uppercase rounded-[6px] transition-all">Cancelar</button>
          <button onClick={() => onSave(form)} className="flex-1 p-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase rounded-[6px] transition-all">Salvar</button>
        </div>
      </div>
    </div>
  )
}

// ─── Scandal Form Modal ───────────────────────────────────────────────────────
function ScandalFormModal({ scandal, politicians, onSave, onClose }) {
  const [form, setForm] = useState({ ...scandal })
  const [urlStatus, setUrlStatus] = useState(null) // null | 'checking' | 'ok' | 'dead'
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const handleUrlChange = (v) => {
    set('news_url', v)
    setUrlStatus(null)
    if (!v || !v.startsWith('http')) return
    setUrlStatus('checking')
    checkUrlNotDead(v).then(({ ok }) => setUrlStatus(ok ? 'ok' : 'dead'))
  }

  return (
    <div className="fixed inset-0 z-[220] bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-slate-950 border border-white/10 rounded-[6px] shadow-2xl overflow-hidden">
        <div className="flex justify-between items-center p-5 border-b border-white/10">
          <h2 className="text-xs font-black text-white uppercase tracking-widest">
            {form.id ? 'Editar' : 'Novo'} Escândalo
          </h2>
          <button onClick={onClose}><X size={16} className="text-slate-600 hover:text-white transition-colors" /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          <SelectField
            label="Político"
            value={form.politician_id}
            onChange={v => set('politician_id', v)}
            options={[{ value: '', label: '— Selecione —' }, ...politicians.map(p => ({ value: p.id, label: p.name }))]}
          />
          <Field label="Título do Escândalo" value={form.title} onChange={v => set('title', v)} />
          <TextArea label="Descrição / Resumo" value={form.caption} onChange={v => set('caption', v)} rows={4} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Severidade" value={form.severity} onChange={v => set('severity', v)} options={SEVERITIES} />
            <Field label="Data do Ocorrido" value={form.date_occurrence} onChange={v => set('date_occurrence', v)} type="date" />
          </div>
          <div>
            <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest block mb-1.5 flex items-center gap-2">
              URL da Fonte / Notícia
              {urlStatus === 'checking' && <span className="text-slate-600">verificando...</span>}
              {urlStatus === 'ok' && <span className="text-emerald-500">✓ acessível</span>}
              {urlStatus === 'dead' && <span className="text-rose-500">⚠ pode estar inacessível</span>}
            </label>
            <input
              type="text" value={form.news_url || ''} placeholder="https://g1.globo.com/..."
              onChange={e => handleUrlChange(e.target.value)}
              className={`w-full p-3 bg-black border text-white text-sm rounded-[6px] outline-none transition-colors ${urlStatus === 'dead' ? 'border-rose-500/50' : urlStatus === 'ok' ? 'border-emerald-500/40' : 'border-white/10 focus:border-indigo-500'}`}
            />
          </div>
        </div>

        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 p-3 bg-white/5 hover:bg-white/10 text-slate-400 text-xs font-black uppercase rounded-[6px] transition-all">Cancelar</button>
          <button onClick={() => onSave(form)} className="flex-1 p-3 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase rounded-[6px] transition-all">Salvar</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Admin Panel ─────────────────────────────────────────────────────────
export default function Admin({ onClose }) {
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [tab, setTab] = useState('politicians')

  // Data
  const [politicians, setPoliticians] = useState([])
  const [scandals, setScandals] = useState([])
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState({ politicians: 0, scandals: 0 })

  // Modals
  const [editingPolitician, setEditingPolitician] = useState(null)
  const [editingScandal, setEditingScandal] = useState(null)

  // Search / filter
  const [searchPol, setSearchPol] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [expandedPolitician, setExpandedPolitician] = useState(null)

  // Scraping
  const [scraping, setScraping] = useState(false)
  const [scrapeLog, setScrapeLog] = useState([])
  const [scrapeResults, setScrapeResults] = useState([])
  const [scrapeYear, setScrapeYear] = useState('2022')
  const [scrapeState, setScrapeState] = useState('SP')
  const [scrapeCargo, setScrapeCargo] = useState('5')
  const [importing, setImporting] = useState(false)

  // Scanning
  const [scanningId, setScanningId] = useState(null)
  const [scanAllActive, setScanAllActive] = useState(false)
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 })
  const [scanLogs, setScanLogs] = useState({}) // { [politicianId]: string[] }

  // ── Auth ────────────────────────────────────────────────────────────────────
  const handleLogin = (e) => {
    e.preventDefault()
    if (password === ADMIN_PASSWORD) {
      setAuthenticated(true)
      loadData()
    } else {
      alert('Senha incorreta')
    }
  }

  // ── Data ────────────────────────────────────────────────────────────────────
  const loadData = async () => {
    setLoading(true)
    const [{ data: pols, count: polCount }, { data: scans, count: scanCount }] = await Promise.all([
      supabase.from('politicians').select('*', { count: 'exact' }).order('name'),
      supabase.from('scandals').select('*, politicians(name)', { count: 'exact' }).order('created_at', { ascending: false }),
    ])
    setPoliticians(pols || [])
    setScandals(scans || [])
    setStats({ politicians: polCount || 0, scandals: scanCount || 0 })
    setLoading(false)
  }

  // ── Politicians CRUD ────────────────────────────────────────────────────────
  const savePolitician = async (data) => {
    const score = Math.max(0, Math.min(100, parseInt(data.score) || 50))
    const status = scoreToStatus(score)
    const payload = { ...data, score, status }

    let error
    if (data.id) {
      const { error: e } = await supabase.from('politicians').update(payload).eq('id', data.id)
      error = e
    } else {
      const { id, ...insert } = payload
      const { error: e } = await supabase.from('politicians').insert(insert)
      error = e
    }

    if (error) { alert('Erro: ' + error.message); return }
    setEditingPolitician(null)
    loadData()
  }

  const deletePolitician = async (id, name) => {
    if (!confirm(`Excluir "${name}" e todos os seus escândalos?`)) return
    await supabase.from('scandals').delete().eq('politician_id', id)
    await supabase.from('politicians').delete().eq('id', id)
    loadData()
  }

  // ── Scandals CRUD ───────────────────────────────────────────────────────────
  const saveScandal = async (data) => {
    if (!data.politician_id) { alert('Selecione um político'); return }
    if (!data.title) { alert('Informe o título'); return }

    // Validate URL before saving
    if (data.news_url) {
      const { ok, reason } = await checkUrlNotDead(data.news_url)
      if (!ok) {
        const proceed = confirm(`⚠️ URL pode estar inacessível: ${reason}\n\nDeseja salvar mesmo assim?`)
        if (!proceed) return
      }
    }

    let error
    if (data.id) {
      const { error: e } = await supabase.from('scandals').update(data).eq('id', data.id)
      error = e
    } else {
      const { id, ...insert } = data
      const { error: e } = await supabase.from('scandals').insert(insert)
      error = e
    }

    if (error) { alert('Erro: ' + error.message); return }
    setEditingScandal(null)
    loadData()
    recalcScore(data.politician_id)
  }

  const deleteScandal = async (id, politicianId, title) => {
    if (!confirm(`Excluir escândalo "${title}"?`)) return
    await supabase.from('scandals').delete().eq('id', id)
    loadData()
    recalcScore(politicianId)
  }

  const recalcScore = async (politicianId) => {
    const { data } = await supabase.from('scandals').select('severity').eq('politician_id', politicianId)
    let score = 100
    for (const s of (data || [])) score -= s.severity === 'high' ? 25 : 10
    score = Math.max(0, score)
    const status = scoreToStatus(score)
    await supabase.from('politicians').update({ score, status }).eq('id', politicianId)
    loadData()
  }

  // ── Scraping ────────────────────────────────────────────────────────────────
  const addLog = (msg, type = 'info') => {
    setScrapeLog(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString('pt-BR') }])
  }

  const handleScrape = async () => {
    setScraping(true)
    setScrapeResults([])
    setScrapeLog([])

    addLog(`Iniciando via Edge Function: ${CARGO_ROLE_MAP[scrapeCargo]} / ${scrapeState || 'BR'} / ${scrapeYear}`)

    try {
      const { data, error } = await supabase.functions.invoke('scrape-tse', {
        body: { year: scrapeYear, state: scrapeState, cargo: scrapeCargo },
      })

      if (error) throw new Error(error.message)

      // Replay server-side log in the UI
      for (const msg of (data.log || [])) {
        const type = msg.startsWith('✓') ? 'success' : msg.includes('falhou') || msg.includes('HTTP') ? 'warn' : 'info'
        addLog(msg, type)
      }

      if (data.candidates?.length > 0) {
        setScrapeResults(data.candidates)
        addLog(`✓ ${data.candidates.length} candidatos prontos para importação`, 'success')
      } else {
        addLog('──────────────────────────────────────────────', 'dim')
        addLog('Nenhum candidato retornado. Possíveis causas:', 'warn')
        addLog(`• Eleição de ${scrapeYear} sem candidatos registrados no TSE`, 'dim')
        addLog('• TSE ainda não abriu o cadastro para o ano selecionado', 'dim')
        addLog('──────────────────────────────────────────────', 'dim')
      }
    } catch (err) {
      addLog(`Erro na Edge Function: ${err.message}`, 'warn')
      addLog('Verifique se a função foi deployada: supabase functions deploy scrape-tse', 'dim')
    }

    setScraping(false)
  }

  const importOne = async (candidate) => {
    const { _raw, ...payload } = candidate
    const { error } = await supabase.from('politicians').insert(payload)
    if (error) {
      // Try update if duplicate
      const { error: e2 } = await supabase.from('politicians')
        .update(payload)
        .eq('candidate_number', payload.candidate_number)
        .eq('role', payload.role)
        .eq('state', payload.state)
      if (e2) { alert('Erro: ' + (error.message || e2.message)); return }
    }
    setScrapeResults(prev => prev.filter(c => c !== candidate))
    loadData()
  }

  const importAll = async () => {
    setImporting(true)
    for (const c of scrapeResults) await importOne(c)
    setScrapeResults([])
    addLog(`✓ Todos importados!`, 'success')
    setImporting(false)
  }

  // ── Filters ──────────────────────────────────────────────────────────────
  const filtered = politicians.filter(p => {
    const q = searchPol.toLowerCase()
    const matchSearch = !q || p.name?.toLowerCase().includes(q) || p.party?.toLowerCase().includes(q) || p.candidate_number?.includes(q)
    const matchRole = !filterRole || p.role === filterRole
    return matchSearch && matchRole
  })

  // ── Login Screen ──────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="fixed inset-0 z-[200] bg-black flex items-center justify-center">
        <div className="w-full max-w-sm p-8 bg-slate-950 border border-white/10 rounded-[6px] shadow-2xl">
          <div className="flex justify-between items-center mb-8">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Shield className="text-indigo-500" size={18} />
                <h1 className="text-lg font-black text-white uppercase tracking-tighter">SUPERADMIN</h1>
              </div>
              <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">Corruptômetro — Acesso Restrito</p>
            </div>
            <button onClick={onClose}><X size={18} className="text-slate-700 hover:text-white transition-colors" /></button>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full p-4 bg-black border border-white/10 text-white rounded-[6px] outline-none focus:border-indigo-500 text-sm transition-colors"
              placeholder="Senha de administrador" autoFocus
            />
            <button type="submit" className="w-full p-4 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-widest rounded-[6px] transition-all text-sm">
              ENTRAR
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Scan Functions ───────────────────────────────────────────────────────
  const handleScanPolitician = async (politician) => {
    setScanningId(politician.id)
    setScanLogs(prev => ({ ...prev, [politician.id]: ['Iniciando scan expandido...'] }))
    try {
      const { data, error } = await supabase.functions.invoke('scan-politician', {
        body: {
          name: politician.name,
          politicianId: politician.id,
          saveToDb: true,
          year: scrapeYear // Passa o ano selecionado na aba 'Raspagem'
        },
      })
      if (error) throw new Error(error.message)
      setScanLogs(prev => ({ ...prev, [politician.id]: data.log || [] }))
      await loadData()
    } catch (err) {
      setScanLogs(prev => ({ ...prev, [politician.id]: [`Erro: ${err.message}`] }))
    }
    setScanningId(null)
  }

  const handleScanAll = async () => {
    if (!confirm(`Escanear TODOS os ${filtered.length} políticos no banco? Isso pode demorar.`)) return
    setScanAllActive(true)
    setScanProgress({ current: 0, total: filtered.length })
    for (let i = 0; i < filtered.length; i++) {
      setScanProgress({ current: i + 1, total: filtered.length })
      await handleScanPolitician(filtered[i])
      // Small delay between requests to respect rate limits
      await new Promise(r => setTimeout(r, 2000))
    }
    setScanAllActive(false)
    setScanProgress({ current: 0, total: 0 })
  }

  const handleImportAllTSE = async () => {
    if (!confirm('Importar todos os estados e cargos do TSE? Isso fará muitas chamadas.')) return
    setImporting(true)
    addLog('Iniciando importação em massa do TSE...')
    const CARGOS = ['1', '3', '5', '6', '7']
    let total = 0
    for (const estado of BRAZIL_STATES) {
      for (const cargo of CARGOS) {
        addLog(`Importando ${CARGO_ROLE_MAP[cargo]} / ${estado}...`)
        try {
          const { data } = await supabase.functions.invoke('scrape-tse', {
            body: { year: scrapeYear, state: estado, cargo },
          })
          if (data?.candidates?.length > 0) {
            for (const c of data.candidates) {
              await supabase.from('politicians').insert(c).select()
            }
            total += data.candidates.length
            addLog(`✓ ${estado} ${CARGO_ROLE_MAP[cargo]}: ${data.candidates.length} candidatos`)
          }
        } catch (e) {
          addLog(`Erro ${estado}/${cargo}: ${e.message}`)
        }
        await new Promise(r => setTimeout(r, 500))
      }
    }
    addLog(`✓ Importação concluída: ${total} candidatos`)
    await loadData()
    setImporting(false)
  }

  // ── Admin Panel ───────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[200] bg-[#030609] overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">

        {/* Header */}
        <div className="flex justify-between items-center mb-6 sticky top-0 bg-[#030609] py-4 border-b border-white/5 z-10">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="text-indigo-500" size={18} />
              <h1 className="text-xl font-black text-white uppercase tracking-tighter">SUPERADMIN</h1>
            </div>
            <div className="flex gap-4 mt-1">
              <span className="text-[9px] text-slate-600 font-bold uppercase tracking-widest flex items-center gap-1">
                <Database size={10} /> {stats.politicians} políticos
              </span>
              <span className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">
                {stats.scandals} escândalos
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={loadData} title="Recarregar" className="p-2.5 text-slate-600 hover:text-white transition-colors">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="p-2.5 bg-white/5 hover:bg-rose-500/20 hover:text-rose-500 text-slate-500 rounded-[6px] transition-all">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-black/40 p-1 rounded-[6px] border border-white/5">
          {['politicians', 'scandals', 'scraping'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-[4px] transition-all ${tab === t ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-white'}`}>
              {t === 'politicians' ? '🧑 Políticos' : t === 'scandals' ? '⚠️ Escândalos' : '🕷️ Raspagem'}
            </button>
          ))}
        </div>

        {/* ── TAB: POLITICIANS ─────────────────────────────────────────────── */}
        {tab === 'politicians' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-700" size={14} />
                <input value={searchPol} onChange={e => setSearchPol(e.target.value)}
                  className="w-full p-3 pl-9 bg-black border border-white/10 text-white text-sm rounded-[6px] outline-none focus:border-indigo-500"
                  placeholder="Buscar por nome, partido ou número..." />
              </div>
              <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
                className="p-3 bg-black border border-white/10 text-slate-400 text-xs rounded-[6px] outline-none focus:border-indigo-500 appearance-none px-4">
                <option value="">Todos os cargos</option>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button
                onClick={handleScanAll}
                disabled={scanAllActive || scanningId !== null}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-black uppercase tracking-wider rounded-[6px] transition-all shrink-0">
                <Globe size={14} /> {scanAllActive ? `${scanProgress.current}/${scanProgress.total}` : 'Escanear Todos'}
              </button>
              <button
                onClick={() => setEditingPolitician(emptyPolitician())}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-wider rounded-[6px] transition-all shrink-0">
                <Plus size={14} /> Novo
              </button>
            </div>

            {/* Bulk scan progress */}
            {scanAllActive && (
              <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-[6px]">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Activity size={10} className="animate-pulse" /> Escaneando — STF + Google + NewsAPI
                  </p>
                  <span className="text-[9px] font-black text-emerald-400 font-mono">
                    {scanProgress.current} / {scanProgress.total}
                  </span>
                </div>
                <div className="h-1.5 bg-black rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${scanProgress.total ? (scanProgress.current / scanProgress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            {loading
              ? <p className="text-center text-slate-700 py-16 text-sm">Carregando...</p>
              : filtered.length === 0
                ? <p className="text-center text-slate-800 py-16 text-xs uppercase tracking-widest">Nenhum resultado</p>
                : filtered.map(p => {
                  const polScandals = scandals.filter(s => s.politician_id === p.id)
                  const isExpanded = expandedPolitician === p.id
                  return (
                    <div key={p.id} className="bg-black/40 border border-white/5 rounded-[6px] overflow-hidden">
                      <div className="flex items-center gap-3 p-3 hover:bg-white/3 transition-all">
                        <div className="w-9 h-9 rounded-[4px] overflow-hidden bg-slate-900 border border-white/10 shrink-0">
                          {p.photo_url
                            ? <img src={p.photo_url} className="w-full h-full object-cover" onError={e => e.target.style.display = 'none'} />
                            : <div className="w-full h-full bg-slate-900" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-black text-white uppercase truncate">{p.name}</div>
                          <div className="text-[9px] text-slate-600 font-bold uppercase">
                            {p.candidate_number && `#${p.candidate_number} • `}{p.party} • {p.role}{p.state && ` • ${p.state}`}
                          </div>
                        </div>
                        <div className={`text-base font-black font-mono w-8 text-right ${p.status === 'safe' ? 'text-emerald-400' : p.status === 'warning' ? 'text-amber-400' : 'text-rose-500'}`}>
                          {p.score}
                        </div>
                        <div className="text-[9px] text-slate-700 font-bold w-8 text-center">
                          {polScandals.length > 0 && <span className="text-rose-500/70">{polScandals.length}⚠</span>}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => setExpandedPolitician(isExpanded ? null : p.id)}
                            className="p-1.5 text-slate-700 hover:text-slate-300 transition-colors">
                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                          <button
                            onClick={() => handleScanPolitician(p)}
                            disabled={scanningId !== null}
                            title="Escanear STF + Google + NewsAPI"
                            className="p-1.5 text-slate-700 hover:text-emerald-400 disabled:opacity-30 transition-colors">
                            {scanningId === p.id
                              ? <Activity size={13} className="animate-pulse text-emerald-400" />
                              : <Activity size={13} />
                            }
                          </button>
                          <button onClick={() => setEditingPolitician(p)} className="p-1.5 text-slate-700 hover:text-indigo-400 transition-colors"><Edit2 size={13} /></button>
                          <button onClick={() => deletePolitician(p.id, p.name)} className="p-1.5 text-slate-700 hover:text-rose-500 transition-colors"><Trash2 size={13} /></button>
                        </div>
                      </div>

                      {/* Expanded scandals */}
                      {isExpanded && (
                        <div className="border-t border-white/5 p-3 space-y-2 bg-black/20">
                          <div className="flex justify-between items-center mb-3">
                            <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Escândalos de {p.name}</p>
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleScanPolitician(p)}
                                disabled={scanningId !== null}
                                className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-500 hover:text-white text-[9px] font-black uppercase rounded-[4px] transition-all disabled:opacity-30">
                                {scanningId === p.id ? <Activity size={9} className="animate-pulse" /> : <Globe size={9} />}
                                {scanningId === p.id ? 'Escaneando...' : 'Escanear'}
                              </button>
                              <button
                                onClick={() => setEditingScandal({ ...emptyScandal(), politician_id: p.id })}
                                className="flex items-center gap-1 px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600 text-rose-500 hover:text-white text-[9px] font-black uppercase rounded-[4px] transition-all">
                                <Plus size={10} /> Adicionar
                              </button>
                            </div>
                          </div>

                          {/* Scan log for this politician */}
                          {scanLogs[p.id]?.length > 0 && (
                            <div className="p-2 bg-black rounded-[4px] font-mono text-[8px] space-y-0.5 max-h-24 overflow-y-auto mb-2">
                              {scanLogs[p.id].map((line, i) => (
                                <div key={i} className={line.startsWith('✓') ? 'text-emerald-600' : line.startsWith('Erro') ? 'text-rose-600' : 'text-slate-700'}>
                                  {line}
                                </div>
                              ))}
                            </div>
                          )}

                          {polScandals.length === 0
                            ? <p className="text-[10px] text-slate-800 text-center py-4 uppercase tracking-widest">Nenhum escândalo registrado</p>
                            : polScandals.map(s => (
                              <div key={s.id} className="flex items-start gap-3 p-2.5 bg-white/3 rounded-[4px]">
                                <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded-[3px] shrink-0 mt-0.5 ${s.severity === 'high' ? 'bg-rose-500 text-white' : 'bg-amber-500 text-black'}`}>
                                  {s.severity}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11px] font-bold text-white truncate">{s.title}</p>
                                  <p className="text-[9px] text-slate-600 line-clamp-1">{s.caption}</p>
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  <button onClick={() => setEditingScandal(s)} className="p-1 text-slate-700 hover:text-indigo-400 transition-colors"><Edit2 size={11} /></button>
                                  <button onClick={() => deleteScandal(s.id, p.id, s.title)} className="p-1 text-slate-700 hover:text-rose-500 transition-colors"><Trash2 size={11} /></button>
                                </div>
                              </div>
                            ))
                          }
                        </div>
                      )}
                    </div>
                  )
                })
            }
          </div>
        )}

        {/* ── TAB: SCANDALS ────────────────────────────────────────────────── */}
        {tab === 'scandals' && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                onClick={() => setEditingScandal(emptyScandal())}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-wider rounded-[6px] transition-all">
                <Plus size={14} /> Novo Escândalo
              </button>
            </div>

            {loading
              ? <p className="text-center text-slate-700 py-16 text-sm">Carregando...</p>
              : scandals.length === 0
                ? <p className="text-center text-slate-800 py-16 text-xs uppercase tracking-widest">Nenhum escândalo registrado</p>
                : scandals.map(s => (
                  <div key={s.id} className="p-4 bg-black/40 border border-white/5 rounded-[6px]">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded-[3px] ${s.severity === 'high' ? 'bg-rose-500 text-white' : 'bg-amber-500 text-black'}`}>
                          {s.severity}
                        </span>
                        <span className="text-[9px] text-indigo-400 font-black uppercase">{s.politicians?.name}</span>
                        <span className="text-[9px] text-slate-700">• {new Date(s.date_occurrence).getFullYear()}</span>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => setEditingScandal(s)} className="p-1.5 text-slate-700 hover:text-indigo-400 transition-colors"><Edit2 size={13} /></button>
                        <button onClick={() => deleteScandal(s.id, s.politician_id, s.title)} className="p-1.5 text-slate-700 hover:text-rose-500 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </div>
                    <p className="text-xs font-black text-white mb-1">{s.title}</p>
                    <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed">{s.caption}</p>
                    {s.news_url && (
                      <a href={s.news_url} target="_blank" rel="noopener noreferrer"
                        className="text-[9px] text-indigo-500/50 hover:text-indigo-400 transition-colors mt-1 block truncate">
                        {s.news_url}
                      </a>
                    )}
                  </div>
                ))
            }
          </div>
        )}

        {/* ── TAB: SCRAPING ────────────────────────────────────────────────── */}
        {tab === 'scraping' && (
          <div className="space-y-5">
            <div className="p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-[6px]">
              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1 flex items-center gap-2">
                <Zap size={12} /> Raspagem Automática — TSE + STF
              </p>
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Conecta ao <strong className="text-slate-400">TSE Dados Abertos</strong> e ao <strong className="text-slate-400">STF</strong> para importar
                candidatos e cruzar com dados de processos criminais públicos. O score é calculado automaticamente conforme os escândalos registrados.
              </p>
            </div>

            {/* Controls */}
            <div className="grid grid-cols-3 gap-3">
              <SelectField label="Ano da Eleição" value={scrapeYear} onChange={setScrapeYear}
                options={[{ value: '2026', label: '2026' }, { value: '2024', label: '2024' }, { value: '2022', label: '2022' }]} />
              <SelectField label="Estado" value={scrapeState} onChange={setScrapeState}
                options={[{ value: '', label: 'Todos' }, ...BRAZIL_STATES.map(s => ({ value: s, label: s }))]} />
              <SelectField label="Cargo" value={scrapeCargo} onChange={setScrapeCargo} options={TSE_CARGOS} />
            </div>

            <button
              onClick={handleScrape} disabled={scraping}
              className="w-full flex items-center justify-center gap-2 p-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-black uppercase tracking-widest text-xs rounded-[6px] transition-all">
              {scraping
                ? <><RefreshCw className="animate-spin" size={16} /> Raspando...</>
                : <><Download size={16} /> Raspar TSE + STF</>
              }
            </button>

            <button
              onClick={handleImportAllTSE} disabled={importing || scraping}
              className="w-full flex items-center justify-center gap-2 p-4 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-slate-400 hover:text-white font-black uppercase tracking-widest text-xs rounded-[6px] transition-all border border-white/5">
              {importing
                ? <><RefreshCw className="animate-spin" size={14} /> Importando todos os estados...</>
                : <><Globe size={14} /> Importar Todos os Estados + Cargos (TSE)</>
              }
            </button>

            {/* Log */}
            {scrapeLog.length > 0 && (
              <div className="p-4 bg-black border border-white/5 rounded-[6px] font-mono text-[10px] space-y-1 max-h-48 overflow-y-auto">
                {scrapeLog.map((entry, i) => (
                  <div key={i} className={`flex gap-3 ${entry.type === 'success' ? 'text-emerald-500' : entry.type === 'warn' ? 'text-amber-400' : entry.type === 'dim' ? 'text-slate-700' : 'text-slate-500'}`}>
                    <span className="text-slate-800 shrink-0">{entry.time}</span>
                    <span>{entry.msg}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Results */}
            {scrapeResults.length > 0 && (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-black text-white uppercase tracking-widest">
                    {scrapeResults.length} candidatos encontrados
                  </p>
                  <button onClick={importAll} disabled={importing}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-wider rounded-[6px] transition-all">
                    {importing ? <RefreshCw className="animate-spin" size={12} /> : <CheckCircle size={12} />}
                    Importar Todos
                  </button>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {scrapeResults.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-white/3 border border-white/5 rounded-[6px]">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-white uppercase truncate">{c.name || '(sem nome)'}</p>
                        <p className="text-[9px] text-slate-600 font-bold uppercase">
                          #{c.candidate_number} • {c.party} • {c.role} • {c.state}
                        </p>
                      </div>
                      <button onClick={() => importOne(c)}
                        className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-400 hover:text-white text-[9px] font-black uppercase tracking-wider rounded-[4px] transition-all shrink-0">
                        Importar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Deploy info */}
            <div className="p-4 bg-white/3 border border-white/5 rounded-[6px] space-y-3">
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                <Zap size={10} /> Deploy + configuração de API keys
              </p>
              <div className="font-mono text-[9px] text-slate-600 space-y-1">
                <p className="text-slate-500"># 1. Login e link do projeto</p>
                <p>npx supabase login</p>
                <p>npx supabase link --project-ref qnilklhhudxepluaogxz</p>
                <p className="text-slate-500 mt-2"># 2. Deploy das funções</p>
                <p>npx supabase functions deploy scrape-tse</p>
                <p>npx supabase functions deploy scan-politician</p>
                <p className="text-slate-500 mt-2"># 3. API keys para o scan (escolha uma ou mais)</p>
                <p>npx supabase secrets set SERPAPI_KEY=<span className="text-indigo-500">sua_chave</span>  <span className="text-slate-700"># serpapi.com</span></p>
                <p>npx supabase secrets set NEWS_API_KEY=<span className="text-indigo-500">sua_chave</span>  <span className="text-slate-700"># newsapi.org</span></p>
                <p>npx supabase secrets set GOOGLE_API_KEY=<span className="text-indigo-500">sua_chave</span>  <span className="text-slate-700"># console.cloud.google.com</span></p>
                <p>npx supabase secrets set GOOGLE_CSE_ID=<span className="text-indigo-500">seu_id</span>    <span className="text-slate-700"># Custom Search Engine</span></p>
              </div>
              <p className="text-[10px] text-slate-700 leading-relaxed border-t border-white/5 pt-2">
                Sem as API keys, apenas o STF é consultado (gratuito). Com SerpAPI o Google é consultado com 3 queries diferentes por político.
              </p>
            </div>
          </div>
        )}

      </div>

      {/* Modals */}
      {editingPolitician && (
        <PoliticianFormModal
          politician={editingPolitician}
          onSave={savePolitician}
          onClose={() => setEditingPolitician(null)}
        />
      )}

      {editingScandal && (
        <ScandalFormModal
          scandal={editingScandal}
          politicians={politicians}
          onSave={saveScandal}
          onClose={() => setEditingScandal(null)}
        />
      )}
    </div>
  )
}
