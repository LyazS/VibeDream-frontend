<template>
  <div class="script-test-container">
    <div class="test-section">
      <div class="input-section">
        <label for="scriptInput">测试脚本:</label>
        <textarea
          id="scriptInput"
          v-model="testScript"
          placeholder="在此输入要测试的脚本代码..."
          rows="10"
          cols="60"
        ></textarea>

        <div class="example-buttons">
          <button @click="loadExample1">加载示例1: 添加轨道和项目</button>
          <button @click="loadExample2">加载示例2: 文本操作</button>
          <button @click="loadExample3">加载示例3: 关键帧操作</button>
          <button @click="loadExample4">加载示例4: 死循环测试 - while(true)</button>
          <button @click="loadExample5">加载示例5: 死循环测试 - 无限递归</button>
          <button @click="loadExample6">加载示例6: 死循环测试 - 密集计算</button>
          <button @click="loadExample7">加载示例7: 循环添加项目</button>
          <button @click="loadExample8">加载示例8: 配置验证错误 - 时间码</button>
          <button @click="loadExample9">加载示例9: 配置验证错误 - 轨道类型</button>
          <button @click="loadExample10">加载示例10: 配置验证错误 - 文本样式</button>
          <button @click="loadExample11">加载示例11: 配置验证错误 - 变换属性</button>
          <button @click="loadExample12">加载示例12: 完整项目示例 - 所有API</button>
        </div>
      </div>

      <div class="control-section">
        <button @click="executeScript" :disabled="isExecuting">
          {{ isExecuting ? '执行中...' : '执行脚本' }}
        </button>
        <button @click="clearResults">清除结果</button>
      </div>

      <div class="results-section">
        <h3>执行结果:</h3>
        <div v-if="errorMessage" class="error-message">
          {{ errorMessage }}
        </div>
        <div v-if="successMessage" class="success-message">
          {{ successMessage }}
        </div>

        <div v-if="operations.length > 0">
          <h4>生成的操作列表:</h4>
          <div class="operations-list">
            <div v-for="(op, index) in operations" :key="index" class="operation-item">
              <strong>操作 {{ index + 1 }}:</strong> {{ op.type }}
              <div class="operation-params">参数: {{ JSON.stringify(op.params, null, 2) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ScriptExecutor } from '@/aipanel/agent/composables/executors/ScriptExecutor'

type OperationConfig = {
  type: string
  params: any
}

const router = useRouter()

const testScript = ref('')
const isExecuting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const operations = ref<OperationConfig[]>([])

// 示例脚本
const exampleScripts = {
  example1: `// 添加轨道和项目
addTrack("video", 0);
addTimelineItem({
  mediaItemId: "video-1",
  trackId: "track-1",
  timeRange: {
    start: "00:00:00+00",
    end: "00:00:10+00"
  }
});
addTrack("audio", 1);
addTimelineItem({
  mediaItemId: "audio-1",
  trackId: "track-2",
  timeRange: {
    start: "00:00:00+00",
    end: "00:00:03+00"
  }
});`,

  example2: `// 文本操作
addTrack("text", 2);
addTimelineItem({
  mediaItemId: "text-1",
  trackId: "track-3",
  timeRange: {
    start: "00:00:00+00",
    end: "00:00:02+00"
  }
});
updateTextContent("text-1", "Updated Text", {
  fontSize: 24,
  color: "#ff0000",
  fontWeight: "normal",
  fontStyle: "normal",
  textAlign: "left"
});`,

  // 关键帧操作 - 基于新格式
  example3: `// 关键帧操作
addTrack("video", 0);
addTimelineItem({
  mediaItemId: "video-1",
  trackId: "track-1",
  timeRange: {
    start: "00:00:00+00",
    end: "00:00:10+00"
  }
});
createKeyframe("video-1", "00:00:01+00");
createKeyframe("video-1", "00:00:05+00");
createKeyframe("video-1", "00:00:09+00");
updateKeyframeProperty("video-1", "00:00:01+00", "opacity", 0);
updateKeyframeProperty("video-1", "00:00:05+00", "opacity", 0.5);
updateKeyframeProperty("video-1", "00:00:09+00", "opacity", 1);`,

  example4: `// 死循环测试 - while(true)
let counter = 0;
while(true) {
  counter++;
  if (counter % 1000000 === 0) {
    console.log('循环计数: ' + counter);
  }
}`,

  example5: `// 死循环测试 - 无限递归
function infiniteRecursion(depth) {
  console.log('递归深度: ' + depth);
  // 没有终止条件，会导致栈溢出
  return infiniteRecursion(depth + 1);
}
infiniteRecursion(1);`,

  example6: `// 死循环测试 - 密集计算
function intensiveCalculation() {
  let result = 0;
  while(true) {
    // 执行大量数学计算以消耗CPU
    for(let i = 0; i < 1000000; i++) {
      result += Math.sqrt(i) * Math.sin(i) * Math.cos(i);
    }
    console.log('计算结果: ' + result);
  }
}
intensiveCalculation();`,

  example7: `// 循环遍历数组添加项目
addTrack("video", 0);
addTrack("audio", 1);
addTrack("text", 2);

addTimelineItem({
  mediaItemId: "video-1",
  trackId: "track-1",
  timeRange: {
    start: "00:00:00+00",
    end: "00:00:03+00"
  }
});
addTimelineItem({
  mediaItemId: "audio-1",
  trackId: "track-2",
  timeRange: {
    start: "00:00:00+00",
    end: "00:00:02+00"
  }
});
addTimelineItem({
  mediaItemId: "text-1",
  trackId: "track-3",
  timeRange: {
    start: "00:00:00+00",
    end: "00:00:01+30"
  }
});`,

  // 配置验证错误示例
  example8: `// 配置验证错误 - 时间码格式错误
addTrack("video", 0);
addTimelineItem({
  mediaItemId: "video-1",
  trackId: "track-1",
  timeRange: {
    start: "invalid-timecode", // 错误的时间码格式
    end: "invalid-end-time"
  }
});`,

  example9: `// 配置验证错误 - 无效轨道类型
addTrack("invalid-type"); // 不支持 track 类型
addTimelineItem({
  mediaItemId: "video-1",
  trackId: "track-1",
  timeRange: {
    start: "00:00:00+00",
    end: "00:00:10+00"
  }
});`,

  example10: `// 配置验证错误 - 文本样式无效
addTrack("text");
addTimelineItem({
  mediaItemId: "text-1",
  trackId: "text-track-1",
  timeRange: {
    start: "00:00:00+00",
    end: "00:00:05+00"
  }
});
updateTextContent("text-1", "Hello World", {
  fontSize: 0, // 字体大小必须大于0
  color: "not-a-color-code", // 应该是颜色字符串
  textAlign: "invalid-align" // 不支持的文本对齐方式
});`,

  example11: `// 配置验证错误 - 变换属性无效
addTrack("video");
addTimelineItem({
  mediaItemId: "video-1",
  trackId: "video-track-1",
  timeRange: {
    start: "00:00:00+00",
    end: "00:00:10+00"
  }
});
updateTimelineItemTransform("video-1", {
  opacity: 1.5, // 超出范围 (应该是 0-1)
  volume: -0.5, // 超出范围 (应该是 0-1)
  rotation: 720, // 应该验证数值类型
  duration: "not-a-duration-format" // 错误的时间码格式
});`,

  example12: `// 完整项目示例 - 展示所有可用API
console.log("=== 开始构建视频项目 ===");

// 添加轨道 - 使用不同位置
addTrack("video", 0);
addTrack("video", 1);
addTrack("audio", 2);
addTrack("text", 3);
addTrack("audio", 4);

// 修改轨道名称
renameTrack("track-2", "main-video");
renameTrack("track-3", "overlay-video");
renameTrack("track-4", "narration-audio");
renameTrack("track-5", "titles-text");
renameTrack("track-6", "background-audio");

// 添加各种时间轴项目

// 主视频项目
addTimelineItem({
  mediaItemId: "main-video-1",
  trackId: "track-1",
  timeRange: {
    start: "00:00:00+00",
    end: "00:02:30+00"
  }
});

// 叠加视频项目
addTimelineItem({
  mediaItemId: "overlay-video-1",
  trackId: "main-video",
  timeRange: {
    start: "00:00:15+00",
    end: "00:00:45+00"
  }
});

// 旁白音频
addTimelineItem({
  mediaItemId: "narration-1",
  trackId: "narration-audio",
  timeRange: {
    start: "00:00:00+00",
    end: "00:02:00+00"
  }
});

// 标题文本
addTimelineItem({
  mediaItemId: "title-text-1",
  trackId: "titles-text",
  timeRange: {
    start: "00:00:05+00",
    end: "00:00:25+00"
  }
});

// 背景音频
addTimelineItem({
  mediaItemId: "bg-music-1",
  trackId: "background-audio",
  timeRange: {
    start: "00:00:10+00",
    end: "02:00:00+00"
  }
});

// 更新文本内容
updateTextContent("title-text-1", "视频标题 - 产品介绍", {
  fontSize: 48,
  color: "#ffffff",
  backgroundColor: "rgba(0,0,0,0.7)",
  fontWeight: "bold",
  fontStyle: "normal",
  textAlign: "center",
  textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
  fontFamily: "Arial, sans-serif"
});

// 更新文本样式
updateTextStyle("title-text-1", {
  fontSize: 36,
  color: "#00ff88",
  textAlign: "left",
  maxWidth: 300,
  lineHeight: 1.4
});

// 创建关键帧动画
createKeyframe("main-video-1", "00:00:10+00");
createKeyframe("main-video-1", "00:00:30+00");
createKeyframe("main-video-1", "00:01:00+00");

// 设置关键帧属性
updateKeyframeProperty("main-video-1", "00:00:10+00", "opacity", 0.8);
updateKeyframeProperty("main-video-1", "00:00:30+00", "opacity", 0.6);
updateKeyframeProperty("main-video-1", "00:01:00+00", "opacity", 1.0);
updateKeyframeProperty("main-video-1", "00:00:10+00", "rotation", 0);
updateKeyframeProperty("main-video-1", "00:00:30+00", "rotation", 45);
updateKeyframeProperty("main-video-1", "00:01:00+00", "rotation", 0);

// 更新视频变换属性
updateTimelineItemTransform("overlay-video-1", {
  x: 50,
  y: 50,
  width: 320,
  height: 240,
  opacity: 0.9,
  zIndex: 10,
  duration: "00:00:30+00",
  playbackRate: 1.2,
  volume: 0.8,
  isMuted: false,
  gain: 2.0,
  rotation: 15
});

// 调整时间轴项目大小
resizeTimelineItem("overlay-video-1", {
  timelineStart: "00:00:15+00",
  timelineEnd: "00:00:45+00",
  clipStart: "00:00:10+00",
  clipEnd: "00:00:30+00"
});

// 分割和复制项目
splitTimelineItem("bg-music-1", "00:00:30+00");
cpTimelineItem("overlay-video-1", "00:01:30+00", "track-1");
mvTimelineItem("overlay-video-1", "00:01:20+00", "track-1");

// 轨道控制操作
autoArrangeTrack("main-video");
toggleTrackVisibility("background-audio", true);
toggleTrackMute("background-audio", false);

// 删除不用的关键帧
deleteKeyframe("main-video-1", "00:00:10+00");
// 清除所有关键帧测试
clearAllKeyframes("overlay-video-1");
// 然后重新创建一些
createKeyframe("overlay-video-1", "00:00:20+00");
createKeyframe("overlay-video-1", "00:00:40+00");

// 最终轨道重命名
renameTrack("track-1", "final-main-video");

console.log("=== 视频项目构建完成 ===");
console.log("总视频长度: 02:30:00+00");
console.log("轨道数量: 5个");
console.log("时间轴项目: 5个");
console.log("关键帧动画: 8个");
console.log("变换效果: 2个");`,
}

function loadExample1() {
  testScript.value = exampleScripts.example1
}

function loadExample2() {
  testScript.value = exampleScripts.example2
}

function loadExample3() {
  testScript.value = exampleScripts.example3
}

function loadExample4() {
  testScript.value = exampleScripts.example4
}

function loadExample5() {
  testScript.value = exampleScripts.example5
}

function loadExample6() {
  testScript.value = exampleScripts.example6
}

function loadExample7() {
  testScript.value = exampleScripts.example7
}

function loadExample8() {
  testScript.value = exampleScripts.example8
}

function loadExample9() {
  testScript.value = exampleScripts.example9
}

function loadExample10() {
  testScript.value = exampleScripts.example10
}

function loadExample11() {
  testScript.value = exampleScripts.example11
}

function loadExample12() {
  testScript.value = exampleScripts.example12
}

async function executeScript() {
  if (!testScript.value.trim()) {
    errorMessage.value = '请输入测试脚本'
    return
  }

  isExecuting.value = true
  errorMessage.value = ''
  successMessage.value = ''
  operations.value = []

  try {
    // 每次执行都重新实例化 ScriptExecutor
    const scriptExecutor = new ScriptExecutor()
    const result = await scriptExecutor.executeScript(testScript.value)
    operations.value = result.operations || []
    const logCount = result.logs?.length || 0
    const operationCount = result.operations?.length || 0
    successMessage.value = `脚本执行成功！生成了 ${operationCount} 个操作，捕获 ${logCount} 条日志`
  } catch (error) {
    errorMessage.value = `脚本执行失败: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    isExecuting.value = false
  }
}

function clearResults() {
  operations.value = []
  errorMessage.value = ''
  successMessage.value = ''
}
</script>

<style scoped>
.script-test-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family: Arial, sans-serif;
  height: 100%;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 1px solid #ddd;
}

.header h1 {
  margin: 0;
  color: #333;
}

.back-btn {
  padding: 8px 16px;
  background-color: #6c757d;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.back-btn:hover {
  background-color: #5a6268;
}

.test-section {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.input-section label {
  display: block;
  margin-bottom: 10px;
  font-weight: bold;
  color: #333;
}

textarea {
  width: 100%;
  max-width: 600px;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  resize: vertical;
}

.example-buttons {
  margin-top: 15px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.example-buttons button {
  padding: 8px 12px;
  background-color: #17a2b8;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.example-buttons button:hover {
  background-color: #138496;
}

.control-section {
  display: flex;
  gap: 15px;
}

.control-section button {
  padding: 10px 20px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}

.control-section button:hover:not(:disabled) {
  background-color: #0056b3;
}

.control-section button:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}

.results-section {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 20px;
  background-color: #f8f9fa;
}

.error-message {
  background-color: #f8d7da;
  color: #721c24;
  padding: 10px;
  border-radius: 4px;
  margin-bottom: 15px;
}

.success-message {
  background-color: #d4edda;
  color: #155724;
  padding: 10px;
  border-radius: 4px;
  margin-bottom: 15px;
}

.operations-list {
  max-height: 400px;
  overflow-y: auto;
}

.operation-item {
  background-color: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 15px;
  margin-bottom: 10px;
  color: #333;
}

.operation-params {
  margin-top: 8px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  background-color: #f8f9fa;
  padding: 8px;
  border-radius: 3px;
  white-space: pre-wrap;
  word-break: break-all;
}

.operation-time {
  margin-top: 5px;
  font-size: 12px;
  color: #666;
}

h3,
h4 {
  margin-top: 0;
  color: #333;
}
</style>
