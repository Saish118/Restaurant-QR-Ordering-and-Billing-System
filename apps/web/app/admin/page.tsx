import type { Metadata } from "next";
import Workspace from "../../components/workspace";
export const metadata: Metadata = {
  title: "Tablehouse · Platform administrator",
};
export default function AdminPage() {
  return <Workspace platformPanel />;
}
