// Vercel Edge Function — proxy CEPESP/FGV para dados de candidatos
// Endpoint: /api/eleicoes?ano=2024&cargo=11&uf=SP&nome=João
export const config = { runtime: "edge" };

const CEPESP = "https://cepesp.io/api/consulta/athena/query";

const CARGOS = {
  "1":  "Presidente",
  "3":  "Governador",
  "5":  "Senador",
  "6":  "Deputado Federal",
  "7":  "Deputado Estadual",
  "11": "Prefeito",
  "13": "Vereador",
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const ano   = searchParams.get("ano")   || "2024";
  const cargo = searchParams.get("cargo") || "11";
  const uf    = searchParams.get("uf")    || "";
  const nome  = searchParams.get("nome")  || "";

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, s-maxage=3600",
  };

  try {
    // Colunas que queremos buscar
    const cols = [
      "ANO_ELEICAO", "NOME_CANDIDATO", "NOME_URNA_CANDIDATO",
      "CPF_CANDIDATO", "SIGLA_PARTIDO", "NOME_PARTIDO",
      "SIGLA_UF", "NOME_MUNICIPIO", "DESCRICAO_CARGO",
      "NUM_TURNO", "DESC_SIT_TOT_TURNO", "NUMERO_CANDIDATO",
      "CODIGO_SEXO", "DESCRICAO_SEXO", "IDADE_DATA_ELEICAO",
      "DESCRICAO_GRAU_INSTRUCAO", "DESCRICAO_OCUPACAO",
      "DESCRICAO_COR_RACA", "SEQUENCIAL_CANDIDATO",
    ];

    const params = new URLSearchParams({ table: "candidatos", anos: ano, cargo });
    cols.forEach(c => params.append("c[]", c));
    if (uf)   params.append("filters[SIGLA_UF]", uf.toUpperCase());

    const url = `${CEPESP}?${params.toString()}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "anticorrupcao-br/1.0" },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`CEPESP ${res.status}`);

    const raw = await res.json();

    // Aguarda processamento assíncrono do CEPESP se necessário
    let data = raw.data || raw;
    if (!Array.isArray(data)) {
      // CEPESP pode retornar um query_id que precisa ser buscado
      return new Response(JSON.stringify({ error: "Dados não disponíveis ainda, tente novamente." }), { status: 202, headers });
    }

    // Normaliza e filtra por nome se necessário
    const candidatos = data
      .map(c => ({
        sequencial:   c.SEQUENCIAL_CANDIDATO || "",
        nome:         c.NOME_CANDIDATO || "",
        nomeUrna:     c.NOME_URNA_CANDIDATO || "",
        cpf:          c.CPF_CANDIDATO || "",
        partido:      c.SIGLA_PARTIDO || "",
        nomePartido:  c.NOME_PARTIDO || "",
        uf:           c.SIGLA_UF || "",
        municipio:    c.NOME_MUNICIPIO || "",
        cargo:        c.DESCRICAO_CARGO || CARGOS[cargo] || cargo,
        turno:        c.NUM_TURNO || "1",
        situacao:     c.DESC_SIT_TOT_TURNO || "",
        numero:       c.NUMERO_CANDIDATO || "",
        sexo:         c.DESCRICAO_SEXO || "",
        idade:        c.IDADE_DATA_ELEICAO || "",
        instrucao:    c.DESCRICAO_GRAU_INSTRUCAO || "",
        ocupacao:     c.DESCRICAO_OCUPACAO || "",
        raca:         c.DESCRICAO_COR_RACA || "",
        ano:          c.ANO_ELEICAO || ano,
      }))
      .filter(c => !nome || c.nome.toLowerCase().includes(nome.toLowerCase()) || c.nomeUrna.toLowerCase().includes(nome.toLowerCase()));

    return new Response(JSON.stringify({ candidatos, total: candidatos.length, ano, cargo: CARGOS[cargo] || cargo }), { headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, candidatos: [] }), { status: 500, headers });
  }
}
