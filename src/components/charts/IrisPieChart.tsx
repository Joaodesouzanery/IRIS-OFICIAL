"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface PieData {
  name: string;
  value: number;
  color?: string;
}

interface IrisPieChartProps {
  data: PieData[];
  height?: number;
  innerRadius?: number;
  showLegend?: boolean;
}

const DEFAULT_COLORS = ["#f97316", "#3b82f6", "#22c55e", "#8b5cf6", "#ef4444", "#06b6d4"];

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-bg-card border border-border rounded-md px-3 py-2 text-sm shadow-xl">
      <p className="text-text-secondary mb-1 font-mono text-xs">{payload[0].name}</p>
      <p className="text-text-primary font-mono font-semibold">{payload[0].value}</p>
      <p className="text-text-muted font-mono text-xs">
        {payload[0].payload.pct ? `${payload[0].payload.pct}%` : ""}
      </p>
    </div>
  );
};

export function IrisPieChart({
  data,
  height = 220,
  innerRadius = 60,
  showLegend = true,
}: IrisPieChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const enriched = data.map((d) => ({
    ...d,
    pct: total > 0 ? ((d.value / total) * 100).toFixed(1) : "0",
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={enriched}
          cx="50%"
          cy={showLegend ? "44%" : "50%"}
          innerRadius={innerRadius}
          outerRadius={innerRadius + 34}
          paddingAngle={3}
          dataKey="value"
        >
          {enriched.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              stroke="transparent"
            />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        {showLegend && (
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value) => {
              const label = String(value);
              return label.length > 18 ? `${label.slice(0, 17)}…` : label;
            }}
            wrapperStyle={{
              fontSize: "11px",
              fontFamily: "JetBrains Mono, monospace",
              color: "#a1a1aa",
              paddingTop: "4px",
              lineHeight: "16px",
            }}
          />
        )}
      </PieChart>
    </ResponsiveContainer>
  );
}
