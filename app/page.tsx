// The card is data-driven: values come from `?data=<url-encoded JSON>` (see
// scripts/render-card.mjs). When no data is supplied it renders DEFAULT_SAMPLE
// so the page still shows a card standalone.

type CardData = {
  won: boolean;
  outcomeWord: string; // big RESULT word, e.g. "Yes" / "No"
  marketTitle: string;
  marketSubtitle: string;
  statusLine: string; // "Market resolved" | "Position open"
  pnl: number; // signed
  currency: string; // "USDC"
  roiPercent: number; // signed
  statusLabel: string; // "Won" | "Lost" | "Open"
};

const DEFAULT_SAMPLE: CardData = {
  won: true,
  outcomeWord: "Yes",
  marketTitle: "Spain beats Belgium",
  marketSubtitle: "World Cup 2026 · Jul 10, 2026",
  statusLine: "Market resolved",
  pnl: 6.52,
  currency: "USDC",
  roiPercent: 32.6,
  statusLabel: "Won",
};

function fmtPnl(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

function fmtRoi(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}

function parseData(raw: unknown): CardData {
  if (typeof raw !== "string") return DEFAULT_SAMPLE;
  try {
    return { ...DEFAULT_SAMPLE, ...(JSON.parse(raw) as Partial<CardData>) };
  } catch {
    return DEFAULT_SAMPLE;
  }
}

function Planet({ small = false }: { small?: boolean }) {
  return (
    <span
      className={small ? "planet planet--small" : "planet planet--large"}
      aria-hidden="true"
    >
      <img className="planet-art" src="/world-planet-cutout.png" alt="" />
    </span>
  );
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Home({
  searchParams,
}: {
  searchParams?: SearchParams | Promise<SearchParams>;
}) {
  const sp = searchParams ? await searchParams : {};
  const data = parseData(sp.data);

  return (
    <main className="page-shell">
      <article
        className={"result-card" + (data.won ? "" : " result-card--negative")}
        aria-label={
          data.won
            ? "World market result card"
            : "World negative market result card"
        }
      >
        <div className="grid-field" aria-hidden="true" />
        <div className="corner-glow" aria-hidden="true" />

        <section className="content-column">
          <header className="brand" aria-label="World">
            <Planet small />
            <span className="brand-name">world</span>
          </header>

          <div className="result-block">
            <p className="eyebrow">Result</p>
            <div className="result-line">
              <strong>{data.outcomeWord}</strong>
              {data.won ? (
                <span className="check" aria-label="Resolved successfully">
                  <img className="check-icon" src="/checkmark-badge.png" alt="" />
                </span>
              ) : (
                <span
                  className="check check--negative"
                  aria-label="Resolved negatively"
                >
                  ×
                </span>
              )}
            </div>
            <p className="market-title">{data.marketTitle}</p>
            <p className="market-sub">{data.marketSubtitle}</p>
            <p className="muted">{data.statusLine}</p>
          </div>

          <div className="divider" />

          <div className="pnl-block">
            <p className="eyebrow">Your PNL</p>
            <div className="pnl-row">
              <p className="pnl-value">
                {fmtPnl(data.pnl)} <span>{data.currency}</span>
              </p>
              <p className="roi">
                <span>ROI</span> {fmtRoi(data.roiPercent)}
              </p>
            </div>
          </div>
        </section>

        <section className="visual-column" aria-hidden="true">
          <Planet />
        </section>

        <div
          className="status-pill"
          aria-label={`Outcome: ${data.statusLabel.toLowerCase()}`}
        >
          <span className="status-dot" />
          <span>{data.statusLabel}</span>
        </div>
      </article>
    </main>
  );
}
