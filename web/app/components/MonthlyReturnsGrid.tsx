const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

interface YearData {
  year: number;
  months: (number | null)[];
  annual: number | null;
  current?: boolean;
}

interface Props {
  data: YearData[];
}

function fmt(v: number | null): { text: string; color: string } {
  if (v === null) return { text: '—', color: 'text-dim/40' };
  const text = `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const color = v > 0 ? 'text-gain' : v < 0 ? 'text-loss' : 'text-dim';
  return { text, color };
}

export default function MonthlyReturnsGrid({ data }: Props) {
  return (
    <div className="bg-panel border border-rim rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-rim">
        <h2 className="text-sm font-semibold text-ink">Monthly Returns</h2>
        <p className="text-xs text-dim mt-0.5">Net returns by month · current year highlighted</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rim">
              <th className="text-left text-xs text-dim font-medium px-5 py-3 w-16">Year</th>
              {MONTHS.map(m => (
                <th key={m} className="text-right text-xs text-dim font-medium px-3 py-3 w-20">{m}</th>
              ))}
              <th className="text-right text-xs text-dim font-medium px-5 py-3 w-20">Year</th>
            </tr>
          </thead>
          <tbody>
            {data.map(row => {
              const annual = fmt(row.annual);
              return (
                <tr
                  key={row.year}
                  className={`border-b border-rim/40 ${row.current ? 'bg-gain/[0.04]' : ''}`}
                >
                  <td className={`px-5 py-4 font-mono text-sm font-semibold ${row.current ? 'text-gain' : 'text-dim'}`}>
                    {row.year}
                  </td>
                  {row.months.map((v, i) => {
                    const { text, color } = fmt(v);
                    return (
                      <td key={i} className={`px-3 py-4 text-right font-mono text-sm ${color}`}>
                        {text}
                      </td>
                    );
                  })}
                  <td className={`px-5 py-4 text-right font-mono text-sm font-semibold ${annual.color}`}>
                    {annual.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
