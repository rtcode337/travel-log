import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { PREFECTURES } from "@/lib/types";
import { DEFAULT_REGION_SCOPE, isValidRegionScope } from "@/lib/region";

interface NominatimReverseResult {
  address?: {
    country?: string;
    state?: string;
    province?: string;
    city?: string;
    city_district?: string;
    town?: string;
    village?: string;
    county?: string;
    "ISO3166-2-lvl4"?: string;
  };
}

/**
 * NominatimはJPの都道府県名を state/province のどちらで返すか一定しない
 * (例: 東京はどちらも無くISO3166-2-lvl4のみ、石川はprovince、等)。
 * ISO3166-2-lvl4("JP-13"のようなコード)はJIS X 0401の都道府県番号と一致し、
 * PREFECTURESの並び順(北海道=1〜沖縄=47)ともそのまま対応するため、
 * これを最優先の情報源として使う。
 */
function resolveJpPrefecture(
  address: NominatimReverseResult["address"]
): string | null {
  const isoCode = address?.["ISO3166-2-lvl4"];
  const match = isoCode?.match(/^JP-(\d{2})$/);
  if (match) {
    const prefecture = PREFECTURES[Number(match[1]) - 1];
    if (prefecture) return prefecture;
  }
  return address?.state ?? address?.province ?? null;
}

/**
 * スポット種別の対象地域スコープ(region_scope)に応じて、spots.prefecture列に
 * 入れる「地域」を解決する。'jp'=都道府県、'world'=国名、国コード=州・県
 * (国により state/province/county のどれで返るかまちまちなため順に試す)
 */
function resolveRegion(
  address: NominatimReverseResult["address"],
  scope: string
): string | null {
  if (scope === "jp") return resolveJpPrefecture(address);
  if (scope === "world") return address?.country ?? null;
  return address?.state ?? address?.province ?? address?.county ?? null;
}

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  if (!lat || !lng) {
    return NextResponse.json({ error: "lat, lng is required" }, { status: 400 });
  }
  const scopeParam = searchParams.get("scope");
  const scope =
    scopeParam && isValidRegionScope(scopeParam) ? scopeParam : DEFAULT_REGION_SCOPE;

  const url =
    "https://nominatim.openstreetmap.org/reverse?" +
    new URLSearchParams({
      lat,
      lon: lng,
      format: "json",
      "accept-language": "ja",
      zoom: "14",
    });

  const res = await fetch(url, {
    headers: {
      // Nominatimの利用ポリシー上、識別可能なUser-Agentが必要
      "User-Agent": "travel-log-personal-app/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    return NextResponse.json({ error: "逆ジオコーディングに失敗しました" }, { status: 502 });
  }
  const result: NominatimReverseResult = await res.json();
  const address = result.address ?? {};

  return NextResponse.json({
    data: {
      region: resolveRegion(address, scope),
      // 東京23区は city_district(区)、それ以外は city/town/village のどれかに入る
      municipality:
        address.city_district ?? address.city ?? address.town ?? address.village ?? null,
    },
  });
}
