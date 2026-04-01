#version 300 es
precision highp float;

in vec2 v_mainUv;
in vec2 v_overlayUv;
out vec4 outColor;

uniform sampler2D u_main;
uniform sampler2D u_overlay;
uniform float u_opacity;

float safeDivide(float numerator, float denominator) {
  return denominator <= 0.00001 ? 1.0 : clamp(numerator / denominator, 0.0, 1.0);
}

vec3 blend(vec3 base, vec3 overlay) {
  return vec3(
    overlay.r <= 0.00001 ? 0.0 : 1.0 - safeDivide(1.0 - base.r, overlay.r),
    overlay.g <= 0.00001 ? 0.0 : 1.0 - safeDivide(1.0 - base.g, overlay.g),
    overlay.b <= 0.00001 ? 0.0 : 1.0 - safeDivide(1.0 - base.b, overlay.b)
  );
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
