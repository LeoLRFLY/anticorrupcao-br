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
function TelaPerfilDeputado({ dep, onVoltar, s, tema, setTema }) {
  const [despesas, setDespesas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState("resumo");
  const [fornExpanded, setFornExpanded] = useState(null);
  const [ano, setAno] = useState(2025);
  const c = COR[dep.classificacao || "loading"];
  const T = s.T;
  const dark = tema === "dark";

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
      <nav style={s.nav}>
        <div style={s.logo} onClick={onVoltar}><IconShield /> ANTICORRUPÇÃO.BR</div>
        <div style={{ display:"flex",gap:"8px",alignItems:"center" }}>
          <button onClick={()=>setTema(dark?"light":"dark")} style={{ background:T.tagBg,border:`1px solid ${T.cardBorder}`,borderRadius:"20px",padding:"5px 12px",cursor:"pointer",fontSize:"14px",display:"flex",alignItems:"center",gap:"6px",color:T.textSecondary,fontFamily:"inherit" }}>{dark?"☀️":"🌙"}<span style={{ fontSize:"10px",fontWeight:"700",letterSpacing:"0.06em" }}>{dark?"CLARO":"ESCURO"}</span></button>
          <button onClick={onVoltar} style={{ background:T.tagBg,border:`1px solid ${T.inputBorder}`,color:T.textPrimary,padding:"7px 16px",borderRadius:"6px",fontSize:"12px",fontFamily:"inherit",cursor:"pointer",fontWeight:"700" }}>← VOLTAR</button>
        </div>
      </nav>
      <div style={{ ...s.main, maxWidth: "800px" }}>
        {/* Breadcrumb */}
        <div style={{ display:"flex",alignItems:"center",gap:"8px",marginBottom:"20px",fontSize:"12px" }}>
          <span onClick={onVoltar} style={{ color:"#00d4aa",cursor:"pointer",fontWeight:"600" }}>Deputados</span>
          <span style={{ color:T.textMuted }}>›</span>
          <span style={{ color:T.textSecondary,fontWeight:"500",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{dep.nome}</span>
        </div>
        {/* Seletor de ano */}
        <div style={{ display:"flex",alignItems:"center",gap:"8px",marginBottom:"16px",flexWrap:"wrap" }}>
          <span style={{ fontSize:"11px",color:T.textLabel,fontWeight:"600",letterSpacing:"0.06em" }}>ANO DE REFERÊNCIA:</span>
          <div style={{ display:"flex",gap:"6px" }}>
            {[2022,2023,2024,2025,2026].map(a=>(
              <button key={a} onClick={()=>setAno(a)} style={{
                padding:"5px 14px",borderRadius:"20px",border:`1px solid ${a===ano?"#00d4aa":T.inputBorder}`,
                background:a===ano?"rgba(0,212,170,0.15)":T.tagBg,
                color:a===ano?"#00d4aa":T.textSecondary,
                fontSize:"11px",fontFamily:"inherit",fontWeight:"700",cursor:"pointer",transition:"all 0.15s"
              }}>{a}</button>
            ))}
          </div>
        </div>

        <div style={{ display:"flex",gap:"20px",alignItems:"center",background:c.bg,border:`1px solid ${c.border}`,borderRadius:"12px",padding:"22px",marginBottom:"22px" }}>
          <img src={dep.urlFoto} alt="" style={{ width:"72px",height:"72px",borderRadius:"50%",objectFit:"cover",border:`3px solid ${c.dot}`,flexShrink:0 }} />
          <div style={{ flex:1 }}>
            <h2 style={{ margin:0,fontSize:"20px",fontWeight:"800",color:"#ffffff",letterSpacing:"-0.01em" }}>{dep.nome}</h2>
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

        {/* Abas */}
        <div style={{ display:"flex",gap:"4px",borderBottom:`1px solid ${T.divider}`,marginBottom:"20px" }}>
          {[
            {id:"resumo",   label:"🔍 RESUMO"},
            {id:"despesas", label:"💳 DESPESAS"},
            {id:"grafico",  label:"📊 CATEGORIAS"},
          ].map(a=>(
            <button key={a.id} onClick={()=>setAba(a.id)} style={{ padding:"10px 16px",background:"transparent",border:"none",borderBottom:aba===a.id?`2px solid ${c.dot}`:"2px solid transparent",color:aba===a.id?c.dot:T.textSecondary,fontSize:"11px",fontFamily:"inherit",fontWeight:"700",letterSpacing:"0.08em",cursor:"pointer",marginBottom:"-1px" }}>{a.label}</button>
          ))}
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
    nav: { position:"sticky",top:0,zIndex:100,background:T.navBg,backdropFilter:"blur(12px)",borderBottom:`1px solid ${T.navBorder}`,padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",height:"54px" },
    logo: { display:"flex",alignItems:"center",gap:"8px",color:T.accent,fontWeight:"700",fontSize:"13px",letterSpacing:"0.08em",cursor:"pointer" },
    navLinks: { display:"flex",gap:"4px",alignItems:"center" },
    navBtn: (a) => ({ padding:"5px 12px",borderRadius:"4px",background:a?T.accentDim:"transparent",border:a?`1px solid ${T.accentBorder}`:"1px solid transparent",color:a?T.accent:T.textMuted,fontSize:"10px",fontFamily:"inherit",fontWeight:"600",letterSpacing:"0.06em",cursor:"pointer" }),
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

  return (
    <div style={s.app}>
      <div style={s.grid}/>
      <nav style={s.nav}>
        <div style={s.logo}><IconShield /> ANTICORRUPÇÃO.BR</div>
        <div style={s.navLinks}>
          <button style={s.navBtn(true)}>DEPUTADOS</button>
          <button style={s.navBtn(false)} onClick={() => setTela("upload")}>UPLOAD DOC</button>
          <button onClick={()=>setTema(dark?"light":"dark")} style={{ marginLeft:"6px",background:T.tagBg,border:`1px solid ${T.cardBorder}`,borderRadius:"20px",padding:"5px 12px",cursor:"pointer",fontSize:"14px",display:"flex",alignItems:"center",gap:"6px",color:T.textSecondary,fontFamily:"inherit" }}>{dark?"☀️":"🌙"}<span style={{ fontSize:"10px",fontWeight:"700",letterSpacing:"0.06em" }}>{dark?"CLARO":"ESCURO"}</span></button>
        </div>
      </nav>

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
