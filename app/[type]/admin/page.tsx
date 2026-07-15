import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import AdminView from "@/components/AdminView";

export default async function TypedAdminPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  // map/spots/accountと違い enabled では絞り込まない。無効化した種類を
  // 管理画面から再度有効化できなくなってしまうため
  const { rows } = await query("select 1 from spot_types where key = $1", [type]);
  if (!rows[0]) notFound();

  return <AdminView typeKey={type} />;
}
