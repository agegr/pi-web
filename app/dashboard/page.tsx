import type { Metadata } from "next";
import { Dashboard } from "@/components/robin/Dashboard";

export const metadata: Metadata = {
  title: "Dashboard — Pi Web",
};

export default function DashboardPage() {
  return <Dashboard />;
}
