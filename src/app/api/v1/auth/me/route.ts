import { NextRequest, NextResponse } from "next/server";
import { adminUsersCount, getAuthenticatedUser, isAdminUser } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userResult = await getAuthenticatedUser(req);
  if (userResult instanceof NextResponse) return userResult;

  const [isAdmin, adminCount] = await Promise.all([
    isAdminUser(userResult),
    adminUsersCount(),
  ]);

  return NextResponse.json({
    user: userResult,
    is_admin: isAdmin,
    can_bootstrap_owner: adminCount === 0,
  });
}
