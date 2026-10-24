# Identidade visual VBM

Referência viva: `COO - Dashboard/index.html` (ramo atual; layout aprovado com dados de exemplo) (padrão de gráficos do VBM Performance Hub,
layout aprovado do COO Dashboard). Copie os blocos de CSS/JS de lá.

## Tipografia
- **Poppins** em tudo (300, 400, 500, 600 e itálico 300/400/500), via Google Fonts, com
  fallback `'Segoe UI', system-ui, sans-serif`.
- Títulos em itálico leve: título do dashboard `italic 300`, 1.7–2.5rem, cor `--accent`;
  nome da unidade/site `italic 400` 2rem (1.5rem até 1600 px), cor `--accent`;
  títulos de painel (`Production Drivers`) `italic 400` 1.18rem; rótulos de filtro `italic .74rem`.
- Título do gráfico 1rem `--chart-title`; unidade `(Mt)` .74rem `--text-faint`.
- Números com `font-variant-numeric: tabular-nums`; formato pt-BR (vírgula decimal).

## Cores (tokens)
| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--page` | `#FFFFFF` | `#06192B` | fundo |
| `--text` / `--text-soft` / `--text-faint` | `#1F2937` / `#6B7280` / `#9CA3AF` | `#E8EEF5` / 66% / 42% | textos |
| `--line` | `#E5E7EB` | `rgba(255,255,255,.10)` | divisórias |
| `--accent` | `#1E8FC4` | `#5CC6EE` | título e unidade (só ≥24 px no claro) |
| `--accent-strong` / `--ctl-on-bg` | `#0B6E99` | `#7DD3F0` / `#3CB5E5` | seleção, foco |
| `--panel` | `#F3F4F5` | `#0C2438` | painel cinza (Production) |
| `--chart-title` | `#1B7F7B` | `#5FD0C9` | título dos gráficos |
| `--serie-b` (Budget) | `#BCBEC0` | `#8E949B` | barra cinza |
| `--serie-a` (Actual/Forecast) | `#3CB5E5` | `#3CB5E5` | barra azul |
| `--good` / `--bad` / `--flat` | `#007E7A` / `#B91C1C` / `#5B5E61` | `#34C3B8` / `#F87171` / `#B0B5BA` | delta favorável/desfavorável/neutro |
| `--nav-bg` | gradiente `#041523 → #072842 → #0b3a64` | igual | barra azul (só dentro do Hub) |

Barras com gradiente vertical: Budget `#CBCDCF → #BCBEC0 → #B2B4B6`;
Actual/Forecast `#62C6EC → #3CB5E5 → #36A9D8`. Tema escuro por tokens em
`@media (prefers-color-scheme: dark)` + `:root[data-theme="dark"]`, com botão de tema.

## Layout da tela de dashboard
- Tela única, sem rolagem a partir de 1440×860; tela cheia (botão + F11) com o mesmo arranjo.
- Cabeçalho: título à esquerda; filtros à direita alinhados à linha dos botões
  (Unidade, Visão, Ano, Trimestre, Mês, Delta) + botões de tela cheia e tema.
- Linha abaixo: nome da unidade à esquerda; legenda Budget / Forecast | Actual e
  "Last updated" (com o selo de origem dos dados) à direita.
- Dois painéis: Production Drivers (fundo `--panel`, raio 20 px, 3 colunas) e Financial
  Drivers (sobre o branco, 2 colunas). Linhas de gráficos alinhadas entre os painéis.
- Altura dos gráficos calculada para as três linhas caberem (até 190 px, nunca esticar);
  sobra vira espaço entre linhas (80%) e rodapé. Títulos colados ao gráfico.
- Sem fundo e sem borda por gráfico (testado e descartado).

## Controles
- Segmentados (`.seg`): pílula com borda `--ctl-border`, botão ativo `--ctl-on-bg`.
- Unidade: drill-down País › Site (botão "Brasil › Sossego", painel com duas colunas;
  fecha ao escolher, ao clicar fora e com Esc).
- Delta: interruptor liga/desliga sem texto (`role="switch"`, `aria-checked`).
- Seletores dentro do card (Cu/Au, All-in/By Product/Sustaining/Cost): mudam também o
  título do card (ex.: "Gold Feed Grade", "All-in | Cost").

## Gráfico de barras (padrão Performance Hub)
- Três pares B × A/F: mês, trimestre e ano. Rótulos `Set B`, `Set A`, `Q3B`, `Q3A`, `26B`, `26F`
  (A/F vêm dos dados). Escala única por gráfico; indicadores em % com folga (coluna maior ≈72%).
- Valor acima de cada barra. Delta entre as barras do par: linha tracejada no nível do
  Budget, linha sólida no Actual, faixa (hachurada quando cai), haste e selo com a diferença
  **simples** (A/F − B, unidade e casas do indicador, sem % nem p.p.).
- Cor do delta pela polaridade do indicador: custo (COGS, CAPEX, All-in) — cair é favorável.
- Animação de entrada nas barras e no delta; respeita `prefers-reduced-motion`.

## Acessibilidade
- Foco visível (`--focus`), `aria-pressed` nos segmentados, `aria-label` descritivo em cada SVG
  (período, Budget, Actual/Forecast, variação), tooltip nas barras.
- Contraste: `--accent` só em textos grandes; textos pequenos usam `--accent-strong` ou `--text`.
