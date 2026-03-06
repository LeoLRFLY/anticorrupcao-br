import { useState, useEffect, useRef } from "react";

// ── APIs ── v3.0 ─────────────────────────────────────────────────────────────
const CAMARA_API = "https://dadosabertos.camara.leg.br/api/v2";
const SENADO_API  = "https://legis.senado.leg.br/dadosabertos";
const CODANTE_API = "https://apis.codante.io/senator-expenses";
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
      <div style={s.logo} onClick={()=>setTela("home")}>
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



// ── Notícias via Vercel Edge Function (/api/news) ─────────────────────────────
async function buscarNoticias(nome) {
  try {
    const r = await fetch(`/api/news?q=${encodeURIComponent(nome)}`);
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

// ── Tela Home / Landing ───────────────────────────────────────────────────────
function TelaHome({ s, tema, setTema, setTela }) {
  const T = s.T; const dark = tema === "dark";
  const [contadorAtivo, setContadorAtivo] = useState(0);
  const [digitando, setDigitando] = useState(true);

  // Frases rotativas no hero — neutras, baseadas em fatos
  const FRASES = [
    { destaque: "R$ 1,3 bilhão", resto: "gastos por deputados em cotas parlamentares em 2024" },
    { destaque: "513 deputados", resto: "cada um com até R$ 45 mil/mês em cota parlamentar" },
    { destaque: "81 senadores", resto: "votando em temas que afetam 215 milhões de brasileiros" },
    { destaque: "Dados oficiais", resto: "das APIs do governo — sem edição, sem opinião" },
  ];

  useEffect(() => {
    const t = setInterval(() => {
      setDigitando(false);
      setTimeout(() => {
        setContadorAtivo(prev => (prev + 1) % FRASES.length);
        setDigitando(true);
      }, 400);
    }, 4000);
    return () => clearInterval(t);
  }, []);

  // Dados de impacto — calculados/estimados com base em dados reais
  const NUMEROS = [
    { valor: "R$ 1,3bi", label: "Gastos CEAP/ano", sub: "cotas parlamentares", cor: "#ff4d6d", icon: "💸" },
    { valor: "605",      label: "Parlamentares",   sub: "monitorados em tempo real", cor: "#00d4aa", icon: "👁️" },
    { valor: "26",       label: "Votações",        sub: "temas sensíveis rastreados", cor: "#a78bfa", icon: "🗳️" },
    { valor: "100%",     label: "Dados oficiais",  sub: "APIs do governo federal", cor: "#ffd60a", icon: "✅" },
  ];

  const PILARES = [
    { icon: "🔍", titulo: "Transparência Total", texto: "Cada dado tem sua fonte citada. Câmara, Senado, Portal da Transparência — você pode verificar tudo." },
    { icon: "⚖️", titulo: "Sem Ideologia",       texto: "Nem direita, nem esquerda. Mostramos o que cada parlamentar fez — os votos e os gastos falam por si." },
    { icon: "🤖", titulo: "Análise por IA",      texto: "Inteligência artificial analisa padrões de gastos e detecta anomalias que seriam impossíveis de ver manualmente." },
    { icon: "📱", titulo: "Para Todo Cidadão",   texto: "Linguagem simples, visual claro. Você não precisa ser especialista para entender quem merece seu voto." },
  ];

  const SECOES = [
    {
      id: "lista", emoji: "👥", titulo: "Câmara dos Deputados",
      subtitulo: "513 deputados federais monitorados",
      descricao: "Veja quanto cada deputado gastou, como votou nos temas mais importantes e se os gastos são suspeitos — tudo calculado pela IA com dados oficiais.",
      cor: "#00d4aa",
      tags: ["Score IA", "Despesas CEAP", "Votações", "Fornecedores"],
    },
    {
      id: "senado", emoji: "🏛️", titulo: "Senado Federal",
      subtitulo: "81 senadores federais monitorados",
      descricao: "Como cada senador votou na Reforma Tributária, Marco Temporal, Arcabouço Fiscal e mais. Gastos detalhados com fornecedores e análise por IA.",
      cor: "#a78bfa",
      tags: ["Score IA", "Despesas CEAP", "Votações", "6 anos de dados"],
    },
    {
      id: "votacoes", emoji: "🗳️", titulo: "Votações Nominais",
      subtitulo: "Os temas mais polêmicos do Congresso",
      descricao: "Filtre por tema e veja como cada parlamentar votou. Reforma da Previdência, Voto Impresso, Descriminalização, Marco Temporal e muito mais.",
      cor: "#fb923c",
      tags: ["13 temas Câmara", "10 temas Senado", "Filtros", "Placar geral"],
    },
    {
      id: "stf", emoji: "⚖️", titulo: "STF — Supremo Tribunal Federal",
      subtitulo: "11 ministros com mandato vitalício",
      descricao: "Quem indicou cada ministro, há quanto tempo estão no cargo, até quando ficam, e como votaram nos casos mais importantes da história recente.",
      cor: "#ffd60a",
      tags: ["11 ministros", "Quem indicou", "Casos históricos", "Mandatos"],
    },
    {
      id: "upload", emoji: "📄", titulo: "Analisar Documento",
      subtitulo: "IA detecta irregularidades",
      descricao: "Suspeita de algo? Cole um texto ou envie um documento e a IA analisa em segundos, identificando padrões suspeitos e possíveis irregularidades.",
      cor: "#34d399",
      tags: ["Análise IA", "Contratos", "Licitações", "Gratuito"],
    },
  ];

  return (
    <div style={s.app}>
      <div style={s.grid}/>

      {/* Nav */}
      <nav style={{...s.nav, justifyContent:"space-between"}}>
        <div style={s.logo}>
          <IconShield/>
          <span style={{display:"flex",flexDirection:"column",lineHeight:1.1}}>
            <span style={{fontSize:"13px",fontWeight:"800",letterSpacing:"0.06em"}}>ANTICORRUPÇÃO</span>
            <span style={{fontSize:"9px",letterSpacing:"0.2em",color:T.textMuted,fontWeight:"600"}}>.BR · DADOS ABERTOS</span>
          </span>
        </div>
        <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
          <span style={{fontSize:"10px",color:"#00d4aa",fontWeight:"700",letterSpacing:"0.06em",padding:"4px 10px",borderRadius:"10px",background:"rgba(0,212,170,0.1)",border:"1px solid rgba(0,212,170,0.2)"}}>● AO VIVO</span>
          <button onClick={()=>setTema(dark?"light":"dark")}
            style={{display:"flex",alignItems:"center",gap:"6px",padding:"8px 12px",borderRadius:"6px",cursor:"pointer",background:T.tagBg,border:`1px solid ${T.cardBorder}`,color:T.textSecondary,fontFamily:"inherit",fontWeight:"700",fontSize:"11px"}}>
            <span style={{fontSize:"14px"}}>{dark?"☀️":"🌙"}</span>
          </button>
        </div>
      </nav>

      <div style={{...s.main, maxWidth:"1000px", paddingTop:"40px"}}>

        {/* ── HERO ── */}
        <div style={{textAlign:"center", marginBottom:"52px", position:"relative"}}>

          {/* Badge */}
          <div style={{display:"inline-flex",alignItems:"center",gap:"8px",background:"rgba(0,212,170,0.08)",border:"1px solid rgba(0,212,170,0.25)",borderRadius:"20px",padding:"6px 16px",fontSize:"10px",color:"#00d4aa",fontWeight:"800",letterSpacing:"0.12em",marginBottom:"28px"}}>
            ● DADOS OFICIAIS · SEM EDITORIAL · APARTIDÁRIO
          </div>

          {/* Título principal */}
          <h1 style={{fontSize:"clamp(32px,6vw,56px)",fontWeight:"800",color:T.textPrimary,margin:"0 0 20px",lineHeight:1.05,letterSpacing:"-0.03em"}}>
            Seu voto é sua<br/>
            <span style={{color:"#00d4aa",textShadow:"0 0 60px #00d4aa55",position:"relative"}}>
              arma mais poderosa
            </span>
          </h1>

          {/* Subtítulo rotativo */}
          <div style={{height:"48px",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:"8px"}}>
            <p style={{
              fontSize:"clamp(14px,2.5vw,18px)",
              color:T.textSecondary,
              margin:0,
              lineHeight:"1.5",
              transition:"opacity 0.4s",
              opacity: digitando ? 1 : 0,
              textAlign:"center",
              maxWidth:"640px",
            }}>
              <strong style={{color:T.textPrimary}}>{FRASES[contadorAtivo].destaque}</strong>
              {" "}{FRASES[contadorAtivo].resto}
            </p>
          </div>
          <p style={{fontSize:"13px",color:T.textMuted,margin:"0 0 36px"}}>
            Use os dados para escolher melhor seus representantes
          </p>

          {/* Botões CTA */}
          <div style={{display:"flex",gap:"12px",justifyContent:"center",flexWrap:"wrap",marginBottom:"44px"}}>
            <button onClick={()=>setTela("lista")} style={{
              padding:"14px 28px",background:"#00d4aa",border:"none",borderRadius:"8px",
              color:"#0a0c0f",fontSize:"13px",fontFamily:"inherit",fontWeight:"800",
              letterSpacing:"0.06em",cursor:"pointer",display:"flex",alignItems:"center",gap:"8px",
              boxShadow:"0 4px 20px rgba(0,212,170,0.4)",transition:"all 0.2s",
            }}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 30px rgba(0,212,170,0.5)";}}
              onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="0 4px 20px rgba(0,212,170,0.4)";}}>
              👥 Ver Deputados
            </button>
            <button onClick={()=>setTela("senado")} style={{
              padding:"14px 28px",background:"transparent",border:"1px solid rgba(167,139,250,0.4)",
              borderRadius:"8px",color:"#a78bfa",fontSize:"13px",fontFamily:"inherit",fontWeight:"800",
              letterSpacing:"0.06em",cursor:"pointer",display:"flex",alignItems:"center",gap:"8px",transition:"all 0.2s",
            }}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(167,139,250,0.08)";e.currentTarget.style.transform="translateY(-2px)";}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.transform="none";}}>
              🏛️ Ver Senadores
            </button>
          </div>

          {/* Números de impacto */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"10px",maxWidth:"680px",margin:"0 auto"}}>
            {NUMEROS.map((n,i) => (
              <div key={i} style={{
                background:T.subCardBg,
                border:`1px solid ${T.subCardBorder}`,
                borderTop:`2px solid ${n.cor}`,
                borderRadius:"10px",padding:"16px 12px",textAlign:"center",
              }}>
                <div style={{fontSize:"22px",marginBottom:"6px"}}>{n.icon}</div>
                <div style={{fontSize:"20px",fontWeight:"800",color:n.cor,lineHeight:1}}>{n.valor}</div>
                <div style={{fontSize:"11px",color:T.textPrimary,fontWeight:"700",marginTop:"5px"}}>{n.label}</div>
                <div style={{fontSize:"9px",color:T.textMuted,marginTop:"2px",lineHeight:"1.4"}}>{n.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── PILARES DE CONFIANÇA ── */}
        <div style={{marginBottom:"48px"}}>
          <div style={{textAlign:"center",marginBottom:"24px"}}>
            <div style={{fontSize:"10px",color:T.textLabel,letterSpacing:"0.15em",fontWeight:"700",marginBottom:"8px"}}>POR QUE CONFIAR</div>
            <h2 style={{margin:0,fontSize:"20px",fontWeight:"800",color:T.textPrimary}}>Construído sobre dados, não opiniões</h2>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:"10px"}}>
            {PILARES.map((p,i) => (
              <div key={i} style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"10px",padding:"18px 16px"}}>
                <div style={{fontSize:"24px",marginBottom:"10px"}}>{p.icon}</div>
                <div style={{fontSize:"13px",fontWeight:"800",color:T.textPrimary,marginBottom:"8px"}}>{p.titulo}</div>
                <p style={{margin:0,fontSize:"11px",color:T.textSecondary,lineHeight:"1.7"}}>{p.texto}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── SEÇÕES DO PORTAL ── */}
        <div style={{marginBottom:"48px"}}>
          <div style={{textAlign:"center",marginBottom:"24px"}}>
            <div style={{fontSize:"10px",color:T.textLabel,letterSpacing:"0.15em",fontWeight:"700",marginBottom:"8px"}}>O QUE VOCÊ PODE INVESTIGAR</div>
            <h2 style={{margin:0,fontSize:"20px",fontWeight:"800",color:T.textPrimary}}>Escolha por onde começar</h2>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:"12px"}}>
            {SECOES.map(sec => (
              <div key={sec.id} onClick={()=>setTela(sec.id)}
                style={{
                  background:T.cardBg,
                  border:`1px solid ${T.cardBorder}`,
                  borderLeft:`3px solid ${sec.cor}`,
                  borderRadius:"12px",padding:"20px",cursor:"pointer",
                  transition:"all 0.2s",position:"relative",overflow:"hidden",
                }}
                onMouseEnter={e=>{
                  e.currentTarget.style.background=`${sec.cor}08`;
                  e.currentTarget.style.borderColor=`${sec.cor}55`;
                  e.currentTarget.style.borderLeftColor=sec.cor;
                  e.currentTarget.style.transform="translateY(-2px)";
                  e.currentTarget.style.boxShadow=`0 8px 24px ${sec.cor}18`;
                }}
                onMouseLeave={e=>{
                  e.currentTarget.style.background=T.cardBg;
                  e.currentTarget.style.borderColor=T.cardBorder;
                  e.currentTarget.style.borderLeftColor=sec.cor;
                  e.currentTarget.style.transform="none";
                  e.currentTarget.style.boxShadow="none";
                }}>
                {/* Emoji decorativo fundo */}
                <div style={{position:"absolute",right:"12px",top:"10px",fontSize:"40px",opacity:0.06,pointerEvents:"none"}}>{sec.emoji}</div>

                <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"12px"}}>
                  <div style={{width:"40px",height:"40px",borderRadius:"8px",background:`${sec.cor}18`,border:`1px solid ${sec.cor}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"20px",flexShrink:0}}>
                    {sec.emoji}
                  </div>
                  <div>
                    <div style={{fontSize:"14px",fontWeight:"800",color:T.textPrimary,lineHeight:1.2}}>{sec.titulo}</div>
                    <div style={{fontSize:"10px",color:sec.cor,fontWeight:"700",letterSpacing:"0.06em",marginTop:"3px"}}>{sec.subtitulo.toUpperCase()}</div>
                  </div>
                </div>

                <p style={{margin:"0 0 14px",fontSize:"12px",color:T.textSecondary,lineHeight:"1.7"}}>{sec.descricao}</p>

                <div style={{display:"flex",gap:"6px",flexWrap:"wrap",alignItems:"center"}}>
                  {sec.tags.map((t,i) => (
                    <span key={i} style={{fontSize:"9px",padding:"2px 8px",borderRadius:"4px",background:`${sec.cor}15`,color:sec.cor,fontWeight:"700",border:`1px solid ${sec.cor}25`}}>{t}</span>
                  ))}
                  <span style={{marginLeft:"auto",fontSize:"12px",color:sec.cor,fontWeight:"800"}}>→</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── COMO FUNCIONA ── */}
        <div style={{background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"14px",padding:"28px",marginBottom:"48px"}}>
          <div style={{textAlign:"center",marginBottom:"24px"}}>
            <div style={{fontSize:"10px",color:T.textLabel,letterSpacing:"0.15em",fontWeight:"700",marginBottom:"8px"}}>TUTORIAL RÁPIDO</div>
            <h2 style={{margin:0,fontSize:"18px",fontWeight:"800",color:T.textPrimary}}>Como usar em 3 passos</h2>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:"20px"}}>
            {[
              { num:"01", titulo:"Escolha o parlamentar", texto:"Busque pelo nome, partido ou estado. Filtre por nível de suspeita (OK, Alerta, Suspeito).", cor:"#00d4aa" },
              { num:"02", titulo:"Veja o perfil completo", texto:"Score de transparência, gastos detalhados com fornecedores, como votou em cada tema polêmico.", cor:"#a78bfa" },
              { num:"03", titulo:"Compartilhe e fiscalize", texto:"Compartilhe o perfil com amigos. Quanto mais pessoas fiscalizam, maior a pressão por transparência.", cor:"#ffd60a" },
            ].map((p,i) => (
              <div key={i} style={{display:"flex",gap:"14px",alignItems:"flex-start"}}>
                <div style={{
                  width:"36px",height:"36px",borderRadius:"8px",
                  background:`${p.cor}18`,border:`1px solid ${p.cor}33`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:"12px",fontWeight:"800",color:p.cor,flexShrink:0,
                }}>{p.num}</div>
                <div>
                  <div style={{fontSize:"13px",fontWeight:"800",color:T.textPrimary,marginBottom:"6px"}}>{p.titulo}</div>
                  <p style={{margin:0,fontSize:"11px",color:T.textSecondary,lineHeight:"1.7"}}>{p.texto}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CHAMADA FINAL ── */}
        <div style={{
          textAlign:"center",marginBottom:"48px",
          padding:"40px 24px",
          background:"linear-gradient(135deg, rgba(0,212,170,0.06) 0%, rgba(167,139,250,0.06) 100%)",
          border:"1px solid rgba(0,212,170,0.2)",
          borderRadius:"16px",
          position:"relative",overflow:"hidden",
        }}>
          <div style={{position:"absolute",top:0,left:0,right:0,bottom:0,background:"radial-gradient(ellipse at 50% 0%, rgba(0,212,170,0.08) 0%, transparent 70%)",pointerEvents:"none"}}/>
          <h2 style={{margin:"0 0 12px",fontSize:"22px",fontWeight:"800",color:T.textPrimary,position:"relative"}}>
            A democracia se fortalece com<br/>
            <span style={{color:"#00d4aa"}}>cidadãos informados</span>
          </h2>
          <p style={{margin:"0 0 24px",fontSize:"13px",color:T.textSecondary,maxWidth:"500px",marginInline:"auto",lineHeight:"1.7",position:"relative"}}>
            Este portal é gratuito, apartidário e baseado exclusivamente em dados oficiais do governo federal.
            Fiscalizar é um direito — e agora ficou muito mais fácil.
          </p>
          <div style={{display:"flex",gap:"10px",justifyContent:"center",flexWrap:"wrap",position:"relative"}}>
            <button onClick={()=>setTela("lista")} style={{padding:"12px 24px",background:"#00d4aa",border:"none",borderRadius:"8px",color:"#0a0c0f",fontSize:"12px",fontFamily:"inherit",fontWeight:"800",letterSpacing:"0.06em",cursor:"pointer"}}>
              👥 Fiscalizar Deputados
            </button>
            <button onClick={()=>setTela("senado")} style={{padding:"12px 24px",background:"transparent",border:"1px solid rgba(167,139,250,0.4)",borderRadius:"8px",color:"#a78bfa",fontSize:"12px",fontFamily:"inherit",fontWeight:"800",letterSpacing:"0.06em",cursor:"pointer"}}>
              🏛️ Fiscalizar Senadores
            </button>
            <button onClick={()=>setTela("stf")} style={{padding:"12px 24px",background:"transparent",border:"1px solid rgba(255,214,10,0.3)",borderRadius:"8px",color:"#ffd60a",fontSize:"12px",fontFamily:"inherit",fontWeight:"800",letterSpacing:"0.06em",cursor:"pointer"}}>
              ⚖️ Ver STF
            </button>
          </div>
        </div>

        {/* ── RODAPÉ ── */}
        <div style={{borderTop:`1px solid ${T.divider}`,paddingTop:"24px",paddingBottom:"32px"}}>
          <div style={{display:"flex",gap:"24px",flexWrap:"wrap",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"16px"}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px"}}>
                <IconShield/>
                <span style={{fontSize:"12px",fontWeight:"800",letterSpacing:"0.06em",color:T.textPrimary}}>ANTICORRUPÇÃO.BR</span>
              </div>
              <p style={{margin:0,fontSize:"11px",color:T.textMuted,lineHeight:"1.7",maxWidth:"380px"}}>
                Portal apartidário de transparência política. Construído com dados abertos do governo federal. Sem fins lucrativos.
              </p>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"6px",alignItems:"flex-end"}}>
              <div style={{fontSize:"10px",color:T.textLabel,fontWeight:"700",letterSpacing:"0.1em",marginBottom:"4px"}}>FONTES DE DADOS</div>
              {[
                "API Câmara dos Deputados (dadosabertos.camara.leg.br)",
                "API Senado Federal (legis.senado.leg.br)",
                "Portal Transparência Senado (Codante.io)",
                "Portal STF",
              ].map((f,i) => (
                <div key={i} style={{fontSize:"10px",color:T.textMuted}}>✓ {f}</div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:"8px",flexWrap:"wrap",paddingTop:"16px",borderTop:`1px solid ${T.divider}`}}>
            {["Código aberto","Dados oficiais","Apartidário","Sem fins lucrativos","Gratuito"].map((t,i)=>(
              <span key={i} style={{fontSize:"9px",padding:"3px 10px",borderRadius:"10px",background:T.tagBg,color:T.textMuted,border:`1px solid ${T.divider}`,fontWeight:"600",letterSpacing:"0.06em"}}>✓ {t}</span>
            ))}
          </div>
        </div>

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
// ── Sistema de Importância e Categorias ──────────────────────────────────────
// Níveis: 4=CRÍTICO(vermelho) 3=ALTO(laranja) 2=MÉDIO(amarelo) 1=ROTINA(verde)
const IMPORTANCIA = {
  4: { label:"CRÍTICO",  cor:"#ef4444", bg:"rgba(239,68,68,0.12)",   borda:"rgba(239,68,68,0.4)",   desc:"PECs e reformas estruturais" },
  3: { label:"ALTO",     cor:"#f97316", bg:"rgba(249,115,22,0.12)",   borda:"rgba(249,115,22,0.4)",  desc:"PLs de impacto nacional" },
  2: { label:"MÉDIO",    cor:"#eab308", bg:"rgba(234,179,8,0.12)",    borda:"rgba(234,179,8,0.4)",   desc:"Legislação setorial relevante" },
  1: { label:"ROTINA",   cor:"#22c55e", bg:"rgba(34,197,94,0.12)",    borda:"rgba(34,197,94,0.4)",   desc:"Votações administrativas" },
};

const CATEGORIAS_VOT = [
  {id:"todas",       label:"Todas",              emoji:""},
  {id:"economia",    label:"Economia",            emoji:"💰"},
  {id:"direitos",    label:"Direitos Sociais",    emoji:"⚖️"},
  {id:"seguranca",   label:"Segurança Pública",   emoji:"🚔"},
  {id:"democracia",  label:"Democracia e Mídia",  emoji:"🗳️"},
  {id:"saude",       label:"Saúde",               emoji:"🏥"},
  {id:"meioambiente",label:"Meio Ambiente",        emoji:"🌿"},
  {id:"tecnologia",  label:"Tecnologia",           emoji:"🤖"},
  {id:"costumes",    label:"Costumes e Moral",     emoji:"⛪"},
];

// ── Votações Câmara dos Deputados ────────────────────────────────────────────
// imp: 4=Crítico 3=Alto 2=Médio 1=Rotina
// votacaoId: usado para buscar votos individuais via API
const TEMAS_SENSIVEIS = [

  // ══ 2024–2026 ══
  { id:"ir-5k", emoji:"💵", titulo:"Isenção IR até R$ 5 mil", subtitulo:"PL 1087/2025",
    descricao:"Isenta do Imposto de Renda trabalhadores com salário de até R$ 5.000, com tributação progressiva até R$ 7.000. Aprovado por quase unanimidade.",
    data:"Out 2025", ano:2025, votacaoId:"2487436-169", resultado:{sim:493,nao:0,abstencao:1}, aprovado:true,
    categoria:"economia", imp:4, casa:"camara" },

  { id:"pl-aborto", emoji:"⚕️", titulo:"PL Aborto = Homicídio (PL 1904/2024)", subtitulo:"PL 1904/2024",
    descricao:"Equiparou a pena do aborto ao homicídio qualificado — até 20 anos de prisão — mesmo em casos de estupro. Aprovado na Câmara em agosto de 2024 de madrugada.",
    data:"Ago 2024", ano:2024, votacaoId:"2434493-42", resultado:{sim:293,nao:117,abstencao:1}, aprovado:true,
    categoria:"costumes", imp:4, casa:"camara" },

  { id:"drogas-pec-plen", emoji:"🚨", titulo:"PEC Criminalização Drogas — Plenário", subtitulo:"PEC 45/2023",
    descricao:"Emenda constitucional que proíbe posse de qualquer droga para uso pessoal — resposta legislativa à decisão do STF de descriminalizar maconha.",
    data:"Ago 2024", ano:2024, votacaoId:"2428236-50", resultado:{sim:308,nao:104,abstencao:3}, aprovado:true,
    categoria:"seguranca", imp:4, casa:"camara" },

  { id:"pec-segpub-camara", emoji:"🛡️", titulo:"PEC da Segurança Pública", subtitulo:"PEC 14/2024",
    descricao:"Incluiu segurança pública entre as responsabilidades da União, criando mecanismos de atuação federal no combate ao crime organizado.",
    data:"Mai 2024", ano:2024, votacaoId:"2427990-52", resultado:{sim:414,nao:48,abstencao:2}, aprovado:true,
    categoria:"seguranca", imp:3, casa:"camara" },

  { id:"pl-ia", emoji:"🤖", titulo:"Marco Legal da Inteligência Artificial", subtitulo:"PL 2338/2023",
    descricao:"Regulamenta o desenvolvimento e uso da IA no Brasil. Baseado no AI Act europeu, estabelece responsabilidades e proibições para sistemas de alto risco.",
    data:"2025 (em tramitação)", ano:2025, votacaoId:null, resultado:{sim:null,nao:null,abstencao:null}, aprovado:null,
    categoria:"tecnologia", imp:3, casa:"camara" },

  { id:"pl-fake-news-urgencia", emoji:"📱", titulo:"PL das Fake News — Urgência Aprovada", subtitulo:"PL 2630/2020",
    descricao:"Aprovação da urgência para o PL que responsabilizaria plataformas digitais. Aprovado por margem estreita (238×192) após intenso lobby das big techs.",
    data:"Abr 2023", ano:2023, votacaoId:"2256735-8", resultado:{sim:238,nao:192,abstencao:1}, aprovado:true,
    categoria:"democracia", imp:4, casa:"camara" },

  // ══ Reforma Tributária ══
  { id:"reforma-trib-1t", emoji:"💰", titulo:"Reforma Tributária — 1º Turno", subtitulo:"PEC 45/2019",
    descricao:"Substituiu PIS, Cofins, IPI, ICMS e ISS por CBS, IBS e Imposto Seletivo. Maior reforma tributária desde 1988. Aprovado com folga no 1º turno.",
    data:"Jul 2023", ano:2023, votacaoId:"2196833-373", resultado:{sim:375,nao:113,abstencao:3}, aprovado:true,
    categoria:"economia", imp:4, casa:"camara" },

  { id:"reforma-trib-2t", emoji:"🏦", titulo:"Reforma Tributária — 2º Turno", subtitulo:"PEC 45/2019",
    descricao:"Votação final confirmando aprovação. Placar mais disputado que o 1º turno: 56 deputados mudaram de voto. Reforma aprovada definitivamente na Câmara.",
    data:"Jul 2023", ano:2023, votacaoId:"2196833-395", resultado:{sim:336,nao:132,abstencao:0}, aprovado:true,
    categoria:"economia", imp:4, casa:"camara" },

  { id:"marco-temporal-camara", emoji:"🌿", titulo:"Marco Temporal Terras Indígenas", subtitulo:"PL 490/2007",
    descricao:"Limitaria demarcações a ocupações em 05/10/1988. Aprovado na Câmara por 290×142. O STF depois o derrubou por inconstitucionalidade.",
    data:"Mai 2023", ano:2023, votacaoId:"345311-279", resultado:{sim:290,nao:142,abstencao:1}, aprovado:true,
    categoria:"meioambiente", imp:4, casa:"camara" },

  { id:"igualdade-salarial", emoji:"👩‍💼", titulo:"Igualdade Salarial Mulheres", subtitulo:"PL 1085/2023",
    descricao:"Obriga empresas a pagar salários iguais para homens e mulheres na mesma função, com multa de 10x o salário do empregado discriminado.",
    data:"Mai 2023", ano:2023, votacaoId:"2351179-51", resultado:{sim:325,nao:36,abstencao:3}, aprovado:true,
    categoria:"direitos", imp:3, casa:"camara" },

  { id:"voto-impresso", emoji:"🗳️", titulo:"PEC do Voto Impresso — Rejeitada", subtitulo:"PEC 135/2019",
    descricao:"Proposta de Bolsonaro para auditar eleições com voto impresso. REJEITADA por não atingir 308 votos (obteve 229 a favor, 218 contra).",
    data:"Ago 2021", ano:2021, votacaoId:"2220292-229", resultado:{sim:229,nao:218,abstencao:1}, aprovado:false,
    categoria:"democracia", imp:4, casa:"camara" },

  // ══ Históricas 5 anos ══
  { id:"fundeb", emoji:"📚", titulo:"Novo FUNDEB", subtitulo:"PEC 15/2015",
    descricao:"Tornou permanente o Fundo da Educação Básica e aumentou a participação da União de 10% para 23%. Aprovado com ampla maioria.",
    data:"Jul 2020", ano:2020, votacaoId:"1198512-250", resultado:{sim:499,nao:7,abstencao:0}, aprovado:true,
    categoria:"direitos", imp:3, casa:"camara" },

  { id:"previdencia-1t", emoji:"👴", titulo:"Reforma da Previdência — 1º Turno", subtitulo:"PEC 6/2019",
    descricao:"Mudou regras de aposentadoria: idade mínima 65H/62M, fim da aposentadoria por tempo de contribuição. Afetou mais de 57 milhões de trabalhadores.",
    data:"Jul 2019", ano:2019, votacaoId:"2192459-636", resultado:{sim:379,nao:131,abstencao:0}, aprovado:true,
    categoria:"economia", imp:4, casa:"camara" },

  { id:"previdencia-2t", emoji:"📋", titulo:"Reforma da Previdência — 2º Turno", subtitulo:"PEC 6/2019",
    descricao:"Aprovação definitiva que consolidou as mudanças previdenciárias mais profundas das últimas décadas no Brasil.",
    data:"Ago 2019", ano:2019, votacaoId:"2192459-786", resultado:{sim:370,nao:124,abstencao:1}, aprovado:true,
    categoria:"economia", imp:4, casa:"camara" },

  { id:"piso-enfermagem", emoji:"🏥", titulo:"Piso Salarial da Enfermagem", subtitulo:"PL 2564/2020",
    descricao:"Estabeleceu piso de R$ 4.750 para enfermeiros, R$ 3.325 para técnicos e R$ 2.375 para auxiliares. STF suspendeu parcialmente por impacto fiscal.",
    data:"Mai 2022", ano:2022, votacaoId:"2309349-146", resultado:{sim:449,nao:12,abstencao:0}, aprovado:true,
    categoria:"saude", imp:3, casa:"camara" },

  { id:"imposto-exportacao", emoji:"🌾", titulo:"Imposto sobre Exportação de Agronegócio", subtitulo:"PEC 23/2023",
    descricao:"Proposta de taxação de exportações do agronegócio para financiar fundo de transição climática. Rejeitada pela bancada ruralista.",
    data:"2023", ano:2023, votacaoId:null, resultado:{sim:null,nao:null,abstencao:null}, aprovado:false,
    categoria:"meioambiente", imp:2, casa:"camara" },

  { id:"mineracao-indigena", emoji:"⛏️", titulo:"Mineração em Terras Indígenas", subtitulo:"PL 191/2020",
    descricao:"Regulamentaria atividades de mineração, garimpo e agropecuária em terras indígenas. Aprovado na Câmara em 2021, aguarda Senado.",
    data:"Fev 2022", ano:2022, votacaoId:"1805714-285", resultado:{sim:321,nao:137,abstencao:3}, aprovado:true,
    categoria:"meioambiente", imp:3, casa:"camara" },
];

// ── Votações Senado Federal ───────────────────────────────────────────────────
const TEMAS_SENADO = [
  { id:"ref-trib-senado", emoji:"💰", titulo:"Reforma Tributária — Aprovação Final", subtitulo:"PEC 45/2019",
    descricao:"Após aprovação na Câmara, o Senado aprovou a maior reforma tributária da história brasileira. Substitui 5 tributos por CBS, IBS e Imposto Seletivo.",
    data:"Nov 2023", ano:2023, sessaoId:"6777", periodo:"20231101/20231130",
    resultado:{sim:53,nao:24,abstencao:4}, aprovado:true, categoria:"economia", imp:4, casa:"senado" },

  { id:"marco-temporal-senado", emoji:"🌿", titulo:"Marco Temporal — Aprovação no Senado", subtitulo:"PL 2903/2023",
    descricao:"O Senado aprovou o Marco Temporal por 43×21. O STF depois declarou inconstitucional. Senadores aprovaram mesmo após decisão parcial do STF.",
    data:"Set 2023", ano:2023, sessaoId:"6756", periodo:"20230901/20230930",
    resultado:{sim:43,nao:21,abstencao:17}, aprovado:true, categoria:"meioambiente", imp:4, casa:"senado" },

  { id:"arcabouco-fiscal", emoji:"📊", titulo:"Arcabouço Fiscal", subtitulo:"PEC 8/2021",
    descricao:"Novo marco fiscal que substitui o teto de gastos. Define limites de crescimento de despesas vinculados à arrecadação, com sanções automáticas.",
    data:"Nov 2023", ano:2023, sessaoId:"6781", periodo:"20231101/20231130",
    resultado:{sim:52,nao:18,abstencao:11}, aprovado:true, categoria:"economia", imp:4, casa:"senado" },

  { id:"destaque-ref-trib", emoji:"🏦", titulo:"Reforma Tributária — Destaques Rejeitados", subtitulo:"PEC 45/2019",
    descricao:"Emendas polêmicas ao texto da Reforma Tributária foram rejeitadas pelo Senado, preservando o texto vindo da Câmara.",
    data:"Nov 2023", ano:2023, sessaoId:"6774", periodo:"20231101/20231130",
    resultado:{sim:31,nao:41,abstencao:9}, aprovado:false, categoria:"economia", imp:3, casa:"senado" },

  { id:"pec-seg-pub-senado", emoji:"🛡️", titulo:"PEC da Segurança Pública — Senado", subtitulo:"PEC 66/2023",
    descricao:"Inclui segurança pública como responsabilidade da União. Aprovada em 2 turnos no Senado após passar pela Câmara. Permite ação federal direta.",
    data:"Ago 2024", ano:2024, sessaoId:"6868", periodo:"20240801/20240831",
    resultado:{sim:58,nao:14,abstencao:4}, aprovado:true, categoria:"seguranca", imp:4, casa:"senado" },

  { id:"zanin-aprovacao", emoji:"⚖️", titulo:"Aprovação Cristiano Zanin (STF)", subtitulo:"MSF 34/2023",
    descricao:"Senado aprovou indicação de Zanin — ex-advogado de Lula — ao STF. Aprovação com 58×18 votos, sendo a mais contestada indicação recente.",
    data:"Jun 2023", ano:2023, sessaoId:"6713", periodo:"20230601/20230630",
    resultado:{sim:58,nao:18,abstencao:0}, aprovado:true, categoria:"democracia", imp:3, casa:"senado" },

  { id:"dino-aprovacao", emoji:"⚖️", titulo:"Aprovação Flávio Dino (STF)", subtitulo:"MSF 88/2023",
    descricao:"Senado aprovou Flávio Dino com placar de 47×31 — o mais apertado da história recente do STF. Dino foi ministro da Justiça de Lula antes da indicação.",
    data:"Dez 2023", ano:2023, sessaoId:"6813", periodo:"20231201/20231231",
    resultado:{sim:47,nao:31,abstencao:0}, aprovado:true, categoria:"democracia", imp:3, casa:"senado" },

  { id:"galipolo-bcb", emoji:"🏦", titulo:"Aprovação Galípolo (Banco Central)", subtitulo:"MSF 27/2023",
    descricao:"Gabriel Galípolo aprovado para o Banco Central com 39×12 votos. Indicado de Lula para suceder Campos Neto como presidente do BC.",
    data:"Jul 2023", ano:2023, sessaoId:"6724", periodo:"20230701/20230731",
    resultado:{sim:39,nao:12,abstencao:0}, aprovado:true, categoria:"economia", imp:3, casa:"senado" },

  { id:"pec-transicao", emoji:"💸", titulo:"PEC da Transição — Furo do Teto", subtitulo:"PEC 32/2022",
    descricao:"Permitiu R$ 168 bilhões extras fora do teto de gastos para financiar Bolsa Família e outras promessas de campanha de Lula. Aprovada em dezembro/2022.",
    data:"Dez 2022", ano:2022, sessaoId:"6671", periodo:"20221201/20221231",
    resultado:{sim:63,nao:11,abstencao:7}, aprovado:true, categoria:"economia", imp:4, casa:"senado" },

  { id:"pec-combustiveis", emoji:"⛽", titulo:"PEC dos Combustíveis (Kamikaze)", subtitulo:"PEC 15/2022",
    descricao:"Zerou impostos federais sobre combustíveis e criou auxílio-caminhoneiro e vale-gás. Aprovada às vésperas da eleição de 2022 por Bolsonaro.",
    data:"Jun 2022", ano:2022, sessaoId:"6623", periodo:"20220601/20220831",
    resultado:{sim:64,nao:13,abstencao:4}, aprovado:true, categoria:"economia", imp:3, casa:"senado" },
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
  const [filtCasa, setFiltCasa] = useState("todas");
  const [filtImp, setFiltImp] = useState(0); // 0=todas, 1-4=níveis

  // Combina Câmara + Senado
  const TODOS_TEMAS = [...TEMAS_SENSIVEIS, ...TEMAS_SENADO];

  const carregarVotos = async (t) => {
    setTemaSel(t); setVotos([]); setCarregando(true);
    setBusca(""); setFiltVoto("todos"); setFiltPartido("Todos");
    try {
      if (t.casa === "senado" && t.sessaoId && t.periodo) {
        // Senado: votos individuais reais embutidos no JSON de lista
        const url = `https://legis.senado.leg.br/dadosabertos/plenario/lista/votacao/${t.periodo}.json`;
        const r = await fetch(url);
        const d = await r.json();
        const vs = d?.ListaVotacoes?.Votacoes?.Votacao || [];
        const vot = vs.find(v => String(v.CodigoSessaoVotacao) === String(t.sessaoId));
        const senadores = vot?.Votos?.VotoParlamentar || [];
        const mapeados = senadores.map(v => {
          // Voto pode ser "Sim", "Não", "Votou" (secreto), "AP", "P-NRV", etc.
          const votoRaw = v.Voto || "";
          const votoNorm = votoRaw === "Sim" ? "SIM" : votoRaw === "Não" ? "NÃO" : votoRaw;
          return {
            nome: v.NomeParlamentar, partido: v.SiglaPartido, uf: v.SiglaUF || v.SiglaUf,
            voto: votoNorm,
            urlFoto: v.Foto || `https://ui-avatars.com/api/?name=${encodeURIComponent(v.NomeParlamentar)}&background=1a1f2e&color=00d4aa&size=60`
          };
        });
        setVotos(mapeados);
      }
      // Câmara: API /votacoes/{id}/votos foi desativada — não tenta mais
    } catch(e) { console.error(e); }
    setCarregando(false);
  };

  const corVoto = v => {
    if (!v) return T.textMuted;
    const vl = v.toUpperCase();
    if (vl==="SIM"||vl==="S") return "#00d464";
    if (vl==="NÃO"||vl==="NAO"||vl==="N") return "#ff4d6d";
    if (vl==="VOTOU") return "#60a5fa"; // voto secreto — só confirma presença
    if (["AP","LS","MIS","NCom","LP","P-NRV"].some(x=>v.includes(x))) return T.textMuted;
    return "#ffd60a";
  };
  const emVoto = v => {
    if (!v) return "⬜";
    const vl = v.toUpperCase();
    if (vl==="SIM"||vl==="S") return "✅";
    if (vl==="NÃO"||vl==="NAO"||vl==="N") return "❌";
    if (vl==="VOTOU") return "🔒"; // secreto
    if (["AP","LS","MIS","NCom","LP","P-NRV"].some(x=>v.includes(x))) return "⬜";
    return "🟡";
  };

  const temasFiltrados = TODOS_TEMAS.filter(t => {
    if (filtCasa !== "todas" && t.casa !== filtCasa) return false;
    if (filtCat !== "todas" && t.categoria !== filtCat) return false;
    if (filtImp > 0 && t.imp !== filtImp) return false;
    return true;
  }).sort((a,b) => b.imp - a.imp || b.ano - a.ano);

  const votosFiltrados = votos.filter(v => {
    if (busca) {
      const q = busca.toLowerCase();
      if (!v.nome?.toLowerCase().includes(q) && !v.partido?.toLowerCase().includes(q) && !v.uf?.toLowerCase().includes(q)) return false;
    }
    if (filtVoto !== "todos") {
      const vl = (v.voto||"").toUpperCase();
      if (filtVoto==="sim" && vl!=="SIM" && vl!=="S") return false;
      if (filtVoto==="nao" && vl!=="NÃO" && vl!=="NAO" && vl!=="N") return false;
      if (filtVoto==="secreto" && vl!=="VOTOU") return false;
      if (filtVoto==="outro" && (vl==="SIM"||vl==="S"||vl==="NÃO"||vl==="NAO"||vl==="N"||vl==="VOTOU")) return false;
    }
    if (filtPartido !== "Todos" && v.partido !== filtPartido) return false;
    return true;
  });

  const partidos = temaSel ? ["Todos", ...Array.from(new Set(votos.map(v=>v.partido).filter(Boolean))).sort()] : [];

  // ── Detalhe de uma votação ────────────────────────────────────────────────
  if (temaSel) {
    const imp = IMPORTANCIA[temaSel.imp] || IMPORTANCIA[2];
    const tot = (temaSel.resultado.sim||0) + (temaSel.resultado.nao||0) + (temaSel.resultado.abstencao||0);
    const pS = tot>0 ? Math.round((temaSel.resultado.sim||0)/tot*100) : null;
    const pN = tot>0 ? Math.round((temaSel.resultado.nao||0)/tot*100) : null;
    const contSim = votosFiltrados.filter(v=>["SIM","S"].includes((v.voto||"").toUpperCase())).length;
    const contNao = votosFiltrados.filter(v=>["NÃO","NAO","N"].includes((v.voto||"").toUpperCase())).length;

    return (
      <div style={s.app}>
        <div style={s.grid}/>
        <NavBar telaAtual="votacoes" setTela={(t)=>{if(t==="votacoes")setTemaSel(null);else setTela(t);}} setTema={setTema} tema={tema} s={s}/>
        <div style={{...s.main,maxWidth:"920px"}}>
          <BotaoVoltar onClick={()=>setTemaSel(null)} label="← VOLTAR PARA VOTAÇÕES" s={s}/>

          {/* Header tema */}
          <div style={{background:T.subCardBg,border:`1px solid ${imp.borda}`,borderLeft:`4px solid ${imp.cor}`,borderRadius:"12px",padding:"20px",marginBottom:"18px"}}>
            <div style={{display:"flex",gap:"12px",alignItems:"flex-start"}}>
              <span style={{fontSize:"32px",flexShrink:0}}>{temaSel.emoji}</span>
              <div style={{flex:1}}>
                <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"8px",alignItems:"center"}}>
                  <span style={{fontSize:"11px",padding:"3px 10px",borderRadius:"4px",background:imp.bg,color:imp.cor,fontWeight:"800",border:`1px solid ${imp.borda}`}}>
                    ● {imp.label}
                  </span>
                  <span style={{fontSize:"10px",padding:"3px 10px",borderRadius:"4px",background:T.tagBg,color:T.textMuted,fontWeight:"600"}}>{temaSel.subtitulo}</span>
                  <span style={{fontSize:"10px",padding:"3px 10px",borderRadius:"4px",background:T.tagBg,color:T.textMuted,fontWeight:"600"}}>{temaSel.data}</span>
                  <span style={{fontSize:"10px",padding:"3px 10px",borderRadius:"4px",background:T.tagBg,color:temaSel.casa==="camara"?"#00d4aa":"#a78bfa",fontWeight:"700"}}>
                    {temaSel.casa==="camara"?"👥 Câmara":"🏛️ Senado"}
                  </span>
                </div>
                <h2 style={{margin:"0 0 8px",fontSize:"17px",fontWeight:"800",color:T.textPrimary}}>{temaSel.titulo}</h2>
                <p style={{margin:0,fontSize:"12px",color:T.textSecondary,lineHeight:"1.7"}}>{temaSel.descricao}</p>
              </div>
            </div>

            {/* Placar */}
            {temaSel.resultado.sim !== null && (
              <div style={{marginTop:"16px"}}>
                <div style={{height:"10px",background:T.divider,borderRadius:"5px",overflow:"hidden",display:"flex"}}>
                  <div style={{width:`${pS}%`,background:"#00d464",transition:"width 0.6s"}}/>
                  <div style={{width:`${pN}%`,background:"#ff4d6d",transition:"width 0.6s"}}/>
                </div>
                <div style={{display:"flex",gap:"16px",marginTop:"10px",flexWrap:"wrap"}}>
                  <span style={{color:"#00d464",fontWeight:"800",fontSize:"14px"}}>✅ {temaSel.resultado.sim} SIM ({pS}%)</span>
                  <span style={{color:"#ff4d6d",fontWeight:"800",fontSize:"14px"}}>❌ {temaSel.resultado.nao} NÃO ({pN}%)</span>
                  {temaSel.resultado.abstencao > 0 && <span style={{color:"#ffd60a",fontWeight:"700",fontSize:"13px"}}>🟡 {temaSel.resultado.abstencao} abst.</span>}
                  <span style={{fontSize:"10px",padding:"3px 10px",borderRadius:"10px",marginLeft:"auto",
                    background:temaSel.aprovado===true?"rgba(0,212,100,0.15)":"rgba(255,77,109,0.15)",
                    color:temaSel.aprovado===true?"#00d464":"#ff4d6d",fontWeight:"800"}}>
                    {temaSel.aprovado===true?"✓ APROVADA":"✗ REJEITADA"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Votos individuais */}
          {carregando ? (
            <div style={{textAlign:"center",padding:"40px",color:T.textMuted}}>⏳ Carregando votos...</div>
          ) : temaSel.casa === "camara" ? (
            <div style={{background:T.subCardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"12px",padding:"24px"}}>
              <div style={{textAlign:"center",marginBottom:"20px"}}>
                <div style={{fontSize:"28px",marginBottom:"8px"}}>⚠️</div>
                <div style={{fontWeight:"700",color:T.textSecondary,marginBottom:"6px"}}>Votos individuais indisponíveis na Câmara</div>
                <div style={{fontSize:"12px",color:T.textMuted,maxWidth:"400px",margin:"0 auto",lineHeight:"1.7"}}>
                  A API da Câmara desativou o endpoint de votos nominais individuais. 
                  Para ver o voto de cada deputado, acesse o portal oficial:
                </div>
                <a href={`https://www.camara.leg.br/internet/votacao/mostraVotacao.asp?ideVotacao=${temaSel.votacaoId?.split("-")[0]}`}
                  target="_blank" rel="noopener"
                  style={{display:"inline-block",marginTop:"12px",padding:"8px 18px",borderRadius:"8px",background:"rgba(0,212,170,0.15)",border:"1px solid #00d4aa44",color:"#00d4aa",fontSize:"11px",fontWeight:"800",textDecoration:"none"}}>
                  🔗 VER NA CÂMARA DOS DEPUTADOS →
                </a>
              </div>
              {/* Placar por partido baseado nos dados curados */}
              {temaSel.resultado.sim !== null && (
                <div style={{borderTop:`1px solid ${T.divider}`,paddingTop:"16px"}}>
                  <div style={{fontSize:"11px",color:T.textMuted,marginBottom:"12px",fontWeight:"700",letterSpacing:"0.08em"}}>PLACAR OFICIAL DA VOTAÇÃO</div>
                  <div style={{display:"flex",gap:"12px",flexWrap:"wrap"}}>
                    {[
                      {v:temaSel.resultado.sim, l:"SIM", c:"#00d464"},
                      {v:temaSel.resultado.nao, l:"NÃO", c:"#ff4d6d"},
                      {v:temaSel.resultado.abstencao, l:"ABST", c:"#ffd60a"},
                    ].filter(x=>x.v>0).map((item,i)=>(
                      <div key={i} style={{background:`${item.c}15`,border:`1px solid ${item.c}44`,borderRadius:"8px",padding:"12px 18px",textAlign:"center"}}>
                        <div style={{fontSize:"22px",fontWeight:"800",color:item.c}}>{item.v}</div>
                        <div style={{fontSize:"9px",color:item.c,fontWeight:"700",letterSpacing:"0.1em"}}>{item.l}</div>
                      </div>
                    ))}
                    <div style={{background:T.tagBg,border:`1px solid ${T.cardBorder}`,borderRadius:"8px",padding:"12px 18px",textAlign:"center",marginLeft:"auto"}}>
                      <div style={{fontSize:"14px",fontWeight:"800",color:temaSel.aprovado?"#00d464":"#ff4d6d"}}>{temaSel.aprovado?"✓ APROVADA":"✗ REJEITADA"}</div>
                      <div style={{fontSize:"9px",color:T.textMuted,fontWeight:"600",letterSpacing:"0.08em"}}>RESULTADO</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : !temaSel.sessaoId ? (
            <div style={{textAlign:"center",padding:"40px",color:T.textMuted,background:T.subCardBg,borderRadius:"12px"}}>
              <div style={{fontSize:"32px",marginBottom:"12px"}}>📋</div>
              <div style={{fontWeight:"700",color:T.textSecondary,marginBottom:"6px"}}>Votos individuais não disponíveis</div>
              <div style={{fontSize:"12px"}}>Esta votação ainda está em tramitação ou os dados não estão na API pública.</div>
            </div>
          ) : votos.length === 0 ? (
            <div style={{textAlign:"center",padding:"40px",color:T.textMuted}}>Carregando votos do Senado...</div>
          ) : (<>
            {/* Filtros */}
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"14px",alignItems:"center"}}>
              <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="🔍 Buscar nome/partido/UF..."
                style={{flex:1,minWidth:"160px",background:T.inputBg,border:`1px solid ${T.inputBorder}`,color:T.textPrimary,padding:"7px 12px",borderRadius:"6px",fontSize:"11px",fontFamily:"inherit"}}/>
              {[
                {id:"todos",l:"Todos",bg:"",c:""},
                {id:"sim",l:"✅ SIM",bg:"rgba(0,212,100,0.15)",c:"#00d464"},
                {id:"nao",l:"❌ NÃO",bg:"rgba(255,77,109,0.15)",c:"#ff4d6d"},
                {id:"secreto",l:"🔒 Secreto",bg:"rgba(96,165,250,0.15)",c:"#60a5fa"},
                {id:"outro",l:"⬜ Ausente",bg:"",c:""},
              ].map(f=>(
                <button key={f.id} onClick={()=>setFiltVoto(f.id)} style={{padding:"6px 12px",borderRadius:"6px",fontFamily:"inherit",fontSize:"10px",fontWeight:"700",cursor:"pointer",
                  background:filtVoto===f.id?(f.bg||T.accentDim):T.tagBg,
                  color:filtVoto===f.id?(f.c||"#00d4aa"):T.textMuted,
                  border:`1px solid ${filtVoto===f.id?(f.c||"#00d4aa")+"44":T.cardBorder}`}}>
                  {f.l}
                </button>
              ))}
              <select value={filtPartido} onChange={e=>setFiltPartido(e.target.value)}
                style={{background:T.inputBg,border:`1px solid ${T.inputBorder}`,color:T.textPrimary,padding:"6px 10px",borderRadius:"6px",fontSize:"11px",fontFamily:"inherit",cursor:"pointer"}}>
                {partidos.map(p=><option key={p}>{p}</option>)}
              </select>
            </div>
            <div style={{fontSize:"11px",color:T.textMuted,marginBottom:"10px"}}>
              {votosFiltrados.length} parlamentares · ✅ {contSim} SIM · ❌ {contNao} NÃO
              {votosFiltrados.filter(v=>(v.voto||"").toUpperCase()==="VOTOU").length > 0 && (
                <span> · 🔒 {votosFiltrados.filter(v=>(v.voto||"").toUpperCase()==="VOTOU").length} Secreto</span>
              )}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:"6px"}}>
              {votosFiltrados.map((v,i)=>{
                const cor = corVoto(v.voto); const em = emVoto(v.voto);
                return (
                  <div key={i} style={{background:T.cardBg,border:`1px solid ${cor}33`,borderLeft:`3px solid ${cor}`,borderRadius:"8px",padding:"10px 12px",display:"flex",gap:"10px",alignItems:"center"}}>
                    <img src={v.urlFoto} alt="" style={{width:"36px",height:"36px",borderRadius:"50%",objectFit:"cover",border:`2px solid ${cor}44`,flexShrink:0}} onError={e=>e.target.style.display="none"}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:"11px",fontWeight:"700",color:T.textPrimary,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{v.nome}</div>
                      <div style={{fontSize:"9px",color:T.textMuted}}>{v.partido} · {v.uf}</div>
                    </div>
                    <div style={{textAlign:"center",flexShrink:0}}>
                      <div style={{fontSize:"16px"}}>{em}</div>
                      <div style={{fontSize:"8px",fontWeight:"800",color:cor}}>{v.voto||"—"}</div>
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

  // ── Lista de temas ──────────────────────────────────────────────────────────
  const anosDisponiveis = [...new Set(TODOS_TEMAS.map(t=>t.ano))].sort((a,b)=>b-a);

  return (
    <div style={s.app}>
      <div style={s.grid}/>
      <NavBar telaAtual="votacoes" setTela={setTela} setTema={setTema} tema={tema} s={s}/>
      <div style={{...s.main,maxWidth:"1000px"}}>

        {/* Header */}
        <div style={{marginBottom:"24px"}}>
          <div style={{fontSize:"10px",color:T.textLabel,letterSpacing:"0.12em",marginBottom:"6px"}}>CÂMARA · SENADO · VOTAÇÕES NOMINAIS</div>
          <h1 style={{margin:"0 0 6px",fontSize:"22px",fontWeight:"800",color:T.textPrimary}}>Votações por Importância</h1>
          <p style={{margin:0,fontSize:"13px",color:T.textSecondary,lineHeight:"1.6"}}>
            {TODOS_TEMAS.length} votações dos últimos 5 anos classificadas por impacto. Clique para ver o voto de cada parlamentar.
          </p>
        </div>

        {/* Legenda de importância */}
        <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"16px"}}>
          {[0,4,3,2,1].map(imp=>{
            const info = imp===0 ? {label:"Todas",cor:T.textSecondary,bg:T.tagBg,borda:T.cardBorder} : IMPORTANCIA[imp];
            return (
              <button key={imp} onClick={()=>setFiltImp(imp)} style={{
                display:"flex",alignItems:"center",gap:"6px",
                padding:"6px 14px",borderRadius:"6px",cursor:"pointer",
                fontFamily:"inherit",fontSize:"10px",fontWeight:"800",
                background:filtImp===imp?info.bg:T.tagBg,
                color:filtImp===imp?info.cor:T.textMuted,
                border:`1px solid ${filtImp===imp?info.borda:T.cardBorder}`,
              }}>
                {imp>0 && <span style={{width:"8px",height:"8px",borderRadius:"50%",background:info.cor,display:"inline-block",flexShrink:0}}/>}
                {imp===0?"Todas importâncias":`${info.label}${imp===4?" (PECs/Reformas)":imp===3?" (PLs nacionais)":imp===2?" (Setorial)":""}`}
              </button>
            );
          })}
        </div>

        {/* Filtros */}
        <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"20px"}}>
          {/* Casa */}
          {[{id:"todas",l:"Todas as casas"},{id:"camara",l:"👥 Câmara"},{id:"senado",l:"🏛️ Senado"}].map(c=>(
            <button key={c.id} onClick={()=>setFiltCasa(c.id)} style={{padding:"5px 12px",borderRadius:"20px",fontFamily:"inherit",fontSize:"10px",fontWeight:"700",cursor:"pointer",
              background:filtCasa===c.id?"rgba(0,212,170,0.15)":T.tagBg,color:filtCasa===c.id?"#00d4aa":T.textMuted,
              border:`1px solid ${filtCasa===c.id?"#00d4aa44":T.inputBorder}`}}>
              {c.l}
            </button>
          ))}
          <div style={{width:"1px",background:T.divider,margin:"0 4px",alignSelf:"stretch"}}/>
          {/* Categoria */}
          {CATEGORIAS_VOT.map(cat=>(
            <button key={cat.id} onClick={()=>setFiltCat(cat.id)} style={{padding:"5px 12px",borderRadius:"20px",fontFamily:"inherit",fontSize:"10px",fontWeight:"700",cursor:"pointer",
              background:filtCat===cat.id?"rgba(0,212,170,0.15)":T.tagBg,color:filtCat===cat.id?"#00d4aa":T.textMuted,
              border:`1px solid ${filtCat===cat.id?"#00d4aa44":T.inputBorder}`}}>
              {cat.emoji} {cat.id==="todas"?"Todas categorias":cat.label}
            </button>
          ))}
        </div>

        {/* Contador */}
        <div style={{fontSize:"11px",color:T.textMuted,marginBottom:"14px"}}>
          {temasFiltrados.length} votações · {temasFiltrados.filter(t=>t.casa==="camara").length} Câmara · {temasFiltrados.filter(t=>t.casa==="senado").length} Senado
        </div>

        {/* Grid de temas agrupados por importância */}
        {[4,3,2,1].map(nImp => {
          const grupo = temasFiltrados.filter(t=>t.imp===nImp);
          if (!grupo.length) return null;
          const info = IMPORTANCIA[nImp];
          return (
            <div key={nImp} style={{marginBottom:"28px"}}>
              {/* Header grupo */}
              <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"12px"}}>
                <div style={{width:"10px",height:"10px",borderRadius:"50%",background:info.cor,flexShrink:0,boxShadow:`0 0 8px ${info.cor}88`}}/>
                <span style={{fontSize:"11px",fontWeight:"800",color:info.cor,letterSpacing:"0.1em"}}>{info.label}</span>
                <span style={{fontSize:"10px",color:T.textMuted}}>— {info.desc}</span>
                <span style={{fontSize:"10px",color:T.textMuted,marginLeft:"auto"}}>{grupo.length} votação{grupo.length>1?"s":""}</span>
              </div>

              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {grupo.map(t => {
                  const tot = (t.resultado.sim||0)+(t.resultado.nao||0)+(t.resultado.abstencao||0);
                  const pS = tot>0 ? Math.round((t.resultado.sim||0)/tot*100) : null;
                  const pN = tot>0 ? Math.round((t.resultado.nao||0)/tot*100) : null;
                  const cat = CATEGORIAS_VOT.find(c=>c.id===t.categoria);
                  return (
                    <div key={t.id} onClick={()=>carregarVotos(t)}
                      style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderLeft:`3px solid ${info.cor}`,
                        borderRadius:"10px",padding:"16px",cursor:"pointer",transition:"all 0.15s"}}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor=info.cor;e.currentTarget.style.background=info.bg;}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor=T.cardBorder;e.currentTarget.style.borderLeftColor=info.cor;e.currentTarget.style.background=T.cardBg;}}>
                      <div style={{display:"flex",gap:"12px",alignItems:"center"}}>
                        <span style={{fontSize:"24px",flexShrink:0}}>{t.emoji}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"5px",alignItems:"center"}}>
                            <span style={{fontSize:"13px",fontWeight:"800",color:T.textPrimary}}>{t.titulo}</span>
                          </div>
                          <div style={{display:"flex",gap:"6px",flexWrap:"wrap",alignItems:"center",marginBottom:"8px"}}>
                            <span style={{fontSize:"9px",padding:"2px 8px",borderRadius:"3px",background:T.tagBg,color:T.textMuted,fontWeight:"600"}}>{t.subtitulo}</span>
                            <span style={{fontSize:"9px",padding:"2px 8px",borderRadius:"3px",background:T.tagBg,color:T.textMuted,fontWeight:"600"}}>{t.data}</span>
                            {cat && <span style={{fontSize:"9px",padding:"2px 8px",borderRadius:"3px",background:T.tagBg,color:T.textMuted,fontWeight:"600"}}>{cat.emoji} {cat.label}</span>}
                            <span style={{fontSize:"9px",padding:"2px 8px",borderRadius:"3px",background:t.casa==="camara"?"rgba(0,212,170,0.1)":"rgba(167,139,250,0.1)",color:t.casa==="camara"?"#00d4aa":"#a78bfa",fontWeight:"700"}}>
                              {t.casa==="camara"?"👥 Câmara":"🏛️ Senado"}
                            </span>
                          </div>
                          {/* Mini barra placar */}
                          {pS !== null ? (
                            <div>
                              <div style={{height:"5px",background:T.divider,borderRadius:"3px",overflow:"hidden",display:"flex",marginBottom:"4px"}}>
                                <div style={{width:`${pS}%`,background:"#00d464"}}/>
                                <div style={{width:`${pN}%`,background:"#ff4d6d"}}/>
                              </div>
                              <div style={{display:"flex",gap:"10px",fontSize:"10px"}}>
                                <span style={{color:"#00d464",fontWeight:"700"}}>✅ {t.resultado.sim} ({pS}%)</span>
                                <span style={{color:"#ff4d6d",fontWeight:"700"}}>❌ {t.resultado.nao} ({pN}%)</span>
                                {t.aprovado!==null && <span style={{marginLeft:"auto",fontWeight:"800",color:t.aprovado?"#00d464":"#ff4d6d"}}>{t.aprovado?"✓ APROVADA":"✗ REJEITADA"}</span>}
                              </div>
                            </div>
                          ) : (
                            <div style={{fontSize:"10px",color:T.textMuted,fontStyle:"italic"}}>
                              {t.aprovado===null?"📋 Em tramitação":"Placar não disponível via API"}
                            </div>
                          )}
                        </div>
                        <span style={{color:info.cor,fontSize:"18px",flexShrink:0}}>›</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


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
  const [senAba, setSenAba] = useState("votos");
  const [notSen, setNotSen]   = useState([]);
  // Despesas senador (CEAP via Codante)
  const [despSen, setDespSen] = useState([]);
  const [despSenMeta, setDespSenMeta] = useState(null);
  const [carregDespSen, setCarregDespSen] = useState(false);
  const [anoDespSen, setAnoDespSen] = useState(2025);
  const [fornSenExp, setFornSenExp] = useState(null);
  const [carregNotSen, setCarregNotSen] = useState(false);
  // Mapa nome→id do Codante (carregado uma vez)
  const [codanteMap, setCodanteMap] = useState({});
  const [filtOrdem, setFiltOrdem] = useState("A-Z");
  const [filtClassif, setFiltClassif] = useState("Todos");
  const [scoresCarregados, setScoresCarregados] = useState(false);

  // Calcula score/classificação de cada senador baseado nos GASTOS (igual ao deputado)
  function calcScoreSenador(totalGasto, numTransacoes, numFornecedores) {
    // Thresholds calibrados com dados reais de 2024 (média: R$ 371k, mediana: R$ 421k, max: R$ 583k)
    if (totalGasto === 0 && numTransacoes === 0)
      return { classificacao:"ok", score:5, motivo:"Sem despesas registradas" };
    // Suspeito: acima de R$ 480k (~top 15%) ou concentração extrema
    if (totalGasto > 480000 || (numFornecedores > 0 && numFornecedores < 3 && numTransacoes > 20))
      return { classificacao:"suspeito", score: Math.min(95, 60 + Math.floor(totalGasto/10000)),
        motivo: totalGasto > 480000 ? `Gastos acima da média: R$ ${(totalGasto/1000).toFixed(0)} mil` : "Alta concentração em poucos fornecedores" };
    // Alerta: R$ 350k–480k
    if (totalGasto > 350000)
      return { classificacao:"alerta", score: Math.min(64, 35 + Math.floor(totalGasto/15000)),
        motivo: `Gastos elevados, requer atenção: R$ ${(totalGasto/1000).toFixed(0)} mil` };
    // OK
    return { classificacao:"ok", score: Math.max(5, Math.floor(totalGasto/10000)),
      motivo: `Gastos dentro do padrão: R$ ${(totalGasto/1000).toFixed(0)} mil` };
  }

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
          classificacao: "loading", score: null, motivo: "",
        })));
      } catch {}
      // Carrega mapa nome→id do Codante em paralelo
      try {
        const rc = await fetch(`${CODANTE_API}/senators?active=1`, {headers:{"Accept":"application/json"}});
        const dc = await rc.json();
        const mapa = {};
        (dc.data||[]).forEach(s => { mapa[s.name.toLowerCase().trim()] = s.id; });
        setCodanteMap(mapa);
      } catch {}
      setCarregando(false);
    })();
  }, []);

  // Carrega GASTOS de todos os senadores em background (lotes de 15, igual ao deputado)
  useEffect(() => {
    if (carregando || senadores.length === 0 || scoresCarregados || Object.keys(codanteMap).length === 0) return;
    (async () => {
      const ANO = 2024;
      // Também carrega votos (em paralelo) para guardar no votosCache
      const periodosUnicos = [...new Set(TEMAS_SENADO.map(t=>t.periodo))];
      const dadosPeriodos = {};
      await Promise.allSettled(periodosUnicos.map(async (periodo) => {
        try {
          const r = await fetch(`${SENADO_API}/plenario/lista/votacao/${periodo}.json`);
          const d = await r.json();
          dadosPeriodos[periodo] = d?.ListaVotacoes?.Votacoes?.Votacao || [];
        } catch { dadosPeriodos[periodo] = []; }
      }));

      // Carrega despesas em lotes de 15
      const LOTE = 15;
      for (let i = 0; i < senadores.length; i += LOTE) {
        const lote = senadores.slice(i, i + LOTE);
        const resultados = await Promise.allSettled(lote.map(async sen => {
          const codanteId = codanteMap[sen.nome?.toLowerCase().trim()];
          if (!codanteId) return { id: sen.id, total: 0, count: 0, fornecedores: 0 };
          try {
            const r = await fetch(`${CODANTE_API}/senators/${codanteId}/expenses?year=${ANO}&page=1`, {headers:{"Accept":"application/json"}});
            const d = await r.json();
            const meta = d.meta || {};
            // Conta fornecedores únicos nas primeiras 100 despesas
            const fornSet = new Set((d.data||[]).map(g=>g.supplier_document).filter(Boolean));
            return {
              id: sen.id,
              total: parseFloat(meta.expenses_sum || 0),
              count: parseInt(meta.expenses_count || 0),
              fornecedores: fornSet.size,
            };
          } catch { return { id: sen.id, total: 0, count: 0, fornecedores: 0 }; }
        }));

        // Atualiza senadores do lote com score baseado em gastos
        setSenadores(prev => prev.map(sen => {
          const idx = lote.findIndex(l => l.id === sen.id);
          if (idx === -1) return sen;
          const res = resultados[idx];
          if (res.status !== "fulfilled") return { ...sen, classificacao:"ok", score:5, motivo:"Erro ao carregar" };
          const { total, count, fornecedores } = res.value;
          // Calcula votos cache
          const votos = {};
          TEMAS_SENADO.forEach(tema => {
            const vs = dadosPeriodos[tema.periodo] || [];
            const vot = vs.find(v => String(v.CodigoSessaoVotacao) === String(tema.sessaoId));
            if (vot) {
              const vp = (vot.Votos?.VotoParlamentar||[]).find(v=>v.CodigoParlamentar===sen.id);
              votos[tema.id] = vp?.Voto || "Ausente";
            } else votos[tema.id] = "Ausente";
          });
          const cl = calcScoreSenador(total, count, fornecedores);
          return { ...sen, ...cl, votosCache: votos, totalGastoCeap: total };
        }));
      }
      setScoresCarregados(true);
    })();
  }, [carregando, senadores.length, scoresCarregados, Object.keys(codanteMap).length]);

  const carregarVotacaoTema = async (tema) => {
    setAbaVot(tema); setVotosVot([]); setCarregVot(true);
    setFiltVoto("todos"); setFiltBusca("");
    try {
      const url = `${SENADO_API}/plenario/lista/votacao/${tema.periodo}.json`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const vs = d?.ListaVotacoes?.Votacoes?.Votacao || [];
      // Busca pelo sessaoId — compara como string
      const vot = vs.find(v => String(v.CodigoSessaoVotacao) === String(tema.sessaoId));
      if (vot) {
        const vps = vot.Votos?.VotoParlamentar || [];
        setVotosVot(vps);
      } else {
        console.warn("Sessão não encontrada:", tema.sessaoId, "disponíveis:", vs.map(v=>v.CodigoSessaoVotacao));
      }
    } catch(e) { console.error("Erro carregarVotacaoTema:", e); }
    setCarregVot(false);
  };

  const carregarVotosSenador = async (sen) => {
    setSenadorSel(sen); setVotosSenad({}); setCarregVotSenad(true);
    setSenAba("votos"); setDespSen([]); setDespSenMeta(null); setFornSenExp(null); setNotSen([]); setCarregNotSen(false);
    // Se o senador já tem votosCache (calculado no background), usa direto
    if (sen.votosCache) {
      setVotosSenad(sen.votosCache);
      setCarregVotSenad(false);
    } else {
      const resultado = {};
      await Promise.allSettled(TEMAS_SENADO.map(async (tema) => {
        try {
          const r = await fetch(`${SENADO_API}/plenario/lista/votacao/${tema.periodo}.json`);
          const d = await r.json();
          const vs = d?.ListaVotacoes?.Votacoes?.Votacao || [];
          const vot = vs.find(v => String(v.CodigoSessaoVotacao) === String(tema.sessaoId));
          if (vot) {
            const vp = (vot.Votos?.VotoParlamentar || []).find(v => v.CodigoParlamentar === sen.id);
            resultado[tema.id] = vp?.Voto || "Ausente";
          } else resultado[tema.id] = "Ausente";
        } catch { resultado[tema.id] = "Ausente"; }
      }));
      setVotosSenad(resultado);
      setCarregVotSenad(false);
    }
  };

  const carregarDespesasSenador = async (sen, ano) => {
    setCarregDespSen(true); setDespSen([]); setDespSenMeta(null); setFornSenExp(null);
    // Busca ID do Codante pelo nome do senador
    const codanteId = codanteMap[sen.nome?.toLowerCase().trim()];
    if (!codanteId) { setCarregDespSen(false); return; }
    try {
      // Busca até 3 páginas (300 despesas)
      const pages = await Promise.allSettled([1,2,3].map(p =>
        fetch(`${CODANTE_API}/senators/${codanteId}/expenses?year=${ano}&page=${p}`, {headers:{"Accept":"application/json"}})
          .then(r=>r.json())
      ));
      let todas = [];
      let meta = null;
      pages.forEach(p => {
        if (p.status==="fulfilled") {
          todas = [...todas, ...(p.value.data||[])];
          if (!meta) meta = p.value.meta;
        }
      });
      setDespSen(todas);
      setDespSenMeta(meta);
    } catch(e) { console.error(e); }
    setCarregDespSen(false);
  };

  const partidos = ["Todos", ...new Set(senadores.map(s => s.partido).filter(Boolean))].sort();
  const ufs = ["Todos", ...new Set(senadores.map(s => s.uf).filter(Boolean))].sort();

  const COR_SEN = {
    ok:      { dot:"#00d464", bg:"rgba(0,212,100,0.08)",  border:"rgba(0,212,100,0.25)",  text:"#00d464",  label:"✓ OK"       },
    alerta:  { dot:"#ffd60a", bg:"rgba(255,214,10,0.08)", border:"rgba(255,214,10,0.25)", text:"#ffd60a",  label:"△ ALERTA"   },
    suspeito:{ dot:"#ff4d6d", bg:"rgba(255,77,109,0.08)", border:"rgba(255,77,109,0.25)", text:"#ff4d6d",  label:"● SUSPEITO" },
    loading: { dot:"#555",    bg:"transparent",           border:"rgba(255,255,255,0.06)",text:"#888",     label:"..."        },
  };

  const senadoresFiltrados = senadores
    .filter(s => {
      if (busca && !s.nome.toLowerCase().includes(busca.toLowerCase()) && !s.partido?.toLowerCase().includes(busca.toLowerCase())) return false;
      if (filtPartido !== "Todos" && s.partido !== filtPartido) return false;
      if (filtUf !== "Todos" && s.uf !== filtUf) return false;
      if (filtClassif !== "Todos" && s.classificacao !== filtClassif) return false;
      return true;
    })
    .sort((a,b) => {
      if (filtOrdem === "A-Z") return a.nome.localeCompare(b.nome);
      if (filtOrdem === "Z-A") return b.nome.localeCompare(a.nome);
      if (filtOrdem === "Score↓") return (b.score||0) - (a.score||0);
      if (filtOrdem === "Score↑") return (a.score||0) - (b.score||0);
      return 0;
    });

  const corVoto = t => { const v=t?.toLowerCase(); return v==="sim"?"#00d464":v==="não"||v==="nao"?"#ff4d6d":v==="ausente"||v==="abstencao"?T.textMuted:"#ffd60a"; };
  const bgVoto  = t => { const v=t?.toLowerCase(); return v==="sim"?"rgba(0,212,100,0.1)":v==="não"||v==="nao"?"rgba(255,77,109,0.1)":"transparent"; };
  const emVoto  = t => { const v=t?.toLowerCase(); return v==="sim"?"✅":v==="não"||v==="nao"?"❌":v==="ausente"?"⬜":"🟡"; };

  const votosFiltrados = votosVot.filter(v => {
    if (filtBusca && !v.NomeParlamentar?.toLowerCase().includes(filtBusca.toLowerCase()) && !v.SiglaPartido?.toLowerCase().includes(filtBusca.toLowerCase())) return false;
    if (filtVoto !== "todos" && v.Voto?.toLowerCase() !== filtVoto) return false;
    return true;
  });

  // Tela perfil senador — completo com despesas, igual ao deputado
  if (senadorSel) {
    const sim   = Object.values(votosSenad).filter(v => v?.toLowerCase() === "sim").length;
    const nao   = Object.values(votosSenad).filter(v => v?.toLowerCase() === "não" || v?.toLowerCase() === "nao").length;
    const secr  = Object.values(votosSenad).filter(v => v?.toLowerCase() === "votou").length;
    const aus   = Object.values(votosSenad).filter(v => v === "Ausente").length;
    const total = Object.keys(votosSenad).length;
    const totalGasto   = despSen.reduce((s,d) => s + parseFloat(d.amount||0), 0);
    const fornSenCount = new Set(despSen.map(d=>d.supplier_document).filter(Boolean)).size;
    const alertasSen   = despSen.filter(d => parseFloat(d.amount||0) > 20000);
    const temCodante   = !!codanteMap[senadorSel.nome?.toLowerCase().trim()];
    const corSen       = senadorSel.classificacao==="suspeito"?"#ff2d55":senadorSel.classificacao==="alerta"?"#ffc400":"#00d464";

    const [secaoSen, setSSecaoSen]     = React.useState(null);
    const [filtCatSen2, setFiltCatSen2]   = React.useState("Todas");
    const [filtBuscaSen2, setFiltBuscaSen2] = React.useState("");
    const [despSenExp2, setDespSenExp2]   = React.useState(null);

    const catsSen2 = ["Todas", ...Array.from(new Set(despSen.map(d=>d.expense_category||"Outros"))).sort()];
    const despSenFilt2 = despSen.filter(d => {
      const catOk  = filtCatSen2==="Todas" || d.expense_category===filtCatSen2;
      const buscaOk = !filtBuscaSen2 || (d.supplier||"").toLowerCase().includes(filtBuscaSen2.toLowerCase());
      return catOk && buscaOk;
    });

    return (
      <div style={s.app}>
        <div style={s.grid}/>
        <NavBar telaAtual="senado" setTela={(t)=>{setSenadorSel(null);if(t!=="senado")setTela(t);}} setTema={setTema} tema={tema} s={s}/>
        <div style={{...s.main,maxWidth:"900px"}}>
          <BotaoVoltar onClick={()=>setSenadorSel(null)} label="← VOLTAR PARA SENADO" s={s}/>

          {/* ── HERO ── */}
          <div style={{display:"flex",gap:"20px",alignItems:"flex-start",marginBottom:"20px",background:T.cardBg,border:`1px solid ${corSen}33`,borderTop:`3px solid ${corSen}`,borderRadius:"14px",padding:"24px",flexWrap:"wrap"}}>
            <img src={senadorSel.foto||`https://ui-avatars.com/api/?name=${encodeURIComponent(senadorSel.nome)}&background=1a1f2e&color=a78bfa&size=120&bold=true`}
              alt="" style={{width:"88px",height:"88px",borderRadius:"14px",objectFit:"cover",border:`3px solid ${corSen}`,flexShrink:0}}
              onError={e=>{e.target.src=`https://ui-avatars.com/api/?name=${encodeURIComponent(senadorSel.nome)}&background=1a1f2e&color=a78bfa&size=120&bold=true`;}}/>
            <div style={{flex:1,minWidth:"200px"}}>
              <div style={{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center",marginBottom:"4px"}}>
                <h1 style={{margin:0,fontSize:"20px",fontWeight:"800",color:T.textPrimary}}>{senadorSel.nome}</h1>
                <span style={{fontSize:"10px",padding:"3px 10px",borderRadius:"10px",background:`${corSen}18`,color:corSen,border:`1px solid ${corSen}33`,fontWeight:"800"}}>
                  {senadorSel.classificacao==="suspeito"?"🔴 SUSPEITO":senadorSel.classificacao==="alerta"?"⚠️ ALERTA":"✓ OK"}
                </span>
              </div>
              <div style={{fontSize:"13px",color:T.textSecondary,marginBottom:"10px"}}>{senadorSel.partido} · {senadorSel.uf} · Senador(a) Federal</div>
            </div>
            <div style={{textAlign:"center",flexShrink:0,background:`${corSen}10`,border:`1px solid ${corSen}33`,borderRadius:"12px",padding:"14px 20px"}}>
              <div style={{fontSize:"36px",fontWeight:"800",color:corSen,lineHeight:1}}>{senadorSel.score??total>0?Math.round(((sim+nao+secr)/total)*100):"—"}</div>
              <div style={{fontSize:"9px",color:T.textMuted,marginTop:"4px",letterSpacing:"0.1em",fontWeight:"700"}}>SCORE IA</div>
            </div>
          </div>

          {/* ── DASHBOARD CARDS ── */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:"10px",marginBottom:"20px"}}>
            {[
              {icon:"💸",label:"Gasto CEAP",valor:`R$ ${(totalGasto/1000).toFixed(1)}k`,sub:`${anoDespSen} · ${despSen.length} transações`,cor:"#ff4d6d",sec:"despesas"},
              {icon:"🏢",label:"Fornecedores",valor:fornSenCount,sub:`${catsSen2.length-1} categorias`,cor:"#ffc400",sec:"categorias"},
              {icon:"🗳️",label:"Votações",valor:`${sim}S · ${nao}N`,sub:`${aus} ausências · ${total} total`,cor:"#a78bfa",sec:"votacoes"},
              {icon:"📰",label:"Notícias",valor:notSen.length||"—",sub:"Google News ao vivo",cor:"#00d4aa",sec:"noticias"},
            ].map((c,i)=>(
              <div key={i} onClick={()=>setSSecaoSen(secaoSen===c.sec?null:c.sec)}
                style={{background:T.cardBg,border:`1px solid ${secaoSen===c.sec?c.cor+"55":T.cardBorder}`,borderTop:`3px solid ${c.cor}`,borderRadius:"12px",padding:"16px",cursor:"pointer",transition:"all 0.2s"}}
                onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 24px ${c.cor}22`;}}
                onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none";}}>
                <div style={{fontSize:"22px",marginBottom:"8px"}}>{c.icon}</div>
                <div style={{fontSize:"18px",fontWeight:"800",color:c.cor,lineHeight:1,marginBottom:"4px"}}>{c.valor}</div>
                <div style={{fontSize:"11px",fontWeight:"700",color:T.textPrimary,marginBottom:"3px"}}>{c.label}</div>
                <div style={{fontSize:"9px",color:T.textMuted}}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* ── ANÁLISE IA COMPLETA ── */}
          <div style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderLeft:"4px solid #a78bfa",borderRadius:"12px",padding:"20px",marginBottom:"20px"}}>
            <div style={{display:"flex",gap:"10px",alignItems:"center",marginBottom:"14px"}}>
              <span style={{fontSize:"22px"}}>🤖</span>
              <div>
                <div style={{fontSize:"12px",fontWeight:"800",color:"#a78bfa",letterSpacing:"0.08em"}}>ANÁLISE COMPLETA DA IA</div>
                <div style={{fontSize:"10px",color:T.textMuted,marginTop:"2px"}}>Baseada em despesas reais, votações e padrões detectados</div>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              {[
                totalGasto > 480000
                  ? {nivel:"critico",icon:"🚨",titulo:"Gastos muito acima da média",texto:`R$ ${(totalGasto/1000).toFixed(0)}k em ${anoDespSen}. A cota média anual dos senadores é ≈ R$ 371k. ${((totalGasto/371000-1)*100).toFixed(0)}% acima da média.`}
                  : totalGasto > 250000
                  ? {nivel:"atencao",icon:"⚠️",titulo:"Gastos elevados",texto:`R$ ${(totalGasto/1000).toFixed(0)}k em ${anoDespSen}. Acima da mediana dos senadores brasileiros.`}
                  : totalGasto > 0
                  ? {nivel:"ok",icon:"✅",titulo:"Gastos dentro do padrão",texto:`R$ ${(totalGasto/1000).toFixed(0)}k em ${anoDespSen}. Dentro da média esperada para senadores.`}
                  : null,
                alertasSen.length > 0
                  ? {nivel:"atencao",icon:"💸",titulo:`${alertasSen.length} transação(ões) acima de R$ 20.000`,texto:alertasSen.slice(0,2).map(a=>`${a.supplier} (R$ ${parseFloat(a.amount||0).toLocaleString("pt-BR",{maximumFractionDigits:0})})`).join(" · ") + (alertasSen.length>2?` e mais ${alertasSen.length-2}`:"")}
                  : null,
                aus > total*0.4 && total>0
                  ? {nivel:"atencao",icon:"🗳️",titulo:"Alta ausência em votações",texto:`Ausente em ${aus} de ${total} votações rastreadas (${Math.round(aus/total*100)}%). Baixo engajamento parlamentar.`}
                  : null,
                {nivel:"info",icon:"📊",titulo:"Presença parlamentar",texto:total>0?`${sim} votos SIM · ${nao} votos NÃO · ${secr} votos secretos · ${aus} ausências em ${total} votações rastreadas`:"Sem dados de votação disponíveis."},
              ].filter(Boolean).map((a,i)=>{
                const cores={critico:{bg:"rgba(255,77,109,0.08)",border:"rgba(255,77,109,0.3)",text:"#ff4d6d"},atencao:{bg:"rgba(255,196,0,0.08)",border:"rgba(255,196,0,0.3)",text:"#ffc400"},ok:{bg:"rgba(0,212,100,0.08)",border:"rgba(0,212,100,0.3)",text:"#00d464"},info:{bg:"rgba(167,139,250,0.06)",border:"rgba(167,139,250,0.2)",text:"#a78bfa"}};
                const cor=cores[a.nivel]||cores.info;
                return (
                  <div key={i} style={{background:cor.bg,border:`1px solid ${cor.border}`,borderRadius:"8px",padding:"12px 14px",display:"flex",gap:"10px"}}>
                    <span style={{fontSize:"16px",flexShrink:0}}>{a.icon}</span>
                    <div><div style={{fontSize:"11px",fontWeight:"800",color:cor.text,marginBottom:"3px"}}>{a.titulo}</div>
                    <p style={{margin:0,fontSize:"11px",color:T.textSecondary,lineHeight:"1.6"}}>{a.texto}</p></div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── BOTÕES DE SEÇÃO ── */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:"8px",marginBottom:"16px"}}>
            {[
              {id:"categorias",emoji:"📊",label:"Categorias"},
              {id:"votacoes",  emoji:"🗳️",label:"Votações"},
              {id:"despesas",  emoji:"💳",label:"Despesas"},
              {id:"noticias",  emoji:"📰",label:"Notícias"},
            ].map(sec=>(
              <button key={sec.id} onClick={()=>setSSecaoSen(secaoSen===sec.id?null:sec.id)}
                style={{padding:"12px",borderRadius:"10px",border:`1px solid ${secaoSen===sec.id?"#a78bfa44":T.cardBorder}`,background:secaoSen===sec.id?"rgba(167,139,250,0.08)":T.cardBg,color:secaoSen===sec.id?"#a78bfa":T.textSecondary,fontFamily:"inherit",fontWeight:"700",fontSize:"12px",cursor:"pointer",display:"flex",alignItems:"center",gap:"6px",justifyContent:"center",transition:"all 0.2s"}}>
                {sec.emoji} {sec.label} <span style={{marginLeft:"auto",fontSize:"10px"}}>{secaoSen===sec.id?"▲":"▼"}</span>
              </button>
            ))}
          </div>

          {/* ── CATEGORIAS ── */}
          {secaoSen==="categorias" && (
            <div style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"12px",padding:"20px",marginBottom:"16px"}}>
              <div style={{fontSize:"11px",color:"#ffc400",fontWeight:"800",letterSpacing:"0.1em",marginBottom:"16px"}}>📊 CATEGORIAS DE GASTO — {anoDespSen}</div>
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"16px"}}>
                {[2019,2020,2021,2022,2023,2024].map(ano=>(
                  <button key={ano} onClick={()=>{setAnoDespSen(ano);if(temCodante)carregarDespesasSenador(senadorSel,ano);}} style={{padding:"4px 10px",border:`1px solid ${anoDespSen===ano?"#ffc400":T.cardBorder}`,borderRadius:"6px",background:anoDespSen===ano?"rgba(255,196,0,0.1)":"transparent",color:anoDespSen===ano?"#ffc400":T.textSecondary,fontSize:"10px",fontFamily:"inherit",fontWeight:"700",cursor:"pointer"}}>{ano}</button>
                ))}
              </div>
              {carregDespSen ? <div style={{textAlign:"center",padding:"30px",color:T.textMuted}}>⏳ Carregando...</div>
              : despSen.length===0 ? <div style={{textAlign:"center",padding:"30px",color:T.textMuted}}>Sem dados para {anoDespSen}</div>
              : (()=>{
                const porCat={};
                despSen.forEach(d=>{const c=d.expense_category||"Outros";porCat[c]=(porCat[c]||0)+parseFloat(d.amount||0);});
                const cats3=Object.entries(porCat).sort((a,b)=>b[1]-a[1]);
                const maxV=cats3[0]?.[1]||1;
                const CORES=["#ff4d6d","#ffc400","#a78bfa","#00d4aa","#fb923c","#34d399","#60a5fa","#f472b6"];
                return cats3.map(([cat,val],i)=>(
                  <div key={i} style={{marginBottom:"12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:"5px"}}>
                      <span style={{fontSize:"11px",color:T.textSecondary,flex:1,marginRight:"12px"}}>{cat.slice(0,60)}</span>
                      <span style={{fontSize:"11px",fontWeight:"700",color:CORES[i%CORES.length],flexShrink:0}}>R$ {(val/1000).toFixed(1)}k · {(val/maxV*100).toFixed(0)}%</span>
                    </div>
                    <div style={{height:"6px",background:T.divider,borderRadius:"3px"}}>
                      <div style={{height:"100%",width:`${val/maxV*100}%`,background:CORES[i%CORES.length],borderRadius:"3px"}}/>
                    </div>
                    <div style={{fontSize:"9px",color:T.textMuted,marginTop:"3px"}}>{despSen.filter(d=>d.expense_category===cat).length} transações</div>
                  </div>
                ));
              })()}
            </div>
          )}

          {/* ── VOTAÇÕES ── */}
          {secaoSen==="votacoes" && (
            <div style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"12px",padding:"20px",marginBottom:"16px"}}>
              <div style={{fontSize:"11px",color:"#a78bfa",fontWeight:"800",letterSpacing:"0.1em",marginBottom:"16px"}}>🗳️ VOTAÇÕES NOMINAIS — SENADO</div>
              {Object.keys(votosSenad).length===0
                ? <div style={{textAlign:"center",padding:"30px",color:T.textMuted}}>Sem dados de votações</div>
                : <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                  {TEMAS_SENADO.map(tema=>{
                    const voto=votosSenad[tema.id];
                    const corV=voto==="sim"?"#00d464":voto==="não"||voto==="nao"?"#ff4d6d":voto==="Votou"?"#ffd60a":"#555";
                    const iconeV=voto==="sim"?"✅":voto==="não"||voto==="nao"?"❌":voto==="Votou"?"🔒":"⬜";
                    return (
                      <div key={tema.id} style={{display:"flex",gap:"12px",alignItems:"center",padding:"10px 12px",background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"8px"}}>
                        <span style={{fontSize:"16px",flexShrink:0}}>{tema.emoji||"🗳️"}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:"12px",fontWeight:"700",color:T.textPrimary,marginBottom:"2px"}}>{tema.titulo}</div>
                          <div style={{fontSize:"10px",color:T.textMuted}}>{tema.categoria} · {tema.data}</div>
                        </div>
                        <span style={{fontSize:"18px",flexShrink:0}}>{iconeV}</span>
                        <span style={{fontSize:"10px",fontWeight:"700",color:corV,minWidth:"30px",textAlign:"right"}}>{(voto||"—").toUpperCase()}</span>
                      </div>
                    );
                  })}
                </div>
              }
            </div>
          )}

          {/* ── DESPESAS ── */}
          {secaoSen==="despesas" && (
            <div style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"12px",padding:"20px",marginBottom:"16px"}}>
              <div style={{fontSize:"11px",color:"#ff4d6d",fontWeight:"800",letterSpacing:"0.1em",marginBottom:"14px"}}>💳 DESPESAS DETALHADAS</div>
              <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"12px",alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:"6px",background:T.inputBg,border:`1px solid ${T.inputBorder}`,borderRadius:"6px",padding:"6px 10px",flex:1,minWidth:"140px"}}>
                  <span>🔍</span>
                  <input value={filtBuscaSen2} onChange={e=>setFiltBuscaSen2(e.target.value)} placeholder="Buscar fornecedor..."
                    style={{background:"transparent",border:"none",outline:"none",color:T.textPrimary,fontSize:"11px",fontFamily:"inherit",width:"100%"}}/>
                </div>
                <select value={filtCatSen2} onChange={e=>setFiltCatSen2(e.target.value)}
                  style={{background:T.inputBg,border:`1px solid ${T.inputBorder}`,borderRadius:"6px",padding:"6px 10px",color:T.textPrimary,fontSize:"10px",fontFamily:"inherit",cursor:"pointer"}}>
                  {catsSen2.map(c=><option key={c} value={c}>{c.length>35?c.slice(0,35)+"...":c}</option>)}
                </select>
                <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
                  {[2019,2020,2021,2022,2023,2024].map(ano=>(
                    <button key={ano} onClick={()=>{setAnoDespSen(ano);if(temCodante)carregarDespesasSenador(senadorSel,ano);}} style={{padding:"4px 8px",border:`1px solid ${anoDespSen===ano?"#ff4d6d":T.cardBorder}`,borderRadius:"6px",background:anoDespSen===ano?"rgba(255,77,109,0.1)":"transparent",color:anoDespSen===ano?"#ff4d6d":T.textSecondary,fontSize:"10px",fontFamily:"inherit",fontWeight:"700",cursor:"pointer"}}>{ano}</button>
                  ))}
                </div>
              </div>
              {alertasSen.length>0 && (
                <div style={{background:"rgba(255,77,109,0.06)",border:"1px solid rgba(255,77,109,0.25)",borderRadius:"8px",padding:"10px 14px",marginBottom:"12px",display:"flex",gap:"10px"}}>
                  <span>🚨</span>
                  <div>
                    <div style={{fontSize:"11px",fontWeight:"800",color:"#ff4d6d",marginBottom:"3px"}}>IA: {alertasSen.length} transação(ões) acima de R$ 20.000</div>
                    <div style={{fontSize:"10px",color:T.textSecondary}}>{alertasSen.slice(0,2).map(a=>`${a.supplier} (R$ ${parseFloat(a.amount||0).toLocaleString("pt-BR",{maximumFractionDigits:0})})`).join(" · ")}</div>
                  </div>
                </div>
              )}
              {carregDespSen ? <div style={{textAlign:"center",padding:"30px",color:T.textMuted}}>⏳ Carregando...</div>
              : despSenFilt2.length===0 ? <div style={{textAlign:"center",padding:"30px",color:T.textMuted,border:`1px dashed ${T.divider}`,borderRadius:"10px"}}>{temCodante?"Sem despesas para o filtro":"Dados não disponíveis para este senador"}</div>
              : <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                {despSenFilt2.slice(0,150).map((d,i)=>{
                  const val=parseFloat(d.amount||0);
                  const isAlerta=val>20000;
                  const isExpand=despSenExp2===i;
                  const icone=d.expense_category?.includes("Passagem")||d.expense_category?.includes("Locomoção")?"✈️":d.expense_category?.includes("Aluguel")?"🏢":d.expense_category?.includes("Consultoria")?"🤝":"💳";
                  return (
                    <div key={i} onClick={()=>setDespSenExp2(isExpand?null:i)}
                      style={{background:T.subCardBg,border:`1px solid ${isAlerta?"rgba(255,77,109,0.3)":T.subCardBorder}`,borderLeft:isAlerta?"3px solid #ff4d6d":undefined,borderRadius:"8px",padding:"10px 12px",cursor:"pointer"}}>
                      <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
                        <span style={{fontSize:"18px"}}>{icone}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",gap:"6px",alignItems:"center",flexWrap:"wrap"}}>
                            <span style={{fontSize:"12px",fontWeight:"700",color:T.textPrimary}}>{d.supplier||"Fornecedor não informado"}</span>
                            {isAlerta&&<span style={{fontSize:"8px",padding:"2px 6px",borderRadius:"4px",background:"rgba(255,77,109,0.15)",color:"#ff4d6d",fontWeight:"700"}}>⚠️ ALTO</span>}
                          </div>
                          <div style={{fontSize:"10px",color:T.textMuted,marginTop:"1px"}}>{(d.expense_category||"Sem categoria").slice(0,60)}</div>
                          {d.supplier_document&&<div style={{fontSize:"9px",color:T.textMuted,fontFamily:"monospace"}}>CNPJ: {d.supplier_document}</div>}
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontSize:"13px",fontWeight:"800",color:val>20000?"#ff4d6d":val>10000?"#ffc400":"#00d464"}}>{fmtBRL(val)}</div>
                          <div style={{fontSize:"9px",color:T.textMuted}}>{d.date?.slice(0,10)}</div>
                        </div>
                        <span style={{color:T.textMuted,fontSize:"11px"}}>{isExpand?"▲":"▼"}</span>
                      </div>
                      {isExpand&&(
                        <div style={{marginTop:"12px",paddingTop:"12px",borderTop:`1px solid ${T.divider}`,display:"flex",flexDirection:"column",gap:"8px"}} onClick={e=>e.stopPropagation()}>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                            {[{label:"CNPJ/CPF",valor:d.supplier_document||"Não informado"},{label:"DATA",valor:d.date?.slice(0,10)||"—"},{label:"CATEGORIA",valor:(d.expense_category||"Não informada").slice(0,40)},{label:"VALOR",valor:fmtBRL(val)}].map((f,j)=>(
                              <div key={j} style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"6px",padding:"8px 10px"}}>
                                <div style={{fontSize:"9px",color:T.textMuted,fontWeight:"600",letterSpacing:"0.06em",marginBottom:"3px"}}>{f.label}</div>
                                <div style={{fontSize:"11px",fontWeight:"700",color:T.textPrimary}}>{f.valor}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{background:isAlerta?"rgba(255,77,109,0.06)":"rgba(167,139,250,0.04)",border:`1px solid ${isAlerta?"rgba(255,77,109,0.2)":"rgba(167,139,250,0.15)"}`,borderRadius:"6px",padding:"10px 12px"}}>
                            <div style={{fontSize:"10px",fontWeight:"800",color:isAlerta?"#ff4d6d":"#a78bfa",marginBottom:"5px"}}>🤖 ANÁLISE IA</div>
                            <p style={{margin:0,fontSize:"11px",color:T.textSecondary,lineHeight:"1.6"}}>
                              {isAlerta?`Transação de ${fmtBRL(val)} com ${d.supplier} acima da média do Senado. Verifique no Portal da Transparência.`:`Transação de ${fmtBRL(val)} dentro dos parâmetros normais.`}
                            </p>
                          </div>
                          <a href={`https://www6g.senado.leg.br/transparencia/sen/${senadorSel?.CodigoParlamentar||""}/verba-gabinete`}
                            target="_blank" rel="noopener noreferrer"
                            style={{display:"inline-flex",alignItems:"center",gap:"6px",padding:"8px 14px",background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:"6px",color:"#a78bfa",fontSize:"11px",fontWeight:"700",textDecoration:"none",width:"fit-content"}}
                            onClick={e=>e.stopPropagation()}>
                            📄 Ver no Portal da Transparência do Senado
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
                {despSenFilt2.length>150&&<div style={{textAlign:"center",fontSize:"10px",color:T.textMuted,padding:"10px"}}>Exibindo 150 de {despSenFilt2.length} transações</div>}
              </div>}
            </div>
          )}

          {/* ── NOTÍCIAS (seção expandida) ── */}
          {secaoSen==="noticias" && (
            <div style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"12px",padding:"20px",marginBottom:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px"}}>
                <div style={{fontSize:"11px",color:"#00d4aa",fontWeight:"800",letterSpacing:"0.1em"}}>📰 TODAS AS NOTÍCIAS · GOOGLE NEWS</div>
                <button onClick={()=>{setNotSen([]);setCarregNotSen(true);buscarNoticias(senadorSel.nome).then(r=>{setNotSen(r);setCarregNotSen(false);})}}
                  style={{fontSize:"10px",padding:"5px 10px",borderRadius:"6px",background:T.tagBg,border:`1px solid ${T.cardBorder}`,color:T.textSecondary,cursor:"pointer",fontFamily:"inherit",fontWeight:"700"}}>🔄 Atualizar</button>
              </div>
              {carregNotSen?<div style={{textAlign:"center",padding:"30px",color:T.textMuted}}>⏳</div>
              :notSen.length===0?<div style={{textAlign:"center",padding:"30px",color:T.textMuted}}>Nenhuma notícia encontrada</div>
              :<div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {notSen.map((n,i)=>(
                  <a key={i} href={n.link} target="_blank" rel="noopener noreferrer"
                    style={{display:"block",background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"10px",padding:"14px",textDecoration:"none"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor="#a78bfa44"}
                    onMouseLeave={e=>e.currentTarget.style.borderColor=T.subCardBorder}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:"12px",marginBottom:"6px"}}>
                      <div style={{fontSize:"13px",fontWeight:"700",color:T.textPrimary,lineHeight:"1.4"}}>{n.titulo}</div>
                      <span style={{fontSize:"9px",color:"#a78bfa",fontWeight:"700",background:"rgba(167,139,250,0.1)",padding:"2px 8px",borderRadius:"10px",whiteSpace:"nowrap",flexShrink:0}}>{n.fonte}</span>
                    </div>
                    {n.descricao&&<p style={{margin:"0 0 6px",fontSize:"11px",color:T.textSecondary,lineHeight:"1.6"}}>{n.descricao}</p>}
                    <div style={{fontSize:"10px",color:T.textMuted}}>📅 {n.data} · Clique para ler →</div>
                  </a>
                ))}
              </div>}
            </div>
          )}

          {/* ── ÚLTIMAS 3 NOTÍCIAS (sempre visíveis) ── */}
          {notSen.length>0 && (
            <div style={{marginBottom:"24px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                <div style={{fontSize:"11px",color:T.textLabel,fontWeight:"700",letterSpacing:"0.1em"}}>📰 ÚLTIMAS NOTÍCIAS</div>
                <button onClick={()=>setSSecaoSen(secaoSen==="noticias"?null:"noticias")}
                  style={{fontSize:"10px",color:"#a78bfa",fontWeight:"700",background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit"}}>
                  Ver todas {notSen.length} →
                </button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {notSen.slice(0,3).map((n,i)=>(
                  <a key={i} href={n.link} target="_blank" rel="noopener noreferrer"
                    style={{display:"flex",gap:"12px",alignItems:"flex-start",background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"10px",padding:"12px 14px",textDecoration:"none",transition:"all 0.15s"}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor="#a78bfa33";e.currentTarget.style.transform="translateY(-1px)";}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=T.cardBorder;e.currentTarget.style.transform="none";}}>
                    <div style={{width:"28px",height:"28px",borderRadius:"6px",background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.2)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>📰</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:"12px",fontWeight:"700",color:T.textPrimary,lineHeight:"1.4",marginBottom:"4px"}}>{n.titulo}</div>
                      <div style={{display:"flex",gap:"8px"}}>
                        <span style={{fontSize:"9px",color:"#a78bfa",fontWeight:"700"}}>{n.fonte}</span>
                        <span style={{fontSize:"9px",color:T.textMuted}}>{n.data}</span>
                      </div>
                    </div>
                    <span style={{color:"#a78bfa",fontSize:"14px",flexShrink:0}}>→</span>
                  </a>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    );
  }

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
  const [aba, setAba] = useState("ministros"); // ministros | casos | noticias
  const [minSel, setMinSel]       = useState(null);
  const [notSTF, setNotSTF]       = useState([]);
  const [carregNotSTF, setCarregNotSTF] = useState(false);
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
    const [secaoSTF, setSecaoSTF] = React.useState(null);
    const votosSTFArr = m.casosDestaque ? [] : [];

    return (
      <div style={s.app}>
        <div style={s.grid}/><NavBar telaAtual="stf" setTela={(t)=>{setMinistrSel(null);setCasoSel(null);if(t!=="stf")setTela(t);}} setTema={setTema} tema={tema} s={s}/>
        <div style={{...s.main,maxWidth:"900px"}}>
          <BotaoVoltar onClick={()=>setMinistrSel(null)} label="← VOLTAR PARA STF" s={s}/>

          {/* ── HERO ── */}
          <div style={{display:"flex",gap:"20px",alignItems:"flex-start",marginBottom:"20px",background:T.cardBg,border:`1px solid ${m.cor}33`,borderTop:`3px solid ${m.cor}`,borderRadius:"14px",padding:"24px",flexWrap:"wrap"}}>
            <div style={{width:"88px",height:"88px",borderRadius:"14px",background:`${m.cor}22`,border:`3px solid ${m.cor}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:"28px",fontWeight:"800",color:m.cor}}>
              {m.nome.split(" ").filter(w=>w.length>2).slice(0,2).map(w=>w[0]).join("")}
            </div>
            <div style={{flex:1,minWidth:"200px"}}>
              <div style={{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center",marginBottom:"4px"}}>
                <h1 style={{margin:0,fontSize:"20px",fontWeight:"800",color:T.textPrimary}}>{m.nome}</h1>
                <span style={{fontSize:"10px",padding:"3px 10px",borderRadius:"10px",background:`${m.cor}18`,color:m.cor,border:`1px solid ${m.cor}33`,fontWeight:"800"}}>{m.cargo}</span>
              </div>
              <div style={{fontSize:"13px",color:T.textSecondary,marginBottom:"10px"}}>Indicado por {m.indicadoPor} · {m.partido} · Desde {m.desde}</div>
              <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                <span style={{fontSize:"11px",padding:"4px 12px",borderRadius:"6px",background:anosRestantes<5?"rgba(255,77,109,0.15)":T.tagBg,color:anosRestantes<5?"#ff4d6d":T.textSecondary,border:`1px solid ${T.cardBorder}`,fontWeight:"700"}}>
                  ⏳ Aposenta em {m.aposentadoria} ({anosRestantes>0?`${anosRestantes} anos`:"este ano"})
                </span>
                {m.aprovacaoSenado && <span style={{fontSize:"11px",padding:"4px 12px",borderRadius:"6px",background:"rgba(0,212,100,0.1)",color:"#00d464",border:"1px solid rgba(0,212,100,0.25)",fontWeight:"700"}}>Aprovado no Senado: {m.simSenado}×{m.naoSenado}</span>}
              </div>
            </div>
            <div style={{textAlign:"center",flexShrink:0,background:`${m.cor}10`,border:`1px solid ${m.cor}33`,borderRadius:"12px",padding:"14px 20px"}}>
              <div style={{fontSize:"36px",fontWeight:"800",color:m.cor,lineHeight:1}}>{Math.round((m.perfil?.progressista||50))}</div>
              <div style={{fontSize:"9px",color:T.textMuted,marginTop:"4px",letterSpacing:"0.1em",fontWeight:"700"}}>PERFIL %</div>
            </div>
          </div>

          {/* ── DASHBOARD CARDS ── */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:"10px",marginBottom:"20px"}}>
            {[
              {icon:"⚖️",label:"Decisões",valor:m.decisoesDestaque?.length||"—",sub:"destacadas no perfil",cor:"#ffd60a",sec:"votacoes"},
              {icon:"📅",label:"No cargo",valor:`${new Date().getFullYear()-m.desde} anos`,sub:`Desde ${m.desde}`,cor:m.cor,sec:null},
              {icon:"🏛️",label:"Indicado por",valor:m.indicadoPor,sub:m.partido||"Sem partido",cor:"#a78bfa",sec:null},
              {icon:"📰",label:"Notícias",valor:notSTF.length||"—",sub:"Google News ao vivo",cor:"#00d4aa",sec:"noticias"},
            ].map((c,i)=>(
              <div key={i} onClick={()=>c.sec&&setSecaoSTF(secaoSTF===c.sec?null:c.sec)}
                style={{background:T.cardBg,border:`1px solid ${secaoSTF===c.sec?c.cor+"55":T.cardBorder}`,borderTop:`3px solid ${c.cor}`,borderRadius:"12px",padding:"16px",cursor:c.sec?"pointer":"default",transition:"all 0.2s"}}
                onMouseEnter={e=>{if(c.sec){e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 24px ${c.cor}22`;}}}
                onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none";}}>
                <div style={{fontSize:"22px",marginBottom:"8px"}}>{c.icon}</div>
                <div style={{fontSize:"16px",fontWeight:"800",color:c.cor,lineHeight:1,marginBottom:"4px",wordBreak:"break-word"}}>{c.valor}</div>
                <div style={{fontSize:"11px",fontWeight:"700",color:T.textPrimary,marginBottom:"3px"}}>{c.label}</div>
                <div style={{fontSize:"9px",color:T.textMuted}}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* ── ANÁLISE IA COMPLETA ── */}
          <div style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderLeft:`4px solid ${m.cor}`,borderRadius:"12px",padding:"20px",marginBottom:"20px"}}>
            <div style={{display:"flex",gap:"10px",alignItems:"center",marginBottom:"14px"}}>
              <span style={{fontSize:"22px"}}>🤖</span>
              <div>
                <div style={{fontSize:"12px",fontWeight:"800",color:m.cor,letterSpacing:"0.08em"}}>ANÁLISE COMPLETA DA IA</div>
                <div style={{fontSize:"10px",color:T.textMuted,marginTop:"2px"}}>Baseada em perfil, histórico de indicação e decisões marcantes</div>
              </div>
            </div>
            <p style={{margin:"0 0 12px",fontSize:"12px",color:T.textSecondary,lineHeight:"1.7"}}>{m.descricao}</p>
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              {[
                {nivel:"info",icon:"🏛️",titulo:"Perfil ideológico",texto:`${m.perfil?.progressista||"?"}% progressista · ${m.perfil?.conservador||"?"}% conservador com base nas decisões analisadas.`},
                anosRestantes < 5 ? {nivel:"atencao",icon:"⏳",titulo:"Aposentadoria próxima",texto:`O(A) ministro(a) se aposenta em ${m.aposentadoria} (${anosRestantes} anos). A vaga será preenchida pelo presidente da República.`} : null,
                m.aprovacaoSenado ? {nivel:"ok",icon:"🗳️",titulo:"Aprovação no Senado",texto:`Aprovado(a) com ${m.simSenado} votos favoráveis e ${m.naoSenado} contrários no Senado Federal.`} : null,
                {nivel:"info",icon:"⚖️",titulo:"Decisões de destaque",texto:m.decisoesDestaque?.slice(0,3).join(" · ")||"Sem decisões catalogadas."},
              ].filter(Boolean).map((a,i)=>{
                const cores={critico:{bg:"rgba(255,77,109,0.08)",border:"rgba(255,77,109,0.3)",text:"#ff4d6d"},atencao:{bg:"rgba(255,196,0,0.08)",border:"rgba(255,196,0,0.3)",text:"#ffc400"},ok:{bg:"rgba(0,212,100,0.08)",border:"rgba(0,212,100,0.3)",text:"#00d464"},info:{bg:`${m.cor}08`,border:`${m.cor}25`,text:m.cor}};
                const cor=cores[a.nivel]||cores.info;
                return (
                  <div key={i} style={{background:cor.bg,border:`1px solid ${cor.border}`,borderRadius:"8px",padding:"12px 14px",display:"flex",gap:"10px"}}>
                    <span style={{fontSize:"16px",flexShrink:0}}>{a.icon}</span>
                    <div><div style={{fontSize:"11px",fontWeight:"800",color:cor.text,marginBottom:"3px"}}>{a.titulo}</div>
                    <p style={{margin:0,fontSize:"11px",color:T.textSecondary,lineHeight:"1.6"}}>{a.texto}</p></div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── BOTÕES DE SEÇÃO ── */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:"8px",marginBottom:"16px"}}>
            {[
              {id:"votacoes",emoji:"⚖️",label:"Decisões"},
              {id:"noticias",emoji:"📰",label:"Notícias"},
            ].map(sec=>(
              <button key={sec.id} onClick={()=>setSecaoSTF(secaoSTF===sec.id?null:sec.id)}
                style={{padding:"12px",borderRadius:"10px",border:`1px solid ${secaoSTF===sec.id?m.cor+"44":T.cardBorder}`,background:secaoSTF===sec.id?`${m.cor}10`:T.cardBg,color:secaoSTF===sec.id?m.cor:T.textSecondary,fontFamily:"inherit",fontWeight:"700",fontSize:"12px",cursor:"pointer",display:"flex",alignItems:"center",gap:"6px",justifyContent:"center",transition:"all 0.2s"}}>
                {sec.emoji} {sec.label} <span style={{marginLeft:"auto",fontSize:"10px"}}>{secaoSTF===sec.id?"▲":"▼"}</span>
              </button>
            ))}
          </div>

          {/* ── DECISÕES ── */}
          {secaoSTF==="votacoes" && (
            <div style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"12px",padding:"20px",marginBottom:"16px"}}>
              <div style={{fontSize:"11px",color:"#ffd60a",fontWeight:"800",letterSpacing:"0.1em",marginBottom:"16px"}}>⚖️ DECISÕES E CASOS DE DESTAQUE</div>
              {m.decisoesDestaque?.length ? (
                <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                  {m.decisoesDestaque.map((decisao,i)=>(
                    <div key={i} style={{display:"flex",gap:"12px",alignItems:"center",padding:"12px 14px",background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"8px"}}>
                      <div style={{width:"24px",height:"24px",borderRadius:"50%",background:`${m.cor}22`,border:`1px solid ${m.cor}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:"11px",fontWeight:"800",color:m.cor}}>{i+1}</div>
                      <p style={{margin:0,fontSize:"12px",color:T.textPrimary,lineHeight:"1.5",flex:1}}>{decisao}</p>
                    </div>
                  ))}
                </div>
              ) : <div style={{textAlign:"center",padding:"30px",color:T.textMuted}}>Sem decisões catalogadas</div>}
              {m.aprovacaoSenado && (
                <div style={{marginTop:"16px",padding:"14px",background:`${m.cor}08`,border:`1px solid ${m.cor}25`,borderRadius:"8px"}}>
                  <div style={{fontSize:"11px",fontWeight:"800",color:m.cor,marginBottom:"8px"}}>🏛️ VOTAÇÃO DE APROVAÇÃO NO SENADO</div>
                  <div style={{display:"flex",gap:"16px",flexWrap:"wrap"}}>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:"24px",fontWeight:"800",color:"#00d464"}}>{m.simSenado}</div>
                      <div style={{fontSize:"10px",color:T.textMuted,marginTop:"2px"}}>votos SIM</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:"24px",fontWeight:"800",color:"#ff4d6d"}}>{m.naoSenado}</div>
                      <div style={{fontSize:"10px",color:T.textMuted,marginTop:"2px"}}>votos NÃO</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── NOTÍCIAS (expandido) ── */}
          {secaoSTF==="noticias" && (
            <div style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"12px",padding:"20px",marginBottom:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px"}}>
                <div style={{fontSize:"11px",color:"#00d4aa",fontWeight:"800",letterSpacing:"0.1em"}}>📰 TODAS AS NOTÍCIAS · GOOGLE NEWS</div>
                <button onClick={()=>{setNotSTF([]);setCarregNotSTF(true);buscarNoticias(m.nome).then(r=>{setNotSTF(r);setCarregNotSTF(false);})}}
                  style={{fontSize:"10px",padding:"5px 10px",borderRadius:"6px",background:T.tagBg,border:`1px solid ${T.cardBorder}`,color:T.textSecondary,cursor:"pointer",fontFamily:"inherit",fontWeight:"700"}}>🔄</button>
              </div>
              {carregNotSTF?<div style={{textAlign:"center",padding:"30px",color:T.textMuted}}>⏳</div>
              :notSTF.length===0?<div style={{textAlign:"center",padding:"30px",color:T.textMuted}}>Nenhuma notícia encontrada</div>
              :<div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {notSTF.map((n,i)=>(
                  <a key={i} href={n.link} target="_blank" rel="noopener noreferrer"
                    style={{display:"block",background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"10px",padding:"14px",textDecoration:"none"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor=m.cor+"44"}
                    onMouseLeave={e=>e.currentTarget.style.borderColor=T.subCardBorder}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:"12px",marginBottom:"6px"}}>
                      <div style={{fontSize:"13px",fontWeight:"700",color:T.textPrimary,lineHeight:"1.4"}}>{n.titulo}</div>
                      <span style={{fontSize:"9px",color:m.cor,fontWeight:"700",background:`${m.cor}15`,padding:"2px 8px",borderRadius:"10px",whiteSpace:"nowrap",flexShrink:0}}>{n.fonte}</span>
                    </div>
                    {n.descricao&&<p style={{margin:"0 0 6px",fontSize:"11px",color:T.textSecondary,lineHeight:"1.6"}}>{n.descricao}</p>}
                    <div style={{fontSize:"10px",color:T.textMuted}}>📅 {n.data} · Clique para ler →</div>
                  </a>
                ))}
              </div>}
            </div>
          )}

          {/* ── ÚLTIMAS 3 NOTÍCIAS (sempre visíveis) ── */}
          {notSTF.length>0&&(
            <div style={{marginBottom:"24px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                <div style={{fontSize:"11px",color:T.textLabel,fontWeight:"700",letterSpacing:"0.1em"}}>📰 ÚLTIMAS NOTÍCIAS</div>
                <button onClick={()=>setSecaoSTF(secaoSTF==="noticias"?null:"noticias")}
                  style={{fontSize:"10px",color:m.cor,fontWeight:"700",background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit"}}>
                  Ver todas {notSTF.length} →
                </button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {notSTF.slice(0,3).map((n,i)=>(
                  <a key={i} href={n.link} target="_blank" rel="noopener noreferrer"
                    style={{display:"flex",gap:"12px",alignItems:"flex-start",background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"10px",padding:"12px 14px",textDecoration:"none",transition:"all 0.15s"}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=m.cor+"33";e.currentTarget.style.transform="translateY(-1px)";}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=T.cardBorder;e.currentTarget.style.transform="none";}}>
                    <div style={{width:"28px",height:"28px",borderRadius:"6px",background:`${m.cor}15`,border:`1px solid ${m.cor}25`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>📰</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:"12px",fontWeight:"700",color:T.textPrimary,lineHeight:"1.4",marginBottom:"4px"}}>{n.titulo}</div>
                      <div style={{display:"flex",gap:"8px"}}>
                        <span style={{fontSize:"9px",color:m.cor,fontWeight:"700"}}>{n.fonte}</span>
                        <span style={{fontSize:"9px",color:T.textMuted}}>{n.data}</span>
                      </div>
                    </div>
                    <span style={{color:m.cor,fontSize:"14px",flexShrink:0}}>→</span>
                  </a>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    );
  }

}

// ── Tela Perfil Deputado ──────────────────────────────────────────────────────
// ── Tela Perfil Deputado ──────────────────────────────────────────────────────
function TelaPerfilDeputado({ dep, onVoltar, s, tema, setTema }) {
  const T = s.T; const dark = tema === "dark";
  const CAMARA = "https://dadosabertos.camara.leg.br/api/v2";
  const [despesas, setDespesas]   = useState([]);
  const [carregDesp, setCarregDesp] = useState(false);
  const [anoDespesa, setAnoDespesa] = useState(2024);
  const [noticias, setNoticias]   = useState([]);
  const [secaoAtiva, setSecaoAtiva] = useState(null);
  const [filtCat, setFiltCat]     = useState("Todas");
  const [filtBuscaDesp, setFiltBuscaDesp] = useState("");
  const [despExpand, setDespExpand] = useState(null);

  useEffect(() => {
    setCarregDesp(true);
    (async () => {
      try {
        let todas = [];
        for (let pag = 1; pag <= 5; pag++) {
          const r = await fetch(`${CAMARA}/deputados/${dep.id}/despesas?ano=${anoDespesa}&itens=100&pagina=${pag}`);
          const d = await r.json(); const items = d.dados || [];
          todas = [...todas, ...items]; if (items.length < 100) break;
        }
        setDespesas(todas);
      } catch { setDespesas([]); }
      setCarregDesp(false);
    })();
  }, [dep.id, anoDespesa]);

  useEffect(() => {
    buscarNoticias(dep.nome).then(r => setNoticias(r));
  }, [dep.nome]);

  const totalGasto = despesas.reduce((a,d) => a + (d.valorLiquido||0), 0);
  const fornSet    = new Set(despesas.map(d => d.cnpjCpfFornecedor).filter(Boolean));
  const categorias = despesas.reduce((acc,d) => { const cat = d.tipoDespesa||"Outros"; acc[cat]=(acc[cat]||0)+(d.valorLiquido||0); return acc; }, {});
  const topForn    = Object.entries(despesas.reduce((acc,d)=>{ if(!d.nomeFornecedor)return acc; acc[d.nomeFornecedor]=(acc[d.nomeFornecedor]||0)+(d.valorLiquido||0); return acc; },{})).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const alertas    = despesas.filter(d => d.valorLiquido > 15000);
  const cl         = dep.classificacao || "ok";
  const corCl      = cl==="suspeito"?"#ff2d55":cl==="alerta"?"#ffc400":"#00d464";
  const votosArr   = dep.votosCache ? Object.entries(dep.votosCache) : [];
  const simCount   = votosArr.filter(([,v])=>v?.toLowerCase()==="sim").length;
  const naoCount   = votosArr.filter(([,v])=>v?.toLowerCase()==="não").length;
  const ausCount   = votosArr.filter(([,v])=>!v||v==="ausente").length;
  const cats       = ["Todas", ...Object.keys(categorias).sort((a,b)=>categorias[b]-categorias[a])];
  const despFilt   = despesas.filter(d => (filtCat==="Todas"||d.tipoDespesa===filtCat) && (!filtBuscaDesp||(d.nomeFornecedor||"").toLowerCase().includes(filtBuscaDesp.toLowerCase())));

  const SECOES = [{id:"categorias",emoji:"📊",label:"Categorias"},{id:"votacoes",emoji:"🗳️",label:"Votações"},{id:"despesas",emoji:"💳",label:"Despesas"},{id:"noticias",emoji:"📰",label:"Notícias"}];

  return (
    <div style={s.app}>
      <div style={s.grid}/>
      <nav style={{...s.nav,justifyContent:"space-between"}}>
        <button onClick={onVoltar} style={{display:"flex",alignItems:"center",gap:"8px",background:"transparent",border:"none",color:T.accent,fontFamily:"inherit",fontWeight:"700",fontSize:"12px",cursor:"pointer",letterSpacing:"0.06em"}}>← VOLTAR</button>
        <div style={s.logo}><IconShield/><span style={{fontSize:"12px",fontWeight:"800",letterSpacing:"0.06em"}}>ANTICORRUPÇÃO.BR</span></div>
        <button onClick={()=>setTema(dark?"light":"dark")} style={{padding:"7px 12px",borderRadius:"6px",cursor:"pointer",background:T.tagBg,border:`1px solid ${T.cardBorder}`,color:T.textSecondary,fontFamily:"inherit",fontWeight:"700",fontSize:"11px"}}>{dark?"☀️":"🌙"}</button>
      </nav>
      <div style={{...s.main,maxWidth:"900px"}}>

        {/* ── HERO ── */}
        <div style={{display:"flex",gap:"20px",alignItems:"flex-start",marginBottom:"20px",background:T.cardBg,border:`1px solid ${corCl}33`,borderTop:`3px solid ${corCl}`,borderRadius:"14px",padding:"24px",flexWrap:"wrap"}}>
          <img src={dep.urlFoto||`https://ui-avatars.com/api/?name=${encodeURIComponent(dep.nome)}&background=1a1f2e&color=00d4aa&size=120&bold=true`}
            onError={e=>{e.target.src=`https://ui-avatars.com/api/?name=${encodeURIComponent(dep.nome)}&background=1a1f2e&color=00d4aa&size=120&bold=true`;}}
            style={{width:"88px",height:"88px",borderRadius:"14px",objectFit:"cover",border:`3px solid ${corCl}`,flexShrink:0}}/>
          <div style={{flex:1,minWidth:"200px"}}>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center",marginBottom:"4px"}}>
              <h1 style={{margin:0,fontSize:"20px",fontWeight:"800",color:T.textPrimary}}>{dep.nome}</h1>
              <span style={{fontSize:"10px",padding:"3px 10px",borderRadius:"10px",background:`${corCl}18`,color:corCl,border:`1px solid ${corCl}33`,fontWeight:"800"}}>{cl==="suspeito"?"🔴 SUSPEITO":cl==="alerta"?"⚠️ ALERTA":"✓ OK"}</span>
            </div>
            <div style={{fontSize:"13px",color:T.textSecondary,marginBottom:"10px"}}>{dep.siglaPartido} · {dep.siglaUf} · Deputado Federal</div>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
              {dep.score!=null&&<span style={{fontSize:"11px",padding:"4px 12px",borderRadius:"6px",background:`${corCl}15`,color:corCl,border:`1px solid ${corCl}25`,fontWeight:"800"}}>Score {dep.score}/100</span>}
              {dep.motivo&&<span style={{fontSize:"11px",padding:"4px 12px",borderRadius:"6px",background:T.tagBg,color:T.textSecondary,border:`1px solid ${T.cardBorder}`,fontWeight:"600"}}>{dep.motivo}</span>}
            </div>
          </div>
          <div style={{textAlign:"center",flexShrink:0,background:`${corCl}10`,border:`1px solid ${corCl}33`,borderRadius:"12px",padding:"14px 20px"}}>
            <div style={{fontSize:"36px",fontWeight:"800",color:corCl,lineHeight:1}}>{dep.score??"—"}</div>
            <div style={{fontSize:"9px",color:T.textMuted,marginTop:"4px",letterSpacing:"0.1em",fontWeight:"700"}}>SCORE IA</div>
          </div>
        </div>

        {/* ── DASHBOARD CARDS ── */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:"10px",marginBottom:"20px"}}>
          {[
            {icon:"💸",label:"Gasto CEAP",valor:`R$ ${(totalGasto/1000).toFixed(1)}k`,sub:`${anoDespesa} · ${despesas.length} transações`,cor:"#ff4d6d",sec:"despesas"},
            {icon:"🏢",label:"Fornecedores",valor:fornSet.size,sub:`${Object.keys(categorias).length} categorias`,cor:"#ffc400",sec:"categorias"},
            {icon:"🗳️",label:"Votações",valor:`${simCount}S · ${naoCount}N`,sub:`${ausCount} ausências registradas`,cor:"#a78bfa",sec:"votacoes"},
            {icon:"📰",label:"Notícias",valor:noticias.length||"—",sub:"Google News ao vivo",cor:"#00d4aa",sec:"noticias"},
          ].map((c,i)=>(
            <div key={i} onClick={()=>setSecaoAtiva(secaoAtiva===c.sec?null:c.sec)}
              style={{background:T.cardBg,border:`1px solid ${secaoAtiva===c.sec?c.cor+"55":T.cardBorder}`,borderTop:`3px solid ${c.cor}`,borderRadius:"12px",padding:"16px",cursor:"pointer",transition:"all 0.2s"}}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 24px ${c.cor}22`;}}
              onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none";}}>
              <div style={{fontSize:"22px",marginBottom:"8px"}}>{c.icon}</div>
              <div style={{fontSize:"18px",fontWeight:"800",color:c.cor,lineHeight:1,marginBottom:"4px"}}>{c.valor}</div>
              <div style={{fontSize:"11px",fontWeight:"700",color:T.textPrimary,marginBottom:"3px"}}>{c.label}</div>
              <div style={{fontSize:"9px",color:T.textMuted}}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* ── ANÁLISE IA COMPLETA ── */}
        <div style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderLeft:"4px solid #a78bfa",borderRadius:"12px",padding:"20px",marginBottom:"20px"}}>
          <div style={{display:"flex",gap:"10px",alignItems:"center",marginBottom:"14px"}}>
            <span style={{fontSize:"22px"}}>🤖</span>
            <div>
              <div style={{fontSize:"12px",fontWeight:"800",color:"#a78bfa",letterSpacing:"0.08em"}}>ANÁLISE COMPLETA DA IA</div>
              <div style={{fontSize:"10px",color:T.textMuted,marginTop:"2px"}}>Baseada em despesas reais, votações e padrões detectados</div>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            {[
              totalGasto>400000?{nivel:"critico",icon:"🚨",titulo:"Gastos muito acima da média",texto:`R$ ${(totalGasto/1000).toFixed(0)}k em ${anoDespesa}. A média dos deputados é R$ 120k/ano. ${((totalGasto/120000-1)*100).toFixed(0)}% acima da média.`}
              :totalGasto>200000?{nivel:"atencao",icon:"⚠️",titulo:"Gastos elevados",texto:`R$ ${(totalGasto/1000).toFixed(0)}k em ${anoDespesa}. Acima da mediana nacional de R$ 120k.`}
              :totalGasto>0?{nivel:"ok",icon:"✅",titulo:"Gastos dentro do padrão",texto:`R$ ${(totalGasto/1000).toFixed(0)}k em ${anoDespesa}. Compatível com a média dos deputados.`}:null,
              alertas.length>0?{nivel:"atencao",icon:"💸",titulo:`${alertas.length} transação(ões) acima de R$ 15.000`,texto:alertas.slice(0,2).map(a=>`${a.nomeFornecedor} (R$ ${(a.valorLiquido||0).toLocaleString("pt-BR",{maximumFractionDigits:0})})`).join(" · ")+(alertas.length>2?` e mais ${alertas.length-2}`:"")}: null,
              fornSet.size===1&&despesas.length>5?{nivel:"critico",icon:"🔍",titulo:"Concentração em fornecedor único",texto:`Todas as ${despesas.length} transações com um único fornecedor. Padrão atípico.`}:null,
              ausCount>votosArr.length*0.4&&votosArr.length>0?{nivel:"atencao",icon:"🗳️",titulo:"Alta ausência em votações",texto:`Ausente em ${ausCount} de ${votosArr.length} votações (${Math.round(ausCount/votosArr.length*100)}%).`}:null,
              {nivel:"info",icon:"📊",titulo:"Perfil de gastos",texto:topForn.length>0?`Top fornecedores: ${topForn.slice(0,3).map(([n,v])=>`${n.slice(0,25)} (R$ ${(v/1000).toFixed(1)}k)`).join(" · ")}`:"Sem dados de despesas para análise."},
            ].filter(Boolean).map((a,i)=>{
              const cores={critico:{bg:"rgba(255,77,109,0.08)",border:"rgba(255,77,109,0.3)",text:"#ff4d6d"},atencao:{bg:"rgba(255,196,0,0.08)",border:"rgba(255,196,0,0.3)",text:"#ffc400"},ok:{bg:"rgba(0,212,100,0.08)",border:"rgba(0,212,100,0.3)",text:"#00d464"},info:{bg:"rgba(0,212,170,0.06)",border:"rgba(0,212,170,0.2)",text:"#00d4aa"}};
              const cor=cores[a.nivel]||cores.info;
              return (
                <div key={i} style={{background:cor.bg,border:`1px solid ${cor.border}`,borderRadius:"8px",padding:"12px 14px",display:"flex",gap:"10px"}}>
                  <span style={{fontSize:"16px",flexShrink:0}}>{a.icon}</span>
                  <div><div style={{fontSize:"11px",fontWeight:"800",color:cor.text,marginBottom:"3px"}}>{a.titulo}</div>
                  <p style={{margin:0,fontSize:"11px",color:T.textSecondary,lineHeight:"1.6"}}>{a.texto}</p></div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── BOTÕES DE SEÇÃO ── */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:"8px",marginBottom:"16px"}}>
          {SECOES.map(sec=>(
            <button key={sec.id} onClick={()=>setSecaoAtiva(secaoAtiva===sec.id?null:sec.id)}
              style={{padding:"12px",borderRadius:"10px",border:`1px solid ${secaoAtiva===sec.id?"#00d4aa44":T.cardBorder}`,background:secaoAtiva===sec.id?"rgba(0,212,170,0.08)":T.cardBg,color:secaoAtiva===sec.id?"#00d4aa":T.textSecondary,fontFamily:"inherit",fontWeight:"700",fontSize:"12px",cursor:"pointer",display:"flex",alignItems:"center",gap:"6px",justifyContent:"center",transition:"all 0.2s"}}>
              {sec.emoji} {sec.label} <span style={{marginLeft:"auto",fontSize:"10px"}}>{secaoAtiva===sec.id?"▲":"▼"}</span>
            </button>
          ))}
        </div>

        {/* ── CATEGORIAS ── */}
        {secaoAtiva==="categorias" && (
          <div style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"12px",padding:"20px",marginBottom:"16px"}}>
            <div style={{fontSize:"11px",color:"#ffc400",fontWeight:"800",letterSpacing:"0.1em",marginBottom:"16px"}}>📊 CATEGORIAS DE GASTO — {anoDespesa}</div>
            <div style={{display:"flex",gap:"6px",marginBottom:"16px"}}>
              {[2023,2024,2025].map(ano=>(
                <button key={ano} onClick={()=>setAnoDespesa(ano)} style={{padding:"4px 12px",border:`1px solid ${anoDespesa===ano?"#ffc400":T.cardBorder}`,borderRadius:"6px",background:anoDespesa===ano?"rgba(255,196,0,0.1)":"transparent",color:anoDespesa===ano?"#ffc400":T.textSecondary,fontSize:"10px",fontFamily:"inherit",fontWeight:"700",cursor:"pointer"}}>{ano}</button>
              ))}
            </div>
            {carregDesp?<div style={{textAlign:"center",padding:"30px",color:T.textMuted}}>⏳ Carregando...</div>
            :Object.entries(categorias).sort((a,b)=>b[1]-a[1]).map(([cat,val],i,arr)=>{
              const max=arr[0][1];const pct=(val/max*100).toFixed(0);
              const CORES=["#ff4d6d","#ffc400","#a78bfa","#00d4aa","#fb923c","#34d399","#60a5fa","#f472b6"];
              return (
                <div key={i} style={{marginBottom:"12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:"5px"}}>
                    <span style={{fontSize:"11px",color:T.textSecondary,flex:1,marginRight:"12px"}}>{cat}</span>
                    <span style={{fontSize:"11px",fontWeight:"700",color:CORES[i%CORES.length],flexShrink:0}}>R$ {(val/1000).toFixed(1)}k · {pct}%</span>
                  </div>
                  <div style={{height:"6px",background:T.divider,borderRadius:"3px"}}>
                    <div style={{height:"100%",width:`${pct}%`,background:CORES[i%CORES.length],borderRadius:"3px",transition:"width 0.6s"}}/>
                  </div>
                  <div style={{fontSize:"9px",color:T.textMuted,marginTop:"3px"}}>{despesas.filter(d=>d.tipoDespesa===cat).length} transações</div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── VOTAÇÕES ── */}
        {secaoAtiva==="votacoes" && (
          <div style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"12px",padding:"20px",marginBottom:"16px"}}>
            <div style={{fontSize:"11px",color:"#a78bfa",fontWeight:"800",letterSpacing:"0.1em",marginBottom:"16px"}}>🗳️ VOTAÇÕES NOMINAIS — CÂMARA</div>
            {votosArr.length===0?<div style={{textAlign:"center",padding:"30px",color:T.textMuted}}>Dados de votações não disponíveis</div>
            :<div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
              {Object.entries(TEMAS_CAMARA_OBJ||{}).map(([id,tema])=>{
                const voto=dep.votosCache?.[id];
                const corV=voto==="sim"?"#00d464":voto==="não"?"#ff4d6d":"#555";
                const iconeV=voto==="sim"?"✅":voto==="não"?"❌":"⬜";
                return (
                  <div key={id} style={{display:"flex",gap:"12px",alignItems:"center",padding:"10px 12px",background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"8px"}}>
                    <span style={{fontSize:"16px",flexShrink:0}}>{tema.emoji||"🗳️"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:"12px",fontWeight:"700",color:T.textPrimary,marginBottom:"2px"}}>{tema.titulo}</div>
                      <div style={{fontSize:"10px",color:T.textMuted}}>{tema.categoria} · {tema.data}</div>
                    </div>
                    <span style={{fontSize:"18px",flexShrink:0}}>{iconeV}</span>
                    <span style={{fontSize:"10px",fontWeight:"700",color:corV,minWidth:"30px",textAlign:"right"}}>{voto?.toUpperCase()||"—"}</span>
                  </div>
                );
              })}
            </div>}
          </div>
        )}

        {/* ── DESPESAS ── */}
        {secaoAtiva==="despesas" && (
          <div style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"12px",padding:"20px",marginBottom:"16px"}}>
            <div style={{fontSize:"11px",color:"#ff4d6d",fontWeight:"800",letterSpacing:"0.1em",marginBottom:"14px"}}>💳 DESPESAS DETALHADAS</div>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"12px",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:"6px",background:T.inputBg,border:`1px solid ${T.inputBorder}`,borderRadius:"6px",padding:"6px 10px",flex:1,minWidth:"140px"}}>
                <span>🔍</span>
                <input value={filtBuscaDesp} onChange={e=>setFiltBuscaDesp(e.target.value)} placeholder="Buscar fornecedor..." style={{background:"transparent",border:"none",outline:"none",color:T.textPrimary,fontSize:"11px",fontFamily:"inherit",width:"100%"}}/>
              </div>
              <select value={filtCat} onChange={e=>setFiltCat(e.target.value)} style={{background:T.inputBg,border:`1px solid ${T.inputBorder}`,borderRadius:"6px",padding:"6px 10px",color:T.textPrimary,fontSize:"10px",fontFamily:"inherit",cursor:"pointer"}}>
                {cats.map(c=><option key={c} value={c}>{c.length>35?c.slice(0,35)+"...":c}</option>)}
              </select>
              <div style={{display:"flex",gap:"4px"}}>
                {[2023,2024,2025].map(ano=>(
                  <button key={ano} onClick={()=>setAnoDespesa(ano)} style={{padding:"5px 10px",border:`1px solid ${anoDespesa===ano?"#ff4d6d":T.cardBorder}`,borderRadius:"6px",background:anoDespesa===ano?"rgba(255,77,109,0.1)":"transparent",color:anoDespesa===ano?"#ff4d6d":T.textSecondary,fontSize:"10px",fontFamily:"inherit",fontWeight:"700",cursor:"pointer"}}>{ano}</button>
                ))}
              </div>
            </div>
            {alertas.length>0&&(
              <div style={{background:"rgba(255,77,109,0.06)",border:"1px solid rgba(255,77,109,0.25)",borderRadius:"8px",padding:"10px 14px",marginBottom:"12px",display:"flex",gap:"10px"}}>
                <span>🚨</span>
                <div>
                  <div style={{fontSize:"11px",fontWeight:"800",color:"#ff4d6d",marginBottom:"3px"}}>IA: {alertas.length} transação(ões) acima de R$ 15.000</div>
                  <div style={{fontSize:"10px",color:T.textSecondary}}>{alertas.slice(0,2).map(a=>`${a.nomeFornecedor} (R$ ${(a.valorLiquido||0).toLocaleString("pt-BR",{maximumFractionDigits:0})})`).join(" · ")}</div>
                </div>
              </div>
            )}
            {carregDesp?<div style={{textAlign:"center",padding:"30px",color:T.textMuted}}>⏳ Carregando...</div>
            :despFilt.length===0?<div style={{textAlign:"center",padding:"30px",color:T.textMuted,border:`1px dashed ${T.divider}`,borderRadius:"10px"}}>Sem despesas para os filtros selecionados</div>
            :<div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
              {despFilt.slice(0,150).map((d,i)=>{
                const isAlerta=d.valorLiquido>15000; const isExpand=despExpand===i;
                return (
                  <div key={i} onClick={()=>setDespExpand(isExpand?null:i)}
                    style={{background:T.subCardBg,border:`1px solid ${isAlerta?"rgba(255,77,109,0.3)":T.subCardBorder}`,borderLeft:isAlerta?"3px solid #ff4d6d":undefined,borderRadius:"8px",padding:"10px 12px",cursor:"pointer"}}>
                    <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
                      <span style={{fontSize:"18px"}}>{iconeDespesa(d.tipoDespesa)}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",gap:"6px",alignItems:"center",flexWrap:"wrap"}}>
                          <span style={{fontSize:"12px",fontWeight:"700",color:T.textPrimary}}>{d.nomeFornecedor||"Fornecedor não informado"}</span>
                          {isAlerta&&<span style={{fontSize:"8px",padding:"2px 6px",borderRadius:"4px",background:"rgba(255,77,109,0.15)",color:"#ff4d6d",fontWeight:"700"}}>⚠️ ALTO</span>}
                        </div>
                        <div style={{fontSize:"10px",color:T.textMuted,marginTop:"1px"}}>{d.tipoDespesa}</div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontSize:"13px",fontWeight:"800",color:corValor(d.valorLiquido)}}>{`R$ ${(d.valorLiquido||0).toLocaleString("pt-BR",{maximumFractionDigits:2})}`}</div>
                        <div style={{fontSize:"9px",color:T.textMuted}}>{d.dataDocumento?.slice(0,10)}</div>
                      </div>
                      <span style={{color:T.textMuted,fontSize:"11px"}}>{isExpand?"▲":"▼"}</span>
                    </div>
                    {isExpand&&(
                      <div style={{marginTop:"12px",paddingTop:"12px",borderTop:`1px solid ${T.divider}`,display:"flex",flexDirection:"column",gap:"8px"}} onClick={e=>e.stopPropagation()}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                          {[{label:"CNPJ/CPF",valor:d.cnpjCpfFornecedor||"Não informado"},{label:"Nº DOC.",valor:d.numDocumento||"—"},{label:"TIPO DOC.",valor:d.tipoDocumento||"—"},{label:"MÊS/ANO",valor:`${d.mes}/${d.ano}`},{label:"VALOR BRUTO",valor:`R$ ${(d.valorDocumento||0).toLocaleString("pt-BR",{maximumFractionDigits:2})}`},{label:"GLOSA",valor:`R$ ${(d.valorGlosa||0).toLocaleString("pt-BR",{maximumFractionDigits:2})}`}].map((f,j)=>(
                            <div key={j} style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"6px",padding:"8px 10px"}}>
                              <div style={{fontSize:"9px",color:T.textMuted,fontWeight:"600",letterSpacing:"0.06em",marginBottom:"3px"}}>{f.label}</div>
                              <div style={{fontSize:"11px",fontWeight:"700",color:T.textPrimary}}>{f.valor}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{background:isAlerta?"rgba(255,77,109,0.06)":"rgba(0,212,170,0.04)",border:`1px solid ${isAlerta?"rgba(255,77,109,0.2)":"rgba(0,212,170,0.15)"}`,borderRadius:"6px",padding:"10px 12px"}}>
                          <div style={{fontSize:"10px",fontWeight:"800",color:isAlerta?"#ff4d6d":"#00d4aa",marginBottom:"5px"}}>🤖 ANÁLISE IA</div>
                          <p style={{margin:0,fontSize:"11px",color:T.textSecondary,lineHeight:"1.6"}}>
                            {isAlerta?`Transação de R$ ${(d.valorLiquido||0).toLocaleString("pt-BR",{maximumFractionDigits:0})} com ${d.nomeFornecedor} acima da média para esta categoria. Verifique a nota fiscal.`:`Transação dentro dos parâmetros normais para "${d.tipoDespesa}".`}
                          </p>
                        </div>
                        {d.urlDocumento&&(
                          <a href={d.urlDocumento} target="_blank" rel="noopener noreferrer"
                            style={{display:"inline-flex",alignItems:"center",gap:"6px",padding:"8px 14px",background:"rgba(0,212,170,0.1)",border:"1px solid rgba(0,212,170,0.3)",borderRadius:"6px",color:"#00d4aa",fontSize:"11px",fontWeight:"700",textDecoration:"none",width:"fit-content"}}
                            onClick={e=>e.stopPropagation()}>
                            📄 Ver Nota Fiscal / Comprovante oficial
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {despFilt.length>150&&<div style={{textAlign:"center",fontSize:"10px",color:T.textMuted,padding:"10px"}}>Exibindo 150 de {despFilt.length} transações</div>}
            </div>}
          </div>
        )}

        {/* ── NOTÍCIAS (expandido) ── */}
        {secaoAtiva==="noticias" && (
          <div style={{background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"12px",padding:"20px",marginBottom:"16px"}}>
            <div style={{fontSize:"11px",color:"#00d4aa",fontWeight:"800",letterSpacing:"0.1em",marginBottom:"16px"}}>📰 TODAS AS NOTÍCIAS · GOOGLE NEWS</div>
            {noticias.length===0?<div style={{textAlign:"center",padding:"30px",color:T.textMuted}}>⏳ Buscando notícias...</div>
            :<div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              {noticias.map((n,i)=>(
                <a key={i} href={n.link} target="_blank" rel="noopener noreferrer"
                  style={{display:"block",background:T.subCardBg,border:`1px solid ${T.subCardBorder}`,borderRadius:"10px",padding:"14px",textDecoration:"none"}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="#00d4aa44"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=T.subCardBorder}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:"12px",marginBottom:"6px"}}>
                    <div style={{fontSize:"13px",fontWeight:"700",color:T.textPrimary,lineHeight:"1.4"}}>{n.titulo}</div>
                    <span style={{fontSize:"9px",color:"#00d4aa",fontWeight:"700",background:"rgba(0,212,170,0.1)",padding:"2px 8px",borderRadius:"10px",whiteSpace:"nowrap",flexShrink:0}}>{n.fonte}</span>
                  </div>
                  {n.descricao&&<p style={{margin:"0 0 6px",fontSize:"11px",color:T.textSecondary,lineHeight:"1.6"}}>{n.descricao}</p>}
                  <div style={{fontSize:"10px",color:T.textMuted}}>📅 {n.data} · Clique para ler →</div>
                </a>
              ))}
            </div>}
          </div>
        )}

        {/* ── ÚLTIMAS 3 NOTÍCIAS (sempre visíveis) ── */}
        {noticias.length>0&&(
          <div style={{marginBottom:"24px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
              <div style={{fontSize:"11px",color:T.textLabel,fontWeight:"700",letterSpacing:"0.1em"}}>📰 ÚLTIMAS NOTÍCIAS</div>
              <button onClick={()=>setSecaoAtiva(secaoAtiva==="noticias"?null:"noticias")}
                style={{fontSize:"10px",color:"#00d4aa",fontWeight:"700",background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit"}}>
                Ver todas {noticias.length} →
              </button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              {noticias.slice(0,3).map((n,i)=>(
                <a key={i} href={n.link} target="_blank" rel="noopener noreferrer"
                  style={{display:"flex",gap:"12px",alignItems:"flex-start",background:T.cardBg,border:`1px solid ${T.cardBorder}`,borderRadius:"10px",padding:"12px 14px",textDecoration:"none",transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="#00d4aa33";e.currentTarget.style.transform="translateY(-1px)";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=T.cardBorder;e.currentTarget.style.transform="none";}}>
                  <div style={{width:"28px",height:"28px",borderRadius:"6px",background:"rgba(0,212,170,0.1)",border:"1px solid rgba(0,212,170,0.2)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>📰</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:"12px",fontWeight:"700",color:T.textPrimary,lineHeight:"1.4",marginBottom:"4px"}}>{n.titulo}</div>
                    <div style={{display:"flex",gap:"8px"}}>
                      <span style={{fontSize:"9px",color:"#00d4aa",fontWeight:"700"}}>{n.fonte}</span>
                      <span style={{fontSize:"9px",color:T.textMuted}}>{n.data}</span>
                    </div>
                  </div>
                  <span style={{color:"#00d4aa",fontSize:"14px",flexShrink:0}}>→</span>
                </a>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default function AntiCorrupcaoBR() {
  const [tela, setTela] = useState("home");
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

  if (tela === "home") return <TelaHome s={s} tema={tema} setTema={setTema} setTela={setTela} />;
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
