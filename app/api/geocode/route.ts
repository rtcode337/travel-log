import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/current-user";

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q,
      format: "json",
      limit: "5",
      countrycodes: "jp",
    });

  const res = await fetch(url, {
    headers: {
      // Nominatimの利用ポリシー上、識別可能なUser-Agentが必要
      "User-Agent": "travel-log-personal-app/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    return NextResponse.json({ error: "検索に失敗しました" }, { status: 502 });
  }
  const results: NominatimResult[] = await res.json();

  return NextResponse.json({
    data: results.map((r) => ({
      name: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
    })),
  });
}
