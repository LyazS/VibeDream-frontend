#version 300 es
// item composite 顶点着色器。
// 把局部 quad 变换到时间轴坐标系，并同时生成 overlay/main 采样坐标。
precision highp float;

in vec2 a_position;
out vec2 v_mainUv;
out vec2 v_overlayUv;

uniform vec2 u_resolution;
uniform vec2 u_translation;
uniform vec2 u_scale;
uniform float u_rotation;

void main() {
  v_overlayUv = vec2(
    a_position.x + 0.5,
    a_position.y + 0.5
  );

  vec2 scaled = a_position * u_scale;
  float s = sin(u_rotation);
  float c = cos(u_rotation);
  vec2 rotated = vec2(
    scaled.x * c - scaled.y * s,
    scaled.x * s + scaled.y * c
  );

  vec2 screen = rotated + u_translation + (u_resolution * 0.5);
  vec2 clip = vec2(
    (screen.x / u_resolution.x) * 2.0 - 1.0,
    // timeline/item 坐标系切到 Y 向上为正后，这里与 clip space 的 Y 方向保持一致。
    (screen.y / u_resolution.y) * 2.0 - 1.0
  );

  v_mainUv = vec2(
    clip.x * 0.5 + 0.5,
    // u_main 是上一轮写入 FBO 的主画面纹理，这里按 clip -> UV 正向映射读取。
    clip.y * 0.5 + 0.5
  );
  gl_Position = vec4(clip, 0.0, 1.0);
}
