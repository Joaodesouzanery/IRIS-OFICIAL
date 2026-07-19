"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from "recharts";
import { getMicrotemaColor, getMicrotemaLabel } from "@/lib/utils";

interface BarData {
  name: string;
  value: number;
  [key: string]: string | number;
}

interface IrisBarChartProps {
  data: BarData[];
  dataKey?: string;
  xKey?: string;
  color?: string;
  useMicrotemaColors?: boolean;
  height?: number;
  horizontal?: boolean;
  formatLabel?: (name: string) => string;
  multibar?: Array<{ key: string; color: string; label: string }>;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-bg-card border border-border rounded-md px-3 py-2 text-sm shadow-xl">
      <p className="text-text-secondary mb-1 font-mono text-xs">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-text-primary font-mono font-medium">{entry.value}</span>
          {entry.name && entry.name !== "value" && (
            <span className="text-text-muted text-xs">{entry.name}</span>
          )}
        </div>
      ))}
    </div>
  );
};

export function IrisBarChart({
  data,
  dataKey = "value",
  xKey = "name",
  color = "#f97316",
  useMicrotemaColors = false,
  height = 220,
  horizontal = false,
  formatLabel,
  multibar,
}: IrisBarChartProps) {
  const fmt = formatLabel ?? ((n: string) => getMicrotemaLabel(n));

  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" horizontal={false} />
          <XAxis type="number" tick={{ fill: "#71717a", fontSize: 11, fontFamily: "JetBrains Mono" }} />
          <YAxis
            type="category"
            dataKey={xKey}
            width={130}
            tick={{ fill: "#a1a1aa", fontSize: 11, fontFamily: "JetBrains Mono" }}
            tickFormatter={fmt}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey={dataKey} radius={[0, 4, 4, 0]} maxBarSize={24}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={useMicrotemaColors ? getMicrotemaColor(entry[xKey] as string) : color}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fill: "#71717a", fontSize: 11, fontFamily: "JetBrains Mono" }}
          tickFormatter={fmt}
        />
        <YAxis tick={{ fill: "#71717a", fontSize: 11, fontFamily: "JetBrains Mono" }} />
        <Tooltip content={<CustomTooltip />} />
        {multibar ? (
          <>
            <Legend
              wrapperStyle={{ paddingTop: "8px", fontSize: "11px", fontFamily: "JetBrains Mono" }}
            />
            {multibar.map((b) => (
              <Bar key={b.key} dataKey={b.key} fill={b.color} name={b.label} radius={[3, 3, 0, 0]} maxBarSize={32} />
            ))}
          </>
        ) : (
          <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} maxBarSize={40}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={useMicrotemaColors ? getMicrotemaColor(entry[xKey] as string) : color}
              />
            ))}
          </Bar>
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
