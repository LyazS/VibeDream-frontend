# OPFS 视频测试素材

`red.webm` 为本仓库生成的纯红色视频：VP9、64 × 48、30 fps、1 秒、无音轨，供真实文件导入和 WebCodecs 解码回归使用，不含外部素材。

生成命令（运行测试不需要 FFmpeg）：

```bash
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=64x48:r=30:d=1 \
  -c:v libvpx-vp9 -pix_fmt yuv420p -an -y test/browser/fixtures/red.webm
```
