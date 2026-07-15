#version 300 es
// main target 内部 copy 用的全屏顶点着色器。
// 输入顶点已是裁剪空间坐标，这里只生成对应 UV。
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
