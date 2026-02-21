"use client";

import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const supabase = useMemo(() => createClient(), []);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    const cleanEmail = email.trim();

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
      });

      if (error) {
        setError(error.message);
      } else {
        setMessage("Bruger oprettet. Log ind med din email og password.");
        setMode("signin");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        setError(error.message);
      } else {
        const params = new URLSearchParams(window.location.search);
        const nextPath = params.get("next") || "/cookbook";
        window.location.href = nextPath;
        return;
      }
    }

    setLoading(false);
  }

  return (
    <main style={{ maxWidth: 480, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Login</h1>
      <p style={{ marginBottom: 16 }}>
        Log ind for at gemme opskrifter i Min kogebog.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => {
            setMode("signin");
            setMessage(null);
            setError(null);
          }}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #111",
            background: mode === "signin" ? "#eee" : "transparent",
            cursor: "pointer",
          }}
        >
          Log ind
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("signup");
            setMessage(null);
            setError(null);
          }}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #111",
            background: mode === "signup" ? "#eee" : "transparent",
            cursor: "pointer",
          }}
        >
          Opret bruger
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="din@email.dk"
          required
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #ccc",
            width: "100%",
          }}
        />

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          minLength={6}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #ccc",
            width: "100%",
          }}
        />

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #111",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading
            ? "Arbejder..."
            : mode === "signup"
            ? "Opret bruger"
            : "Log ind"}
        </button>
      </form>

      {message && (
        <p style={{ marginTop: 12, color: "green" }}>
          {message}
        </p>
      )}

      {error && (
        <p style={{ marginTop: 12, color: "crimson" }}>
          {error}
        </p>
      )}
    </main>
  );
}
