import { useState, useEffect, useRef } from "react";

// ── APIs ── v3.0 ─────────────────────────────────────────────────────────────
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
function CardDeputado({ dep, onClick, T }) {
  const c = COR[dep.classificacao || "loading"];
  const isDark = !T || T.appBg === "#0a0c0f";
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
        <div style={{ position: "absolute", bottom: 0, right: 0, width: "9px", height: "9px", borderRadius: "50%", background: c.dot, border: `2px solid ${T?.appBg||"#0a0c0f"}` }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: "700", color: T?.textPrimary||"#f2f2f2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dep.nome}</div>
        <div style={{ fontSize: "11px", color: T?.textSecondary||"#999", marginTop: "2px", fontWeight: "500" }}>{dep.siglaPartido} · {dep.siglaUf}</div>
        {dep.motivo && <div style={{ fontSize: "10px", color: c.text, marginTop: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dep.motivo}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
        <span style={{ fontSize: "9px", padding: "2px 8px", borderRadius: "3px", background: `${c.dot}33`, color: c.dot, fontWeight: "800", letterSpacing: "0.08em" }}>{c.label}</span>
        {dep.totalGasto > 0 && <span style={{ fontSize: "10px", color: T?.textSecondary||"#bbb", fontWeight: "600" }}>{fmtBRL(dep.totalGasto)}</span>}
      </div>
      <span style={{ color: T?.textMuted||"#777" }}><IconChevron /></span>
    </div>
  );
}


// ── Ícone por tipo de despesa ─────────────────────────────────────────────────
function iconeDespesa(tipo) {
  if (!tipo) return "📄";
  const t = tipo.toUpperCase();
  if (t.includes("COMBUSTÍVEL") || t.includes("COMBUSTIVEL")) return "⛽";
  if (t.includes("PASSAGEM") || t.includes("AÉREA") || t.includes("AEREA")) return "✈️";
  if (t.includes("ALIMENTAÇÃO") || t.includes("ALIMENTACAO") || t.includes("REFEIÇÃO")) return "🍽️";
  if (t.includes("ESCRITÓRIO") || t.includes("ESCRITORIO") || t.includes("LOCAÇÃO")) return "🏢";
  if (t.includes("TELEFON") || t.includes("POSTAL")) return "📱";
  if (t.includes("DIVULGAÇÃO") || t.includes("DIVULGACAO") || t.includes("PUBLICIDADE")) return "📢";
  if (t.includes("CONSULTORIA") || t.includes("ASSESSORIA")) return "🤝";
  if (t.includes("TÁXI") || t.includes("TAXI") || t.includes("UBER") || t.includes("VEÍCULO")) return "🚗";
  if (t.includes("HOSPEDAGEM") || t.includes("HOTEL")) return "🏨";
  if (t.includes("SEGURANÇA") || t.includes("SEGURANCA")) return "🛡️";
  return "📋";
}

function corValor(v) {
  if (v > 20000) return { cor: "#ff4d6d", bg: "rgba(255,77,109,0.1)", label: "ALTO" };
  if (v > 8000)  return { cor: "#ffd60a", bg: "rgba(255,214,10,0.1)",  label: "MÉDIO" };
  return               { cor: "#00d4aa", bg: "rgba(0,212,170,0.08)",   label: "" };
}

// ── Alertas inteligentes para leigos ─────────────────────────────────────────
function gerarAlertas(despesas) {
  const alertas = [];
  if (!despesas.length) return alertas;

  const total = despesas.reduce((s,d)=>s+(d.valorLiquido||0),0);
  const porFornecedor = {};
  const porTipo = {};
  despesas.forEach(d => {
    if (d.cnpjCpfFornecedor) porFornecedor[d.cnpjCpfFornecedor] = (porFornecedor[d.cnpjCpfFornecedor]||0)+1;
    if (d.tipoDespesa) porTipo[d.tipoDespesa] = (porTipo[d.tipoDespesa]||{total:0,count:0});
    if (d.tipoDespesa) { porTipo[d.tipoDespesa].total += d.valorLiquido||0; porTipo[d.tipoDespesa].count += 1; }
  });

  const fornMaisUsado = Object.entries(porFornecedor).sort((a,b)=>b[1]-a[1])[0];
  const tipoMaisGasto = Object.entries(porTipo).sort((a,b)=>b[1].total-a[1].total)[0];
  const numFornecedores = Object.keys(porFornecedor).length;
  const maiorDespesa = despesas.reduce((mx,d)=>d.valorLiquido>mx.valorLiquido?d:mx, despesas[0]);

  if (total > 120000)
    alertas.push({ nivel:"critico", icone:"🚨", titulo:"Gasto muito acima da média", texto:`Total de ${fmtBRL(total)} ultrapassa o padrão esperado de R$ 100 mil/ano para cota parlamentar.` });
  else if (total > 70000)
    alertas.push({ nivel:"atencao", icone:"⚠️", titulo:"Gasto elevado", texto:`Total de ${fmtBRL(total)} está acima da média dos deputados brasileiros.` });

  if (fornMaisUsado && fornMaisUsado[1] >= 8)
    alertas.push({ nivel:"atencao", icone:"🔁", titulo:"Fornecedor repetido com frequência", texto:`Um mesmo fornecedor aparece ${fornMaisUsado[1]} vezes nas despesas. Isso pode indicar favorecimento.` });

  if (numFornecedores > 30 && total < 20000)
    alertas.push({ nivel:"critico", icone:"🕵️", titulo:"Muitos fornecedores para valor baixo", texto:`${numFornecedores} fornecedores diferentes para um total de apenas ${fmtBRL(total)}. Padrão atípico.` });

  if (maiorDespesa && maiorDespesa.valorLiquido > 15000)
    alertas.push({ nivel:"atencao", icone:"💸", titulo:"Despesa unitária muito alta", texto:`Uma única despesa de ${fmtBRL(maiorDespesa.valorLiquido)} com "${maiorDespesa.nomeFornecedor}". Verifique se há justificativa.` });

  if (tipoMaisGasto && tipoMaisGasto[1].count > 15)
    alertas.push({ nivel:"info", icone:"📋", titulo:`Alta concentração em "${tipoMaisGasto[0]?.substring(0,35)}"`, texto:`${tipoMaisGasto[1].count} transações nessa categoria representam ${fmtBRL(tipoMaisGasto[1].total)} do total.` });

  if (alertas.length === 0)
    alertas.push({ nivel:"ok", icone:"✅", titulo:"Sem irregularidades detectadas", texto:"Os gastos deste deputado estão dentro do padrão esperado para o exercício de 2024." });

  return alertas;
}

// ── Perfil Deputado ───────────────────────────────────────────────────────────

// ── Componente de Navegação Global ──────────────────────────────────────────
function NavBar({ telaAtual, setTela, setTema, tema, s }) {
  const T = s.T; const dark = tema === "dark";
  const ITENS = [
    { id:"lista",    label:"DEPUTADOS",  emoji:"👥" },
    { id:"senado",   label:"SENADO",     emoji:"🏛️" },
    { id:"votacoes", label:"VOTAÇÕES",   emoji:"🗳️" },
    { id:"stf",      label:"STF",        emoji:"⚖️" },
  ];
  return (
    <nav style={s.nav}>
      {/* Logo */}
      <div style={s.logo} onClick={()=>setTela("lista")}>
        <IconShield/>
        <span style={{display:"flex",flexDirection:"column",lineHeight:1.1}}>
          <span style={{fontSize:"13px",fontWeight:"800",letterSpacing:"0.06em"}}>ANTICORRUPÇÃO</span>
          <span style={{fontSize:"9px",letterSpacing:"0.2em",color:T.textMuted,fontWeight:"600"}}>.BR · DADOS ABERTOS</span>
        </span>
      </div>
      {/* Itens de nav */}
      <div style={s.navLinks}>
        {ITENS.map(item => {
          const ativo = telaAtual === item.id;
          return (
            <button key={item.id}
              onClick={()=>setTela(item.id)}
              style={{
                display:"flex",alignItems:"center",gap:"6px",
                padding:"8px 16px",borderRadius:"6px",cursor:"pointer",
                fontFamily:"inherit",fontSize:"11px",fontWeight:"800",
                letterSpacing:"0.07em",transition:"all 0.15s",
                background: ativo ? "#00d4aa" : T.tagBg,
                color: ativo ? "#0a0e1a" : T.textSecondary,
                border: ativo ? "1px solid #00d4aa" : `1px solid ${T.cardBorder}`,
                boxShadow: ativo ? "0 0 12px #00d4aa44" : "none",
              }}>
              <span style={{fontSize:"14px"}}>{item.emoji}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
        {/* Separador */}
        <div style={{width:"1px",height:"20px",background:T.divider,margin:"0 4px"}}/>
        {/* Botão modo claro/escuro */}
        <button onClick={()=>setTema(dark?"light":"dark")}
          style={{display:"flex",alignItems:"center",gap:"6px",padding:"8px 12px",
            borderRadius:"6px",cursor:"pointer",background:T.tagBg,
            border:`1px solid ${T.cardBorder}`,color:T.textSecondary,
            fontFamily:"inherit",fontWeight:"700",fontSize:"11px"}}>
          <span style={{fontSize:"14px"}}>{dark?"☀️":"🌙"}</span>
          <span>{dark?"CLARO":"ESCURO"}</span>
        </button>
      </div>
    </nav>
  );
}

// ── Botão Voltar padronizado ──────────────────────────────────────────────────
function BotaoVoltar({ onClick, label, s }) {
  const T = s.T;
  return (
    <button onClick={onClick} style={{
      display:"inline-flex",alignItems:"center",gap:"10px",
      background:T.tagBg,
      border:`2px solid ${T.cardBorder}`,
      color:T.textPrimary,
      padding:"10px 20px",borderRadius:"8px",
      fontSize:"12px",fontFamily:"inherit",cursor:"pointer",
      fontWeight:"800",letterSpacing:"0.06em",marginBottom:"20px",
      transition:"all 0.15s",
    }}
    onMouseEnter={e=>{e.currentTarget.style.borderColor="#00d4aa";e.currentTarget.style.color="#00d4aa";}}
    onMouseLeave={e=>{e.currentTarget.style.borderColor=T.cardBorder;e.currentTarget.style.color=T.textPrimary;}}>
      <span style={{fontSize:"18px",lineHeight:1,fontWeight:"400"}}>←</span>
      <span>{label || "VOLTAR"}</span>
    </button>
  );
}

function TelaPerfilDeputado({ dep, onVoltar, s, tema, setTema }) {
  const [despesas, setDespesas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState("resumo");
  const [fornExpanded, setFornExpanded] = useState(null);
  const [ano, setAno] = useState(2025);
  const [votosDeputado, setVotosDeputado] = useState({}); // { votacaoId: tipoVoto }
  const [carregandoVotos, setCarregandoVotos] = useState(false);
  const c = COR[dep.classificacao || "loading"];
  const T = s.T;
  const dark = tema === "dark";

  // Carrega como o deputado votou nos temas sensíveis
  useEffect(() => {
    (async () => {
      setCarregandoVotos(true);
      const votos = {};
      await Promise.allSettled(TEMAS_SENSIVEIS.map(async (tema) => {
        try {
          const res = await fetch(`${CAMARA_API}/votacoes/${tema.votacaoId}/votos`);
          const data = await res.json();
          const voto = (data.dados||[]).find(v => v.deputado_?.id === dep.id);
          if (voto) votos[tema.id] = voto.tipoVoto;
          else votos[tema.id] = "ausente";
        } catch { votos[tema.id] = "ausente"; }
      }));
      setVotosDeputado(votos);
      setCarregandoVotos(false);
    })();
  }, [dep.id]);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      setFornExpanded(null);
      try {
        // Busca até 200 despesas (2 páginas de 100)
        const [r1, r2] = await Promise.allSettled([
          fetch(`${CAMARA_API}/deputados/${dep.id}/despesas?ano=${ano}&itens=100&pagina=1`).then(r=>r.json()),
          fetch(`${CAMARA_API}/deputados/${dep.id}/despesas?ano=${ano}&itens=100&pagina=2`).then(r=>r.json()),
        ]);
        const d1 = r1.status==="fulfilled" ? r1.value.dados||[] : [];
        const d2 = r2.status==="fulfilled" ? r2.value.dados||[] : [];
        setDespesas([...d1, ...d2]);
      } catch {}
      setCarregando(false);
    })();
  }, [dep.id, ano]);

  const porTipo = despesas.reduce((acc, d) => { acc[d.tipoDespesa] = (acc[d.tipoDespesa]||0)+d.valorLiquido; return acc; }, {});
  const tiposOrdenados = Object.entries(porTipo).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const maxV = tiposOrdenados[0]?.[1]||1;
  const alertas = gerarAlertas(despesas);
  const total = despesas.reduce((s,d)=>s+(d.valorLiquido||0),0);
  const fornecedores = new Set(despesas.map(d=>d.cnpjCpfFornecedor).filter(Boolean)).size;

  return (
    <div style={s.app}>
      <div style={s.grid} />
      <NavBar telaAtual="lista" setTela={(t)=>{if(t==="lista")onVoltar();}} setTema={setTema} tema={tema} s={s}/>
      <div style={{ ...s.main, maxWidth: "800px" }}>
        {/* Botão voltar + Breadcrumb */}
        <BotaoVoltar onClick={onVoltar} label="← VOLTAR PARA DEPUTADOS" s={s}/>
        <div style={{ display:"flex",alignItems:"center",gap:"8px",marginBottom:"20px",fontSize:"12px" }}>
          <span onClick={onVoltar} style={{ color:"#00d4aa",cursor:"pointer",fontWeight:"600" }}>👥 Deputados</span>
          <span style={{ color:T.textMuted }}>›</span>
          <span style={{ color:T.textSecondary,fontWeight:"500",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{dep.nome}</span>
        </div>
        <div style={{ display:"flex",gap:"20px",alignItems:"center",background:c.bg,border:`1px solid ${c.border}`,borderRadius:"12px",padding:"22px",marginBottom:"22px" }}>
          <img src={dep.urlFoto} alt="" style={{ width:"72px",height:"72px",borderRadius:"50%",objectFit:"cover",border:`3px solid ${c.dot}`,flexShrink:0 }} />
          <div style={{ flex:1 }}>
            <h2 style={{ margin:0,fontSize:"20px",fontWeight:"800",color:T.textPrimary,letterSpacing:"-0.01em" }}>{dep.nome}</h2>
            <div style={{ display:"flex",gap:"6px",marginTop:"8px",flexWrap:"wrap" }}>
              {[dep.siglaPartido, dep.siglaUf, "Deputado Federal"].map((t,i)=>(
                <span key={i} style={{ fontSize:"11px",padding:"4px 12px",borderRadius:"4px",background:T.tagBg,color:T.tagText,letterSpacing:"0.06em",fontWeight:"700" }}>{t}</span>
              ))}
            </div>
            {dep.motivo && <div style={{ marginTop:"10px",fontSize:"12px",color:c.text,fontWeight:"600" }}>⚡ {dep.motivo}</div>}
          </div>
          <div style={{ textAlign:"center",flexShrink:0 }}>
            <div style={{ fontSize:"32px",fontWeight:"800",color:c.dot,lineHeight:1 }}>{dep.score||"—"}</div>
            <div style={{ fontSize:"10px",color:T.textSecondary,letterSpacing:"0.08em",marginTop:"4px",fontWeight:"600" }}>SCORE IA</div>
            <div style={{ fontSize:"11px",fontWeight:"800",color:c.text,marginTop:"3px",letterSpacing:"0.06em" }}>{c.label}</div>
          </div>
        </div>

        {/* Abas + seletor de ano */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${T.divider}`,marginBottom:"20px",flexWrap:"wrap",gap:"8px" }}>
          <div style={{ display:"flex",gap:"4px" }}>
            {[
              {id:"resumo",   label:"🔍 RESUMO"},
              {id:"votos",    label:"🗳️ VOTAÇÕES"},
              {id:"despesas", label:"💳 DESPESAS"},
              {id:"grafico",  label:"📊 CATEGORIAS"},
            ].map(a=>(
              <button key={a.id} onClick={()=>setAba(a.id)} style={{ padding:"10px 16px",background:"transparent",border:"none",borderBottom:aba===a.id?`2px solid ${c.dot}`:"2px solid transparent",color:aba===a.id?c.dot:T.textSecondary,fontSize:"11px",fontFamily:"inherit",fontWeight:"700",letterSpacing:"0.08em",cursor:"pointer",marginBottom:"-1px" }}>{a.label}</button>
            ))}
          </div>
          {/* Seletor de ano */}
          <div style={{ display:"flex",gap:"5px",paddingBottom:"8px" }}>
            {[2022,2023,2024,2025,2026].map(a=>(
              <button key={a} onClick={()=>setAno(a)} style={{
                padding:"4px 10px",borderRadius:"20px",
                border:`1px solid ${a===ano?"#00d4aa":T.inputBorder}`,
                background:a===ano?"rgba(0,212,170,0.15)":T.tagBg,
                color:a===ano?"#00d4aa":T.textSecondary,
                fontSize:"11px",fontFamily:"inherit",fontWeight:"700",cursor:"pointer",transition:"all 0.15s"
              }}>{a}</button>
            ))}
          </div>
        </div>

        {carregando ? (
          <div style={{ textAlign:"center",padding:"60px",color:"#aaa",fontSize:"13px",letterSpacing:"0.06em" }}>
            <div style={{ fontSize:"28px",marginBottom:"12px" }}>⏳</div>Carregando dados...
          </div>

        ) : aba==="resumo" ? (
          <div style={{ display:"flex",flexDirection:"column",gap:"14px" }}>

            {/* Cards de estatísticas */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"10px" }}>
              {[
                { label:"Total gasto em 2024", valor:fmtBRL(total), icon:"💰", sub:"Cota parlamentar", cor: total>120000?"#ff4d6d":total>70000?"#ffd60a":"#00d4aa" },
                { label:"Pagamentos realizados", valor:despesas.length, icon:"🧾", sub:"Nº de notas fiscais", cor:"#aaa" },
                { label:"Empresas diferentes", valor:fornecedores, icon:"🏢", sub:"Fornecedores únicos", cor: fornecedores>40?"#ff4d6d":fornecedores<5&&despesas.length>10?"#ffd60a":"#aaa" },
              ].map((item,i)=>(
                <div key={i} style={{ background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"10px",padding:"16px",textAlign:"center" }}>
                  <div style={{ fontSize:"22px",marginBottom:"6px" }}>{item.icon}</div>
                  <div style={{ fontSize:"18px",fontWeight:"800",color:item.cor }}>{item.valor}</div>
                  <div style={{ fontSize:"11px",color:T.textPrimary,fontWeight:"600",marginTop:"4px" }}>{item.label}</div>
                  <div style={{ fontSize:"10px",color:T.textMuted,marginTop:"2px" }}>{item.sub}</div>
                </div>
              ))}
            </div>

            {/* Alertas explicativos */}
            <div style={{ background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"10px",padding:"20px" }}>
              <div style={{ fontSize:"11px",color:T.textLabel,letterSpacing:"0.1em",marginBottom:"16px",fontWeight:"700" }}>🤖 ANÁLISE DA IA — O QUE ENCONTRAMOS</div>
              <div style={{ display:"flex",flexDirection:"column",gap:"10px" }}>
                {alertas.map((a,i)=>{
                  const cores = {
                    critico: { bg:"rgba(255,77,109,0.08)", border:"rgba(255,77,109,0.25)", text:"#ff4d6d" },
                    atencao: { bg:"rgba(255,214,10,0.08)",  border:"rgba(255,214,10,0.25)",  text:"#ffd60a" },
                    info:    { bg:"rgba(0,212,170,0.06)",   border:"rgba(0,212,170,0.2)",    text:"#00d4aa" },
                    ok:      { bg:"rgba(0,212,100,0.06)",   border:"rgba(0,212,100,0.2)",    text:"#00d464" },
                  };
                  const cor = cores[a.nivel] || cores.info;
                  return (
                    <div key={i} style={{ background:cor.bg, border:`1px solid ${cor.border}`, borderRadius:"8px", padding:"14px 16px" }}>
                      <div style={{ display:"flex",alignItems:"center",gap:"10px",marginBottom:"6px" }}>
                        <span style={{ fontSize:"18px" }}>{a.icone}</span>
                        <span style={{ fontSize:"13px",fontWeight:"800",color:cor.text }}>{a.titulo}</span>
                      </div>
                      <p style={{ margin:0,fontSize:"12px",color:"#ccc",lineHeight:"1.7" }}>{a.texto}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top fornecedores */}
            {despesas.length > 0 && (() => {
              const porForn = {};
              despesas.forEach(d => {
                if (!d.nomeFornecedor) return;
                if (!porForn[d.nomeFornecedor]) porForn[d.nomeFornecedor] = { total:0, count:0, cnpj: d.cnpjCpfFornecedor };
                porForn[d.nomeFornecedor].total += d.valorLiquido||0;
                porForn[d.nomeFornecedor].count += 1;
              });
              // Inclui pagamentos individuais por fornecedor
              const todosOrdenados = Object.entries(porForn).sort((a,b)=>b[1].total-a[1].total);
              const top = todosOrdenados.slice(0,10);
              const restante = todosOrdenados.length - 10;
              return (
                <div style={{ background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"10px",padding:"20px" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px" }}>
                    <div style={{ fontSize:"11px",color:T.textLabel,letterSpacing:"0.1em",fontWeight:"700" }}>🏆 QUEM MAIS RECEBEU DINHEIRO DESTE DEPUTADO</div>
                    <span style={{ fontSize:"10px",color:T.textMuted,fontWeight:"600" }}>{todosOrdenados.length} fornecedores</span>
                  </div>
                  <div style={{ fontSize:"10px",color:T.textMuted,marginBottom:"14px" }}>Clique em qualquer fornecedor para ver os pagamentos detalhados e comprovantes</div>
                  {top.map(([nome,info],i)=>{
                    const aberto = fornExpanded === nome;
                    const pagamentos = despesas.filter(d=>d.nomeFornecedor===nome).sort((a,b)=>new Date(b.dataDocumento)-new Date(a.dataDocumento));
                    const corVal = info.total>20000?"#ff4d6d":info.total>8000?"#ffd60a":"#00d4aa";
                    return (
                      <div key={i} style={{ borderBottom:i<top.length-1?`1px solid ${T.divider}`:"none" }}>
                        {/* Linha principal — clicável */}
                        <div onClick={()=>setFornExpanded(aberto?null:nome)}
                          style={{ display:"flex",alignItems:"center",gap:"12px",padding:"12px 0",cursor:"pointer" }}>
                          <div style={{ width:"28px",height:"28px",borderRadius:"50%",background:aberto?corVal+"33":T.tagBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",fontWeight:"800",color:aberto?corVal:T.textSecondary,flexShrink:0,transition:"all 0.2s" }}>{i+1}</div>
                          <div style={{ flex:1,minWidth:0 }}>
                            <div style={{ fontSize:"12px",fontWeight:"700",color:T.textPrimary,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{nome}</div>
                            <div style={{ display:"flex",gap:"8px",alignItems:"center",marginTop:"3px",flexWrap:"wrap" }}>
                              <span style={{ fontSize:"10px",color:T.textMuted }}>{info.count} pagamento{info.count>1?"s":""}  ·  {info.cnpj ? "CNPJ: "+info.cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,"$1.$2.$3/$4-$5") : ""}</span>
                            </div>
                          </div>
                          <div style={{ display:"flex",alignItems:"center",gap:"10px",flexShrink:0 }}>
                            <div style={{ fontSize:"15px",fontWeight:"800",color:corVal }}>{fmtBRL(info.total)}</div>
                            <span style={{ fontSize:"16px",color:T.textMuted,transition:"transform 0.2s",transform:aberto?"rotate(90deg)":"rotate(0deg)",display:"inline-block" }}>›</span>
                          </div>
                        </div>

                        {/* Pagamentos expandidos */}
                        {aberto && (
                          <div style={{ marginBottom:"12px",borderRadius:"8px",overflow:"hidden",border:`1px solid ${T.cardBorder}` }}>
                            {/* Header */}
                            <div style={{ display:"grid",gridTemplateColumns:"1fr 100px 100px 44px",gap:"8px",padding:"8px 14px",background:T.tagBg,fontSize:"9px",color:T.textLabel,fontWeight:"700",letterSpacing:"0.08em" }}>
                              <span>DESCRIÇÃO / DOCUMENTO</span>
                              <span style={{ textAlign:"right" }}>DATA</span>
                              <span style={{ textAlign:"right" }}>VALOR</span>
                              <span style={{ textAlign:"center" }}>DOC</span>
                            </div>
                            {pagamentos.map((pg,j)=>{
                              const data = pg.dataDocumento?.substring(0,10)||"";
                              const [a2,m2,d2] = data.split("-");
                              const dataFmt = data ? `${d2}/${m2}/${a2}` : "—";
                              const cvp = corValor(pg.valorLiquido||0);
                              return (
                                <div key={j} style={{ display:"grid",gridTemplateColumns:"1fr 100px 100px 44px",gap:"8px",padding:"10px 14px",borderTop:`1px solid ${T.divider}`,background:j%2===0?T.cardBg:"transparent",alignItems:"center" }}>
                                  <div style={{ minWidth:0 }}>
                                    <div style={{ fontSize:"11px",color:T.textPrimary,fontWeight:"600",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{pg.tipoDespesa||"Sem categoria"}</div>
                                    {pg.tipoDocumento && <div style={{ fontSize:"9px",color:T.textMuted,marginTop:"2px" }}>{pg.tipoDocumento}{pg.numDocumento?" · Nº "+pg.numDocumento:""}</div>}
                                  </div>
                                  <div style={{ textAlign:"right",fontSize:"11px",color:T.textSecondary }}>{dataFmt}</div>
                                  <div style={{ textAlign:"right",fontSize:"12px",fontWeight:"800",color:cvp.cor }}>{fmtBRL(pg.valorLiquido||0)}</div>
                                  <div style={{ textAlign:"center" }}>
                                    {pg.urlDocumento ? (
                                      <a href={pg.urlDocumento} target="_blank" rel="noopener noreferrer"
                                        title="Ver comprovante (PDF)"
                                        style={{ display:"inline-flex",alignItems:"center",justifyContent:"center",width:"28px",height:"28px",borderRadius:"6px",background:"rgba(0,212,170,0.15)",color:"#00d4aa",textDecoration:"none",fontSize:"13px",border:"1px solid rgba(0,212,170,0.3)" }}>
                                        📄
                                      </a>
                                    ) : (
                                      <span style={{ display:"inline-flex",alignItems:"center",justifyContent:"center",width:"28px",height:"28px",borderRadius:"6px",background:T.tagBg,color:T.textMuted,fontSize:"11px" }} title="Sem comprovante">—</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                            {/* Subtotal */}
                            <div style={{ display:"grid",gridTemplateColumns:"1fr 100px 100px 44px",gap:"8px",padding:"10px 14px",background:corVal+"15",borderTop:`2px solid ${corVal}44` }}>
                              <div style={{ fontSize:"11px",fontWeight:"800",color:T.textPrimary }}>TOTAL PAGO — {info.count} pagamento{info.count>1?"s":""}</div>
                              <div></div>
                              <div style={{ textAlign:"right",fontSize:"14px",fontWeight:"800",color:corVal }}>{fmtBRL(info.total)}</div>
                              <div></div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {restante > 0 && (
                    <div style={{ marginTop:"12px",padding:"10px 14px",borderRadius:"8px",background:T.tagBg,textAlign:"center",fontSize:"11px",color:T.textSecondary }}>
                      + {restante} fornecedor{restante>1?"es":""} com valores menores não listados · veja a aba <strong style={{color:"#00d4aa",cursor:"pointer"}} onClick={()=>{}}>💳 DESPESAS</strong> para lista completa
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

        ) : aba==="votos" ? (
          <div style={{ display:"flex",flexDirection:"column",gap:"10px" }}>
            {carregandoVotos && (
              <div style={{ textAlign:"center",padding:"40px",color:T.textSecondary,fontSize:"13px" }}>
                <div style={{ fontSize:"24px",marginBottom:"10px" }}>⏳</div>Buscando votos em todos os temas...
              </div>
            )}
            {!carregandoVotos && (<>
              {/* Resumo rápido */}
              {(() => {
                const votados = Object.values(votosDeputado).filter(v=>v!=="ausente");
                const sim = Object.values(votosDeputado).filter(v=>v?.toLowerCase()==="sim").length;
                const nao = Object.values(votosDeputado).filter(v=>v?.toLowerCase()==="não").length;
                const ausente = Object.values(votosDeputado).filter(v=>v==="ausente").length;
                return (
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"8px",marginBottom:"4px" }}>
                    {[
                      {label:"Votou SIM",    valor:sim,    cor:"#00d464", bg:"rgba(0,212,100,0.1)", em:"✅"},
                      {label:"Votou NÃO",    valor:nao,    cor:"#ff4d6d", bg:"rgba(255,77,109,0.1)", em:"❌"},
                      {label:"Abstenção",    valor:Object.values(votosDeputado).filter(v=>v&&v.toLowerCase()!=="sim"&&v.toLowerCase()!=="não"&&v!=="ausente").length, cor:"#ffd60a", bg:"rgba(255,214,10,0.1)", em:"🟡"},
                      {label:"Ausente",      valor:ausente, cor:T.textMuted, bg:T.tagBg, em:"⬜"},
                    ].map((item,i)=>(
                      <div key={i} style={{ background:item.bg,border:`1px solid ${item.cor}33`,borderRadius:"8px",padding:"12px",textAlign:"center" }}>
                        <div style={{ fontSize:"20px",marginBottom:"4px" }}>{item.em}</div>
                        <div style={{ fontSize:"18px",fontWeight:"800",color:item.cor }}>{item.valor}</div>
                        <div style={{ fontSize:"9px",color:T.textLabel,marginTop:"3px",letterSpacing:"0.06em" }}>{item.label}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {/* Lista por tema */}
              {TEMAS_SENSIVEIS.map(tema=>{
                const voto = votosDeputado[tema.id];
                const corV = voto?.toLowerCase()==="sim"?"#00d464":voto?.toLowerCase()==="não"?"#ff4d6d":voto==="ausente"?T.textMuted:"#ffd60a";
                const bgV  = voto?.toLowerCase()==="sim"?"rgba(0,212,100,0.08)":voto?.toLowerCase()==="não"?"rgba(255,77,109,0.08)":voto==="ausente"?T.subCardBg:"rgba(255,214,10,0.08)";
                const emV  = voto?.toLowerCase()==="sim"?"✅":voto?.toLowerCase()==="não"?"❌":voto==="ausente"?"⬜":"🟡";
                const catCor = tema.categoria==="economia"?"#00d4aa":tema.categoria==="direitos"?"#a78bfa":"#fb923c";
                return (
                  <div key={tema.id} style={{ background:bgV,border:`1px solid ${corV}33`,borderRadius:"10px",padding:"14px 16px",display:"flex",gap:"12px",alignItems:"center" }}>
                    <div style={{ fontSize:"24px",flexShrink:0 }}>{tema.emoji}</div>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ display:"flex",alignItems:"center",gap:"8px",marginBottom:"3px",flexWrap:"wrap" }}>
                        <span style={{ fontSize:"13px",fontWeight:"700",color:T.textPrimary }}>{tema.titulo}</span>
                        <span style={{ fontSize:"9px",color:catCor,background:`${catCor}22`,padding:"1px 7px",borderRadius:"10px",fontWeight:"700",letterSpacing:"0.05em" }}>
                          {tema.categoria.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ fontSize:"10px",color:T.textSecondary }}>{tema.subtitulo} · {tema.data}</div>
                      <div style={{ fontSize:"10px",color:T.textMuted,marginTop:"3px",lineHeight:"1.5" }}>{tema.descricao}</div>
                      {/* Placar geral */}
                      {tema.resultado.sim > 0 && (
                        <div style={{ display:"flex",gap:"10px",marginTop:"6px",fontSize:"9px",flexWrap:"wrap" }}>
                          <span style={{ color:"#00d464",fontWeight:"700" }}>✅ {tema.resultado.sim} SIM</span>
                          <span style={{ color:"#ff4d6d",fontWeight:"700" }}>❌ {tema.resultado.nao} NÃO</span>
                          {tema.resultado.abstencao>0&&<span style={{ color:"#ffd60a",fontWeight:"700" }}>🟡 {tema.resultado.abstencao}</span>}
                          <span style={{ color:T.textMuted }}>— placar geral</span>
                        </div>
                      )}
                    </div>
                    <div style={{ flexShrink:0,textAlign:"center" }}>
                      <div style={{ fontSize:"22px" }}>{emV}</div>
                      <div style={{ fontSize:"10px",fontWeight:"800",color:corV,marginTop:"3px",letterSpacing:"0.04em" }}>
                        {voto==="ausente"?"AUSENTE":voto?.toUpperCase()||"—"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>)}
          </div>

        ) : aba==="despesas" ? (
          <div style={{ display:"flex",flexDirection:"column",gap:"8px" }}>
            {despesas.length===0 && (
              <div style={{ color:"#aaa",fontSize:"13px",textAlign:"center",padding:"60px",border:"1px dashed rgba(255,255,255,0.1)",borderRadius:"12px" }}>
                Nenhuma despesa registrada em 2024
              </div>
            )}
            {despesas.slice(0,50).map((d,i)=>{
              const cv = corValor(d.valorLiquido||0);
              const icone = iconeDespesa(d.tipoDespesa);
              const data = d.dataDocumento?.substring(0,10) || "";
              const [ano,mes,dia] = data.split("-");
              const dataFmt = data ? `${dia}/${mes}/${ano}` : "—";
              return (
                <div key={i} style={{ display:"flex",gap:"14px",alignItems:"center",background:T.cardBg,borderLeft:`3px solid ${cv.cor}`,border:`1px solid ${T.cardBorder}`,borderRadius:"8px",padding:"14px 16px" }}>
                  <div style={{ fontSize:"22px",flexShrink:0,width:"32px",textAlign:"center" }}>{icone}</div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:"13px",fontWeight:"700",color:T.textPrimary,marginBottom:"5px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>
                      {d.nomeFornecedor || "Fornecedor não informado"}
                    </div>
                    <div style={{ display:"flex",gap:"6px",flexWrap:"wrap",alignItems:"center" }}>
                      <span style={{ fontSize:"10px",color:T.tagText,background:T.tagBg,padding:"2px 8px",borderRadius:"3px",fontWeight:"600" }}>
                        {d.tipoDespesa?.substring(0,38) || "Sem categoria"}
                      </span>
                      {d.cnpjCpfFornecedor && (
                        <span style={{ fontSize:"10px",color:T.textMuted,fontFamily:"monospace" }}>
                          CNPJ: {d.cnpjCpfFornecedor.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,"$1.$2.$3/$4-$5")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign:"right",flexShrink:0 }}>
                    <div style={{ fontSize:"15px",fontWeight:"800",color:cv.cor }}>{fmtBRL(d.valorLiquido||0)}</div>
                    <div style={{ fontSize:"10px",color:"#777",marginTop:"4px" }}>{dataFmt}</div>
                    {cv.label && <span style={{ fontSize:"9px",padding:"1px 6px",borderRadius:"3px",background:cv.bg,color:cv.cor,fontWeight:"700",marginTop:"4px",display:"inline-block" }}>{cv.label}</span>}
                  </div>
                </div>
              );
            })}
          </div>

        ) : (
          <div style={{ background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"10px",padding:"22px" }}>
            <div style={{ fontSize:"11px",color:T.textLabel,letterSpacing:"0.1em",marginBottom:"20px",fontWeight:"700" }}>📊 ONDE O DINHEIRO FOI GASTO — 2024</div>
            {tiposOrdenados.map(([tipo,valor],i)=>(
              <div key={i} style={{ marginBottom:"16px" }}>
                <div style={{ display:"flex",justifyContent:"space-between",marginBottom:"6px",alignItems:"center" }}>
                  <span style={{ fontSize:"12px",color:"#ddd",fontWeight:"600",display:"flex",alignItems:"center",gap:"8px" }}>
                    <span>{iconeDespesa(tipo)}</span>
                    <span style={{ color:T.textPrimary }}>{tipo.substring(0,42)}</span>
                  </span>
                  <span style={{ fontSize:"13px",fontWeight:"800",color:"#f0f0f0",flexShrink:0,marginLeft:"8px" }}>{fmtBRL(valor)}</span>
                </div>
                <div style={{ height:"7px",background:T.divider,borderRadius:"4px" }}>
                  <div style={{ height:"100%",borderRadius:"4px",width:`${(valor/maxV)*100}%`,background:`linear-gradient(90deg,${c.dot},${c.dot}88)`,transition:"width 0.5s" }} />
                </div>
                <div style={{ fontSize:"10px",color:T.textMuted,marginTop:"4px" }}>{Math.round((valor/total)*100)}% do total gasto</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tela Upload ───────────────────────────────────────────────────────────────
function TelaUpload({ s, setTela, tema, setTema }) {
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
      <NavBar telaAtual="upload" setTela={setTela} setTema={setTema} tema={tema} s={s}/>
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
// ── Tela Votações ─────────────────────────────────────────────────────────────
const TEMAS_SENSIVEIS = [
  // ECONOMIA
  { id:"reforma-trib-1t", emoji:"💰", titulo:"Reforma Tributária — 1º Turno", subtitulo:"PEC 45/2019",
    descricao:"Substituiu PIS, Cofins, IPI, ICMS e ISS por CBS, IBS e Imposto Seletivo. Maior reforma tributária desde 1988.",
    data:"Jul 2023", votacaoId:"2196833-373", resultado:{sim:375,nao:113,abstencao:3}, aprovado:true, categoria:"economia" },
  { id:"reform-trib-2t", emoji:"🏦", titulo:"Reforma Tributária — 2º Turno", subtitulo:"PEC 45/2019",
    descricao:"Votação final confirmando a aprovação. Compare com o 1º turno para identificar mudanças de posição.",
    data:"Jul 2023", votacaoId:"2196833-395", resultado:{sim:336,nao:132,abstencao:0}, aprovado:true, categoria:"economia" },
  { id:"previdencia-1t", emoji:"👴", titulo:"Reforma da Previdência — 1º Turno", subtitulo:"PEC 6/2019",
    descricao:"Mudou regras de aposentadoria: idade mínima 65H/62M, tempo de contribuição, fim da aposentadoria por tempo.",
    data:"Jul 2019", votacaoId:"2192459-636", resultado:{sim:379,nao:131,abstencao:0}, aprovado:true, categoria:"economia" },
  { id:"previdencia-2t", emoji:"📋", titulo:"Reforma da Previdência — 2º Turno", subtitulo:"PEC 6/2019",
    descricao:"Aprovação definitiva da reforma previdenciária que afetou mais de 57 milhões de trabalhadores.",
    data:"Ago 2019", votacaoId:"2192459-786", resultado:{sim:370,nao:124,abstencao:1}, aprovado:true, categoria:"economia" },
  { id:"ir-5k", emoji:"💵", titulo:"Isenção IR até R$ 5 mil", subtitulo:"PL 1087/2025",
    descricao:"Isenta do Imposto de Renda trabalhadores com salário até R$ 5.000. Aprovado por quase unanimidade.",
    data:"Out 2025", votacaoId:"2487436-169", resultado:{sim:493,nao:0,abstencao:1}, aprovado:true, categoria:"economia" },
  { id:"fundeb", emoji:"📚", titulo:"Novo FUNDEB", subtitulo:"PEC 15/2015",
    descricao:"Tornou permanente o Fundo da Educação Básica e aumentou participação da União de 10% para 23%.",
    data:"Jul 2020", votacaoId:"1198512-250", resultado:{sim:499,nao:7,abstencao:0}, aprovado:true, categoria:"economia" },
  // DIREITOS
  { id:"marco-temporal-1", emoji:"🌿", titulo:"Marco Temporal Terras Indígenas", subtitulo:"PL 490/2007",
    descricao:"Limitaria demarcação de terras indígenas a ocupações comprovadas em 05/10/1988. Aprovado na Câmara, vetado pelo STF.",
    data:"Mai 2023", votacaoId:"345311-279", resultado:{sim:290,nao:142,abstencao:1}, aprovado:true, categoria:"direitos" },
  { id:"marco-temporal-2", emoji:"🏛️", titulo:"Marco Temporal — Aprovação Final", subtitulo:"PL 490/2007",
    descricao:"Votação da subemenda substitutiva global. Versão aprovada com destaques e emendas.",
    data:"Mai 2023", votacaoId:"345311-276", resultado:{sim:288,nao:148,abstencao:2}, aprovado:true, categoria:"direitos" },
  { id:"igualdade-salarial", emoji:"⚖️", titulo:"Igualdade Salarial Mulheres", subtitulo:"PL 1085/2023",
    descricao:"Obriga empresas a pagar salários iguais para homens e mulheres na mesma função, com multa de 10x o salário.",
    data:"Mai 2023", votacaoId:"2351179-51", resultado:{sim:325,nao:36,abstencao:3}, aprovado:true, categoria:"direitos" },
  { id:"piso-enfermagem", emoji:"🏥", titulo:"Piso Salarial da Enfermagem", subtitulo:"PL 2564/2020",
    descricao:"Estabeleceu piso de R$ 4.750 para enfermeiros, R$ 3.325 para técnicos e R$ 2.375 para auxiliares.",
    data:"Mai 2022", votacaoId:"2309349-146", resultado:{sim:449,nao:12,abstencao:0}, aprovado:true, categoria:"direitos" },
  // LIBERDADES E SEGURANÇA
  { id:"fake-news", emoji:"📱", titulo:"PL das Fake News — Urgência", subtitulo:"PL 2630/2020",
    descricao:"Responsabilizaria plataformas digitais por desinformação. Aprovação da urgência por margem estreita.",
    data:"Abr 2023", votacaoId:"2310837-8", resultado:{sim:238,nao:192,abstencao:1}, aprovado:true, categoria:"liberdades" },
  { id:"voto-impresso", emoji:"🗳️", titulo:"PEC do Voto Impresso — Rejeição", subtitulo:"PEC 135/2019",
    descricao:"Proposta de Bolsonaro para auditar eleições com voto impresso. REJEITADA: 229 a favor, 218 contra (faltaram votos).",
    data:"Ago 2021", votacaoId:"2220292-229", resultado:{sim:229,nao:218,abstencao:1}, aprovado:false, categoria:"liberdades" },
  { id:"drogas-pec", emoji:"🚨", titulo:"PEC Criminalização Drogas", subtitulo:"PEC 45/2023",
    descricao:"Criminalizou constitucionalmente o porte de drogas para uso pessoal. Aprovado na CCJC antes de ir ao plenário.",
    data:"Jun 2024", votacaoId:"2428236-50", resultado:{sim:47,nao:17,abstencao:0}, aprovado:true, categoria:"liberdades" },
];

const CATEGORIAS_VOT = [
  {id:"todas",label:"Todas"},
  {id:"economia",label:"💰 Economia"},
  {id:"direitos",label:"⚖️ Direitos e Social"},
  {id:"liberdades",label:"🔓 Liberdades e Segurança"},
];

function TelaVotacoes({ s, tema, setTema, setTela }) {
  const T = s.T; const dark = tema==="dark";
  const [temaSel, setTemaSel] = useState(null);
  const [votos, setVotos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtVoto, setFiltVoto] = useState("todos");
  const [filtPartido, setFiltPartido] = useState("Todos");
  const [filtCat, setFiltCat] = useState("todas");

  const carregarVotos = async (t) => {
    setTemaSel(t); setVotos([]); setCarregando(true);
    setBusca(""); setFiltVoto("todos"); setFiltPartido("Todos");
    try {
      const res = await fetch(`${CAMARA_API}/votacoes/${t.votacaoId}/votos`);
      const data = await res.json();
      setVotos(data.dados||[]);
    } catch {}
    setCarregando(false);
  };

  const partidos = temaSel ? ["Todos",...new Set(votos.map(v=>v.deputado_?.siglaPartido).filter(Boolean)).values()].sort() : [];

  const votosFiltrados = votos.filter(v => {
    const dep = v.deputado_||{};
    if (busca && !dep.nome?.toLowerCase().includes(busca.toLowerCase()) && !dep.siglaPartido?.toLowerCase().includes(busca.toLowerCase())) return false;
    if (filtVoto!=="todos" && v.tipoVoto?.toLowerCase()!==filtVoto) return false;
    if (filtPartido!=="Todos" && dep.siglaPartido!==filtPartido) return false;
    return true;
  });

  const statsPorPartido = votos.reduce((acc,v)=>{
    const p=v.deputado_?.siglaPartido||"?";
    if(!acc[p]) acc[p]={sim:0,nao:0,abs:0,total:0};
    const t=v.tipoVoto?.toLowerCase();
    if(t==="sim") acc[p].sim++; else if(t==="não") acc[p].nao++; else acc[p].abs++;
    acc[p].total++; return acc;
  },{});
  const partidosOrdenados = Object.entries(statsPorPartido).sort((a,b)=>b[1].total-a[1].total).slice(0,12);

  const corVoto = t => { const v=t?.toLowerCase(); return v==="sim"?"#00d464":v==="não"?"#ff4d6d":"#ffd60a"; };
  const bgVoto  = t => { const v=t?.toLowerCase(); return v==="sim"?"rgba(0,212,100,0.1)":v==="não"?"rgba(255,77,109,0.1)":"rgba(255,214,10,0.1)"; };
  const emVoto  = t => { const v=t?.toLowerCase(); return v==="sim"?"✅":v==="não"?"❌":"🟡"; };

  return (
    <div style={s.app}>
      <div style={s.grid}/>
      <NavBar telaAtual="votacoes" setTela={(t)=>{if(t==="votacoes")setTemaSel&&setTemaSel(null);setTela(t);}} setTema={setTema} tema={tema} s={s}/>

      <div style={{...s.main,maxWidth:"900px"}}>
        {!temaSel ? (<>
          <div style={{marginBottom:"24px"}}>
            <div style={{fontSize:"10px",color:T.textLabel,letterSpacing:"0.12em",marginBottom:"6px"}}>CÂMARA DOS DEPUTADOS · VOTAÇÕES NOMINAIS</div>
            <h1 style={{margin:0,fontSize:"22px",fontWeight:"800",color:T.textPrimary}}>Como votaram em temas sensíveis</h1>
            <p style={{margin:"8px 0 0",fontSize:"13px",color:T.textSecondary,lineHeight:"1.6"}}>Selecione um tema para ver o voto de cada deputado. Dados oficiais da API da Câmara.</p>
          </div>
          <div style={{display:"flex",gap:"6px",marginBottom:"20px",flexWrap:"wrap"}}>
            {CATEGORIAS_VOT.map(cat=>(
              <button key={cat.id} onClick={()=>setFiltCat(cat.id)} style={{padding:"5px 14px",borderRadius:"20px",border:`1px solid ${filtCat===cat.id?"#00d4aa":T.inputBorder}`,background:filtCat===cat.id?"rgba(0,212,170,0.15)":T.tagBg,color:filtCat===cat.id?"#00d4aa":T.textSecondary,fontSize:"11px",fontFamily:"inherit",fontWeight:"700",cursor:"pointer"}}>{cat.label}</button>
            ))}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            {TEMAS_SENSIVEIS.filter(t=>filtCat==="todas"||t.categoria===filtCat).map(t=>{
              const tot=t.resultado.sim+t.resultado.nao+t.resultado.abstencao;
              const pS=tot>0?Math.round(t.resultado.sim/tot*100):0;
              const pN=tot>0?Math.round(t.resultado.nao/tot*100):0;
              return (
                <div key={t.id} onClick={()=>carregarVotos(t)} style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"12px",padding:"20px",cursor:"pointer"}}>
                  <div style={{display:"flex",gap:"16px",alignItems:"flex-start"}}>
                    <div style={{fontSize:"28px",flexShrink:0}}>{t.emoji}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"4px",flexWrap:"wrap"}}>
                        <span style={{fontSize:"15px",fontWeight:"800",color:T.textPrimary}}>{t.titulo}</span>
                        <span style={{fontSize:"10px",color:T.textMuted,background:T.tagBg,padding:"2px 8px",borderRadius:"10px",fontWeight:"600"}}>{t.subtitulo}</span>
                        <span style={{fontSize:"10px",color:T.textMuted}}>{t.data}</span>
                      </div>
                      <p style={{margin:"0 0 14px",fontSize:"12px",color:T.textSecondary,lineHeight:"1.6"}}>{t.descricao}</p>
                      <div style={{display:"flex",height:"8px",borderRadius:"4px",overflow:"hidden",marginBottom:"8px",gap:"2px"}}>
                        <div style={{width:`${pS}%`,background:"#00d464"}}/>
                        <div style={{width:`${pN}%`,background:"#ff4d6d"}}/>
                        {t.resultado.abstencao>0 && <div style={{flex:1,background:"#ffd60a"}}/>}
                      </div>
                      <div style={{display:"flex",gap:"16px",fontSize:"11px",flexWrap:"wrap"}}>
                        <span style={{color:"#00d464",fontWeight:"700"}}>✅ {t.resultado.sim} SIM ({pS}%)</span>
                        <span style={{color:"#ff4d6d",fontWeight:"700"}}>❌ {t.resultado.nao} NÃO ({pN}%)</span>
                        {t.resultado.abstencao>0&&<span style={{color:"#ffd60a",fontWeight:"700"}}>🟡 {t.resultado.abstencao}</span>}
                        <span style={{color:T.textMuted,marginLeft:"auto"}}>clique para ver cada deputado →</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{marginTop:"24px",padding:"16px",background:T.subCardBg,border:`1px solid ${T.divider}`,borderRadius:"10px",fontSize:"11px",color:T.textMuted,lineHeight:"1.7"}}>
            <strong style={{color:T.textSecondary}}>ℹ️ Sobre:</strong> Votos nominais extraídos da API oficial da Câmara. Estamos expandindo o banco com mais temas como anistia, porte de armas, meio ambiente e outros.
          </div>
        </>) : (<>
          {/* Breadcrumb */}
          <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"20px",fontSize:"12px"}}>
            <span onClick={()=>setTemaSel(null)} style={{color:"#00d4aa",cursor:"pointer",fontWeight:"600"}}>Votações</span>
            <span style={{color:T.textMuted}}>›</span>
            <span style={{color:T.textSecondary,fontWeight:"500"}}>{temaSel.titulo}</span>
          </div>

          {/* Header tema */}
          <div style={{background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"12px",padding:"20px",marginBottom:"20px"}}>
            <div style={{display:"flex",gap:"14px",alignItems:"flex-start"}}>
              <span style={{fontSize:"32px"}}>{temaSel.emoji}</span>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap",marginBottom:"6px"}}>
                  <h2 style={{margin:0,fontSize:"18px",fontWeight:"800",color:T.textPrimary}}>{temaSel.titulo}</h2>
                  <span style={{fontSize:"10px",color:T.textMuted,background:T.tagBg,padding:"2px 8px",borderRadius:"10px",fontWeight:"600"}}>{temaSel.subtitulo} · {temaSel.data}</span>
                </div>
                <p style={{margin:"0 0 14px",fontSize:"12px",color:T.textSecondary,lineHeight:"1.6"}}>{temaSel.descricao}</p>
                {votos.length>0&&(()=>{
                  const sim=votos.filter(v=>v.tipoVoto?.toLowerCase()==="sim").length;
                  const nao=votos.filter(v=>v.tipoVoto?.toLowerCase()==="não").length;
                  const abs=votos.length-sim-nao; const tot=votos.length;
                  return (<>
                    <div style={{display:"flex",height:"12px",borderRadius:"6px",overflow:"hidden",marginBottom:"10px",gap:"2px"}}>
                      <div style={{width:`${(sim/tot)*100}%`,background:"#00d464"}}/>
                      <div style={{width:`${(nao/tot)*100}%`,background:"#ff4d6d"}}/>
                      {abs>0&&<div style={{flex:1,background:"#ffd60a"}}/>}
                    </div>
                    <div style={{display:"flex",gap:"20px",fontSize:"13px",flexWrap:"wrap"}}>
                      <span style={{color:"#00d464",fontWeight:"800"}}>✅ {sim} SIM ({Math.round(sim/tot*100)}%)</span>
                      <span style={{color:"#ff4d6d",fontWeight:"800"}}>❌ {nao} NÃO ({Math.round(nao/tot*100)}%)</span>
                      {abs>0&&<span style={{color:"#ffd60a",fontWeight:"800"}}>🟡 {abs} ABSTENÇÃO</span>}
                      <span style={{color:T.textMuted}}>{tot} deputados</span>
                    </div>
                  </>);
                })()}
              </div>
            </div>
          </div>

          {/* Por partido */}
          {!carregando&&votos.length>0&&(
            <div style={{background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"10px",padding:"18px",marginBottom:"20px"}}>
              <div style={{fontSize:"11px",color:T.textLabel,letterSpacing:"0.1em",fontWeight:"700",marginBottom:"14px"}}>📊 RESULTADO POR PARTIDO</div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {partidosOrdenados.map(([partido,st])=>{
                  const pS=Math.round(st.sim/st.total*100);
                  const pN=Math.round(st.nao/st.total*100);
                  return (
                    <div key={partido} style={{display:"flex",alignItems:"center",gap:"10px"}}>
                      <div style={{width:"80px",fontSize:"11px",fontWeight:"700",color:T.textPrimary,flexShrink:0}}>{partido}</div>
                      <div style={{flex:1,height:"18px",borderRadius:"4px",overflow:"hidden",display:"flex",gap:"1px",background:T.divider}}>
                        <div style={{width:`${pS}%`,background:"#00d464",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {pS>12&&<span style={{fontSize:"9px",fontWeight:"800",color:"#fff"}}>{pS}%</span>}
                        </div>
                        <div style={{width:`${pN}%`,background:"#ff4d6d",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {pN>12&&<span style={{fontSize:"9px",fontWeight:"800",color:"#fff"}}>{pN}%</span>}
                        </div>
                        <div style={{flex:1,background:"#ffd60a33"}}/>
                      </div>
                      <div style={{fontSize:"10px",color:T.textMuted,flexShrink:0,textAlign:"right",minWidth:"100px"}}>
                        {st.sim}✅ {st.nao}❌{st.abs>0?" "+st.abs+"🟡":""} <span style={{color:T.textLabel}}>({st.total})</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filtros */}
          <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"14px",background:T.subCardBg,border:`1px solid ${T.divider}`,borderRadius:"8px",padding:"12px 14px",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:"7px",background:T.inputBg,border:`1px solid ${T.inputBorder}`,borderRadius:"6px",padding:"6px 10px",flex:"1",minWidth:"160px"}}>
              <IconSearch/><input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar deputado ou partido..."
                style={{background:"transparent",border:"none",outline:"none",color:T.textPrimary,fontSize:"11px",fontFamily:"inherit",width:"100%"}}/>
            </div>
            {["todos","sim","não","abstencao"].map(vt=>(
              <button key={vt} onClick={()=>setFiltVoto(vt)} style={{
                padding:"5px 12px",borderRadius:"6px",fontFamily:"inherit",fontSize:"10px",fontWeight:"700",cursor:"pointer",
                background:filtVoto===vt?(vt==="sim"?"rgba(0,212,100,0.2)":vt==="não"?"rgba(255,77,109,0.2)":vt==="abstencao"?"rgba(255,214,10,0.2)":T.accentDim):T.tagBg,
                color:filtVoto===vt?(vt==="sim"?"#00d464":vt==="não"?"#ff4d6d":vt==="abstencao"?"#ffd60a":"#00d4aa"):T.textSecondary,
                border:`1px solid ${filtVoto===vt?(vt==="sim"?"#00d46444":vt==="não"?"#ff4d6d44":vt==="abstencao"?"#ffd60a44":"#00d4aa44"):T.inputBorder}`,
              }}>{vt==="todos"?"Todos":vt==="sim"?"✅ SIM":vt==="não"?"❌ NÃO":"🟡 ABSTENÇÃO"}</button>
            ))}
            <select value={filtPartido} onChange={e=>setFiltPartido(e.target.value)}
              style={{background:T.selectBg,border:`1px solid ${T.inputBorder}`,borderRadius:"6px",color:T.textPrimary,fontSize:"11px",fontFamily:"inherit",padding:"6px 10px",cursor:"pointer",outline:"none"}}>
              {partidos.map(p=><option key={p} value={p} style={{background:T.selectBg}}>{p}</option>)}
            </select>
            <span style={{fontSize:"10px",color:T.textMuted}}>{votosFiltrados.length} deputados</span>
          </div>

          {carregando&&<div style={{textAlign:"center",padding:"60px",color:T.textSecondary,fontSize:"13px"}}><div style={{fontSize:"28px",marginBottom:"12px"}}>⏳</div>Carregando votos...</div>}

          {/* Lista votos */}
          {!carregando&&(
            <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
              {votosFiltrados.map((v,i)=>{
                const dep=v.deputado_||{};
                const cor=corVoto(v.tipoVoto); const bg=bgVoto(v.tipoVoto);
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:"12px",background:bg,border:`1px solid ${cor}33`,borderLeft:`3px solid ${cor}`,borderRadius:"8px",padding:"10px 14px"}}>
                    <span style={{fontSize:"18px",flexShrink:0}}>{emVoto(v.tipoVoto)}</span>
                    <img src={dep.urlFoto} alt="" style={{width:"32px",height:"32px",borderRadius:"50%",objectFit:"cover",border:`2px solid ${cor}`,flexShrink:0}} onError={e=>{e.target.style.display="none"}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:"12px",fontWeight:"700",color:T.textPrimary,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{dep.nome}</div>
                      <div style={{fontSize:"10px",color:T.textSecondary,marginTop:"2px"}}>{dep.siglaPartido} · {dep.siglaUf}</div>
                    </div>
                    <span style={{fontSize:"11px",fontWeight:"800",color:cor,flexShrink:0,padding:"3px 10px",borderRadius:"4px",background:`${cor}22`,border:`1px solid ${cor}44`}}>
                      {v.tipoVoto?.toUpperCase()}
                    </span>
                  </div>
                );
              })}
              {votosFiltrados.length===0&&<div style={{textAlign:"center",padding:"40px",color:T.textMuted,fontSize:"13px",border:`1px dashed ${T.divider}`,borderRadius:"12px"}}>Nenhum voto encontrado com esses filtros</div>}
            </div>
          )}
        </>)}
      </div>
    </div>
  );
}


// ── Constantes Senado ──────────────────────────────────────────────────────────
const SENADO_API = "https://legis.senado.leg.br/dadosabertos";

const TEMAS_SENADO = [
  { id:"reform-trib-sf", emoji:"💰", titulo:"Reforma Tributária", subtitulo:"PEC 45/2019 no Senado",
    descricao:"Aprovação no Senado da maior reforma tributária desde 1988. 53 votos a favor, 24 contra.",
    data:"Nov 2023", sessaoId:"6777", periodo:"20231101/20231130",
    resultado:{sim:53,nao:24,abstencao:4}, aprovado:true, categoria:"economia" },
  { id:"marco-temporal-sf", emoji:"🌿", titulo:"Marco Temporal Terras Indígenas", subtitulo:"PL 2903/2023 no Senado",
    descricao:"Aprovação no Senado do Marco Temporal. 43 a favor, 21 contra. STF derrubou parcialmente depois.",
    data:"Set 2023", sessaoId:"6756", periodo:"20230901/20231031",
    resultado:{sim:43,nao:21,abstencao:17}, aprovado:true, categoria:"direitos" },
  { id:"arcabouco-sf", emoji:"📊", titulo:"Arcabouço Fiscal", subtitulo:"PEC 8/2021 no Senado",
    descricao:"Novo marco fiscal substituindo o teto de gastos. Aprovado com 52 votos a favor.",
    data:"Nov 2023", sessaoId:"6781", periodo:"20231101/20231130",
    resultado:{sim:52,nao:18,abstencao:11}, aprovado:true, categoria:"economia" },
  { id:"pec45-sf-destaques", emoji:"🏦", titulo:"Reforma Tributária — Destaques", subtitulo:"PEC 45/2019 emendas",
    descricao:"Votação de emenda polêmica à Reforma Tributária que foi rejeitada pelo Senado.",
    data:"Nov 2023", sessaoId:"6774", periodo:"20231101/20231130",
    resultado:{sim:31,nao:41,abstencao:9}, aprovado:false, categoria:"economia" },
  { id:"pec-seguranca-sf", emoji:"🚔", titulo:"PEC da Segurança Pública", subtitulo:"PEC 66/2023 no Senado",
    descricao:"Proposta que alterou a Constituição para reforçar o papel da segurança pública. 2 turnos.",
    data:"Ago 2024", sessaoId:"6868", periodo:"20240801/20240901",
    resultado:{sim:0,nao:0,abstencao:0}, aprovado:true, categoria:"direitos" },
  { id:"plp-regulacao-sf", emoji:"🏛️", titulo:"Regulação das Plataformas Digitais", subtitulo:"PL 2.630/2023",
    descricao:"Votação sobre urgência do Marco das Plataformas no Senado. Resultado dividido.",
    data:"Out 2023", sessaoId:"6761", periodo:"20230901/20231031",
    resultado:{sim:24,nao:46,abstencao:11}, aprovado:false, categoria:"liberdades" },
];


// ── Tela Senado ───────────────────────────────────────────────────────────────
function TelaSenado({ s, tema, setTema, setTela }) {
  const T = s.T; const dark = tema === "dark";
  const [senadores, setSenadores] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [senadorSel, setSenadorSel] = useState(null);
  const [busca, setBusca] = useState("");
  const [filtPartido, setFiltPartido] = useState("Todos");
  const [filtUf, setFiltUf] = useState("Todos");
  const [abaVot, setAbaVot] = useState(null); // tema votação selecionado
  const [votosVot, setVotosVot] = useState([]);
  const [carregVot, setCarregVot] = useState(false);
  const [filtVoto, setFiltVoto] = useState("todos");
  const [filtBusca, setFiltBusca] = useState("");
  // Perfil senador
  const [votosSenad, setVotosSenad] = useState({});
  const [carregVotSenad, setCarregVotSenad] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${SENADO_API}/senador/lista/atual.json`);
        const d = await r.json();
        const lista = d?.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar || [];
        setSenadores(lista.map(s => ({
          id: s.IdentificacaoParlamentar.CodigoParlamentar,
          nome: s.IdentificacaoParlamentar.NomeParlamentar,
          nomeCompleto: s.IdentificacaoParlamentar.NomeCompletoParlamentar,
          partido: s.IdentificacaoParlamentar.SiglaPartidoParlamentar,
          uf: s.IdentificacaoParlamentar.UfParlamentar,
          foto: s.IdentificacaoParlamentar.UrlFotoParlamentar,
          email: s.IdentificacaoParlamentar.EmailParlamentar,
          sexo: s.IdentificacaoParlamentar.SexoParlamentar,
        })));
      } catch {}
      setCarregando(false);
    })();
  }, []);

  const carregarVotacaoTema = async (tema) => {
    setAbaVot(tema); setVotosVot([]); setCarregVot(true);
    setFiltVoto("todos"); setFiltBusca("");
    try {
      const r = await fetch(`${SENADO_API}/plenario/lista/votacao/${tema.periodo}.json`);
      const d = await r.json();
      const vs = d?.ListaVotacoes?.Votacoes?.Votacao || [];
      const vot = vs.find(v => v.CodigoSessaoVotacao === tema.sessaoId);
      if (vot) {
        setVotosVot(vot.Votos?.VotoParlamentar || []);
        // Atualiza resultado real
        tema.resultado_real = vot.Votos?.VotoParlamentar || [];
      }
    } catch {}
    setCarregVot(false);
  };

  const carregarVotosSenador = async (sen) => {
    setSenadorSel(sen); setVotosSenad({}); setCarregVotSenad(true);
    const resultado = {};
    await Promise.allSettled(TEMAS_SENADO.map(async (tema) => {
      try {
        const r = await fetch(`${SENADO_API}/plenario/lista/votacao/${tema.periodo}.json`);
        const d = await r.json();
        const vs = d?.ListaVotacoes?.Votacoes?.Votacao || [];
        const vot = vs.find(v => v.CodigoSessaoVotacao === tema.sessaoId);
        if (vot) {
          const vp = (vot.Votos?.VotoParlamentar || []).find(v => v.CodigoParlamentar === sen.id);
          resultado[tema.id] = vp?.Voto || "Ausente";
        } else resultado[tema.id] = "Ausente";
      } catch { resultado[tema.id] = "Ausente"; }
    }));
    setVotosSenad(resultado);
    setCarregVotSenad(false);
  };

  const partidos = ["Todos", ...new Set(senadores.map(s => s.partido).filter(Boolean))].sort();
  const ufs = ["Todos", ...new Set(senadores.map(s => s.uf).filter(Boolean))].sort();

  const senadoresFiltrados = senadores.filter(s => {
    if (busca && !s.nome.toLowerCase().includes(busca.toLowerCase()) && !s.partido?.toLowerCase().includes(busca.toLowerCase())) return false;
    if (filtPartido !== "Todos" && s.partido !== filtPartido) return false;
    if (filtUf !== "Todos" && s.uf !== filtUf) return false;
    return true;
  });

  const corVoto = t => { const v=t?.toLowerCase(); return v==="sim"?"#00d464":v==="não"||v==="nao"?"#ff4d6d":v==="ausente"||v==="abstencao"?T.textMuted:"#ffd60a"; };
  const bgVoto  = t => { const v=t?.toLowerCase(); return v==="sim"?"rgba(0,212,100,0.1)":v==="não"||v==="nao"?"rgba(255,77,109,0.1)":"transparent"; };
  const emVoto  = t => { const v=t?.toLowerCase(); return v==="sim"?"✅":v==="não"||v==="nao"?"❌":v==="ausente"?"⬜":"🟡"; };

  const votosFiltrados = votosVot.filter(v => {
    if (filtBusca && !v.NomeParlamentar?.toLowerCase().includes(filtBusca.toLowerCase()) && !v.SiglaPartido?.toLowerCase().includes(filtBusca.toLowerCase())) return false;
    if (filtVoto !== "todos" && v.Voto?.toLowerCase() !== filtVoto) return false;
    return true;
  });

  // Tela perfil senador
  if (senadorSel) {
    const sim = Object.values(votosSenad).filter(v => v?.toLowerCase() === "sim").length;
    const nao = Object.values(votosSenad).filter(v => v?.toLowerCase() === "não" || v?.toLowerCase() === "nao").length;
    const aus = Object.values(votosSenad).filter(v => v === "Ausente").length;
    return (
      <div style={s.app}>
        <div style={s.grid}/>
        <NavBar telaAtual="senado" setTela={(t)=>{setSenadorSel(null);if(t!=="senado")setTela(t);}} setTema={setTema} tema={tema} s={s}/>
        <div style={{...s.main,maxWidth:"800px"}}>
          <BotaoVoltar onClick={()=>setSenadorSel(null)} label="← VOLTAR PARA SENADO" s={s}/>
          <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"16px",fontSize:"12px"}}>
            <span onClick={()=>setSenadorSel(null)} style={{color:"#00d4aa",cursor:"pointer",fontWeight:"600"}}>🏛️ Senado</span>
            <span style={{color:T.textMuted}}>›</span>
            <span style={{color:T.textSecondary,fontWeight:"500"}}>{senadorSel.nome}</span>
          </div>
          {/* Card senador */}
          <div style={{background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"12px",padding:"22px",marginBottom:"22px",display:"flex",gap:"20px",alignItems:"center"}}>
            <img src={senadorSel.foto} alt="" style={{width:"76px",height:"76px",borderRadius:"50%",objectFit:"cover",border:"3px solid #00d4aa",flexShrink:0}}
              onError={e=>{e.target.style.display="none"}}/>
            <div style={{flex:1}}>
              <h2 style={{margin:"0 0 8px",fontSize:"20px",fontWeight:"800",color:T.textPrimary}}>{senadorSel.nome}</h2>
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                {[senadorSel.partido, senadorSel.uf, "Senador(a) Federal"].map((t,i)=>(
                  <span key={i} style={{fontSize:"11px",padding:"4px 12px",borderRadius:"4px",background:T.tagBg,color:T.tagText,letterSpacing:"0.06em",fontWeight:"700"}}>{t}</span>
                ))}
              </div>
              {senadorSel.email && <div style={{fontSize:"11px",color:T.textMuted,marginTop:"8px"}}>✉️ {senadorSel.email}</div>}
            </div>
          </div>
          {/* Resumo votos */}
          <div style={{fontSize:"11px",color:T.textLabel,letterSpacing:"0.1em",fontWeight:"700",marginBottom:"12px"}}>🗳️ VOTAÇÕES EM TEMAS SENSÍVEIS</div>
          {carregVotSenad && <div style={{textAlign:"center",padding:"40px",color:T.textSecondary}}>⏳ Buscando votos...</div>}
          {!carregVotSenad && (<>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"8px",marginBottom:"16px"}}>
              {[{l:"SIM",v:sim,cor:"#00d464",bg:"rgba(0,212,100,0.1)",em:"✅"},{l:"NÃO",v:nao,cor:"#ff4d6d",bg:"rgba(255,77,109,0.1)",em:"❌"},{l:"AUSENTE",v:aus,cor:T.textMuted,bg:T.tagBg,em:"⬜"}].map((item,i)=>(
                <div key={i} style={{background:item.bg,border:`1px solid ${item.cor}33`,borderRadius:"8px",padding:"14px",textAlign:"center"}}>
                  <div style={{fontSize:"22px",marginBottom:"4px"}}>{item.em}</div>
                  <div style={{fontSize:"20px",fontWeight:"800",color:item.cor}}>{item.v}</div>
                  <div style={{fontSize:"9px",color:T.textLabel,marginTop:"3px",letterSpacing:"0.06em"}}>{item.l}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              {TEMAS_SENADO.map(tema=>{
                const voto = votosSenad[tema.id] || "—";
                const cor = corVoto(voto); const bg = bgVoto(voto); const em = emVoto(voto);
                const catCor = tema.categoria==="economia"?"#00d4aa":tema.categoria==="direitos"?"#a78bfa":"#fb923c";
                return (
                  <div key={tema.id} style={{background:bg,border:`1px solid ${cor}33`,borderRadius:"10px",padding:"14px 16px",display:"flex",gap:"12px",alignItems:"center"}}>
                    <div style={{fontSize:"22px",flexShrink:0}}>{tema.emoji}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"2px",flexWrap:"wrap"}}>
                        <span style={{fontSize:"12px",fontWeight:"700",color:T.textPrimary}}>{tema.titulo}</span>
                        <span style={{fontSize:"9px",color:catCor,background:`${catCor}22`,padding:"1px 7px",borderRadius:"10px",fontWeight:"700"}}>{tema.categoria.toUpperCase()}</span>
                      </div>
                      <div style={{fontSize:"10px",color:T.textSecondary}}>{tema.subtitulo} · {tema.data}</div>
                    </div>
                    <div style={{flexShrink:0,textAlign:"center"}}>
                      <div style={{fontSize:"20px"}}>{em}</div>
                      <div style={{fontSize:"10px",fontWeight:"800",color:cor,marginTop:"2px"}}>{voto.toUpperCase()}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>)}
        </div>
      </div>
    );
  }

  // Tela detalhe votação
  if (abaVot) {
    const sim = votosVot.filter(v=>v.Voto?.toLowerCase()==="sim").length;
    const nao = votosVot.filter(v=>v.Voto?.toLowerCase()==="não").length;
    const tot = votosVot.length;
    return (
      <div style={s.app}>
        <div style={s.grid}/>
        <NavBar telaAtual="senado" setTela={(t)=>{setAbaVot(null);if(t!=="senado")setTela(t);}} setTema={setTema} tema={tema} s={s}/>
        <div style={{...s.main,maxWidth:"860px"}}>
          <BotaoVoltar onClick={()=>setAbaVot(null)} label="← VOLTAR PARA SENADO" s={s}/>
          <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"16px",fontSize:"12px"}}>
            <span onClick={()=>setAbaVot(null)} style={{color:"#00d4aa",cursor:"pointer",fontWeight:"600"}}>🏛️ Senado</span>
            <span style={{color:T.textMuted}}>›</span>
            <span style={{color:T.textSecondary}}>{abaVot.titulo}</span>
          </div>
          {/* Header tema */}
          <div style={{background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"12px",padding:"20px",marginBottom:"20px"}}>
            <div style={{display:"flex",gap:"14px"}}>
              <span style={{fontSize:"32px"}}>{abaVot.emoji}</span>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap",marginBottom:"6px"}}>
                  <h2 style={{margin:0,fontSize:"17px",fontWeight:"800",color:T.textPrimary}}>{abaVot.titulo}</h2>
                  <span style={{fontSize:"10px",color:T.textMuted,background:T.tagBg,padding:"2px 8px",borderRadius:"10px",fontWeight:"600"}}>{abaVot.subtitulo} · {abaVot.data}</span>
                </div>
                <p style={{margin:"0 0 12px",fontSize:"12px",color:T.textSecondary,lineHeight:"1.6"}}>{abaVot.descricao}</p>
                {tot > 0 && (<>
                  <div style={{display:"flex",height:"10px",borderRadius:"5px",overflow:"hidden",marginBottom:"8px",gap:"2px"}}>
                    <div style={{width:`${(sim/tot)*100}%`,background:"#00d464"}}/>
                    <div style={{width:`${(nao/tot)*100}%`,background:"#ff4d6d"}}/>
                    <div style={{flex:1,background:"#ffd60a44"}}/>
                  </div>
                  <div style={{display:"flex",gap:"16px",fontSize:"12px",flexWrap:"wrap"}}>
                    <span style={{color:"#00d464",fontWeight:"800"}}>✅ {sim} SIM ({Math.round(sim/tot*100)}%)</span>
                    <span style={{color:"#ff4d6d",fontWeight:"800"}}>❌ {nao} NÃO ({Math.round(nao/tot*100)}%)</span>
                    <span style={{color:T.textMuted}}>{tot} senadores</span>
                  </div>
                </>)}
              </div>
            </div>
          </div>
          {/* Filtros */}
          <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"14px",background:T.subCardBg,border:`1px solid ${T.divider}`,borderRadius:"8px",padding:"12px 14px",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:"7px",background:T.inputBg,border:`1px solid ${T.inputBorder}`,borderRadius:"6px",padding:"6px 10px",flex:"1",minWidth:"160px"}}>
              <IconSearch/><input value={filtBusca} onChange={e=>setFiltBusca(e.target.value)} placeholder="Buscar senador ou partido..."
                style={{background:"transparent",border:"none",outline:"none",color:T.textPrimary,fontSize:"11px",fontFamily:"inherit",width:"100%"}}/>
            </div>
            {["todos","sim","não"].map(vt=>(
              <button key={vt} onClick={()=>setFiltVoto(vt)} style={{
                padding:"5px 12px",borderRadius:"6px",fontFamily:"inherit",fontSize:"10px",fontWeight:"700",cursor:"pointer",
                background:filtVoto===vt?(vt==="sim"?"rgba(0,212,100,0.2)":vt==="não"?"rgba(255,77,109,0.2)":T.accentDim):T.tagBg,
                color:filtVoto===vt?(vt==="sim"?"#00d464":vt==="não"?"#ff4d6d":"#00d4aa"):T.textSecondary,
                border:`1px solid ${filtVoto===vt?(vt==="sim"?"#00d46444":vt==="não"?"#ff4d6d44":"#00d4aa44"):T.inputBorder}`,
              }}>{vt==="todos"?"Todos":vt==="sim"?"✅ SIM":"❌ NÃO"}</button>
            ))}
            <span style={{fontSize:"10px",color:T.textMuted}}>{votosFiltrados.length} senadores</span>
          </div>
          {carregVot && <div style={{textAlign:"center",padding:"60px",color:T.textSecondary}}>⏳ Carregando votos...</div>}
          {!carregVot && (
            <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
              {votosFiltrados.map((v,i)=>{
                const cor=corVoto(v.Voto); const bg=bgVoto(v.Voto);
                return (
                  <div key={i} onClick={()=>carregarVotosSenador(senadores.find(s=>s.id===v.CodigoParlamentar)||{id:v.CodigoParlamentar,nome:v.NomeParlamentar,partido:v.SiglaPartido,uf:v.SiglaUF,foto:v.Foto})}
                    style={{display:"flex",alignItems:"center",gap:"12px",background:bg,border:`1px solid ${cor}33`,borderLeft:`3px solid ${cor}`,borderRadius:"8px",padding:"10px 14px",cursor:"pointer"}}>
                    <span style={{fontSize:"18px",flexShrink:0}}>{emVoto(v.Voto)}</span>
                    <img src={v.Foto} alt="" style={{width:"32px",height:"32px",borderRadius:"50%",objectFit:"cover",border:`2px solid ${cor}`,flexShrink:0}} onError={e=>{e.target.style.display="none"}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:"12px",fontWeight:"700",color:T.textPrimary}}>{v.NomeParlamentar}</div>
                      <div style={{fontSize:"10px",color:T.textSecondary}}>{v.SiglaPartido} · {v.SiglaUF}</div>
                    </div>
                    <span style={{fontSize:"11px",fontWeight:"800",color:cor,flexShrink:0,padding:"3px 10px",borderRadius:"4px",background:`${cor}22`,border:`1px solid ${cor}44`}}>
                      {v.Voto?.toUpperCase()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Tela principal — lista senadores
  return (
    <div style={s.app}>
      <div style={s.grid}/>
      <NavBar telaAtual="senado" setTela={setTela} setTema={setTema} tema={tema} s={s}/>
      <div style={{...s.main,maxWidth:"1100px"}}>
        {/* Header */}
        <div style={{marginBottom:"20px"}}>
          <div style={{fontSize:"10px",color:T.textLabel,letterSpacing:"0.12em",marginBottom:"6px"}}>SENADO FEDERAL · 81 SENADORES</div>
          <h1 style={{margin:0,fontSize:"22px",fontWeight:"800",color:T.textPrimary}}>Senado Federal</h1>
          <p style={{margin:"8px 0 0",fontSize:"13px",color:T.textSecondary}}>Clique em um senador para ver como votou nos temas sensíveis. Dados oficiais API do Senado.</p>
        </div>

        {/* Votações do Senado */}
        <div style={{background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"12px",padding:"18px",marginBottom:"20px"}}>
          <div style={{fontSize:"11px",color:T.textLabel,letterSpacing:"0.1em",fontWeight:"700",marginBottom:"14px"}}>🗳️ TEMAS SENSÍVEIS NO SENADO — clique para ver cada voto</div>
          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            {TEMAS_SENADO.map(tema=>{
              const {sim,nao}=tema.resultado; const tot=sim+nao+(tema.resultado.abstencao||0);
              const pS=tot>0?Math.round(sim/tot*100):0; const pN=tot>0?Math.round(nao/tot*100):0;
              return (
                <div key={tema.id} onClick={()=>carregarVotacaoTema(tema)}
                  style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"8px",padding:"14px 16px",cursor:"pointer",display:"flex",gap:"12px",alignItems:"center"}}>
                  <span style={{fontSize:"22px",flexShrink:0}}>{tema.emoji}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px",flexWrap:"wrap"}}>
                      <span style={{fontSize:"13px",fontWeight:"700",color:T.textPrimary}}>{tema.titulo}</span>
                      <span style={{fontSize:"9px",color:T.textMuted,background:T.tagBg,padding:"1px 7px",borderRadius:"10px",fontWeight:"600"}}>{tema.subtitulo}</span>
                      <span style={{fontSize:"9px",color:T.textMuted}}>{tema.data}</span>
                    </div>
                    {tot > 0 && (
                      <div style={{display:"flex",gap:"12px",fontSize:"10px"}}>
                        <span style={{color:"#00d464",fontWeight:"700"}}>✅ {sim} SIM ({pS}%)</span>
                        <span style={{color:"#ff4d6d",fontWeight:"700"}}>❌ {nao} NÃO ({pN}%)</span>
                        <span style={{color:T.textMuted}}>→ clique para detalhar</span>
                      </div>
                    )}
                  </div>
                  <span style={{color:"#00d4aa",fontSize:"16px"}}>›</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Filtros senadores */}
        <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"16px",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:"7px",background:T.inputBg,border:`1px solid ${T.inputBorder}`,borderRadius:"6px",padding:"7px 12px",flex:"1",minWidth:"200px"}}>
            <IconSearch/><input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar senador ou partido..."
              style={{background:"transparent",border:"none",outline:"none",color:T.textPrimary,fontSize:"13px",fontFamily:"inherit",width:"100%"}}/>
          </div>
          <select value={filtPartido} onChange={e=>setFiltPartido(e.target.value)}
            style={{background:T.selectBg,border:`1px solid ${T.inputBorder}`,borderRadius:"6px",color:T.textPrimary,fontSize:"12px",fontFamily:"inherit",padding:"7px 12px",cursor:"pointer",outline:"none"}}>
            {partidos.map(p=><option key={p} value={p} style={{background:T.selectBg}}>{p}</option>)}
          </select>
          <select value={filtUf} onChange={e=>setFiltUf(e.target.value)}
            style={{background:T.selectBg,border:`1px solid ${T.inputBorder}`,borderRadius:"6px",color:T.textPrimary,fontSize:"12px",fontFamily:"inherit",padding:"7px 12px",cursor:"pointer",outline:"none"}}>
            {ufs.map(u=><option key={u} value={u} style={{background:T.selectBg}}>{u}</option>)}
          </select>
          <span style={{fontSize:"11px",color:T.textMuted}}>{senadoresFiltrados.length} senadores</span>
        </div>

        {/* Grid senadores */}
        {carregando ? (
          <div style={{textAlign:"center",padding:"60px",color:T.textSecondary}}>⏳ Carregando senadores...</div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:"10px"}}>
            {senadoresFiltrados.map(sen=>(
              <div key={sen.id} onClick={()=>carregarVotosSenador(sen)}
                style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"10px",padding:"14px",cursor:"pointer",display:"flex",gap:"12px",alignItems:"center"}}>
                <img src={sen.foto} alt="" style={{width:"44px",height:"44px",borderRadius:"50%",objectFit:"cover",border:"2px solid #00d4aa44",flexShrink:0}}
                  onError={e=>{e.target.style.background="#1a1f2e";e.target.style.display="none"}}/>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:"12px",fontWeight:"700",color:T.textPrimary,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sen.nome}</div>
                  <div style={{fontSize:"10px",color:T.textSecondary,marginTop:"2px"}}>{sen.partido} · {sen.uf}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ── Tela STF / Judiciário ─────────────────────────────────────────────────────
const MINISTROS_STF = [
  { id:"moraes",  nome:"Alexandre de Moraes",    cargo:"Presidente",         indicadoPor:"Temer",     partido:"PSDB",  desde:2017, aposentadoria:2043,
    descricao:"Ex-Ministro da Justiça de Temer. Preside o TSE e o STF. Relator dos casos do 8 de janeiro e das investigações de golpe de Estado.",
    decisoesDestaque:["Decretou prisão de Bolsonaro (2025)","Conduziu julgamento do 8 de Janeiro","Bloqueou X/Twitter no Brasil","Relatou ADI sobre criptomoedas"],
    aprovacaoSenado:null, simSenado:null, naoSenado:null,
    perfil:{conservador:30, progressista:70}, cor:"#00d4aa" },
  { id:"barroso", nome:"Luís Roberto Barroso",   cargo:"Ministro",           indicadoPor:"Dilma",     partido:"PSDB",  desde:2013, aposentadoria:2063,
    descricao:"Constitucionalista renomado. Relatou descriminalização do porte de maconha para uso pessoal e a ADPF das favelas.",
    decisoesDestaque:["Descriminalização porte de maconha (maioria)","ADPF das Favelas (operações policiais)","Defensor ativo da democracia","Votou contra Marco Temporal"],
    aprovacaoSenado:null, simSenado:null, naoSenado:null,
    perfil:{conservador:25, progressista:75}, cor:"#a78bfa" },
  { id:"fachin",  nome:"Edson Fachin",            cargo:"Vice-Presidente",    indicadoPor:"Dilma",     partido:"PT",    desde:2015, aposentadoria:2065,
    descricao:"Ex-professor da UFPR. Relator da Lava Jato no STF. Anulou condenações de Lula por incompetência do juízo de Curitiba.",
    decisoesDestaque:["Anulou condenações de Lula no STF","Relator da Operação Lava Jato no STF","Votou pela descriminalização da maconha","Votos em defesa do sistema eleitoral"],
    aprovacaoSenado:null, simSenado:null, naoSenado:null,
    perfil:{conservador:20, progressista:80}, cor:"#fb923c" },
  { id:"zanin",   nome:"Cristiano Zanin",         cargo:"Ministro",           indicadoPor:"Lula",      partido:"PT",    desde:2023, aposentadoria:2053,
    descricao:"Foi advogado de defesa do próprio Lula durante a Lava Jato. Nomeação polêmica por conflito de interesses.",
    decisoesDestaque:["Votou pela descriminalização da maconha","Posição ainda em formação (ingresso em 2023)","Aprovado pelo Senado: 58 a 18","Primeiro ministro indicado por ex-cliente"],
    aprovacaoSenado:true, simSenado:58, naoSenado:18,
    perfil:{conservador:35, progressista:65}, cor:"#00d464" },
  { id:"dino",    nome:"Flávio Dino",             cargo:"Ministro",           indicadoPor:"Lula",      partido:"PSB",   desde:2023, aposentadoria:2060,
    descricao:"Ex-governador do Maranhão e ex-ministro da Justiça. Aprovado pelo Senado com placar apertado de 47 a 31.",
    decisoesDestaque:["Aprovado com placar apertado: 47 a 31","Bloqueou emendas parlamentares (Pix)","Ex-governador e ex-ministro da Justiça","Posição em formação no STF"],
    aprovacaoSenado:true, simSenado:47, naoSenado:31,
    perfil:{conservador:30, progressista:70}, cor:"#ffd60a" },
  { id:"fux",     nome:"Luiz Fux",                cargo:"Ministro",           indicadoPor:"Lula",      partido:"PT",    desde:2011, aposentadoria:2028,
    descricao:"Ex-presidente do STF (2020-2022). Processualista. Posição moderada, votou de forma variada nos temas polêmicos.",
    decisoesDestaque:["Presidiu o STF 2020-2022","Posição dividida na maconha","Decisões no Direito Processual","Contra descriminalização do aborto"],
    aprovacaoSenado:null, simSenado:null, naoSenado:null,
    perfil:{conservador:55, progressista:45}, cor:"#94a3b8" },
  { id:"toffoli", nome:"Dias Toffoli",            cargo:"Ministro",           indicadoPor:"Lula",      partido:"PT",    desde:2009, aposentadoria:2035,
    descricao:"Ex-advogado do PT. Polêmico: foi presidente do STF e do TSE. Decisões controversas sobre compartilhamento de dados e inquéritos.",
    decisoesDestaque:["Suspendeu investigação da Coaf sobre Bolsonaro","Votou contra descriminalização da maconha","Ex-presidente do STF (2018-2020)","Decisões monocráticas polêmicas"],
    aprovacaoSenado:null, simSenado:null, naoSenado:null,
    perfil:{conservador:60, progressista:40}, cor:"#f97316" },
  { id:"gilmar",  nome:"Gilmar Mendes",           cargo:"Ministro (Decano)",  indicadoPor:"FHC",       partido:"PSDB",  desde:2002, aposentadoria:2030,
    descricao:"Decano do STF. Indicado por FHC. Jurista prolífico mas com várias decisões polêmicas envolvendo habeas corpus a investigados.",
    decisoesDestaque:["Concedeu habeas corpus a investigados da Lava Jato","Votou contra descriminalização da maconha","Jurista mais antigo do STF","Decisões polêmicas em casos criminais"],
    aprovacaoSenado:null, simSenado:null, naoSenado:null,
    perfil:{conservador:65, progressista:35}, cor:"#64748b" },
  { id:"carmen",  nome:"Cármen Lúcia",            cargo:"Ministra",           indicadoPor:"Lula",      partido:"PT",    desde:2006, aposentadoria:2026,
    descricao:"Ex-presidente do STF e TSE. Conhecida por posições firmes em defesa da democracia. Se aposenta em 2026.",
    decisoesDestaque:["Foi presidente do STF (2016-2018)","Posições firmes contra corrupção","Votou pela descriminalização da maconha","Defesa da democracia e direitos fundamentais"],
    aprovacaoSenado:null, simSenado:null, naoSenado:null,
    perfil:{conservador:35, progressista:65}, cor:"#e879f9" },
  { id:"andre",   nome:"André Mendonça",          cargo:"Ministro",           indicadoPor:"Bolsonaro", partido:"PSL",   desde:2021, aposentadoria:2052,
    descricao:"Ex-AGU e ex-Ministro da Justiça de Bolsonaro. Se declarou 'terrivelmente evangélico'. Posições conservadoras nas pautas de costumes.",
    decisoesDestaque:["Votou contra descriminalização da maconha","Posição conservadora em costumes","Ex-ministro da Justiça de Bolsonaro","Indicado como 'terrivelmente evangélico'"],
    aprovacaoSenado:null, simSenado:null, naoSenado:null,
    perfil:{conservador:85, progressista:15}, cor:"#ef4444" },
  { id:"kassio",  nome:"Kassio Nunes Marques",    cargo:"Ministro",           indicadoPor:"Bolsonaro", partido:"PSL",   desde:2020, aposentadoria:2058,
    descricao:"Indicado por Bolsonaro como primeiro ministro da composição. Ex-presidente do TRF-1. Posições conservadoras.",
    decisoesDestaque:["Votou contra descriminalização da maconha","Posição conservadora na maioria dos temas","Primeiro indicado de Bolsonaro ao STF","Decisões alinhadas com pauta conservadora"],
    aprovacaoSenado:null, simSenado:null, naoSenado:null,
    perfil:{conservador:80, progressista:20}, cor:"#dc2626" },
];

const CASOS_STF = [
  { id:"maconha", emoji:"🌿", titulo:"Descriminalização da Maconha", processo:"RE 635.659",
    descricao:"STF decidiu que portar maconha para uso pessoal não é crime. Placar final de 6 a 5.",
    data:"Jun 2024", resultado:"Aprovado (6x5)",
    votos:{
      moraes:"Sim", barroso:"Sim", fachin:"Sim", zanin:"Sim", dino:"Sim", fux:"Não",
      toffoli:"Não", gilmar:"Não", carmen:"Sim", andre:"Não", kassio:"Não",
    }, aprovado:true },
  { id:"8jan", emoji:"🏛️", titulo:"Julgamento do 8 de Janeiro", processo:"AP 1044 e outros",
    descricao:"Julgamento dos envolvidos nos ataques às sedes dos Três Poderes em 8 de janeiro de 2023.",
    data:"2023/2024", resultado:"Condenações aprovadas",
    votos:{
      moraes:"Relator", barroso:"Sim", fachin:"Sim", zanin:"Sim", dino:"Sim", fux:"Sim",
      toffoli:"Não (parcial)", gilmar:"Não (parcial)", carmen:"Sim", andre:"Não", kassio:"Não",
    }, aprovado:true },
  { id:"marco-temporal", emoji:"🌱", titulo:"Marco Temporal — Inconstitucional", processo:"RE 1.017.365",
    descricao:"STF declarou inconstitucional o marco temporal para demarcação de terras indígenas aprovado pelo Congresso.",
    data:"Set 2023", resultado:"Inconstitucional (9x2)",
    votos:{
      moraes:"Inconst.", barroso:"Inconst.", fachin:"Inconst.", zanin:"Inconst.", dino:"Inconst.", fux:"Const.",
      toffoli:"Inconst.", gilmar:"Inconst.", carmen:"Inconst.", andre:"Const.", kassio:"Inconst.",
    }, aprovado:true },
  { id:"habeas-corpus-aborto", emoji:"⚕️", titulo:"Aborto até 22 semanas — ADPF", processo:"ADPF 442",
    descricao:"ADPF que pede a descriminalização do aborto até 22 semanas de gestação. Ainda não julgada.",
    data:"Pendente", resultado:"Aguardando julgamento",
    votos:{
      moraes:"?", barroso:"Favorável (histórico)", fachin:"?", zanin:"?", dino:"?", fux:"?",
      toffoli:"?", gilmar:"?", carmen:"?", andre:"?", kassio:"?",
    }, aprovado:null },
  { id:"emendas-pix", emoji:"💸", titulo:"Bloqueio das Emendas Parlamentares", processo:"ADPF 850 e outros",
    descricao:"Flávio Dino bloqueou o pagamento de emendas parlamentares via Pix exigindo maior transparência.",
    data:"Nov 2023", resultado:"Mantido pelo plenário",
    votos:{
      moraes:"Sim", barroso:"Sim", fachin:"Sim", zanin:"Sim", dino:"Relator", fux:"Divergência",
      toffoli:"Sim", gilmar:"Divergência", carmen:"Sim", andre:"Divergência", kassio:"Divergência",
    }, aprovado:true },
  { id:"bolsonaro-golpe", emoji:"⚔️", titulo:"Inquérito Golpe de Estado", processo:"Inq. 4.781",
    descricao:"Investigação sobre suposta tentativa de golpe de Estado envolvendo Bolsonaro e militares em 2022/2023.",
    data:"2023/2025", resultado:"Em andamento",
    votos:{
      moraes:"Relator", barroso:"?", fachin:"?", zanin:"?", dino:"?", fux:"?",
      toffoli:"?", gilmar:"?", carmen:"?", andre:"?", kassio:"?",
    }, aprovado:null },
];

function TelaSTF({ s, tema, setTema, setTela }) {
  const T = s.T; const dark = tema === "dark";
  const [ministrSel, setMinistrSel] = useState(null);
  const [casoSel, setCasoSel] = useState(null);
  const [aba, setAba] = useState("ministros"); // ministros | casos
  const [filtro, setFiltro] = useState("todos"); // todos | progressista | conservador | lula | bolsonaro

  const corVotoSTF = v => {
    if (!v) return T.textMuted;
    const vl = v.toLowerCase();
    if (vl.includes("sim")||vl.includes("inconst")) return "#00d464";
    if (vl.includes("não")||vl.includes("const.")) return "#ff4d6d";
    if (vl.includes("relator")) return "#00d4aa";
    if (vl.includes("?")) return T.textMuted;
    return "#ffd60a";
  };
  const emVotoSTF = v => {
    if (!v) return "⬜";
    const vl = v.toLowerCase();
    if (vl.includes("sim")||vl.includes("inconst")) return "✅";
    if (vl.includes("não")||vl.includes("const.")) return "❌";
    if (vl.includes("relator")) return "⚖️";
    return "🔍";
  };

  const ministrFilt = MINISTROS_STF.filter(m => {
    if (filtro === "progressista") return m.perfil.progressista >= 60;
    if (filtro === "conservador") return m.perfil.conservador >= 60;
    if (filtro === "lula") return ["Lula","Dilma","FHC"].includes(m.indicadoPor);
    if (filtro === "bolsonaro") return m.indicadoPor === "Bolsonaro";
    return true;
  });



  // Perfil do ministro
  if (ministrSel) {
    const m = ministrSel;
    const anosRestantes = m.aposentadoria - new Date().getFullYear();
    return (
      <div style={s.app}>
        <div style={s.grid}/><NavBar telaAtual="stf" setTela={(t)=>{setMinistrSel(null);setCasoSel(null);if(t!=="stf")setTela(t);}} setTema={setTema} tema={tema} s={s}/>
        <div style={{...s.main,maxWidth:"800px"}}>
          <BotaoVoltar onClick={()=>setMinistrSel(null)} label="← VOLTAR PARA STF" s={s}/>
          <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"16px",fontSize:"12px"}}>
            <span onClick={()=>setMinistrSel(null)} style={{color:"#00d4aa",cursor:"pointer",fontWeight:"600"}}>⚖️ STF</span>
            <span style={{color:T.textMuted}}>›</span>
            <span style={{color:T.textSecondary}}>{m.nome}</span>
          </div>
          {/* Card ministro */}
          <div style={{background:T.subCardBg,border:`1px solid ${m.cor}44`,borderLeft:`4px solid ${m.cor}`,borderRadius:"12px",padding:"22px",marginBottom:"20px"}}>
            <div style={{display:"flex",gap:"18px",alignItems:"flex-start"}}>
              {/* Avatar com iniciais */}
              <div style={{width:"72px",height:"72px",borderRadius:"50%",background:`${m.cor}22`,border:`3px solid ${m.cor}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:"22px",fontWeight:"800",color:m.cor}}>
                {m.nome.split(" ").filter(w=>w.length>2).slice(0,2).map(w=>w[0]).join("")}
              </div>
              <div style={{flex:1}}>
                <h2 style={{margin:"0 0 6px",fontSize:"18px",fontWeight:"800",color:T.textPrimary}}>{m.nome}</h2>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"10px"}}>
                  <span style={{fontSize:"10px",padding:"3px 10px",borderRadius:"4px",background:T.tagBg,color:T.tagText,fontWeight:"700"}}>{m.cargo}</span>
                  <span style={{fontSize:"10px",padding:"3px 10px",borderRadius:"4px",background:`${m.cor}22`,color:m.cor,fontWeight:"700"}}>Indicado por {m.indicadoPor}</span>
                  <span style={{fontSize:"10px",padding:"3px 10px",borderRadius:"4px",background:T.tagBg,color:T.tagText,fontWeight:"700"}}>Desde {m.desde}</span>
                  <span style={{fontSize:"10px",padding:"3px 10px",borderRadius:"4px",background:anosRestantes<5?"rgba(255,77,109,0.15)":T.tagBg,color:anosRestantes<5?"#ff4d6d":T.tagText,fontWeight:"700"}}>
                    Aposenta {m.aposentadoria} ({anosRestantes > 0 ? `${anosRestantes} anos` : "este ano"})
                  </span>
                </div>
                <p style={{margin:0,fontSize:"12px",color:T.textSecondary,lineHeight:"1.7"}}>{m.descricao}</p>
              </div>
            </div>
            {/* Aprovação Senado */}
            {m.aprovacaoSenado && (
              <div style={{marginTop:"16px",padding:"12px",background:T.cardBg,borderRadius:"8px",display:"flex",gap:"16px",alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:"11px",color:T.textLabel,fontWeight:"700",letterSpacing:"0.08em"}}>APROVAÇÃO NO SENADO</span>
                <span style={{color:"#00d464",fontWeight:"800",fontSize:"14px"}}>✅ {m.simSenado} SIM</span>
                <span style={{color:"#ff4d6d",fontWeight:"800",fontSize:"14px"}}>❌ {m.naoSenado} NÃO</span>
                <span style={{fontSize:"11px",color:T.textMuted}}>({Math.round(m.simSenado/(m.simSenado+m.naoSenado)*100)}% de aprovação)</span>
              </div>
            )}
            {/* Barra progressista/conservador */}
            <div style={{marginTop:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:"10px",color:T.textMuted,marginBottom:"6px"}}>
                <span style={{fontWeight:"700",color:"#ef4444"}}>◀ CONSERVADOR</span>
                <span style={{fontWeight:"700",color:"#a78bfa"}}>PROGRESSISTA ▶</span>
              </div>
              <div style={{height:"8px",background:"#ef444422",borderRadius:"4px",overflow:"hidden"}}>
                <div style={{width:`${m.perfil.progressista}%`,height:"100%",background:"linear-gradient(90deg,#ef4444,#a78bfa)",borderRadius:"4px"}}/>
              </div>
              <div style={{fontSize:"10px",color:T.textMuted,marginTop:"4px",textAlign:"center"}}>
                {m.perfil.progressista >= 60 ? `${m.perfil.progressista}% progressista` : `${m.perfil.conservador}% conservador`} (análise baseada em votos)
              </div>
            </div>
          </div>
          {/* Decisões destaque */}
          <div style={{fontSize:"11px",color:T.textLabel,letterSpacing:"0.1em",fontWeight:"700",marginBottom:"10px"}}>📋 DECISÕES E POSIÇÕES NOTÁVEIS</div>
          <div style={{display:"flex",flexDirection:"column",gap:"6px",marginBottom:"20px"}}>
            {m.decisoesDestaque.map((d,i)=>(
              <div key={i} style={{background:T.subCardBg,border:`1px solid ${T.divider}`,borderRadius:"8px",padding:"10px 14px",display:"flex",gap:"10px",alignItems:"center"}}>
                <span style={{color:m.cor,fontSize:"14px",flexShrink:0}}>›</span>
                <span style={{fontSize:"12px",color:T.textSecondary}}>{d}</span>
              </div>
            ))}
          </div>
          {/* Como votou nos casos */}
          <div style={{fontSize:"11px",color:T.textLabel,letterSpacing:"0.1em",fontWeight:"700",marginBottom:"10px"}}>⚖️ COMO VOTOU NOS CASOS HISTÓRICOS</div>
          <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
            {CASOS_STF.map(caso=>{
              const voto = caso.votos[m.id];
              const cor = corVotoSTF(voto); const em = emVotoSTF(voto);
              return (
                <div key={caso.id} onClick={()=>{setMinistrSel(null);setCasoSel(caso);}}
                  style={{background:T.cardBg,border:`1px solid ${cor}33`,borderLeft:`3px solid ${cor}`,borderRadius:"8px",padding:"12px 14px",display:"flex",gap:"12px",alignItems:"center",cursor:"pointer"}}>
                  <span style={{fontSize:"20px",flexShrink:0}}>{caso.emoji}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:"12px",fontWeight:"700",color:T.textPrimary}}>{caso.titulo}</div>
                    <div style={{fontSize:"10px",color:T.textMuted}}>{caso.processo} · {caso.data}</div>
                  </div>
                  <div style={{textAlign:"center",flexShrink:0}}>
                    <div style={{fontSize:"18px"}}>{em}</div>
                    <div style={{fontSize:"9px",fontWeight:"800",color:cor,marginTop:"1px"}}>{voto||"—"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Detalhe de um caso
  if (casoSel) {
    const caso = casoSel;
    return (
      <div style={s.app}>
        <div style={s.grid}/><NavBar telaAtual="stf" setTela={(t)=>{setMinistrSel(null);setCasoSel(null);if(t!=="stf")setTela(t);}} setTema={setTema} tema={tema} s={s}/>
        <div style={{...s.main,maxWidth:"860px"}}>
          <BotaoVoltar onClick={()=>setCasoSel(null)} label="← VOLTAR PARA STF" s={s}/>
          <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"16px",fontSize:"12px"}}>
            <span onClick={()=>setCasoSel(null)} style={{color:"#00d4aa",cursor:"pointer",fontWeight:"600"}}>⚖️ STF</span>
            <span style={{color:T.textMuted}}>›</span>
            <span style={{color:T.textSecondary}}>{caso.titulo}</span>
          </div>
          <div style={{background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"12px",padding:"20px",marginBottom:"20px"}}>
            <div style={{display:"flex",gap:"14px"}}>
              <span style={{fontSize:"32px"}}>{caso.emoji}</span>
              <div style={{flex:1}}>
                <h2 style={{margin:"0 0 6px",fontSize:"17px",fontWeight:"800",color:T.textPrimary}}>{caso.titulo}</h2>
                <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"10px"}}>
                  <span style={{fontSize:"10px",padding:"2px 8px",borderRadius:"10px",background:T.tagBg,color:T.tagText,fontWeight:"600"}}>{caso.processo}</span>
                  <span style={{fontSize:"10px",padding:"2px 8px",borderRadius:"10px",background:T.tagBg,color:T.tagText,fontWeight:"600"}}>{caso.data}</span>
                  <span style={{fontSize:"10px",padding:"2px 8px",borderRadius:"10px",
                    background:caso.aprovado===true?"rgba(0,212,100,0.15)":caso.aprovado===false?"rgba(255,77,109,0.15)":"rgba(255,214,10,0.15)",
                    color:caso.aprovado===true?"#00d464":caso.aprovado===false?"#ff4d6d":"#ffd60a",fontWeight:"700"}}>
                    {caso.resultado}
                  </span>
                </div>
                <p style={{margin:0,fontSize:"12px",color:T.textSecondary,lineHeight:"1.7"}}>{caso.descricao}</p>
              </div>
            </div>
          </div>
          <div style={{fontSize:"11px",color:T.textLabel,letterSpacing:"0.1em",fontWeight:"700",marginBottom:"10px"}}>🗳️ COMO CADA MINISTRO VOTOU</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:"8px"}}>
            {MINISTROS_STF.map(m=>{
              const voto = caso.votos[m.id];
              const cor = corVotoSTF(voto); const em = emVotoSTF(voto);
              return (
                <div key={m.id} onClick={()=>{setCasoSel(null);setMinistrSel(m);}}
                  style={{background:T.cardBg,border:`1px solid ${cor}33`,borderLeft:`3px solid ${cor}`,borderRadius:"8px",padding:"12px 14px",display:"flex",gap:"12px",alignItems:"center",cursor:"pointer"}}>
                  <div style={{width:"36px",height:"36px",borderRadius:"50%",background:`${m.cor}22`,border:`2px solid ${m.cor}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"13px",fontWeight:"800",color:m.cor,flexShrink:0}}>
                    {m.nome.split(" ").filter(w=>w.length>2).slice(0,2).map(w=>w[0]).join("")}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:"12px",fontWeight:"700",color:T.textPrimary,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.nome}</div>
                    <div style={{fontSize:"10px",color:T.textMuted}}>Indicado: {m.indicadoPor}</div>
                  </div>
                  <div style={{textAlign:"center",flexShrink:0}}>
                    <div style={{fontSize:"18px"}}>{em}</div>
                    <div style={{fontSize:"9px",fontWeight:"800",color:cor,marginTop:"1px",maxWidth:"60px",wordBreak:"break-word",textAlign:"center"}}>{voto||"—"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Tela principal
  return (
    <div style={s.app}>
      <div style={s.grid}/><NavBar telaAtual="stf" setTela={(t)=>{setMinistrSel(null);setCasoSel(null);if(t!=="stf")setTela(t);}} setTema={setTema} tema={tema} s={s}/>
      <div style={{...s.main,maxWidth:"1100px"}}>
        {/* Header */}
        <div style={{marginBottom:"20px"}}>
          <div style={{fontSize:"10px",color:T.textLabel,letterSpacing:"0.12em",marginBottom:"6px"}}>PODER JUDICIÁRIO · SUPREMO TRIBUNAL FEDERAL</div>
          <h1 style={{margin:"0 0 6px",fontSize:"22px",fontWeight:"800",color:T.textPrimary}}>STF — Supremo Tribunal Federal</h1>
          <p style={{margin:0,fontSize:"13px",color:T.textSecondary}}>11 ministros vitalícios que interpretam a Constituição. Clique em um ministro ou caso para ver detalhes.</p>
        </div>
        {/* Tabs */}
        <div style={{display:"flex",gap:"4px",marginBottom:"20px"}}>
          {[{id:"ministros",label:"👤 MINISTROS"},{id:"casos",label:"⚖️ CASOS HISTÓRICOS"}].map(t=>(
            <button key={t.id} onClick={()=>setAba(t.id)} style={{
              padding:"7px 16px",borderRadius:"6px",fontFamily:"inherit",fontSize:"11px",fontWeight:"700",cursor:"pointer",
              background:aba===t.id?T.accentDim:T.tagBg,
              color:aba===t.id?"#00d4aa":T.textSecondary,
              border:`1px solid ${aba===t.id?"#00d4aa44":T.inputBorder}`,
            }}>{t.label}</button>
          ))}
        </div>

        {aba === "ministros" && (<>
          {/* Filtros */}
          <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"16px"}}>
            {[{id:"todos",label:"Todos"},
              {id:"progressista",label:"🟣 Progressistas"},
              {id:"conservador",label:"🔴 Conservadores"},
              {id:"lula",label:"🔵 Indicados PT/PSDB"},
              {id:"bolsonaro",label:"🟡 Indicados Bolsonaro"}].map(f=>(
              <button key={f.id} onClick={()=>setFiltro(f.id)} style={{
                padding:"5px 12px",borderRadius:"6px",fontFamily:"inherit",fontSize:"10px",fontWeight:"700",cursor:"pointer",
                background:filtro===f.id?T.accentDim:T.tagBg,
                color:filtro===f.id?"#00d4aa":T.textSecondary,
                border:`1px solid ${filtro===f.id?"#00d4aa44":T.inputBorder}`,
              }}>{f.label}</button>
            ))}
          </div>
          {/* Grid ministros */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:"10px"}}>
            {ministrFilt.map(m=>{
              const anosR = m.aposentadoria - new Date().getFullYear();
              return (
                <div key={m.id} onClick={()=>setMinistrSel(m)}
                  style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderLeft:`3px solid ${m.cor}`,borderRadius:"10px",padding:"16px",cursor:"pointer"}}>
                  <div style={{display:"flex",gap:"14px",alignItems:"center",marginBottom:"12px"}}>
                    <div style={{width:"48px",height:"48px",borderRadius:"50%",background:`${m.cor}22`,border:`2px solid ${m.cor}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px",fontWeight:"800",color:m.cor,flexShrink:0}}>
                      {m.nome.split(" ").filter(w=>w.length>2).slice(0,2).map(w=>w[0]).join("")}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:"13px",fontWeight:"800",color:T.textPrimary}}>{m.nome}</div>
                      <div style={{fontSize:"10px",color:T.textSecondary,marginTop:"2px"}}>{m.cargo}</div>
                      <div style={{display:"flex",gap:"5px",marginTop:"5px",flexWrap:"wrap"}}>
                        <span style={{fontSize:"9px",padding:"2px 7px",borderRadius:"3px",background:`${m.cor}22`,color:m.cor,fontWeight:"700"}}>Indicado: {m.indicadoPor}</span>
                        <span style={{fontSize:"9px",padding:"2px 7px",borderRadius:"3px",background:anosR<=4?"rgba(255,77,109,0.15)":T.tagBg,color:anosR<=4?"#ff4d6d":T.textMuted,fontWeight:"600"}}>
                          {anosR > 0 ? `Aposenta em ${m.aposentadoria}` : `Aposenta ${m.aposentadoria}`}
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Barra progressista/conservador */}
                  <div style={{height:"5px",background:"#ef444422",borderRadius:"3px",overflow:"hidden"}}>
                    <div style={{width:`${m.perfil.progressista}%`,height:"100%",background:"linear-gradient(90deg,#ef4444,#a78bfa)"}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:"9px",color:T.textMuted,marginTop:"3px"}}>
                    <span>Conservador</span><span>Progressista</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>)}

        {aba === "casos" && (
          <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
            {CASOS_STF.map(caso=>{
              const simCount = Object.values(caso.votos).filter(v=>v?.toLowerCase().includes("sim")||v?.toLowerCase().includes("inconst")).length;
              const naoCount = Object.values(caso.votos).filter(v=>v?.toLowerCase().includes("não")||v?.toLowerCase().includes("const.")).length;
              return (
                <div key={caso.id} onClick={()=>setCasoSel(caso)}
                  style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"10px",padding:"18px",cursor:"pointer",display:"flex",gap:"14px",alignItems:"center"}}>
                  <span style={{fontSize:"28px",flexShrink:0}}>{caso.emoji}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"5px",flexWrap:"wrap"}}>
                      <span style={{fontSize:"14px",fontWeight:"800",color:T.textPrimary}}>{caso.titulo}</span>
                      <span style={{fontSize:"10px",color:T.textMuted,background:T.tagBg,padding:"2px 8px",borderRadius:"10px"}}>{caso.processo}</span>
                    </div>
                    <p style={{margin:"0 0 8px",fontSize:"12px",color:T.textSecondary,lineHeight:"1.5"}}>{caso.descricao}</p>
                    <div style={{display:"flex",gap:"10px",fontSize:"10px",flexWrap:"wrap",alignItems:"center"}}>
                      {simCount > 0 && <span style={{color:"#00d464",fontWeight:"700"}}>✅ {simCount} favoráveis</span>}
                      {naoCount > 0 && <span style={{color:"#ff4d6d",fontWeight:"700"}}>❌ {naoCount} contrários</span>}
                      <span style={{padding:"2px 8px",borderRadius:"10px",
                        background:caso.aprovado===true?"rgba(0,212,100,0.1)":caso.aprovado===false?"rgba(255,77,109,0.1)":"rgba(255,214,10,0.1)",
                        color:caso.aprovado===true?"#00d464":caso.aprovado===false?"#ff4d6d":"#ffd60a",fontWeight:"700"}}>
                        {caso.resultado}
                      </span>
                    </div>
                  </div>
                  <span style={{color:"#00d4aa",fontSize:"18px",flexShrink:0}}>›</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

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
  const [tema, setTema] = useState("dark");

  const dark = tema === "dark";
  const T = {
    // Backgrounds
    appBg:      dark ? "#0a0c0f"                    : "#f0f2f5",
    navBg:      dark ? "rgba(10,12,15,0.97)"        : "rgba(248,249,252,0.97)",
    navBorder:  dark ? "rgba(0,212,170,0.1)"        : "rgba(0,170,130,0.2)",
    cardBg:     dark ? "rgba(255,255,255,0.04)"     : "rgba(255,255,255,0.9)",
    cardBorder: dark ? "rgba(255,255,255,0.08)"     : "rgba(0,0,0,0.08)",
    inputBg:    dark ? "rgba(255,255,255,0.04)"     : "#ffffff",
    inputBorder:dark ? "rgba(255,255,255,0.1)"      : "rgba(0,0,0,0.15)",
    selectBg:   dark ? "#0f1115"                    : "#ffffff",
    gridColor:  dark ? "rgba(0,212,170,0.025)"      : "rgba(0,170,130,0.04)",
    // Textos
    textPrimary:  dark ? "#f2f2f2"  : "#111111",
    textSecondary:dark ? "#999"     : "#555555",
    textMuted:    dark ? "#666"     : "#aaaaaa",
    textLabel:    dark ? "#888"     : "#777777",
    // Accents
    accent:     "#00d4aa",
    accentDim:  dark ? "rgba(0,212,170,0.1)"  : "rgba(0,170,130,0.12)",
    accentBorder:dark? "rgba(0,212,170,0.25)" : "rgba(0,170,130,0.35)",
    // Separador
    divider:    dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)",
    // Tag/badge
    tagBg:      dark ? "rgba(255,255,255,0.1)"  : "rgba(0,0,0,0.07)",
    tagText:    dark ? "#eee"   : "#333",
    // Sub-cards
    subCardBg:  dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.03)",
    subCardBorder: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)",
  };

  const s = {
    app: { minHeight:"100vh", background:T.appBg, color:T.textPrimary, fontFamily:"'IBM Plex Mono','Courier New',monospace", transition:"background 0.3s,color 0.3s" },
    grid: { position:"fixed",inset:0,zIndex:0,pointerEvents:"none",backgroundImage:`linear-gradient(${T.gridColor} 1px,transparent 1px),linear-gradient(90deg,${T.gridColor} 1px,transparent 1px)`,backgroundSize:"40px 40px" },
    nav: { position:"sticky",top:0,zIndex:100,background:T.navBg,backdropFilter:"blur(12px)",borderBottom:`1px solid ${T.navBorder}`,padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:"58px" },
    logo: { display:"flex",alignItems:"center",gap:"8px",color:T.accent,fontWeight:"700",fontSize:"13px",letterSpacing:"0.08em",cursor:"pointer",flexShrink:0 },
    navLinks: { display:"flex",gap:"6px",alignItems:"center" },
    navBtn: (a) => ({ padding:"7px 14px",borderRadius:"6px",background:a?T.accentDim:T.tagBg,border:`1px solid ${a?T.accentBorder:T.cardBorder}`,color:a?T.accent:T.textSecondary,fontSize:"11px",fontFamily:"inherit",fontWeight:"700",letterSpacing:"0.05em",cursor:"pointer",whiteSpace:"nowrap" }),
    main: { position:"relative",zIndex:1,maxWidth:"1000px",margin:"0 auto",padding:"28px 20px" },
    T,
  };

  useEffect(() => {
    (async () => {
      setCarregando(true);
      try {
        // Busca página 1 primeiro — mostra imediatamente
        const r1 = await fetch(`${CAMARA_API}/deputados?itens=100&pagina=1&ordem=ASC&ordenarPor=nome`);
        const d1 = await r1.json();
        let lista = d1.dados || [];

        if (lista.length === 0) throw new Error("API vazia");

        // Mostra os primeiros 100 imediatamente
        const vistos = new Set(lista.map(d => d.id));
        setDeputados(lista.map(d => ({ ...d, classificacao: null, score: null, motivo: null, totalGasto: 0 })));
        setCarregando(false);

        // Busca resto em paralelo (páginas 2-6)
        const paginas = await Promise.allSettled(
          [2,3,4,5,6].map(p => fetch(`${CAMARA_API}/deputados?itens=100&pagina=${p}&ordem=ASC&ordenarPor=nome`).then(r=>r.json()))
        );
        for (const res of paginas) {
          if (res.status === "fulfilled") {
            const novos = (res.value.dados || []).filter(d => !vistos.has(d.id));
            novos.forEach(d => vistos.add(d.id));
            if (novos.length > 0) {
              lista = [...lista, ...novos];
              setDeputados(prev => {
                const idsExist = new Set(prev.map(x => x.id));
                const add = novos.filter(d => !idsExist.has(d.id));
                return [...prev, ...add.map(d => ({ ...d, classificacao: null, score: null, motivo: null, totalGasto: 0 }))];
              });
            }
          }
        }

        // Classifica em lotes de 8
        const LOTE = 8;
        const MAX = Math.min(lista.length, 80);
        for (let i = 0; i < MAX; i += LOTE) {
          const loteAtual = lista.slice(i, i + LOTE);
          await Promise.allSettled(loteAtual.map(async (dep) => {
            try {
              const r = await fetch(`${CAMARA_API}/deputados/${dep.id}/despesas?ano=2024&itens=100`);
              const d = await r.json();
              const despesas = d.dados || [];
              const totalGasto = despesas.reduce((s, x) => s + (x.valorLiquido || 0), 0);
              const classif = classificarLocal(despesas);
              setDeputados(prev => prev.map(x => x.id === dep.id ? { ...x, ...classif, totalGasto } : x));
              // Tenta IA
              try {
                const classifIA = await classificarDeputado(dep, despesas);
                setDeputados(prev => prev.map(x => x.id === dep.id ? { ...x, ...classifIA, totalGasto } : x));
              } catch {}
            } catch {
              setDeputados(prev => prev.map(x => x.id === dep.id ? { ...x, ...classificarLocal([]), totalGasto: 0 } : x));
            }
          }));
          setProgresso(Math.min(99, Math.round(((i + LOTE) / MAX) * 100)));
          await new Promise(r => setTimeout(r, 400));
        }
        setProgresso(100);
      } catch (e) {
        console.error("Erro ao carregar:", e);
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

  if (depSelecionado) return <TelaPerfilDeputado dep={depSelecionado} onVoltar={() => setDepSelecionado(null)} s={s} tema={tema} setTema={setTema} />;
  if (tela === "upload") return <TelaUpload s={s} setTela={setTela} tema={tema} setTema={setTema} />;
  if (tela === "votacoes") return <TelaVotacoes s={s} tema={tema} setTema={setTema} setTela={setTela} />;
  if (tela === "senado") return <TelaSenado s={s} tema={tema} setTema={setTema} setTela={setTela} />;
  if (tela === "stf") return <TelaSTF s={s} tema={tema} setTema={setTema} setTela={setTela} />;

  return (
    <div style={s.app}>
      <div style={s.grid}/>
            <NavBar telaAtual={tela} setTela={setTela} setTema={setTema} tema={tema} s={s}/>

      <div style={s.main}>
        <div style={{ marginBottom:"20px" }}>
          <div style={{ fontSize:"10px",color:T.textLabel,letterSpacing:"0.12em",marginBottom:"5px" }}>LEGISLATURA 57 · DADOS REAIS · API CÂMARA DOS DEPUTADOS</div>
          <h1 style={{ margin:0,fontSize:"22px",fontWeight:"800",color:T.textPrimary }}>Deputados Federais</h1>
        </div>

        {/* Barra progresso IA */}
        {progresso < 100 && !carregando && (
          <div style={{ marginBottom:"16px",background:T.subCardBg,border:`1px solid ${T.divider}`,borderRadius:"8px",padding:"12px 16px" }}>
            <div style={{ display:"flex",justifyContent:"space-between",marginBottom:"7px" }}>
              <span style={{ fontSize:"10px",color:T.textSecondary,letterSpacing:"0.08em",fontWeight:"600" }}>🤖 IA CLASSIFICANDO DEPUTADOS...</span>
              <span style={{ fontSize:"10px",color:"#00d4aa",fontWeight:"700" }}>{progresso}%</span>
            </div>
            <div style={{ height:"3px",background:T.divider,borderRadius:"2px" }}>
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
              background: filtroClassif===item.key&&i>0 ? `${item.cor}11` : T.subCardBg,
              border: `1px solid ${filtroClassif===item.key&&i>0 ? item.cor+"33" : T.divider}`,
              borderTop: `2px solid ${item.cor}`, borderRadius:"8px", padding:"10px 14px",
              cursor:"pointer", textAlign:"center",
            }}>
              <div style={{ fontSize:"20px",fontWeight:"800",color:item.cor }}>{item.valor}</div>
              <div style={{ fontSize:"9px",color:T.textLabel,letterSpacing:"0.08em",marginTop:"2px",fontWeight:"600" }}>{item.label}</div>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div style={{ display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"14px",background:T.subCardBg,border:`1px solid ${T.divider}`,borderRadius:"8px",padding:"12px 14px" }}>
          <div style={{ display:"flex",alignItems:"center",gap:"7px",background:T.inputBg,border:`1px solid ${T.inputBorder}`,borderRadius:"6px",padding:"6px 10px",flex:"1",minWidth:"150px" }}>
            <IconSearch/>
            <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar deputado ou partido..."
              style={{ background:"transparent",border:"none",outline:"none",color:T.textPrimary,fontSize:"11px",fontFamily:"inherit",width:"100%" }}/>
          </div>
          {[
            {label:"UF", val:filtroUf, set:setFiltroUf, opts:ufsDisponiveis},
            {label:"Partido", val:filtroPartido, set:setFiltroPartido, opts:partidosDisponiveis},
          ].map((f,i)=>(
            <select key={i} value={f.val} onChange={e=>f.set(e.target.value)} style={{ background:T.selectBg,border:`1px solid ${T.inputBorder}`,borderRadius:"6px",color:T.textPrimary,fontSize:"11px",fontFamily:"inherit",padding:"6px 10px",cursor:"pointer",outline:"none" }}>
              {f.opts.map(o=><option key={o} value={o} style={{background:T.selectBg,color:T.textPrimary}}>{o}</option>)}
            </select>
          ))}
          <select value={ordenar} onChange={e=>setOrdenar(e.target.value)} style={{ background:T.selectBg,border:`1px solid ${T.inputBorder}`,borderRadius:"6px",color:T.textPrimary,fontSize:"11px",fontFamily:"inherit",padding:"6px 10px",cursor:"pointer",outline:"none" }}>
            <option value="nome" style={{background:T.selectBg,color:T.textPrimary}}>A–Z</option>
            <option value="score" style={{background:T.selectBg,color:T.textPrimary}}>Maior risco</option>
            <option value="gasto" style={{background:T.selectBg,color:T.textPrimary}}>Maior gasto</option>
          </select>
        </div>

        <div style={{ fontSize:"10px",color:T.textLabel,marginBottom:"10px",letterSpacing:"0.06em",fontWeight:"600" }}>
          {deputadosFiltrados.length} DEPUTADOS ENCONTRADOS
        </div>

        {carregando && deputadosFiltrados.length === 0 ? (
          <div style={{ textAlign:"center",padding:"60px",color:"#444" }}>
            <div style={{ fontSize:"22px",marginBottom:"10px" }}>⏳</div>
            <div style={{ fontSize:"11px",letterSpacing:"0.1em" }}>CARREGANDO DEPUTADOS...</div>
          </div>
        ) : deputadosFiltrados.length === 0 ? (
          <div style={{ textAlign:"center",padding:"60px",color:"#555",border:"1px dashed rgba(255,255,255,0.08)",borderRadius:"12px" }}>
            <div style={{ fontSize:"22px",marginBottom:"10px" }}>🔍</div>
            <div style={{ fontSize:"12px",letterSpacing:"0.08em" }}>Nenhum deputado encontrado com esses filtros</div>
          </div>
        ) : (
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:"7px" }}>
            {deputadosFiltrados.map(dep => <CardDeputado key={dep.id} dep={dep} onClick={setDepSelecionado} T={T}/>)}
          </div>
        )}
      </div>
    </div>
  );
}
