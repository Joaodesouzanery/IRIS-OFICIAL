"use client";

import { useState } from "react";
import { BarChart2, TrendingUp, PieChart, LineChart } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChartType = "bar" | "area" | "pie" | "line";

interface ChartWrapperProps {
  title: string;
  subtitle?: string;
  availableTypes?: ChartType[];
  defaultType?: ChartType;
  children: (type: ChartType) => React.ReactNode;
  className?: string;
  titleExtra?: React.ReactNode;
}

const TYPE_ICONS: Record<ChartType, React.ElementType> = {
  bar:  BarChart2,
  area: TrendingUp,
  pie:  PieChart,
  line: LineChart,
};

const TYPE_LABELS: Record<ChartType, string> = {
  bar:  "Barras",
  area: "Área",
  pie:  "Pizza",
  line: "Linha",
};

export function ChartWrapper({
  title,
  subtitle,
  availableTypes = ["bar", "area", "pie"],
  defaultType,
  children,
  className,
  titleExtra,
}: ChartWrapperProps) {
  const [type, setType] = useState<ChartType>(defaultType ?? availableTypes[0]);

  return (
    <div className={cn("card p-3 overflow-hidden", className)}>
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-secondary leading-tight truncate">{title}</p>
          {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
          {titleExtra}
        </div>

        {availableTypes.length > 1 && (
          <div className="flex items-center gap-0.5 bg-bg-hover rounded-md p-0.5 shrink-0">
            {availableTypes.map((t) => {
              const Icon = TYPE_ICONS[t];
              return (
                <button
                  key={t}
                  title={TYPE_LABELS[t]}
                  onClick={() => setType(t)}
                  className={cn(
                    "p-1.5 rounded transition-colors",
                    type === t
                      ? "bg-brand text-white shadow-sm"
                      : "text-text-muted hover:text-text-secondary hover:bg-bg-card"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {children(type)}
    </div>
  );
}
