#version 300 es
precision highp float;

in vec2 v_mainUv;
in vec2 v_overlayUv;
out vec4 outColor;

uniform sampler2D u_main;
uniform sampler2D u_overlay;
uniform float u_opacity;

vec3 blend(vec3 base, vec3 overlay) {
  vec3 low = 2.0 * base * overlay;
  vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - overlay);
  return mix(low, high, step(0.5, base));
}

void main() {
  vec4 base = texture(u_main, v_mainUv);
  vec4 overlay = texture(u_overlay, v_overlayUv);
  float effectiveOpacity = clamp(overlay.a * u_opacity, 0.0, 1.0);
  vec3 blended = blend(base.rgb, overlay.rgb);
  vec3 rgb = mix(base.rgb, blended, effectiveOpacity);
  float alpha = effectiveOpacity + base.a * (1.0 - effectiveOpacity);
  outColor = vec4(rgb, alpha);
}
