// Vercel Edge Function — candidatos via CEPESP/FGV (com polling assíncrono)
// Endpoint: /api/eleicoes?ano=2024&cargo=11&uf=SP&nome=João
export const config = { runtime: "edge" };

const CEPESP_BASE = "https://cepesp.io/api/consulta";
const CARGOS = {
  "1":"Presidente","3":"Governador","5":"Senador",
  "6":"Deputado Federal","7":"Deputado Estadual",
  "11":"Prefeito","13":"Vereador",
};

const hdrs = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
  "Cache-Control": "public, s-maxage=1800",
};

// Aguarda resultado assíncrono do CEPESP (polling até 12s)
async function pollCepesp(queryId, maxMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 1500));
    const r = await fetch(`${CEPESP_BASE}/athena/query/${queryId}`, {
      headers: { "User-Agent": "anticorrupcao-br/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) break;
    const d = await r.json();
    if (d.last_status === "SUCCEEDED" && Array.isArray(d.data)) return d.data;
    if (d.last_status === "FAILED") break;
  }
  return null;
}

function normalizar(c, cargo) {
  return {
    sequencial: c.SEQUENCIAL_CANDIDATO || "",
    nome:       c.NOME_CANDIDATO || "",
    nomeUrna:   c.NOME_URNA_CANDIDATO || c.NOME_CANDIDATO || "",
    cpf:        c.CPF_CANDIDATO || "",
    partido:    c.SIGLA_PARTIDO || "",
    nomePartido:c.NOME_PARTIDO || "",
    uf:         c.SIGLA_UF || "",
    municipio:  c.NOME_MUNICIPIO || "",
    cargo:      c.DESCRICAO_CARGO || CARGOS[cargo] || cargo,
    turno:      String(c.NUM_TURNO || "1"),
    situacao:   c.DESC_SIT_TOT_TURNO || "",
    numero:     c.NUMERO_CANDIDATO || "",
    sexo:       c.DESCRICAO_SEXO || "",
    idade:      c.IDADE_DATA_ELEICAO || "",
    instrucao:  c.DESCRICAO_GRAU_INSTRUCAO || "",
    ocupacao:   c.DESCRICAO_OCUPACAO || "",
    ano:        c.ANO_ELEICAO || "",
  };
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const ano   = searchParams.get("ano")   || "2024";
  const cargo = searchParams.get("cargo") || "11";
  const uf    = searchParams.get("uf")    || "";
  const nome  = searchParams.get("nome")  || "";

  try {
    const cols = [
      "ANO_ELEICAO","NOME_CANDIDATO","NOME_URNA_CANDIDATO","CPF_CANDIDATO",
      "SIGLA_PARTIDO","NOME_PARTIDO","SIGLA_UF","NOME_MUNICIPIO",
      "DESCRICAO_CARGO","NUM_TURNO","DESC_SIT_TOT_TURNO","NUMERO_CANDIDATO",
      "DESCRICAO_SEXO","IDADE_DATA_ELEICAO","DESCRICAO_GRAU_INSTRUCAO",
      "DESCRICAO_OCUPACAO","SEQUENCIAL_CANDIDATO",
    ];

    const qs = new URLSearchParams({ table:"candidatos", anos: ano, cargo });
    cols.forEach(c => qs.append("c[]", c));
    if (uf) qs.append("filters[SIGLA_UF]", uf.toUpperCase());

    const res = await fetch(`${CEPESP_BASE}/athena/query?${qs}`, {
      headers: { "User-Agent": "anticorrupcao-br/1.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`CEPESP status ${res.status}`);

    const raw = await res.json();

    // Resposta imediata com data[]
    let rows = Array.isArray(raw.data) ? raw.data
             : Array.isArray(raw)      ? raw
             : null;

    // Resposta assíncrona: temos query_id, fazer polling
    if (!rows && (raw.id || raw.query_id)) {
      rows = await pollCepesp(raw.id || raw.query_id);
    }

    if (!rows) {
      return new Response(
        JSON.stringify({ erro: "CEPESP ainda processando — tente novamente em alguns segundos.", candidatos: [] }),
        { status: 202, headers: hdrs }
      );
    }

    const candidatos = rows
      .map(c => normalizar(c, cargo))
      .filter(c => !nome ||
        c.nome.toLowerCase().includes(nome.toLowerCase()) ||
        c.nomeUrna.toLowerCase().includes(nome.toLowerCase())
      );

    return new Response(
      JSON.stringify({ candidatos, total: candidatos.length, ano, cargoLabel: CARGOS[cargo] || cargo }),
      { headers: hdrs }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ erro: `Erro ao consultar dados: ${e.message}`, candidatos: [] }),
      { status: 500, headers: hdrs }
    );
  }
}
