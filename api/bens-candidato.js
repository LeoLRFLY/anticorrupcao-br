// Vercel Edge Function — bens declarados via TSE DivulgaCandContas (+ CEPESP fallback)
// Endpoint: /api/bens-candidato?sequencial=X&uf=SP&eleicao=619&ano=2024
//                             ou  ?cpf=12345678901&ano=2024  (fallback CEPESP)
export const config = { runtime: "edge" };

const TSE    = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";
const CEPESP = "https://cepesp.io/api/consulta/athena/query";

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
  "Cache-Control": "public, s-maxage=3600",
};

function timedFetch(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

function normalizarBens(bens) {
  if (!Array.isArray(bens)) return [];
  return bens.map(b => ({
    ordem:   String(b.ordem   || b.ordemBem        || ""),
    tipo:    b.tipoBem?.descricao || b.descricaoTipoBem || b.tipo    || "",
    detalhe: b.descricao          || b.detalhe          || b.detalheBem || "",
    valor:   parseFloat(b.valor   || b.valorBem        || 0),
  })).sort((a, b) => b.valor - a.valor);
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const cpf        =  searchParams.get("cpf")        || "";
  const ano        =  searchParams.get("ano")        || "2024";
  const sequencial =  searchParams.get("sequencial") || "";
  const uf         = (searchParams.get("uf")         || "").toUpperCase();
  const eleicao    =  searchParams.get("eleicao")    || "";

  if (!cpf && !sequencial) {
    return new Response(JSON.stringify({ bens: [], total: 0 }), { headers: OUT_HDR });
  }

  // ── 1. TSE (requer sequencial + uf + eleicao) ────────────────────────────
  if (sequencial && uf && eleicao) {
    try {
      const url = `${TSE}/candidatura/buscar/${ano}/${uf}/${eleicao}/candidato/${sequencial}`;
      const r   = await timedFetch(url, { headers: TSE_HDR }, 12000);
      if (r.ok) {
        const data      = await r.json();
        const candidato = data.candidato || data;
        const bens      = normalizarBens(candidato.bens || candidato.patrimonios || candidato.listaBens || []);
        const totalPatrimonio = bens.reduce((s, b) => s + b.valor, 0);
        return new Response(
          JSON.stringify({ bens, total: bens.length, totalPatrimonio, fonte: "TSE" }),
          { headers: OUT_HDR }
        );
      }
    } catch {}
  }

  // ── 2. CEPESP fallback (com CPF) ─────────────────────────────────────────
  if (!cpf) {
    return new Response(
      JSON.stringify({ bens: [], total: 0, aviso: "Bens indisponíveis — CPF não informado." }),
      { headers: OUT_HDR }
    );
  }

  try {
    const cols = [
      "ANO_ELEICAO","CPF_CANDIDATO","NOME_CANDIDATO",
      "SEQUENCIAL_CANDIDATO","ORDEM_BEM","DESCRICAO_TIPO_BEM",
      "DETALHE_BEM","VALOR_BEM",
    ];
    const params = new URLSearchParams({ table: "bem_candidato", anos: ano });
    cols.forEach(c => params.append("c[]", c));
    params.append("filters[CPF_CANDIDATO]", cpf.replace(/\D/g, ""));

    const res = await timedFetch(`${CEPESP}?${params}`, {
      headers: { "User-Agent": "anticorrupcao-br/1.0" },
    }, 15000);

    if (!res.ok) throw new Error(`CEPESP ${res.status}`);
    const raw  = await res.json();
    const data = raw.data || raw;

    if (!Array.isArray(data)) {
      return new Response(JSON.stringify({ bens: [], total: 0, aviso: "Processando..." }), { headers: OUT_HDR });
    }

    const bens = data.map(b => ({
      ordem:   b.ORDEM_BEM            || "",
      tipo:    b.DESCRICAO_TIPO_BEM   || "",
      detalhe: b.DETALHE_BEM          || "",
      valor:   parseFloat(b.VALOR_BEM || 0),
    })).sort((a, b) => b.valor - a.valor);

    const totalPatrimonio = bens.reduce((s, b) => s + b.valor, 0);
    return new Response(
      JSON.stringify({ bens, total: bens.length, totalPatrimonio, fonte: "CEPESP" }),
      { headers: OUT_HDR }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message, bens: [] }),
      { status: 500, headers: OUT_HDR }
    );
  }
}
