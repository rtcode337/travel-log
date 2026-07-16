import { notFound } from "next/navigation";
import { canViewSpotType } from "@/lib/spot-type-access";
import AccountView from "@/components/AccountView";

export default async function TypedAccountPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (!(await canViewSpotType(type))) notFound();

  return <AccountView typeKey={type} />;
}
