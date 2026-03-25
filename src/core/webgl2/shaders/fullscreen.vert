#version 300 es
// 全屏 quad 顶点着色器。
// 输入顶点已是裁剪空间坐标，因此这里只需要顺手生成 [0,1] UV。
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
