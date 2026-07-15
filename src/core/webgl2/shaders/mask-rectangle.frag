#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_source;
uniform vec2 u_textureSize;
uniform vec2 u_center;
uniform float u_rotation;
uniform vec2 u_rectSize;
uniform float u_cornerRadius;
uniform float u_outerRange;
uniform float u_decayRate;
uniform bool u_inverted;

float sdRoundedRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float computeOuterFalloff(float signedDistance, float outerRange, float decayRate) {
  if (signedDistance <= 0.0) {
    return 1.0;
  }

  if (outerRange <= 0.0) {
    return 0.0;
  }

  float t = clamp(signedDistance / outerRange, 0.0, 1.0);
  float decayExponent = mix(0.25, 4.0, clamp(decayRate, 0.0, 1.0));
  return pow(1.0 - t, decayExponent);
}

void main() {
  vec4 source = texture(u_source, v_uv);

  vec2 pixel = vec2(
    (v_uv.x - 0.5) * u_textureSize.x,
    (0.5 - v_uv.y) * u_textureSize.y
  );
  vec2 centered = pixel - u_center;
  float s = sin(-u_rotation);
  float c = cos(-u_rotation);
  vec2 p = vec2(
    centered.x * c - centered.y * s,
    centered.x * s + centered.y * c
  );

  float outerRange = max(u_outerRange, 0.0);
  float radius = min(u_cornerRadius, min(u_rectSize.x, u_rectSize.y) * 0.5);
  float distance = sdRoundedRect(p, max(u_rectSize * 0.5, vec2(0.0001)), radius);
  float maskValue = computeOuterFalloff(distance, outerRange, u_decayRate);

  if (u_inverted) {
    maskValue = 1.0 - maskValue;
  }

  outColor = vec4(source.rgb, source.a * clamp(maskValue, 0.0, 1.0));
}
