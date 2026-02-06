export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Qartigo</h1>
      <p style={{ fontSize: 16, marginBottom: 24 }}>

      </p>

      <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Step 1</h2>
        <p style={{ marginBottom: 12 }}>Upload et billede af dit køleskab.</p>
Foto af køleskab til ugeplan og indkøbsliste.

        <input type="file" accept="image/*" />

        <div style={{ marginTop: 16, fontSize: 14, opacity: 0.8 }}>
          (I næste step kobler vi upload til et API-endpoint.)
        </div>
      </section>
    </main>
  );
}

