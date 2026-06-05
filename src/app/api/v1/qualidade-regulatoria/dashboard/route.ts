import { NextRequest, NextResponse } from "next/server";
import { loadQualidadeDashboardData } from "@/lib/server/qualidade-regulatoria-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get("ano") ?? new Date().getFullYear());
  const dashboard = await loadQualidadeDashboardData(year);
  return NextResponse.json(dashboard);
}
