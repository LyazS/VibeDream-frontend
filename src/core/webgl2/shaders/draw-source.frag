#version 300 es
// 直接采样 source texture
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_source;

void main() {
  vec4 source = texture(u_source, v_uv);
  outColor = vec4(min(source.rgb, 1.0), source.a);
}
