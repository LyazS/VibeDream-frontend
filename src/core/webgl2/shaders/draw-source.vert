#version 300 es
// item source copy 顶点着色器。
// 直接把 fullscreen quad 转成 [0,1] UV，用于复制 source texture。

in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
