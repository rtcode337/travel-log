import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import AccountView from "@/components/AccountView";

export default async function TypedAccountPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const { rows } = await query(
    "select 1 from spot_types where key = $1 and enabled",
    [type]
  );
  if (!rows[0]) notFound();

  return <AccountView typeKey={type} />;
}
