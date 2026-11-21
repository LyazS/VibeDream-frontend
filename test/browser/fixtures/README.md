# OPFS 视频测试素材

`red.webm` 为本仓库生成的纯红色视频：VP9、64 × 48、30 fps、1 秒、无音轨，供真实文件导入和 WebCodecs 解码回归使用，不含外部素材。

生成命令（运行测试不需要 FFmpeg）：

```bash
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=64x48:r=30:d=1 \
  -c:v libvpx-vp9 -pix_fmt yuv420p -an -y test/browser/fixtures/red.webm
```

`green-tone.webm` 用于验证链接素材的成片。前一秒为蓝色，后一秒为绿色，全程包含 523 Hz 音轨。测试只导出后一秒中的一段，并检查输出的颜色、音轨和时长。

```bash
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i color=c=blue:s=64x48:r=30:d=1 \
  -f lavfi -i color=c=lime:s=64x48:r=30:d=1 \
  -f lavfi -i sine=frequency=523:sample_rate=48000:duration=2 \
  -filter_complex '[0:v][1:v]concat=n=2:v=1:a=0[video]' \
  -map '[video]' -map 2:a -c:v libvpx-vp9 -pix_fmt yuv420p -c:a libopus \
  -y test/browser/fixtures/green-tone.webm
```
