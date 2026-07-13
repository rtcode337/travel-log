import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import AdminView from "@/components/AdminView";

export default async function TypedAdminPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const { rows } = await query("select 1 from spot_types where key = $1", [type]);
  if (!rows[0]) notFound();

  return <AdminView typeKey={type} />;
}
