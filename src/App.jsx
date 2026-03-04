import { useState, useEffect, useRef } from "react";

// ── APIs ──────────────────────────────────────────────────────────────────────
const CAMARA_API = "https://dadosabertos.camara.leg.br/api/v2";
const TRANSP_KEY = import.meta.env.VITE_TRANSPARENCIA_API_KEY || "";

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtBRL = v => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(v);

const UFS = ["Todos","AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];
const ANOS = ["Todos","2025","2024","2023","2022"];
const PARTIDOS = ["Todos","AVANTE","CIDADANIA","MDB","NOVO","PCdoB","PDT","PL","PODE","PP","PRD","PSB","PSD","PSDB","PSOL","PT","PV","REDE","REPUBLICANOS","SOLIDARIEDADE","UNIÃO"];

// ── Classificação local (fallback sem IA) ────────────────────────────────────
function classificarLocal(despesas) {
  const total = despesas.reduce((s, d) => s + (d.valorLiquido || 0), 0);
  const fornecedores = new Set(despesas.map(d => d.cnpjCpfFornecedor).filter(Boolean));
  const maiorDespesa = Math.max(...despesas.map(d => d.valorLiquido || 0), 0);
  const numTransacoes = despesas.length;

  // Concentração em poucos fornecedores é suspeito
  const concentracao = fornecedores.size > 0 ? numTransacoes / fornecedores.size : 0;

  // Critérios baseados na cota parlamentar (limite ~R$ 150k/mês = R$ 1.8M/ano)
  if (total > 120000 || maiorDespesa > 50000 || concentracao > 8) {
    return { classificacao: "suspeito", score: Math.min(95, 65 + Math.floor(total/5000)), motivo: total > 120000 ? "Gastos acima da média da cota" : maiorDespesa > 50000 ? "Despesa unitária muito elevada" : "Alta concentração em poucos fornecedores" };
  }
  if (total > 60000 || maiorDespesa > 20000 || concentracao > 5) {
    return { classificacao: "alerta", score: Math.min(64, 35 + Math.floor(total/3000)), motivo: total > 60000 ? "Gastos elevados, requer atenção" : "Padrão de gastos atípico" };
  }
  if (total === 0) {
    return { classificacao: "ok", score: 5, motivo: "Sem despesas registradas em 2024" };
  }
  return { classificacao: "ok", score: Math.max(5, Math.floor(total/3000)), motivo: "Gastos dentro do padrão esperado" };
}

// ── Classificação por IA ──────────────────────────────────────────────────────
async function classificarDeputado(deputado, despesas) {
  try {
    const totalGasto = despesas.reduce((s, d) => s + (d.valorLiquido || 0), 0);
    const numFornecedores = new Set(despesas.map(d => d.cnpjCpfFornecedor)).size;
    const tiposDespesa = [...new Set(despesas.map(d => d.tipoDespesa))];
    const maiorDespesa = Math.max(...despesas.map(d => d.valorLiquido || 0), 0);

    const res = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        system: `Você classifica gastos de deputados brasileiros. Responda APENAS com JSON puro sem markdown:
{"classificacao":"ok"|"alerta"|"suspeito","score":0-100,"motivo":"frase curta até 70 chars"}
Critérios: ok=padrão normal, alerta=pontos atenção, suspeito=irregularidades claras`,
        messages: [{
          role: "user",
          content: `Deputado: ${deputado.nome} (${deputado.siglaPartido}/${deputado.siglaUf})
Total gasto cota: ${fmtBRL(totalGasto)}
Fornecedores distintos: ${numFornecedores}
Maior despesa única: ${fmtBRL(maiorDespesa)}
Transações: ${despesas.length}
Categorias: ${tiposDespesa.slice(0,4).join(", ")}`
        }],
      }),
    });
    const data = await res.json();
    const txt = data.content?.map(c => c.text || "").join("") || "{}";
    return JSON.parse(txt.replace(/```json|```/g, "").trim());
  } catch {
    // Fallback local inteligente — usa regras baseadas nos dados reais
    return classificarLocal(despesas);
  }
}

// ── Cores ─────────────────────────────────────────────────────────────────────
const COR = {
  ok:       { bg: "rgba(0,212,100,0.07)",  border: "rgba(0,212,100,0.25)",  text: "#00d464", label: "OK",       dot: "#00d464" },
  alerta:   { bg: "rgba(255,196,0,0.07)",  border: "rgba(255,196,0,0.25)",  text: "#ffc400", label: "ALERTA",   dot: "#ffc400" },
  suspeito: { bg: "rgba(255,45,85,0.07)",  border: "rgba(255,45,85,0.25)",  text: "#ff2d55", label: "SUSPEITO", dot: "#ff2d55" },
  loading:  { bg: "rgba(255,255,255,0.02)",border: "rgba(255,255,255,0.07)",text: "#444",    label: "...",      dot: "#333"    },
};

// ── Ícones ────────────────────────────────────────────────────────────────────
const IconShield = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const IconSearch = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>;
const IconChevron = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>;
const IconAlert = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const IconUpload = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;

// ── Card Deputado ─────────────────────────────────────────────────────────────
function CardDeputado({ dep, onClick }) {
  const c = COR[dep.classificacao || "loading"];
  return (
    <div onClick={() => onClick(dep)} style={{
      display: "flex", alignItems: "center", gap: "12px",
      background: c.bg, border: `1px solid ${c.border}`,
      borderRadius: "8px", padding: "11px 14px", cursor: "pointer",
      transition: "opacity 0.15s",
    }}>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <img src={dep.urlFoto} alt="" onError={e => { e.target.style.display="none"; }}
          style={{ width: "42px", height: "42px", borderRadius: "50%", objectFit: "cover", border: `2px solid ${c.dot}`, display: "block" }} />
        <div style={{ position: "absolute", bottom: 0, right: 0, width: "9px", height: "9px", borderRadius: "50%", background: c.dot, border: "2px solid #0a0c0f" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: "700", color: "#f2f2f2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dep.nome}</div>
        <div style={{ fontSize: "11px", color: "#999", marginTop: "2px", fontWeight: "500" }}>{dep.siglaPartido} · {dep.siglaUf}</div>
        {dep.motivo && <div style={{ fontSize: "10px", color: c.text, marginTop: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dep.motivo}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
        <span style={{ fontSize: "9px", padding: "2px 8px", borderRadius: "3px", background: `${c.dot}33`, color: c.dot, fontWeight: "800", letterSpacing: "0.08em" }}>{c.label}</span>
        {dep.totalGasto > 0 && <span style={{ fontSize: "10px", color: "#bbb", fontWeight: "600" }}>{fmtBRL(dep.totalGasto)}</span>}
      </div>
      <span style={{ color: "#777" }}><IconChevron /></span>
    </div>
  );
}

// ── Perfil Deputado ───────────────────────────────────────────────────────────
function TelaPerfilDeputado({ dep, onVoltar, s }) {
  const [despesas, setDespesas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState("despesas");
  const c = COR[dep.classificacao || "loading"];

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${CAMARA_API}/deputados/${dep.id}/despesas?ano=2024&itens=50`);
        const data = await res.json();
        setDespesas(data.dados || []);
      } catch {}
      setCarregando(false);
    })();
  }, [dep.id]);

  const porTipo = despesas.reduce((acc, d) => { acc[d.tipoDespesa] = (acc[d.tipoDespesa]||0)+d.valorLiquido; return acc; }, {});
  const tiposOrdenados = Object.entries(porTipo).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const maxV = tiposOrdenados[0]?.[1]||1;

  return (
    <div style={s.app}>
      <div style={s.grid} />
      <nav style={s.nav}>
        <div style={s.logo}><IconShield /> ANTICORRUPÇÃO.BR</div>
        <button onClick={onVoltar} style={{ background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"#777",padding:"5px 12px",borderRadius:"6px",fontSize:"11px",fontFamily:"inherit",cursor:"pointer" }}>← VOLTAR</button>
      </nav>
      <div style={{ ...s.main, maxWidth: "800px" }}>
        <div style={{ display:"flex",gap:"20px",alignItems:"center",background:c.bg,border:`1px solid ${c.border}`,borderRadius:"12px",padding:"22px",marginBottom:"22px" }}>
          <img src={dep.urlFoto} alt="" style={{ width:"72px",height:"72px",borderRadius:"50%",objectFit:"cover",border:`3px solid ${c.dot}`,flexShrink:0 }} />
          <div style={{ flex:1 }}>
            <h2 style={{ margin:0,fontSize:"20px",fontWeight:"800",color:"#ffffff",letterSpacing:"-0.01em" }}>{dep.nome}</h2>
            <div style={{ display:"flex",gap:"6px",marginTop:"8px",flexWrap:"wrap" }}>
              {[dep.siglaPartido, dep.siglaUf, "Deputado Federal"].map((t,i)=>(
                <span key={i} style={{ fontSize:"10px",padding:"3px 10px",borderRadius:"4px",background:"rgba(255,255,255,0.1)",color:"#bbb",letterSpacing:"0.06em",fontWeight:"600" }}>{t}</span>
              ))}
            </div>
            {dep.motivo && <div style={{ marginTop:"10px",fontSize:"12px",color:c.text,fontWeight:"600" }}>⚡ {dep.motivo}</div>}
          </div>
          <div style={{ textAlign:"center",flexShrink:0 }}>
            <div style={{ fontSize:"32px",fontWeight:"800",color:c.dot,lineHeight:1 }}>{dep.score||"—"}</div>
            <div style={{ fontSize:"9px",color:"#888",letterSpacing:"0.08em",marginTop:"4px" }}>SCORE IA</div>
            <div style={{ fontSize:"11px",fontWeight:"800",color:c.text,marginTop:"3px",letterSpacing:"0.06em" }}>{c.label}</div>
          </div>
        </div>

        <div style={{ display:"flex",gap:"4px",borderBottom:"1px solid rgba(255,255,255,0.06)",marginBottom:"18px" }}>
          {[{id:"despesas",label:"💳 DESPESAS 2024"},{id:"grafico",label:"📊 POR CATEGORIA"}].map(a=>(
            <button key={a.id} onClick={()=>setAba(a.id)} style={{ padding:"10px 16px",background:"transparent",border:"none",borderBottom:aba===a.id?`2px solid ${c.dot}`:"2px solid transparent",color:aba===a.id?c.dot:"#888",fontSize:"11px",fontFamily:"inherit",fontWeight:"700",letterSpacing:"0.08em",cursor:"pointer",marginBottom:"-1px" }}>{a.label}</button>
          ))}
        </div>

        {carregando ? (
          <div style={{ textAlign:"center",padding:"40px",color:"#444",fontSize:"12px" }}>Carregando dados...</div>
        ) : aba==="despesas" ? (
          <div style={{ display:"flex",flexDirection:"column",gap:"7px" }}>
            {despesas.length===0 && <div style={{ color:"#444",fontSize:"12px",textAlign:"center",padding:"40px" }}>Nenhuma despesa em 2024</div>}
            {despesas.slice(0,25).map((d,i)=>(
              <div key={i} style={{ display:"flex",gap:"12px",alignItems:"center",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"8px",padding:"12px 16px" }}>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontSize:"12px",fontWeight:"700",color:"#f0f0f0",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{d.nomeFornecedor||"N/D"}</div>
                  <div style={{ fontSize:"10px",color:"#888",marginTop:"3px",letterSpacing:"0.04em" }}>{d.tipoDespesa} · {d.dataDocumento?.substring(0,10)}</div>
                </div>
                <div style={{ fontSize:"13px",fontWeight:"800",color:d.valorLiquido>10000?"#ff4d6d":d.valorLiquido>5000?"#ffcc00":"#aaa",flexShrink:0 }}>{fmtBRL(d.valorLiquido)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"8px",padding:"22px" }}>
            <div style={{ fontSize:"10px",color:"#555",letterSpacing:"0.1em",marginBottom:"18px" }}>GASTOS POR CATEGORIA — 2024</div>
            {tiposOrdenados.map(([tipo,valor],i)=>(
              <div key={i} style={{ marginBottom:"12px" }}>
                <div style={{ display:"flex",justifyContent:"space-between",marginBottom:"4px" }}>
                  <span style={{ fontSize:"11px",color:"#bbb" }}>{tipo.substring(0,48)}</span>
                  <span style={{ fontSize:"11px",fontWeight:"800",color:"#f0f0f0" }}>{fmtBRL(valor)}</span>
                </div>
                <div style={{ height:"5px",background:"rgba(255,255,255,0.05)",borderRadius:"3px" }}>
                  <div style={{ height:"100%",borderRadius:"3px",width:`${(valor/maxV)*100}%`,background:`linear-gradient(90deg,${c.dot},${c.dot}77)` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tela Upload ───────────────────────────────────────────────────────────────
function TelaUpload({ s, setTela }) {
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState(null);
  const [analisando, setAnalisando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const inputRef = useRef(null);
  const corRisco = { baixo:"#00d464", medio:"#ffc400", alto:"#ff6b2b", critico:"#ff2d55" };

  const analisar = async () => {
    if (!texto.trim() && !arquivo) return;
    setAnalisando(true);
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000,
          system: `Analise documentos em busca de corrupção. Responda APENAS em JSON sem markdown:
{"risco":"baixo|medio|alto|critico","score":0-100,"alertas":[{"tipo":"string","descricao":"string"}],"resumo":"string"}`,
          messages: [{ role: "user", content: `Analise:\n\n${texto || arquivo}` }],
        }),
      });
      const data = await res.json();
      const txt = data.content?.map(c=>c.text||"").join("")||"{}";
      setResultado(JSON.parse(txt.replace(/```json|```/g,"").trim()));
    } catch {
      setResultado({ risco:"medio",score:50,alertas:[{tipo:"Demo",descricao:"Configure API Anthropic para análise real."}],resumo:"Modo demonstração." });
    }
    setAnalisando(false);
  };

  return (
    <div style={s.app}>
      <div style={s.grid}/>
      <nav style={s.nav}>
        <div style={s.logo}><IconShield /> ANTICORRUPÇÃO.BR</div>
        <div style={s.navLinks}>
          <button style={s.navBtn(false)} onClick={()=>setTela("lista")}>DEPUTADOS</button>
          <button style={s.navBtn(true)}>UPLOAD DOC</button>
        </div>
      </nav>
      <div style={{...s.main,maxWidth:"620px"}}>
        <div style={{marginBottom:"28px"}}>
          <div style={{fontSize:"10px",color:"#555",letterSpacing:"0.15em",marginBottom:"6px"}}>ANÁLISE POR IA</div>
          <h2 style={{margin:0,fontSize:"20px",fontWeight:"800",color:"#fff"}}>Analisar Documento</h2>
          <p style={{color:"#555",fontSize:"12px",marginTop:"6px"}}>IA detecta irregularidades em contratos e documentos públicos</p>
        </div>
        <div onClick={()=>inputRef.current?.click()} style={{border:"2px dashed rgba(0,212,170,0.2)",borderRadius:"10px",padding:"28px",textAlign:"center",cursor:"pointer",marginBottom:"14px",background:arquivo?"rgba(0,212,170,0.04)":"transparent"}}>
          <input ref={inputRef} type="file" accept=".pdf,.txt,.doc,.docx" style={{display:"none"}} onChange={e=>setArquivo(e.target.files[0]?.name||null)}/>
          <div style={{color:"#555",marginBottom:"6px"}}><IconUpload/></div>
          <div style={{fontSize:"12px",color:arquivo?"#00d4aa":"#555"}}>{arquivo?`✓ ${arquivo}`:"Clique para selecionar arquivo"}</div>
        </div>
        <textarea value={texto} onChange={e=>setTexto(e.target.value)} placeholder="Ou cole o texto do documento aqui..." rows={5}
          style={{width:"100%",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"8px",color:"#ccc",fontSize:"12px",fontFamily:"inherit",padding:"12px",resize:"vertical",outline:"none",boxSizing:"border-box",marginBottom:"14px"}}/>
        <button onClick={analisar} disabled={analisando||(!texto&&!arquivo)} style={{width:"100%",padding:"13px",background:"#00d4aa",border:"none",borderRadius:"8px",color:"#0a0c0f",fontWeight:"800",fontSize:"12px",fontFamily:"inherit",letterSpacing:"0.08em",cursor:"pointer",marginBottom:"18px"}}>
          {analisando?"ANALISANDO...":"🔍 ANALISAR COM IA"}
        </button>
        {resultado&&(
          <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"10px",padding:"18px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
              <span style={{fontSize:"11px",fontWeight:"700",color:"#ccc",letterSpacing:"0.06em"}}>RESULTADO</span>
              <div style={{display:"flex",alignItems:"center",gap:"8px",background:`${corRisco[resultado.risco]}22`,border:`1px solid ${corRisco[resultado.risco]}44`,borderRadius:"6px",padding:"5px 12px"}}>
                <span style={{fontSize:"18px",fontWeight:"800",color:corRisco[resultado.risco]}}>{resultado.score}</span>
                <div><div style={{fontSize:"9px",color:"#555"}}>SCORE</div><div style={{fontSize:"10px",color:corRisco[resultado.risco],fontWeight:"700"}}>{resultado.risco?.toUpperCase()}</div></div>
              </div>
            </div>
            <p style={{fontSize:"12px",color:"#666",lineHeight:1.7,marginBottom:"14px"}}>{resultado.resumo}</p>
            {resultado.alertas?.map((a,i)=>(
              <div key={i} style={{display:"flex",gap:"10px",background:"rgba(255,45,85,0.05)",border:"1px solid rgba(255,45,85,0.12)",borderRadius:"6px",padding:"10px 12px",marginBottom:"7px"}}>
                <span style={{color:"#ff2d55",flexShrink:0,marginTop:"1px"}}><IconAlert/></span>
                <div><div style={{fontSize:"11px",fontWeight:"700",color:"#ccc"}}>{a.tipo}</div><div style={{fontSize:"11px",color:"#666",marginTop:"2px"}}>{a.descricao}</div></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── APP PRINCIPAL ─────────────────────────────────────────────────────────────
export default function AntiCorrupcaoBR() {
  const [tela, setTela] = useState("lista");
  const [deputados, setDeputados] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [progresso, setProgresso] = useState(0);
  const [busca, setBusca] = useState("");
  const [filtroUf, setFiltroUf] = useState("Todos");
  const [filtroPartido, setFiltroPartido] = useState("Todos");
  const [filtroClassif, setFiltroClassif] = useState("Todos");
  const [ordenar, setOrdenar] = useState("nome");
  const [depSelecionado, setDepSelecionado] = useState(null);

  const s = {
    app: { minHeight:"100vh",background:"#0a0c0f",color:"#e8e8e8",fontFamily:"'IBM Plex Mono','Courier New',monospace" },
    grid: { position:"fixed",inset:0,zIndex:0,pointerEvents:"none",backgroundImage:"linear-gradient(rgba(0,212,170,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,170,0.025) 1px,transparent 1px)",backgroundSize:"40px 40px" },
    nav: { position:"sticky",top:0,zIndex:100,background:"rgba(10,12,15,0.97)",backdropFilter:"blur(12px)",borderBottom:"1px solid rgba(0,212,170,0.1)",padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",height:"54px" },
    logo: { display:"flex",alignItems:"center",gap:"8px",color:"#00d4aa",fontWeight:"700",fontSize:"13px",letterSpacing:"0.08em",cursor:"pointer" },
    navLinks: { display:"flex",gap:"4px" },
    navBtn: (a) => ({ padding:"5px 12px",borderRadius:"4px",background:a?"rgba(0,212,170,0.1)":"transparent",border:a?"1px solid rgba(0,212,170,0.25)":"1px solid transparent",color:a?"#00d4aa":"#666",fontSize:"10px",fontFamily:"inherit",fontWeight:"600",letterSpacing:"0.06em",cursor:"pointer" }),
    main: { position:"relative",zIndex:1,maxWidth:"1000px",margin:"0 auto",padding:"28px 20px" },
  };

  useEffect(() => {
    (async () => {
      setCarregando(true);
      try {
        // Busca paginada — 100 por vez
        let lista = [];
        for (let pag = 1; pag <= 6; pag++) {
          const res = await fetch(
            `${CAMARA_API}/deputados?idLegislatura=57&itens=100&pagina=${pag}&ordem=ASC&ordenarPor=nome`,
            { headers: { "Accept": "application/json" } }
          );
          if (!res.ok) break;
          const text = await res.text();
          const data = JSON.parse(text);
          const lote = data.dados || [];
          if (lote.length === 0) break;
          lista = [...lista, ...lote];
        }

        if (lista.length === 0) {
          // Fallback sem idLegislatura
          const res2 = await fetch(`${CAMARA_API}/deputados?itens=100&ordem=ASC&ordenarPor=nome`, { headers: { "Accept": "application/json" } });
          const text2 = await res2.text();
          const data2 = JSON.parse(text2);
          lista = data2.dados || [];
        }

        // Remove duplicatas por ID
        const vistos = new Set();
        const listaUnica = lista.filter(d => { if (vistos.has(d.id)) return false; vistos.add(d.id); return true; });

        setDeputados(listaUnica.map(d => ({ ...d, classificacao: null, score: null, motivo: null, totalGasto: 0 })));
        setCarregando(false);
        lista = listaUnica;

        // Classifica em lotes de 5
        const LOTE = 5;
        const MAX = Math.min(lista.length, 50);
        for (let i = 0; i < MAX; i += LOTE) {
          const loteAtual = lista.slice(i, i + LOTE);
          await Promise.all(loteAtual.map(async (dep) => {
            try {
              const r = await fetch(
                `${CAMARA_API}/deputados/${dep.id}/despesas?ano=2024&itens=100`,
                { headers: { "Accept": "application/json" } }
              );
              const txt = await r.text();
              const d = JSON.parse(txt);
              const despesas = d.dados || [];
              const totalGasto = despesas.reduce((s, x) => s + (x.valorLiquido || 0), 0);
              // Classifica localmente primeiro (instantâneo)
              const classifLocal = classificarLocal(despesas);
              setDeputados(prev => prev.map(x => x.id === dep.id ? { ...x, ...classifLocal, totalGasto } : x));
              // Depois tenta melhorar com IA (se disponível)
              try {
                const classifIA = await classificarDeputado(dep, despesas);
                setDeputados(prev => prev.map(x => x.id === dep.id ? { ...x, ...classifIA, totalGasto } : x));
              } catch {}
            } catch (e) {
              // Classifica localmente se der qualquer erro
              const classifLocal = classificarLocal([]);
              setDeputados(prev => prev.map(x => x.id === dep.id ? { ...x, ...classifLocal, totalGasto: 0 } : x));
            }
          }));
          setProgresso(Math.min(99, Math.round(((i + LOTE) / MAX) * 100)));
          await new Promise(r => setTimeout(r, 600));
        }
        setProgresso(100);
      } catch (e) {
        console.error("Erro:", e);
        setCarregando(false);
      }
    })();
  }, []);

  // Gera listas dinâmicas de UF e Partido a partir dos dados reais
  const ufsDisponiveis = ["Todos", ...Array.from(new Set(deputados.map(d => d.siglaUf).filter(Boolean))).sort()];
  const partidosDisponiveis = ["Todos", ...Array.from(new Set(deputados.map(d => d.siglaPartido).filter(Boolean))).sort()];

  const buscaNorm = busca.toLowerCase().trim();
  const deputadosFiltrados = deputados.filter(d => {
    if (buscaNorm) {
      const nomeMatch = d.nome?.toLowerCase().includes(buscaNorm);
      const partidoMatch = d.siglaPartido?.toLowerCase().includes(buscaNorm);
      const ufMatch = d.siglaUf?.toLowerCase().includes(buscaNorm);
      if (!nomeMatch && !partidoMatch && !ufMatch) return false;
    }
    if (filtroUf !== "Todos" && d.siglaUf !== filtroUf) return false;
    if (filtroPartido !== "Todos" && d.siglaPartido !== filtroPartido) return false;
    if (filtroClassif !== "Todos" && d.classificacao !== filtroClassif) return false;
    return true;
  }).sort((a, b) => {
    if (ordenar === "nome") return (a.nome||"").localeCompare(b.nome||"");
    if (ordenar === "score") return (b.score || 0) - (a.score || 0);
    if (ordenar === "gasto") return (b.totalGasto || 0) - (a.totalGasto || 0);
    return 0;
  });

  const contOk = deputados.filter(d => d.classificacao === "ok").length;
  const contAlerta = deputados.filter(d => d.classificacao === "alerta").length;
  const contSuspeito = deputados.filter(d => d.classificacao === "suspeito").length;

  if (depSelecionado) return <TelaPerfilDeputado dep={depSelecionado} onVoltar={() => setDepSelecionado(null)} s={s} />;
  if (tela === "upload") return <TelaUpload s={s} setTela={setTela} />;

  return (
    <div style={s.app}>
      <div style={s.grid}/>
      <nav style={s.nav}>
        <div style={s.logo}><IconShield /> ANTICORRUPÇÃO.BR</div>
        <div style={s.navLinks}>
          <button style={s.navBtn(true)}>DEPUTADOS</button>
          <button style={s.navBtn(false)} onClick={() => setTela("upload")}>UPLOAD DOC</button>
        </div>
      </nav>

      <div style={s.main}>
        <div style={{ marginBottom:"20px" }}>
          <div style={{ fontSize:"10px",color:"#777",letterSpacing:"0.12em",marginBottom:"5px" }}>LEGISLATURA 57 · DADOS REAIS · API CÂMARA DOS DEPUTADOS</div>
          <h1 style={{ margin:0,fontSize:"22px",fontWeight:"800",color:"#ffffff" }}>Deputados Federais</h1>
        </div>

        {/* Barra progresso IA */}
        {progresso < 100 && !carregando && (
          <div style={{ marginBottom:"16px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"8px",padding:"12px 16px" }}>
            <div style={{ display:"flex",justifyContent:"space-between",marginBottom:"7px" }}>
              <span style={{ fontSize:"10px",color:"#aaa",letterSpacing:"0.08em",fontWeight:"600" }}>🤖 IA CLASSIFICANDO DEPUTADOS...</span>
              <span style={{ fontSize:"10px",color:"#00d4aa",fontWeight:"700" }}>{progresso}%</span>
            </div>
            <div style={{ height:"3px",background:"rgba(255,255,255,0.05)",borderRadius:"2px" }}>
              <div style={{ height:"100%",width:`${progresso}%`,background:"linear-gradient(90deg,#00d4aa,#00a882)",borderRadius:"2px",transition:"width 0.4s" }}/>
            </div>
          </div>
        )}

        {/* Stats clicáveis */}
        <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"8px",marginBottom:"16px" }}>
          {[
            { label:"TOTAL",    valor:deputados.length, cor:"#888",    key:"Todos"    },
            { label:"✓ OK",     valor:contOk,           cor:"#00d464", key:"ok"       },
            { label:"⚠ ALERTA", valor:contAlerta,        cor:"#ffc400", key:"alerta"   },
            { label:"🔴 SUSPEITO",valor:contSuspeito,    cor:"#ff2d55", key:"suspeito" },
          ].map((item,i) => (
            <div key={i} onClick={() => setFiltroClassif(filtroClassif===item.key&&i>0?"Todos":item.key)} style={{
              background: filtroClassif===item.key&&i>0 ? `${item.cor}11` : "rgba(255,255,255,0.02)",
              border: `1px solid ${filtroClassif===item.key&&i>0 ? item.cor+"33" : "rgba(255,255,255,0.07)"}`,
              borderTop: `2px solid ${item.cor}`, borderRadius:"8px", padding:"10px 14px",
              cursor:"pointer", textAlign:"center",
            }}>
              <div style={{ fontSize:"20px",fontWeight:"800",color:item.cor }}>{item.valor}</div>
              <div style={{ fontSize:"9px",color:"#999",letterSpacing:"0.08em",marginTop:"2px",fontWeight:"600" }}>{item.label}</div>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div style={{ display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"14px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"8px",padding:"12px 14px" }}>
          <div style={{ display:"flex",alignItems:"center",gap:"7px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:"6px",padding:"6px 10px",flex:"1",minWidth:"150px" }}>
            <IconSearch/>
            <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar deputado ou partido..."
              style={{ background:"transparent",border:"none",outline:"none",color:"#ccc",fontSize:"11px",fontFamily:"inherit",width:"100%" }}/>
          </div>
          {[
            {label:"UF", val:filtroUf, set:setFiltroUf, opts:ufsDisponiveis},
            {label:"Partido", val:filtroPartido, set:setFiltroPartido, opts:partidosDisponiveis},
          ].map((f,i)=>(
            <select key={i} value={f.val} onChange={e=>f.set(e.target.value)} style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:"6px",color:"#ccc",fontSize:"11px",fontFamily:"inherit",padding:"6px 10px",cursor:"pointer",outline:"none" }}>
              {f.opts.map(o=><option key={o} value={o} style={{background:"#161819"}}>{o}</option>)}
            </select>
          ))}
          <select value={ordenar} onChange={e=>setOrdenar(e.target.value)} style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:"6px",color:"#ccc",fontSize:"11px",fontFamily:"inherit",padding:"6px 10px",cursor:"pointer",outline:"none" }}>
            <option value="nome" style={{background:"#161819"}}>A–Z</option>
            <option value="score" style={{background:"#161819"}}>Maior risco</option>
            <option value="gasto" style={{background:"#161819"}}>Maior gasto</option>
          </select>
        </div>

        <div style={{ fontSize:"10px",color:"#888",marginBottom:"10px",letterSpacing:"0.06em",fontWeight:"600" }}>
          {deputadosFiltrados.length} DEPUTADOS ENCONTRADOS
        </div>

        {carregando ? (
          <div style={{ textAlign:"center",padding:"60px",color:"#444" }}>
            <div style={{ fontSize:"22px",marginBottom:"10px" }}>⏳</div>
            <div style={{ fontSize:"11px",letterSpacing:"0.1em" }}>CARREGANDO DEPUTADOS...</div>
          </div>
        ) : (
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:"7px" }}>
            {deputadosFiltrados.map(dep => <CardDeputado key={dep.id} dep={dep} onClick={setDepSelecionado}/>)}
          </div>
        )}
      </div>
    </div>
  );
}
