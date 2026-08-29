"use client";
import { useState } from "react";

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.assign("/login");
      }}
      disabled={busy}
      className="mt-1 text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
    >
      Sign out
    </button>
  );
}
