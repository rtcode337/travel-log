import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES, type Spot } from "@/lib/types";

const ALLOWED_STATUSES = ["published", "rejected", "pending"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { id } = await params;
  const { status } = await request.json();
  if (!ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const { rows } = await query<Spot>(
    "update spots set status = $1 where id = $2 returning *",
    [status, id]
  );
  return NextResponse.json({ data: rows[0] ?? null });
}
