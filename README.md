# 🕵️ AntiCorrupção.BR

Ferramenta pública de fiscalização que cruza dados do Portal da Transparência, TSE, Diário Oficial e listas negras para detectar automaticamente padrões de corrupção em gastos de políticos.

## 🚨 Alertas automáticos detectados

- 📈 **Gasto acima da média histórica** — compara com últimos 3 anos
- 🤝 **Doador virou contratado** — cruza TSE x Portal da Transparência  
- 🏢 **Empresa suspeita** — verifica no CEIS, CNEP e listas negras
- 💰 **Salto patrimonial** — compara declarações TSE ano a ano

## 🛠️ Como rodar localmente

```bash
# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Edite o .env com suas chaves de API

# Iniciar em desenvolvimento
npm start
```

## 🔑 APIs utilizadas

| API | Descrição | Cadastro |
|-----|-----------|---------|
| Portal da Transparência | Gastos e contratos públicos | [portaldatransparencia.gov.br/api](https://portaldatransparencia.gov.br/api) |
| TSE Dados Abertos | Doações eleitorais e patrimônio | [dadosabertos.tse.jus.br](https://dadosabertos.tse.jus.br) |
| Anthropic Claude | Análise de documentos por IA | [console.anthropic.com](https://console.anthropic.com) |

## 📋 Roadmap

- [x] MVP — Interface completa + análise de documentos por IA
- [ ] Integração real com API Portal da Transparência
- [ ] Cruzamento TSE x contratos
- [ ] Sistema de alertas automáticos via e-mail
- [ ] Deploy público

## 📄 Licença

MIT — Use, modifique e distribua livremente.
