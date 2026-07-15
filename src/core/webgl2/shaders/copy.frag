#version 300 es
// main target 内部 copy 用的片元着色器。
// 不做混合或变换，只把源纹理逐像素写到目标 framebuffer。
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_texture;

void main() {
  outColor = texture(u_texture, v_uv);
}
