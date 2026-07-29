# OpenKey

一个不依赖构建工具的 Manifest V3 Chrome 扩展，用来搬运 AI 配置：

- NewAPI `https://welfare.0xpsyche.me/keys` → Sub2API `http://localhost:8080/admin/accounts`
- Linux.do 话题页 → CC Switch `ccswitch://` Provider 深链接

## 安装

1. 打开 `chrome://extensions/`，启用“开发者模式”。
2. 点击“加载已解压的扩展”，选择本仓库目录 `/Users/lance/Desktop/openKey`。
3. 如果 Sub2API 使用其他本机端口，点击扩展图标修改目标地址。

## 使用

### NewAPI → Sub2API

在 NewAPI 的 API 密钥页（如 `/keys`、`/token`、`/console/token`）点击“导出到 Sub2API”，选择配置后扩展会打开本地 Sub2API 账号管理页并自动创建。

如果表格只显示掩码 Key，扩展会**优先**请求同源 `POST /api/token/{id}/key`（必要时先用 `GET /api/token/` 按名称/掩码匹配 id）；API 失败时再尝试该行的复制按钮/菜单，并拦截页面写入剪贴板的内容。仍然无法识别时，可在**导出面板内**手工粘贴 Key（支持 Base64）。

### Linux.do → CC Switch

在话题页（`/t/...`）头像下方会出现两个按钮：

1. **导入到 CC Switch**：自动解析帖主首条正文（含 Base64）。一段 Base64 只会生成一条配置，不会把编码原文再当成第二把 Key。
2. **Base64 解码**：弹窗展示已识别结果，并提供输入框；粘贴 Base64 后点「解码」，确认无误再导入 CC Switch。

扩展会先解码 Base64，再从普通文本、代码块、链接和解码结果中识别网址、Key、模型，选择目标应用后逐条打开 CC Switch 深链接。若没有明确模型，标题/帖主正文包含 `grok` 时默认 `grok-4.5`，包含 `gpt`、`openai` 或 `chatgpt` 时默认 `gpt-5.6-sol`。CC Switch 会显示自己的导入确认界面。

图片里的配置无法仅靠网页 DOM 读取；遇到纯截图时请先复制为文本或用「Base64 解码」粘贴后再导入。

## 安全说明

- API Key 不会发送到第三方服务器；A → B 的待导入数据只放在扩展会话存储中，填充后清理。
- CC Switch 深链接本身会包含 API Key，这是 CC Switch 官方导入协议的工作方式；只对可信配置使用。
- 单条填充不会自动点击 Sub2API 的最终“创建”；批量创建只有在你二次确认后才会依次点击“创建”。扩展不会自动确认 CC Switch 的导入。

## 本地检查

```bash
npm test
```
