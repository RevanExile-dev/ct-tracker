import { ImageResponse } from "next/og";

export const alt = "Carta Viva — la tua collezione TCG";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(circle at 20% 20%, #123834 0, #0d0f12 48%), radial-gradient(circle at 82% 75%, #35152f 0, #0d0f12 50%)", color: "#f5f3ee", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
        <div style={{ width: 210, height: 292, borderRadius: 24, transform: "rotate(-7deg)", border: "6px solid #2dd8c9", background: "linear-gradient(145deg,#151b20,#251527)", boxShadow: "24px 28px 60px #0008", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 70, fontWeight: 800, color: "#f8e9a3" }}>CV</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 94, fontWeight: 800, letterSpacing: -5 }}><span style={{ color: "#6ae7dc" }}>Carta</span><span style={{ color: "#ef83dc" }}>Viva</span></div>
          <div style={{ fontSize: 32, color: "#a8adb3", maxWidth: 650 }}>La tua collezione, finalmente viva.</div>
          <div style={{ marginTop: 28, fontSize: 22, color: "#62d8ce", letterSpacing: 4 }}>PREZZI · MOVIMENTI · BINDER</div>
        </div>
      </div>
    </div>,
    size
  );
}
