"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface LineData {
  name: string;
  /**
   * `null` é um valor LEGÍTIMO e significa "sem base para medir" (etapa65). O Recharts o desenha
   * como LACUNA na linha, que é exatamente a leitura certa — publicar 0 no lugar faria
   * "ninguém votou" parecer "colegiado em conflito total".
   */
  [key: string]: string | number | null;
}

interface IrisLineChartProps {
  data: LineData[];
  lines: Array<{ key: string; color: string; label: string }>;
  height?: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-bg-card border border-border rounded-md px-3 py-2 text-sm shadow-xl">
      <p className="text-text-muted font-mono text-xs mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-text-secondary text-xs">{entry.name}</span>
          <span className="text-text-primary font-mono font-medium">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

export function IrisLineChart({ data, lines, height = 220 }: IrisLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: "#71717a", fontSize: 11, fontFamily: "JetBrains Mono" }}
        />
        <YAxis tick={{ fill: "#71717a", fontSize: 11, fontFamily: "JetBrains Mono" }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: "11px", fontFamily: "JetBrains Mono", color: "#a1a1aa" }}
        />
        {lines.map((line) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            stroke={line.color}
            name={line.label}
            strokeWidth={2}
            dot={{ r: 3, fill: line.color, strokeWidth: 0 }}
            activeDot={{ r: 5, strokeWidth: 0 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
