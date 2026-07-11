import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { Role } from "@/lib/types";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { rows } = await query<{ email: string }>(
    "select email from users where id = $1",
    [user.id]
  );

  return NextResponse.json({
    data: { id: user.id, role: user.role as Role, email: rows[0]?.email ?? "" },
  });
}
