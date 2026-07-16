import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { isGoogleConfigured } from "@/lib/auth/google";

export async function GET() {
  const { rows } = await query<{ exists: boolean }>(
    "select exists(select 1 from users) as exists"
  );
  return NextResponse.json({
    hasUser: rows[0].exists,
    googleEnabled: isGoogleConfigured(),
  });
}
