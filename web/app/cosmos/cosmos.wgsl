struct Params {
  resolution: vec2f,
  pointer: vec2f,
  time: f32,
  energy: f32,
}

@group(0) @binding(0) var<uniform> params: Params;

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn spectral(t: f32) -> vec3f {
  let a = vec3f(0.48, 0.48, 0.52);
  let b = vec3f(0.46, 0.42, 0.40);
  let c = vec3f(1.0, 1.0, 1.0);
  let d = vec3f(0.02, 0.34, 0.67);
  return a + b * cos(6.28318 * (c * t + d));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let safeHeight = max(params.resolution.y, 1.0);
  let aspect = params.resolution.x / safeHeight;
  var p = (uv - 0.5) * vec2f(aspect, 1.0);
  let mouse = (params.pointer - 0.5) * vec2f(aspect, 1.0);
  p -= mouse * 0.075;

  let radius = length(p);
  let angle = atan2(p.y, p.x);
  let pulse = 0.5 + 0.5 * sin(params.time * 0.42);

  var color = vec3f(0.008, 0.012, 0.026);
  let core = exp(-radius * 2.35) * (0.18 + pulse * 0.035);
  color += spectral(angle / 6.28318 + params.time * 0.014) * core;

  let ribbonA = abs(p.y + 0.17 * sin(p.x * 3.8 + params.time * 0.28));
  let ribbonB = abs(p.y - 0.22 * sin(p.x * 2.6 - params.time * 0.21) + 0.10);
  color += vec3f(0.02, 0.55, 0.62) * exp(-ribbonA * 18.0) * 0.08 * params.energy;
  color += vec3f(0.62, 0.03, 0.45) * exp(-ribbonB * 20.0) * 0.07 * params.energy;

  let cell = floor((uv * params.resolution) / 5.0);
  let sparkleSeed = hash21(cell);
  let sparkle = select(0.0, pow(sin(params.time * (0.8 + sparkleSeed * 1.8) + sparkleSeed * 40.0) * 0.5 + 0.5, 12.0), sparkleSeed > 0.994);
  color += spectral(sparkleSeed) * sparkle * 0.36;

  let ring = exp(-abs(radius - (0.24 + 0.012 * sin(params.time * 0.5))) * 120.0);
  color += spectral(angle / 6.28318 + params.time * 0.025) * ring * 0.075 * params.energy;

  let vignette = smoothstep(0.95, 0.18, length((uv - 0.5) * vec2f(0.82, 1.0)));
  color *= 0.38 + vignette * 0.84;
  return vec4f(color, 1.0);
}
