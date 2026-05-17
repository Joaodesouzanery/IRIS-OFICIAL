import { NextResponse } from "next/server";
import { getRuntimeStatus } from "@/lib/server/runtime-status";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const userDemo =
    req.headers.get("x-iris-demo") === "1" ||
    new URL(req.url).searchParams.get("demo") === "1";
  return NextResponse.json(getRuntimeStatus(userDemo));
}
