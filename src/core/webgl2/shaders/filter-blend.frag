#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_source;
uniform sampler2D u_filtered;
uniform float u_intensity;

void main() {
  vec4 sourceColor = texture(u_source, v_uv);
  vec4 filteredColor = texture(u_filtered, v_uv);
  float intensity = clamp(u_intensity, 0.0, 1.0);
  outColor = mix(sourceColor, filteredColor, intensity);
}
