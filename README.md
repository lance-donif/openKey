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

在 NewAPI 的 API 密钥页点击“导出到 Sub2API”，选择配置后扩展会打开本地账号管理页。目标页有“填充单条”和“批量创建”两种方式：单条只填入表单，批量创建会在二次确认后依次创建账号。

如果 NewAPI 表格只显示掩码，扩展会尝试使用该行的复制按钮；仍然无法识别时，可在扩展弹窗中手工补充 Key。

### Linux.do → CC Switch

在话题页点击“导入到 CC Switch”。扩展只解析帖主的首条正文，会先解码 Base64 地址，再从普通文本、代码块、链接和解码结果中识别网址、Key、模型，选择目标应用后逐条打开 CC Switch 深链接。若没有明确模型，标题/帖主正文包含 `grok` 时默认 `grok-4.5`，包含 `gpt`、`openai` 或 `chatgpt` 时默认 `gpt-5.6-sol`。CC Switch 会显示自己的导入确认界面。

图片里的配置无法仅靠网页 DOM 读取；遇到纯截图时请先复制为文本再导入。

## 安全说明

- API Key 不会发送到第三方服务器；A → B 的待导入数据只放在扩展会话存储中，填充后清理。
- CC Switch 深链接本身会包含 API Key，这是 CC Switch 官方导入协议的工作方式；只对可信配置使用。
- 单条填充不会自动点击 Sub2API 的最终“创建”；批量创建只有在你二次确认后才会依次点击“创建”。扩展不会自动确认 CC Switch 的导入。

## 本地检查

```bash
npm test
```
