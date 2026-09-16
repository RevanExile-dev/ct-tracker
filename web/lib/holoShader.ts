// Shader foil condiviso tra ThreeCardHero (card/[id], dietro ?three=1) e
// HomeHero3D (home, stesso flag): iridescenza dipendente dall'angolo di
// vista (termine Fresnel), come una carta foil reale che cattura la luce
// muovendosi - non un ciclo temporale continuo. Estratto qui per evitare di
// duplicare lo stesso GLSL in due componenti.

export const HOLO_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const HOLO_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float fresnel = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0), 2.2);
    vec3 iridescent = vec3(
      0.5 + 0.5 * sin(fresnel * 8.0 + vUv.x * 6.0),
      0.5 + 0.5 * sin(fresnel * 8.0 + vUv.x * 6.0 + 2.094),
      0.5 + 0.5 * sin(fresnel * 8.0 + vUv.x * 6.0 + 4.189)
    );
    vec3 color = mix(tex.rgb, tex.rgb + iridescent * fresnel * uIntensity, fresnel * uIntensity);
    gl_FragColor = vec4(color, tex.a);
  }
`;
