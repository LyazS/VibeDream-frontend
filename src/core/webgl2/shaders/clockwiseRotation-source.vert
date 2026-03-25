#version 300 es
// 媒体朝向修正顶点着色器。
// 把局部 quad 旋转后再做一次 Y 轴翻转，绘制到中间 target 的中心位置。
precision highp float;

in vec2 a_position;
out vec2 v_uv;

uniform vec2 u_resolution;
uniform vec2 u_scale;
uniform int u_rotation;

void main() {
  v_uv = a_position + 0.5;

  vec2 scaled = a_position * u_scale;
  float s = 0.0;
  float c = 1.0;

  // u_rotation uses discrete clockwise angles: 0 / 90 / 180 / 270.
  if (u_rotation == 90) {
    s = -1.0;
    c = 0.0;
  } else if (u_rotation == 180) {
    s = 0.0;
    c = -1.0;
  } else if (u_rotation == 270) {
    s = 1.0;
    c = 0.0;
  }

  vec2 rotated = vec2(
    scaled.x * c - scaled.y * s,
    scaled.x * s + scaled.y * c
  );

  // RotateSourcePass 产出的中间纹理需要是正向图像，这里在旋转后额外翻转一次 Y。
  rotated.y = -rotated.y;

  vec2 screen = rotated + (u_resolution * 0.5);
  vec2 clip = vec2(
    (screen.x / u_resolution.x) * 2.0 - 1.0,
    1.0 - (screen.y / u_resolution.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
}
