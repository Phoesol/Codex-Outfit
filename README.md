# 👗 Outfit Manager — 让你的 AI 角色真正「穿」上衣服

> 给 SillyTavern 酒馆的穿搭管理插件。从此 AI 不再乱编服装，每天穿什么你说了算。

---

## 🎯 一句话

把穿搭信息注入对话上下文，AI 描写服装时有据可依，人设不再崩。

---

## ✨ 功能一览

| 功能 | 说明 |
|------|------|
| 👗 **真实衣柜** | 上传穿搭照片 + 文字描述，分风格/季节/场景标签 |
| 🌐 **世界书联动** | 内置 20 种现代风格 + 5 款内衣，一键随机搭配 |
| 🤖 **AI 批量导入** | 照片发给 ChatGPT/Claude → 描述粘贴回来 → 自动建好 |
| 🎲 **场景快切** | 底部一排 `[睡前] [外出] [约会] [家居]`，一键换装 |
| 🏷️ **自动标签** | 调用视觉 API 自动识别风格/季节/场景 |
| 📋 **批量粘贴** | 外部 AI 返回的描述一次性粘贴，按 `--- 第N套 ---` 自动分配 |
| 🔄 **启动提醒** | 每次开酒馆右下角弹 toast，告诉你今天穿什么 |
| 👤 **User/角色独立** | 你和每个角色各有独立衣柜，互不干扰 |

---

![主面板](screenshots/main-panel.png)

![批量添加](screenshots/batch-add.png)

![场景切换](screenshots/scene-switch.png)

![设置](screenshots/settings.png)

---

## 📦 安装

```
酒馆 → 扩展管理 → 安装插件 → 输入 URL：
https://github.com/gabby1111111111/Outfit-Manager
```

点安装 → 重启 → 扩展管理启用 → 完成。

---

## 🚀 快速上手

**有照片：** 点「批量添加」→ 选图片 → 点「复制提示词」丢给 ChatGPT/Claude → 描述粘贴回来 → 创建

**没照片：** 勾「仅世界书」→ 点底部 `[睡前] [外出] [约会]` 随机穿 → 弹窗确认

**混着来：** 平时底部按钮随机穿 → 想穿自己某套时去衣柜点一下就行

---

## ⚙️ 设置建议

- **注入位置**：用户消息末尾（兼容性最好）
- **注入方式**：纯文字（最稳定）
- **API**：默认使用酒馆主 API，也可另配辅助 API

---

## 🤖 兼容

| 模型 | 状态 |
|------|------|
| Gemini 2.5 Pro | ✅ |
| Claude 3.5/4 | ✅ |
| DeepSeek V3/R1 | ✅ |

---

## 🙏 鸣谢

- 💎uu现代v2.1 / 🦋uu内衣v1.0 世界书 — 来自 Discord 旅程社区的 **离谱喵✧˖°** 老师
- 二改自 [wenshui012/Outfit-Manager](https://github.com/wenshui012/Outfit-Manager)

---

![主面板](screenshots/main-panel.png)
![批量添加](screenshots/batch-add.png)
![场景切换](screenshots/scene-switch.png)
![设置](screenshots/settings.png)
