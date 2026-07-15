#version 300 es
// 媒体朝向修正片元着色器。
// 直接按旋转后的几何位置采样原始 source texture。
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_source;

void main() {
  outColor = texture(u_source, vec2(v_uv.x, 1.0 - v_uv.y));
}
