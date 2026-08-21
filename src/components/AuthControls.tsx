"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogIn, LogOut, Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useViewer } from "@/lib/use-viewer";

const HAS_SUPABASE = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export function AuthControls() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!HAS_SUPABASE) return;
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!HAS_SUPABASE) return null;

  async function signOut() {
    setBusy(true);
    try {
      await createSupabaseBrowserClient().auth.signOut();
      setUserEmail(null);
    } finally {
      setBusy(false);
    }
  }

  if (userEmail) {
    return (
      <div className="flex items-center gap-2">
        <ViewerBadge />
        <span className="hidden lg:inline text-xs text-text-muted max-w-[180px] truncate">{userEmail}</span>
        <button className="btn-secondary text-xs" onClick={signOut} disabled={busy}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
          Sair
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link className="btn-secondary text-xs" href="/login">
        <LogIn className="w-3.5 h-3.5" />
        Entrar
      </Link>
    </div>
  );
}

// Selo do papel do usuário (ago/2026): viewer vê "Visualização" ao lado do e-mail.
function ViewerBadge() {
  const { isViewer, carregando } = useViewer();
  if (carregando || !isViewer) return null;
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
      Visualização
    </span>
  );
}
