#version 300 es
// present pass：不再做任何效果，只把主画面纹理拷到默认 framebuffer。
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_texture;

void main() {
  outColor = texture(u_texture, v_uv);
}
