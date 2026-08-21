import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard/painel-regulatorio"); // Observatório = porta de entrada (ago/2026)
}
