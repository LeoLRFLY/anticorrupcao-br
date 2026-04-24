// Vercel Edge Function — candidatos via TSE DivulgaCandContas (+ CEPESP fallback)
// Endpoint: /api/eleicoes?ano=2024&cargo=11&uf=SP&nome=João
export const config = { runtime: "edge" };

const TSE    = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";
const CEPESP = "https://cepesp.io/api/consulta";

const CARGO_LABELS = {
  "1":"Presidente","3":"Governador","5":"Senador",
  "6":"Deputado Federal","7":"Deputado Estadual","11":"Prefeito","13":"Vereador",
};

// Eleições que ocorrem a cada ciclo no Brasil
const ANO_MUNICIPAL = new Set(["2024","2020","2016","2012","2008"]);
const ANO_FEDERAL   = new Set(["2022","2018","2014","2010","2006"]);
const CARGO_MUNICIPAL = new Set(["11","13"]);
const CARGO_FEDERAL   = new Set(["1","3","5","6","7"]);

const TSE_HDR = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "application/json, text/plain, */*",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "Origin":          "https://divulgacandcontas.tse.jus.br",
  "Referer":         "https://divulgacandcontas.tse.jus.br/",
};

const OUT_HDR = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
  "Cache-Control": "public, s-maxage=1800",
};

// Máx total: ~4s TSE listing + 7s TSE candidatos + 4s CEPESP inicial + 7s CEPESP poll = 22s < 30s limit
function timedFetch(url, opts = {}, ms = 4000) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function getEleicaoCodigos(ano) {
  const r = await timedFetch(`${TSE}/eleicao/listar/${ano}`, { headers: TSE_HDR }, 4000);
  if (!r.ok) return null;
  const payload = await r.json();
  const lista   = Array.isArray(payload)           ? payload
                : Array.isArray(payload?.eleicoes) ? payload.eleicoes
                : [];

  const mapa = {};
  for (const el of lista) {
    const id   = String(el.id || el.codigo || el.codigoEleicao || "");
    const desc = (el.descricao || el.nome || "").toUpperCase();
    if (!id) continue;
    const is2T = desc.includes("2°") || desc.includes("SEGUNDO") || desc.includes("2 TURNO");
    if (desc.includes("MUNICIPAL") && !is2T) mapa.municipal1 = id;
    if (desc.includes("MUNICIPAL") &&  is2T) mapa.municipal2 = id;
    if ((desc.includes("GERAL") || desc.includes("FEDERAL")) && !is2T) mapa.federal1 = id;
    if ((desc.includes("GERAL") || desc.includes("FEDERAL")) &&  is2T) mapa.federal2 = id;
  }
  mapa._lista = lista.map(e => ({ id: e.id, descricao: e.descricao }));
  return mapa;
}

function normalizarTSE(c, cargo, ano, codigoEleicao) {
  const partido   = c.partido   || {};
  const municipio = c.municipio || {};
  const cargoObj  = c.cargo     || {};
  const genero    = c.genero    || {};
  const grau      = c.grauInstrucao || {};
  const ocup      = c.ocupacao  || {};
  const sit       = c.situacaoTurno || {};
  const loc       = c.localidade    || {};
  const uf = typeof loc === "string" ? loc : (loc.sigla ?? c.siglaUF ?? (municipio.uf?.sigla ?? ""));

  return {
    sequencial:   c.sequencialCandidato || c.sequencial || "",
    nome:         c.nomeCompleto || c.nome || "",
    nomeUrna:     c.nomeUrna    || c.nomeCompleto || c.nome || "",
    cpf:          c.cpf || c.cpfCandidato || "",
    partido:      partido.sigla  || c.siglaPartido  || "",
    nomePartido:  partido.nome   || c.nomePartido   || "",
    uf,
    municipio:    municipio.descricao || municipio.nome || c.nomeMunicipio || "",
    cargo:        cargoObj.descricao  || c.descricaoCargo || CARGO_LABELS[cargo] || cargo,
    turno:        String(c.turno || "1"),
    situacao:     sit.descricao   || c.descricaoTotalizacaoTurno || c.situacao || "",
    numero:       String(c.numero || c.numeroCandidato || ""),
    sexo:         genero.descricao || c.descricaoGenero || "",
    idade:        String(c.idadeDataEleicao ?? c.idade ?? ""),
    instrucao:    grau.descricao   || c.descricaoGrauInstrucao   || "",
    ocupacao:     ocup.descricao   || c.descricaoOcupacao        || "",
    ano:          String(ano),
    foto:         c.fotoUrl || c.foto || "",
    codigoEleicao,
  };
}

// ── CEPESP fallback ──────────────────────────────────────────────────────────
async function pollCepesp(queryId, maxMs = 7000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r = await timedFetch(`${CEPESP}/athena/query/${queryId}`, {
        headers: { "User-Agent": "anticorrupcao-br/1.0" },
      }, 3000);
      if (!r.ok) break;
      const d = await r.json();
      const ok = d.last_status === "SUCCEEDED" || d.last_status === "SUCCESS";
      if (ok && Array.isArray(d.data)) return d.data;
      if (d.last_status === "FAILED" || d.last_status === "ERROR") break;
    } catch { break; }
  }
  return null;
}

async function buscarCepesp(ano, cargo, uf, nome) {
  const cols = [
    "ANO_ELEICAO","NOME_CANDIDATO","NOME_URNA_CANDIDATO","CPF_CANDIDATO",
    "SIGLA_PARTIDO","NOME_PARTIDO","SIGLA_UF","NOME_MUNICIPIO",
    "DESCRICAO_CARGO","NUM_TURNO","DESC_SIT_TOT_TURNO","NUMERO_CANDIDATO",
    "DESCRICAO_SEXO","IDADE_DATA_ELEICAO","DESCRICAO_GRAU_INSTRUCAO",
    "DESCRICAO_OCUPACAO","SEQUENCIAL_CANDIDATO",
  ];
  const qs = new URLSearchParams({ table: "candidatos", anos: ano, cargo });
  cols.forEach(c => qs.append("c[]", c));
  if (uf) qs.append("filters[SIGLA_UF]", uf);

  const res = await timedFetch(`${CEPESP}/athena/query?${qs}`, {
    headers: { "User-Agent": "anticorrupcao-br/1.0" },
  }, 4000);
  if (!res.ok) return null;

  const raw  = await res.json();
  let rows   = Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : null;
  if (!rows && (raw.id || raw.query_id)) rows = await pollCepesp(raw.id || raw.query_id);
  if (!rows) return null;

  const n = nome.toLowerCase();
  return rows
    .map(c => ({
      sequencial:  c.SEQUENCIAL_CANDIDATO || "",
      nome:        c.NOME_CANDIDATO || "",
      nomeUrna:    c.NOME_URNA_CANDIDATO || c.NOME_CANDIDATO || "",
      cpf:         c.CPF_CANDIDATO || "",
      partido:     c.SIGLA_PARTIDO || "",
      nomePartido: c.NOME_PARTIDO  || "",
      uf:          c.SIGLA_UF      || "",
      municipio:   c.NOME_MUNICIPIO || "",
      cargo:       c.DESCRICAO_CARGO || CARGO_LABELS[cargo] || cargo,
      turno:       String(c.NUM_TURNO || "1"),
      situacao:    c.DESC_SIT_TOT_TURNO || "",
      numero:      c.NUMERO_CANDIDATO   || "",
      sexo:        c.DESCRICAO_SEXO     || "",
      idade:       c.IDADE_DATA_ELEICAO || "",
      instrucao:   c.DESCRICAO_GRAU_INSTRUCAO || "",
      ocupacao:    c.DESCRICAO_OCUPACAO        || "",
      ano:         String(ano),
      codigoEleicao: "",
    }))
    .filter(c => !n || c.nome.toLowerCase().includes(n) || c.nomeUrna.toLowerCase().includes(n));
}

// ── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const ano   =  searchParams.get("ano")   || "2024";
  const cargo =  searchParams.get("cargo") || "11";
  const uf    = (searchParams.get("uf")    || "").toUpperCase();
  const nome  = (searchParams.get("nome")  || "").trim();

  // Validação: anos municipais só têm Prefeito/Vereador; anos federais só têm cargos federais
  if (ANO_MUNICIPAL.has(ano) && CARGO_FEDERAL.has(cargo)) {
    return new Response(
      JSON.stringify({
        erro: `Em ${ano} ocorreram apenas eleições municipais (Prefeito e Vereador). Para ${CARGO_LABELS[cargo]}, selecione um ano federal (2022, 2018…).`,
        candidatos: [],
      }),
      { status: 200, headers: OUT_HDR }
    );
  }
  if (ANO_FEDERAL.has(ano) && CARGO_MUNICIPAL.has(cargo)) {
    return new Response(
      JSON.stringify({
        erro: `Em ${ano} ocorreram apenas eleições federais/estaduais. Para ${CARGO_LABELS[cargo]}, selecione um ano municipal (2024, 2020…).`,
        candidatos: [],
      }),
      { status: 200, headers: OUT_HDR }
    );
  }

  const debug = [];

  // ── 1. TSE DivulgaCandContas ─────────────────────────────────────────────
  try {
    const codigos = await getEleicaoCodigos(ano);
    if (!codigos) {
      debug.push(`TSE /eleicao/listar/${ano} retornou erro ou timeout`);
    } else {
      const isMunicipal   = CARGO_MUNICIPAL.has(cargo);
      const isNacional    = cargo === "1";
      const codigoEleicao = isMunicipal ? (codigos.municipal1 || codigos.municipal2)
                          : isNacional  ? (codigos.federal1   || codigos.municipal1)
                          :               (codigos.federal1);

      if (!codigoEleicao) {
        debug.push(`TSE: sem código para cargo ${cargo} em ${ano}. Disponíveis: ${JSON.stringify(codigos._lista)}`);
      } else {
        const ufParam = isNacional ? "BR" : (uf || "BR");
        const url     = `${TSE}/candidatura/listar/${ano}/${ufParam}/${codigoEleicao}/${cargo}/candidatos`;

        const r = await timedFetch(url, { headers: TSE_HDR }, 7000);
        if (!r.ok) {
          debug.push(`TSE candidatos HTTP ${r.status}: ${url}`);
        } else {
          const data = await r.json();
          const rows = data.candidatos || data.data || (Array.isArray(data) ? data : []);
          const n    = nome.toLowerCase();
          let candidatos = rows.map(c => normalizarTSE(c, cargo, ano, codigoEleicao));
          if (n) candidatos = candidatos.filter(c =>
            c.nome.toLowerCase().includes(n) || c.nomeUrna.toLowerCase().includes(n)
          );
          return new Response(
            JSON.stringify({ candidatos, total: candidatos.length, ano, cargoLabel: CARGO_LABELS[cargo] || cargo, fonte: "TSE" }),
            { headers: OUT_HDR }
          );
        }
      }
    }
  } catch (e) {
    debug.push(`TSE exception: ${e.message}`);
  }

  // ── 2. CEPESP / FGV fallback ─────────────────────────────────────────────
  try {
    const candidatos = await buscarCepesp(ano, cargo, uf, nome);
    if (candidatos !== null) {
      return new Response(
        JSON.stringify({ candidatos, total: candidatos.length, ano, cargoLabel: CARGO_LABELS[cargo] || cargo, fonte: "CEPESP" }),
        { headers: OUT_HDR }
      );
    }
    debug.push("CEPESP: sem dados ou timeout");
  } catch (e) {
    debug.push(`CEPESP exception: ${e.message}`);
  }

  // ── Ambas as fontes falharam ─────────────────────────────────────────────
  return new Response(
    JSON.stringify({
      erro: "Dados eleitorais temporariamente indisponíveis. Tente novamente em alguns instantes.",
      candidatos: [],
      debug,
    }),
    { status: 200, headers: OUT_HDR }
  );
}
