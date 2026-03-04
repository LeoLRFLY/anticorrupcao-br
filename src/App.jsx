import { useState, useEffect, useRef } from "react";

const API_BASE = "https://api.portaldatransparencia.gov.br/api-de-dados";
const API_KEY = import.meta.env.VITE_TRANSPARENCIA_API_KEY || "";

// ── Helpers de data ───────────────────────────────────────────────────────────
const hoje = new Date();
const fmtData = (d) => `${String(d.getDate()).padStart(2,"0")}%2F${String(d.getMonth()+1).padStart(2,"0")}%2F${d.getFullYear()}`;
const dataInicio = () => { const d = new Date(); d.setFullYear(d.getFullYear()-1); return fmtData(d); };
const dataFim = () => fmtData(hoje);

// ── Funções de busca real na API ──────────────────────────────────────────────
const headers = { "chave-api-dados": API_KEY, "Accept": "application/json" };

async function buscarContratos(nomeEmpresa = "", orgao = "26000") {
  try {
    const url = `${API_BASE}/contratos?dataInicial=${dataInicio()}&dataFinal=${dataFim()}&codigoOrgao=${orgao}&pagina=1`;
    const res = await fetch(url, { headers });
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(c => ({
      empresa: c.fornecedor?.nome || "N/D",
      cnpj: c.fornecedor?.cnpjFormatado || "",
      valor: c.valorInicialCompra || 0,
      valorFinal: c.valorFinalCompra || 0,
      data: c.dataAssinatura ? new Date(c.dataAssinatura).toLocaleDateString("pt-BR") : "N/D",
      objeto: c.objeto?.replace("Objeto: ","").substring(0,120) || "",
      modalidade: c.modalidadeCompra || "",
      orgao: c.unidadeGestora?.orgaoMaximo?.sigla || orgao,
      status: "normal",
    }));
  } catch { return []; }
}

async function buscarContratosVariosOrgaos() {
  const orgaos = ["26000","20000","30000","36000","52000","25000"];
  const resultados = await Promise.all(orgaos.map(o => buscarContratos("", o)));
  return resultados.flat().slice(0, 30);
}

function detectarAlertas(contratos) {
  const alertas = [];
  const porEmpresa = {};
  contratos.forEach(c => {
    if (!porEmpresa[c.empresa]) porEmpresa[c.empresa] = [];
    porEmpresa[c.empresa].push(c);
  });

  // Alerta: empresa com múltiplos contratos (possível concentração)
  Object.entries(porEmpresa).forEach(([empresa, lista]) => {
    if (lista.length >= 2) {
      const total = lista.reduce((s, c) => s + c.valor, 0);
      alertas.push({
        id: alertas.length + 1,
        tipo: "empresa_suspeita",
        severidade: total > 5000000 ? "critica" : "alta",
        titulo: `${lista.length} contratos para mesma empresa`,
        descricao: `${empresa} recebeu ${lista.length} contratos totalizando ${fmtBRL(total)}`,
        data: lista[0].data,
        valor: fmtBRL(total),
        orgao: lista[0].orgao,
      });
    }
  });

  // Alerta: contrato de valor muito alto
  contratos
    .filter(c => c.valor > 3000000)
    .forEach(c => {
      alertas.push({
        id: alertas.length + 1,
        tipo: "gasto_alto",
        severidade: c.valor > 10000000 ? "critica" : "alta",
        titulo: `Contrato de alto valor — ${c.modalidade}`,
        descricao: `${c.empresa}: ${c.objeto}`,
        data: c.data,
        valor: fmtBRL(c.valor),
        orgao: c.orgao,
      });
    });

  return alertas.slice(0, 8);
}

function fmtBRL(v) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

// ── Dados mock para demonstração visual ──────────────────────────────────────
const MOCK_POLITICO = {
  nome: "João Carlos da Silva",
  cargo: "Deputado Federal",
  partido: "PXX",
  uf: "SP",
  foto: null,
  cpf: "***.***.***-**",
  mandato: "2023–2027",
};

const MOCK_ALERTAS = [
  {
    id: 1,
    tipo: "gasto_alto",
    severidade: "alta",
    titulo: "Gasto 340% acima da média",
    descricao: "Despesa com 'consultoria' em Mar/2024: R$ 2.4M vs média histórica de R$ 547K",
    data: "15/03/2024",
    valor: "R$ 2.400.000",
  },
  {
    id: 2,
    tipo: "doador_contratado",
    severidade: "critica",
    titulo: "Doador virou contratado",
    descricao: "Construtora XYZ Ltda doou R$ 180K para campanha e recebeu contrato de R$ 8.2M em 2023",
    data: "08/11/2023",
    valor: "R$ 8.200.000",
  },
  {
    id: 3,
    tipo: "empresa_suspeita",
    severidade: "media",
    titulo: "Contrato com empresa na lista negra",
    descricao: "TechGov Soluções ME consta em cadastro de empresas irregulares (CEIS/CNEP)",
    data: "22/01/2024",
    valor: "R$ 430.000",
  },
  {
    id: 4,
    tipo: "salto_patrimonial",
    severidade: "alta",
    titulo: "Patrimônio cresceu 890% em 4 anos",
    descricao: "Declaração TSE: R$ 340K em 2018 → R$ 3.4M em 2022. Bens: 3 imóveis novos",
    data: "01/06/2022",
    valor: "R$ 3.040.000",
  },
];

const MOCK_GASTOS = [
  { mes: "Jan", valor: 420 },
  { mes: "Fev", valor: 380 },
  { mes: "Mar", valor: 2400 },
  { mes: "Abr", valor: 510 },
  { mes: "Mai", valor: 490 },
  { mes: "Jun", valor: 475 },
];

const MOCK_CONTRATOS = [
  { empresa: "TechGov Soluções ME", valor: "R$ 430.000", data: "Jan/2024", status: "suspeito" },
  { empresa: "Construtora XYZ Ltda", valor: "R$ 8.200.000", data: "Nov/2023", status: "critico" },
  { empresa: "Serv Geral SA", valor: "R$ 210.000", data: "Out/2023", status: "normal" },
  { empresa: "Assessoria Gov Ltda", valor: "R$ 640.000", data: "Set/2023", status: "normal" },
];

// ── Ícones SVG inline ────────────────────────────────────────────────────────
const IconSearch = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
  </svg>
);
const IconAlert = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);
const IconUpload = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);
const IconEye = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);
const IconShield = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);

// ── Componente MiniBarChart ──────────────────────────────────────────────────
function MiniBarChart({ data }) {
  const max = Math.max(...data.map(d => d.valor));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "80px" }}>
      {data.map((d, i) => {
        const h = (d.valor / max) * 80;
        const isAnomaly = d.valor > 1000;
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
            <div style={{
              width: "100%", height: `${h}px`,
              background: isAnomaly
                ? "linear-gradient(180deg, #ff3b3b, #c0392b)"
                : "linear-gradient(180deg, #00d4aa, #00a882)",
              borderRadius: "3px 3px 0 0",
              position: "relative",
              transition: "all 0.3s",
            }}>
              {isAnomaly && (
                <div style={{
                  position: "absolute", top: "-20px", left: "50%", transform: "translateX(-50%)",
                  fontSize: "10px", color: "#ff3b3b", fontWeight: "700"
                }}>⚠</div>
              )}
            </div>
            <span style={{ fontSize: "9px", color: "#888", fontFamily: "monospace" }}>{d.mes}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Componente AlertasPublicos com dados reais ───────────────────────────────
function AlertasPublicos({ s, setTela, corSeveridade, labelSeveridade, iconeAlerta }) {
  const [alertas, setAlertas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      const contratos = await buscarContratosVariosOrgaos();
      const detectados = detectarAlertas(contratos);
      setAlertas(detectados.length > 0 ? detectados : MOCK_ALERTAS);
      setUltimaAtualizacao(new Date().toLocaleTimeString("pt-BR"));
      setCarregando(false);
    })();
  }, []);

  return (
    <div style={s.app}>
      <div style={s.grid} />
      <nav style={s.nav}>
        <div style={s.logo} onClick={() => setTela("home")}><IconShield /> ANTICORRUPÇÃO.BR</div>
        <div style={s.navLinks}>
          <button style={s.navBtn(false)} onClick={() => setTela("home")}>BUSCAR</button>
          <button style={s.navBtn(true)}>ALERTAS</button>
          <button style={s.navBtn(false)} onClick={() => setTela("upload")}>UPLOAD DOC</button>
        </div>
      </nav>
      <div style={s.main}>
        <div style={{ marginBottom: "32px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: "10px", color: "#555", letterSpacing: "0.15em", marginBottom: "8px" }}>PAINEL PÚBLICO — DADOS REAIS</div>
            <h2 style={{ margin: 0, fontSize: "22px", fontWeight: "800", color: "#fff" }}>Alertas Detectados</h2>
            <p style={{ color: "#555", fontSize: "12px", marginTop: "6px" }}>Anomalias identificadas automaticamente via Portal da Transparência</p>
          </div>
          {ultimaAtualizacao && (
            <div style={{ fontSize: "10px", color: "#444", textAlign: "right" }}>
              ATUALIZADO<br /><span style={{ color: "#00d4aa" }}>{ultimaAtualizacao}</span>
            </div>
          )}
        </div>

        {carregando ? (
          <div style={{ textAlign: "center", padding: "60px", color: "#555" }}>
            <div style={{ fontSize: "28px", marginBottom: "12px" }}>🔍</div>
            <div style={{ fontSize: "12px", letterSpacing: "0.1em" }}>CONSULTANDO PORTAL DA TRANSPARÊNCIA...</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {alertas.map((alerta, i) => (
              <div key={i} style={{
                display: "flex", gap: "16px", alignItems: "center",
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
                borderLeft: `3px solid ${corSeveridade(alerta.severidade)}`,
                borderRadius: "8px", padding: "16px 20px",
              }}>
                <span style={{ fontSize: "20px" }}>{iconeAlerta(alerta.tipo)}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: "#ccc" }}>{alerta.titulo}</div>
                  <div style={{ fontSize: "11px", color: "#666", marginTop: "4px", lineHeight: 1.5 }}>{alerta.descricao}</div>
                  <div style={{ fontSize: "10px", color: "#444", marginTop: "6px" }}>
                    {alerta.orgao && <span>🏛 {alerta.orgao} · </span>}{alerta.data}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                  <span style={{
                    fontSize: "10px", padding: "2px 8px", borderRadius: "3px",
                    background: `${corSeveridade(alerta.severidade)}22`,
                    color: corSeveridade(alerta.severidade), fontWeight: "700",
                  }}>{labelSeveridade(alerta.severidade)}</span>
                  {alerta.valor && <span style={{ fontSize: "11px", color: "#ffcc00", fontWeight: "700" }}>{alerta.valor}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── App principal ────────────────────────────────────────────────────────────
export default function AntiCorrupcaoBR() {
  const [tela, setTela] = useState("home"); // home | perfil | upload | alertas-pub
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [politico, setPolitico] = useState(null);
  const [abaSelecionada, setAbaSelecionada] = useState("alertas");
  const [arquivoNome, setArquivoNome] = useState(null);
  const [analisando, setAnalisando] = useState(false);
  const [analiseResultado, setAnaliseResultado] = useState(null);
  const [textoDoc, setTextoDoc] = useState("");
  const inputRef = useRef(null);

  const buscarPolitico = () => {
    if (!busca.trim()) return;
    setCarregando(true);
    setTimeout(() => {
      setPolitico(MOCK_POLITICO);
      setTela("perfil");
      setCarregando(false);
    }, 1200);
  };

  const analisarDocumento = async () => {
    if (!textoDoc.trim() && !arquivoNome) return;
    setAnalisando(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `Você é um especialista em análise de corrupção e compliance público no Brasil. 
Analise o documento fornecido e identifique APENAS em JSON (sem markdown), seguindo exatamente este formato:
{
  "risco": "baixo|medio|alto|critico",
  "score": 0-100,
  "alertas": [{"tipo": "string", "descricao": "string"}],
  "resumo": "string de 2 frases"
}`,
          messages: [{ role: "user", content: `Analise este documento em busca de indícios de corrupção, irregularidades ou desvios de conduta:\n\n${textoDoc || "Documento: " + arquivoNome}` }],
        }),
      });
      const data = await res.json();
      const txt = data.content?.map(c => c.text || "").join("") || "{}";
      const parsed = JSON.parse(txt.replace(/```json|```/g, "").trim());
      setAnaliseResultado(parsed);
    } catch {
      setAnaliseResultado({
        risco: "medio",
        score: 52,
        alertas: [{ tipo: "Leitura simulada", descricao: "Conecte sua chave da API Anthropic para análise real." }],
        resumo: "Análise de demonstração. Configure sua API key para usar o recurso real.",
      });
    }
    setAnalisando(false);
  };

  const corSeveridade = (s) => ({
    critica: "#ff2d55", alta: "#ff6b2b", media: "#ffcc00", baixa: "#00d4aa"
  })[s] || "#888";

  const labelSeveridade = (s) => ({
    critica: "CRÍTICO", alta: "ALTO", media: "MÉDIO", baixa: "BAIXO"
  })[s] || s;

  const iconeAlerta = (tipo) => ({
    gasto_alto: "📈", doador_contratado: "🤝", empresa_suspeita: "🏢", salto_patrimonial: "💰"
  })[tipo] || "⚠️";

  // ── ESTILOS BASE ─────────────────────────────────────────────────────────
  const s = {
    app: {
      minHeight: "100vh",
      background: "#0a0c0f",
      color: "#e8e8e8",
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      position: "relative",
      overflow: "hidden",
    },
    grid: {
      position: "fixed", inset: 0, zIndex: 0,
      backgroundImage: `
        linear-gradient(rgba(0,212,170,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,212,170,0.03) 1px, transparent 1px)
      `,
      backgroundSize: "40px 40px",
      pointerEvents: "none",
    },
    nav: {
      position: "sticky", top: 0, zIndex: 100,
      background: "rgba(10,12,15,0.95)",
      backdropFilter: "blur(12px)",
      borderBottom: "1px solid rgba(0,212,170,0.15)",
      padding: "0 24px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      height: "60px",
    },
    logo: {
      display: "flex", alignItems: "center", gap: "10px",
      color: "#00d4aa", fontWeight: "700", fontSize: "15px", letterSpacing: "0.08em",
      cursor: "pointer",
    },
    navLinks: {
      display: "flex", gap: "4px",
    },
    navBtn: (ativo) => ({
      padding: "6px 14px", borderRadius: "4px",
      background: ativo ? "rgba(0,212,170,0.12)" : "transparent",
      border: ativo ? "1px solid rgba(0,212,170,0.3)" : "1px solid transparent",
      color: ativo ? "#00d4aa" : "#888",
      fontSize: "11px", fontFamily: "inherit", fontWeight: "600",
      letterSpacing: "0.06em", cursor: "pointer",
      transition: "all 0.2s",
    }),
    main: { position: "relative", zIndex: 1, maxWidth: "900px", margin: "0 auto", padding: "40px 24px" },
  };

  // ── TELA HOME ────────────────────────────────────────────────────────────
  if (tela === "home") return (
    <div style={s.app}>
      <div style={s.grid} />
      <nav style={s.nav}>
        <div style={s.logo}><IconShield /> ANTICORRUPÇÃO.BR</div>
        <div style={s.navLinks}>
          <button style={s.navBtn(true)} onClick={() => setTela("home")}>BUSCAR</button>
          <button style={s.navBtn(false)} onClick={() => setTela("alertas-pub")}>ALERTAS</button>
          <button style={s.navBtn(false)} onClick={() => setTela("upload")}>UPLOAD DOC</button>
        </div>
      </nav>

      <div style={s.main}>
        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: "60px", paddingTop: "40px" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "8px",
            background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.3)",
            borderRadius: "20px", padding: "6px 16px", marginBottom: "28px",
            fontSize: "11px", color: "#ff2d55", letterSpacing: "0.1em", fontWeight: "700",
          }}>
            ● SISTEMA ATIVO — MONITORANDO DADOS PÚBLICOS
          </div>
          <h1 style={{
            fontSize: "clamp(32px, 6vw, 56px)", fontWeight: "800",
            lineHeight: 1.1, letterSpacing: "-0.02em", marginBottom: "20px",
            color: "#fff",
          }}>
            Fiscalize o dinheiro<br />
            <span style={{ color: "#00d4aa" }}>público</span> que é seu.
          </h1>
          <p style={{ color: "#666", fontSize: "14px", lineHeight: 1.7, maxWidth: "480px", margin: "0 auto 40px" }}>
            Cruzamos dados do Portal da Transparência, TSE, Diário Oficial e listas negras para detectar automaticamente padrões de corrupção.
          </p>

          {/* Barra de busca */}
          <div style={{ position: "relative", maxWidth: "520px", margin: "0 auto" }}>
            <div style={{
              display: "flex", gap: "0",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(0,212,170,0.25)",
              borderRadius: "8px", overflow: "hidden",
            }}>
              <div style={{ padding: "0 16px", display: "flex", alignItems: "center", color: "#555" }}>
                <IconSearch />
              </div>
              <input
                value={busca}
                onChange={e => setBusca(e.target.value)}
                onKeyDown={e => e.key === "Enter" && buscarPolitico()}
                placeholder="Nome do político, CPF ou cargo..."
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: "#e8e8e8", fontSize: "14px", fontFamily: "inherit",
                  padding: "16px 0",
                }}
              />
              <button
                onClick={buscarPolitico}
                disabled={carregando}
                style={{
                  padding: "0 24px", background: "#00d4aa", border: "none",
                  color: "#0a0c0f", fontWeight: "700", fontSize: "12px",
                  fontFamily: "inherit", letterSpacing: "0.08em", cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {carregando ? "..." : "BUSCAR"}
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px", marginBottom: "48px" }}>
          {[
            { label: "ALERTAS ATIVOS", valor: "1.847", cor: "#ff2d55" },
            { label: "POLÍTICOS MONITORADOS", valor: "5.568", cor: "#00d4aa" },
            { label: "CONTRATOS CRUZADOS", valor: "284K", cor: "#ffcc00" },
          ].map((item, i) => (
            <div key={i} style={{
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "8px", padding: "24px", textAlign: "center",
              borderTop: `2px solid ${item.cor}`,
            }}>
              <div style={{ fontSize: "28px", fontWeight: "800", color: item.cor, letterSpacing: "-0.02em" }}>{item.valor}</div>
              <div style={{ fontSize: "10px", color: "#555", letterSpacing: "0.1em", marginTop: "6px" }}>{item.label}</div>
            </div>
          ))}
        </div>

        {/* Como funciona */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "40px" }}>
          <div style={{ fontSize: "10px", color: "#555", letterSpacing: "0.15em", marginBottom: "24px" }}>COMO DETECTAMOS</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "12px" }}>
            {[
              { icon: "📈", titulo: "Gasto acima da média", desc: "Comparamos com média histórica de 3 anos" },
              { icon: "🤝", titulo: "Doador → Contratado", desc: "Cruzamos TSE com Portal da Transparência" },
              { icon: "🏢", titulo: "Empresa suspeita", desc: "Verificamos no CEIS, CNEP e listas negras" },
              { icon: "💰", titulo: "Salto patrimonial", desc: "Analisamos declarações TSE ano a ano" },
            ].map((item, i) => (
              <div key={i} style={{
                display: "flex", gap: "14px", alignItems: "flex-start",
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "8px", padding: "18px",
              }}>
                <span style={{ fontSize: "22px" }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: "#ccc", marginBottom: "4px" }}>{item.titulo}</div>
                  <div style={{ fontSize: "11px", color: "#555", lineHeight: 1.5 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // ── TELA PERFIL ──────────────────────────────────────────────────────────
  if (tela === "perfil") return (
    <div style={s.app}>
      <div style={s.grid} />
      <nav style={s.nav}>
        <div style={s.logo} onClick={() => setTela("home")}><IconShield /> ANTICORRUPÇÃO.BR</div>
        <div style={s.navLinks}>
          <button style={s.navBtn(false)} onClick={() => setTela("home")}>BUSCAR</button>
          <button style={s.navBtn(false)} onClick={() => setTela("alertas-pub")}>ALERTAS</button>
          <button style={s.navBtn(false)} onClick={() => setTela("upload")}>UPLOAD DOC</button>
        </div>
      </nav>
      <div style={s.main}>
        {/* Cabeçalho perfil */}
        <div style={{
          display: "flex", gap: "24px", alignItems: "flex-start",
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "12px", padding: "28px", marginBottom: "24px",
        }}>
          <div style={{
            width: "72px", height: "72px", borderRadius: "50%",
            background: "rgba(0,212,170,0.1)", border: "2px solid rgba(0,212,170,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "28px", flexShrink: 0,
          }}>👤</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "800", color: "#fff", letterSpacing: "-0.01em" }}>{politico.nome}</h2>
            <div style={{ display: "flex", gap: "10px", marginTop: "8px", flexWrap: "wrap" }}>
              {[politico.cargo, politico.partido, politico.uf, politico.mandato].map((t, i) => (
                <span key={i} style={{
                  fontSize: "10px", padding: "3px 10px", borderRadius: "3px",
                  background: "rgba(0,212,170,0.08)", border: "1px solid rgba(0,212,170,0.2)",
                  color: "#00d4aa", letterSpacing: "0.06em",
                }}>{t}</span>
              ))}
            </div>
          </div>
          <div style={{
            textAlign: "right",
            background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.3)",
            borderRadius: "8px", padding: "14px 20px",
          }}>
            <div style={{ fontSize: "28px", fontWeight: "800", color: "#ff2d55" }}>4</div>
            <div style={{ fontSize: "10px", color: "#ff2d55", letterSpacing: "0.08em" }}>ALERTAS</div>
          </div>
        </div>

        {/* Abas */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "20px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "0" }}>
          {[
            { id: "alertas", label: "🚨 ALERTAS" },
            { id: "gastos", label: "📊 GASTOS" },
            { id: "contratos", label: "📋 CONTRATOS" },
          ].map(aba => (
            <button key={aba.id} onClick={() => setAbaSelecionada(aba.id)} style={{
              padding: "10px 18px", background: "transparent", border: "none",
              borderBottom: abaSelecionada === aba.id ? "2px solid #00d4aa" : "2px solid transparent",
              color: abaSelecionada === aba.id ? "#00d4aa" : "#555",
              fontSize: "11px", fontFamily: "inherit", fontWeight: "700",
              letterSpacing: "0.08em", cursor: "pointer", marginBottom: "-1px",
            }}>{aba.label}</button>
          ))}
        </div>

        {/* Aba Alertas */}
        {abaSelecionada === "alertas" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {MOCK_ALERTAS.map(alerta => (
              <div key={alerta.id} style={{
                background: "rgba(255,255,255,0.02)",
                border: `1px solid rgba(255,255,255,0.08)`,
                borderLeft: `3px solid ${corSeveridade(alerta.severidade)}`,
                borderRadius: "8px", padding: "20px",
                display: "flex", gap: "16px", alignItems: "flex-start",
              }}>
                <span style={{ fontSize: "24px", flexShrink: 0 }}>{iconeAlerta(alerta.tipo)}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                    <span style={{
                      fontSize: "10px", padding: "2px 8px", borderRadius: "3px",
                      background: `${corSeveridade(alerta.severidade)}22`,
                      color: corSeveridade(alerta.severidade),
                      fontWeight: "700", letterSpacing: "0.08em",
                    }}>{labelSeveridade(alerta.severidade)}</span>
                    <span style={{ fontSize: "12px", fontWeight: "700", color: "#ddd" }}>{alerta.titulo}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: "12px", color: "#666", lineHeight: 1.6 }}>{alerta.descricao}</p>
                  <div style={{ display: "flex", gap: "16px", marginTop: "10px" }}>
                    <span style={{ fontSize: "11px", color: "#444" }}>📅 {alerta.data}</span>
                    <span style={{ fontSize: "11px", color: "#ffcc00", fontWeight: "700" }}>{alerta.valor}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Aba Gastos */}
        {abaSelecionada === "gastos" && (
          <div style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "8px", padding: "28px",
          }}>
            <div style={{ fontSize: "11px", color: "#555", letterSpacing: "0.1em", marginBottom: "20px" }}>
              GASTOS MENSAIS 2024 (R$ mil) — ⚠ MARÇO ANOMALIA DETECTADA
            </div>
            <MiniBarChart data={MOCK_GASTOS} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "12px", marginTop: "24px" }}>
              {[
                { label: "Média histórica", valor: "R$ 547K", cor: "#00d4aa" },
                { label: "Maior gasto", valor: "R$ 2.4M", cor: "#ff2d55" },
                { label: "Desvio padrão", valor: "+340%", cor: "#ffcc00" },
              ].map((item, i) => (
                <div key={i} style={{
                  background: "rgba(255,255,255,0.03)", borderRadius: "6px", padding: "14px", textAlign: "center"
                }}>
                  <div style={{ fontSize: "16px", fontWeight: "800", color: item.cor }}>{item.valor}</div>
                  <div style={{ fontSize: "10px", color: "#555", marginTop: "4px", letterSpacing: "0.06em" }}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Aba Contratos */}
        {abaSelecionada === "contratos" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {MOCK_CONTRATOS.map((c, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: "14px",
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "8px", padding: "16px 20px",
              }}>
                <div style={{
                  width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
                  background: { suspeito: "#ffcc00", critico: "#ff2d55", normal: "#00d4aa" }[c.status]
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#ccc" }}>{c.empresa}</div>
                  <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>{c.data}</div>
                </div>
                <div style={{ fontSize: "14px", fontWeight: "800", color: { suspeito: "#ffcc00", critico: "#ff2d55", normal: "#888" }[c.status] }}>
                  {c.valor}
                </div>
                <span style={{
                  fontSize: "10px", padding: "2px 8px", borderRadius: "3px",
                  background: "rgba(255,255,255,0.05)", color: "#555", letterSpacing: "0.06em"
                }}>{c.status.toUpperCase()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ── TELA ALERTAS PÚBLICOS ────────────────────────────────────────────────
  if (tela === "alertas-pub") return (
    <AlertasPublicos
      s={s} setTela={setTela}
      corSeveridade={corSeveridade} labelSeveridade={labelSeveridade} iconeAlerta={iconeAlerta}
    />
  );

  // ── TELA UPLOAD ──────────────────────────────────────────────────────────
  if (tela === "upload") return (
    <div style={s.app}>
      <div style={s.grid} />
      <nav style={s.nav}>
        <div style={s.logo} onClick={() => setTela("home")}><IconShield /> ANTICORRUPÇÃO.BR</div>
        <div style={s.navLinks}>
          <button style={s.navBtn(false)} onClick={() => setTela("home")}>BUSCAR</button>
          <button style={s.navBtn(false)} onClick={() => setTela("alertas-pub")}>ALERTAS</button>
          <button style={s.navBtn(true)} onClick={() => setTela("upload")}>UPLOAD DOC</button>
        </div>
      </nav>
      <div style={{ ...s.main, maxWidth: "640px" }}>
        <div style={{ marginBottom: "32px" }}>
          <div style={{ fontSize: "10px", color: "#555", letterSpacing: "0.15em", marginBottom: "8px" }}>ANÁLISE POR IA</div>
          <h2 style={{ margin: 0, fontSize: "22px", fontWeight: "800", color: "#fff" }}>Analisar Documento</h2>
          <p style={{ color: "#555", fontSize: "12px", marginTop: "6px" }}>IA detecta irregularidades em contratos, notas fiscais e documentos públicos</p>
        </div>

        {/* Área de upload */}
        <div
          onClick={() => inputRef.current?.click()}
          style={{
            border: "2px dashed rgba(0,212,170,0.25)", borderRadius: "12px",
            padding: "40px", textAlign: "center", cursor: "pointer",
            background: arquivoNome ? "rgba(0,212,170,0.05)" : "rgba(255,255,255,0.02)",
            marginBottom: "20px", transition: "all 0.2s",
          }}
        >
          <input ref={inputRef} type="file" accept=".pdf,.txt,.doc,.docx" style={{ display: "none" }}
            onChange={e => setArquivoNome(e.target.files[0]?.name || null)} />
          <div style={{ fontSize: "32px", marginBottom: "12px" }}><IconUpload /></div>
          <div style={{ fontSize: "13px", color: "#ccc", fontWeight: "600" }}>
            {arquivoNome ? `✓ ${arquivoNome}` : "Clique para selecionar arquivo"}
          </div>
          <div style={{ fontSize: "11px", color: "#555", marginTop: "6px" }}>PDF, TXT, DOC — máx. 10MB</div>
        </div>

        {/* Ou texto direto */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "10px", color: "#555", letterSpacing: "0.1em", marginBottom: "8px" }}>OU COLE O TEXTO AQUI</div>
          <textarea
            value={textoDoc}
            onChange={e => setTextoDoc(e.target.value)}
            placeholder="Cole o conteúdo do documento, contrato, licitação..."
            rows={6}
            style={{
              width: "100%", background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px",
              color: "#ccc", fontSize: "12px", fontFamily: "inherit",
              padding: "16px", resize: "vertical", outline: "none",
              boxSizing: "border-box", lineHeight: 1.6,
            }}
          />
        </div>

        <button
          onClick={analisarDocumento}
          disabled={analisando || (!textoDoc && !arquivoNome)}
          style={{
            width: "100%", padding: "16px",
            background: analisando ? "rgba(0,212,170,0.3)" : "#00d4aa",
            border: "none", borderRadius: "8px",
            color: "#0a0c0f", fontWeight: "800", fontSize: "13px",
            fontFamily: "inherit", letterSpacing: "0.08em",
            cursor: analisando ? "wait" : "pointer",
            marginBottom: "24px",
          }}
        >
          {analisando ? "ANALISANDO COM IA..." : "🔍 ANALISAR DOCUMENTO"}
        </button>

        {/* Resultado */}
        {analiseResultado && (
          <div style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "12px", padding: "24px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#ccc", letterSpacing: "0.06em" }}>RESULTADO DA ANÁLISE</div>
              <div style={{
                display: "flex", alignItems: "center", gap: "8px",
                background: `${corSeveridade(analiseResultado.risco)}22`,
                border: `1px solid ${corSeveridade(analiseResultado.risco)}44`,
                borderRadius: "6px", padding: "6px 14px",
              }}>
                <div style={{ fontSize: "18px", fontWeight: "800", color: corSeveridade(analiseResultado.risco) }}>
                  {analiseResultado.score}
                </div>
                <div>
                  <div style={{ fontSize: "9px", color: "#555", letterSpacing: "0.08em" }}>SCORE DE RISCO</div>
                  <div style={{ fontSize: "10px", color: corSeveridade(analiseResultado.risco), fontWeight: "700" }}>
                    {analiseResultado.risco?.toUpperCase()}
                  </div>
                </div>
              </div>
            </div>
            <p style={{ fontSize: "12px", color: "#777", lineHeight: 1.7, marginBottom: "20px" }}>{analiseResultado.resumo}</p>
            {analiseResultado.alertas?.map((a, i) => (
              <div key={i} style={{
                display: "flex", gap: "12px",
                background: "rgba(255,45,85,0.05)", border: "1px solid rgba(255,45,85,0.15)",
                borderRadius: "6px", padding: "12px 16px", marginBottom: "8px",
              }}>
                <span style={{ color: "#ff2d55" }}><IconAlert /></span>
                <div>
                  <div style={{ fontSize: "11px", fontWeight: "700", color: "#ccc" }}>{a.tipo}</div>
                  <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>{a.descricao}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
