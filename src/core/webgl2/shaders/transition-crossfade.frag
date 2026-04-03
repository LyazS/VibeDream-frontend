#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_fromTexture;
uniform sampler2D u_toTexture;
uniform float u_progress;

void main() {
  vec4 fromColor = texture(u_fromTexture, v_uv);
  vec4 toColor = texture(u_toTexture, v_uv);
  float progress = clamp(u_progress, 0.0, 1.0);
  outColor = mix(fromColor, toColor, progress);
}
