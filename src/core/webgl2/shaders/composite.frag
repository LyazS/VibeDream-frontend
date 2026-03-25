#version 300 es
// straight alpha 的 normal/alpha over 合成：
// overlay 按 item 几何配置覆盖在 base 上，结果写回主画面 write target。
// 这里按 straight alpha 计算，不按 premultiplied alpha 解释 overlay.rgb。
precision highp float;

in vec2 v_mainUv;
in vec2 v_overlayUv;
out vec4 outColor;

uniform sampler2D u_main;
uniform sampler2D u_overlay;
uniform float u_opacity;

void main() {
  vec4 base = texture(u_main, v_mainUv);
  vec4 overlay = texture(u_overlay, v_overlayUv);
  overlay.a *= u_opacity;
  vec3 rgb = overlay.rgb * overlay.a + base.rgb * (1.0 - overlay.a);
  float alpha = overlay.a + base.a * (1.0 - overlay.a);
  outColor = vec4(rgb, alpha);
}
