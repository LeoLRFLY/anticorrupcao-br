// Vercel Edge Function — bens declarados do candidato via CEPESP/FGV
// Endpoint: /api/bens-candidato?cpf=12345678901&ano=2024
export const config = { runtime: "edge" };

const CEPESP = "https://cepesp.io/api/consulta/athena/query";

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const cpf = searchParams.get("cpf") || "";
  const ano = searchParams.get("ano") || "2024";

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, s-maxage=3600",
  };

  if (!cpf) return new Response(JSON.stringify({ bens: [], total: 0 }), { headers });

  try {
    const cols = [
      "ANO_ELEICAO", "CPF_CANDIDATO", "NOME_CANDIDATO",
      "SEQUENCIAL_CANDIDATO", "ORDEM_BEM", "DESCRICAO_TIPO_BEM",
      "DETALHE_BEM", "VALOR_BEM",
    ];

    const params = new URLSearchParams({ table: "bem_candidato", anos: ano });
    cols.forEach(c => params.append("c[]", c));
    params.append("filters[CPF_CANDIDATO]", cpf.replace(/\D/g, ""));

    const url = `${CEPESP}?${params.toString()}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "anticorrupcao-br/1.0" },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`CEPESP ${res.status}`);

    const raw = await res.json();
    const data = raw.data || raw;

    if (!Array.isArray(data)) {
      return new Response(JSON.stringify({ bens: [], total: 0, aviso: "Processando..." }), { headers });
    }

    const bens = data.map(b => ({
      ordem:    b.ORDEM_BEM || "",
      tipo:     b.DESCRICAO_TIPO_BEM || "",
      detalhe:  b.DETALHE_BEM || "",
      valor:    parseFloat(b.VALOR_BEM || 0),
    })).sort((a, b) => b.valor - a.valor);

    const totalPatrimonio = bens.reduce((s, b) => s + b.valor, 0);

    return new Response(JSON.stringify({ bens, total: bens.length, totalPatrimonio }), { headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, bens: [] }), { status: 500, headers });
  }
}
