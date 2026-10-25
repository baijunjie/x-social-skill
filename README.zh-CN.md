[English](README.md) | **中文**

# skill-x-social

X (Twitter) 浏览器自动化 skill — 通过 Playwright + Chrome 发推、点赞、回复、转推、引用、搜索，以及删除自己的推文。

## 为什么用浏览器自动化？

- **API 太贵** — X 官方 API 发推需要付费订阅（$200+/月）
- **真实浏览器指纹** — 用本机 Chrome 而非自带的 Chromium，X 要找的那些自动化特征本身就不存在
- **一次登录** — 手动登录一次，会话持久保存在 Chrome 配置文件中
- **需要时能无头** — 可选开启，`HeadlessChrome` 的 UA 与 client hints 都会被覆盖，见 [无头模式](#无头模式)

## 功能

| 操作 | 脚本 | 说明 |
|------|------|------|
| 发推 | `scripts/post.ts` | 发布推文，支持文本和图片（最多 4 张） |
| 点赞 | `scripts/like.ts` | 点赞任意推文 |
| 回复 | `scripts/reply.ts` | 回复推文，可附带图片 |
| 转推 | `scripts/retweet.ts` | 转推（不带评论） |
| 引用 | `scripts/quote.ts` | 引用推文并附加评论，可附带图片 |
| 搜索 | `scripts/search.ts` | 搜索「最新」标签页，返回结构化推文（作者、正文、时间、各项计数） |
| 列出自己的推文 | `scripts/my-tweets.ts` | 从个人主页时间线枚举当前账号自己的推文 |
| 列出提及 | `scripts/mentions.ts` | 从通知页「提及」标签列出回复与 @ 当前账号的推文 |
| 删除 | `scripts/delete.ts` | 按 URL 删除单条或批量删除 |
| 批量清理 | `scripts/purge.ts` | 直接从时间线批量删除自己的推文，可用正则过滤 |

**删除不可撤销 —— X 没有撤销功能。** `purge.ts` 不传 `match` 时会把时间线上能加载到的自己的推文全部删掉，直到 `limit`。

所有脚本使用 stdin/stdout JSON 通信 — 管道输入，解析输出。完整 IO 协议见 [SKILL.md](SKILL.md)。

## 快速开始

### 前置条件

- **Node.js** >= 20
- **Google Chrome** 已安装

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 Chrome 路径

默认路径为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。

如果 Chrome 安装在其他位置，查找并写入 `.env`：

```bash
# 查找 Chrome 安装位置（macOS）
CHROME=$(mdfind "kMDItemCFBundleIdentifier == 'com.google.Chrome'" 2>/dev/null | head -1)

# 如果找到，写入 .env
if [ -n "$CHROME" ]; then
  echo "CHROME_PATH=$CHROME/Contents/MacOS/Google Chrome" >> .env
  echo "已添加 CHROME_PATH 到 .env"
else
  echo "未找到 Chrome，请先安装 Google Chrome。"
fi
```

### 3. X 认证

```bash
npx tsx scripts/setup.ts
```

此命令会打开 Chrome，你需要手动登录 X。脚本会自动检测登录完成（超时：5 分钟）。

验证：

```bash
cat data/x-auth.json  # {"authenticated": true, ...}
```

## 使用

```bash
# 发推
echo '{"content":"Hello world"}' | npx tsx scripts/post.ts

# 发推附带图片
echo '{"content":"看看这个","imagePaths":["/path/to/image.png"]}' | npx tsx scripts/post.ts

# 点赞
echo '{"tweetUrl":"https://x.com/user/status/123"}' | npx tsx scripts/like.ts

# 回复
echo '{"tweetUrl":"https://x.com/user/status/123","content":"写得好！"}' | npx tsx scripts/reply.ts

# 转推
echo '{"tweetUrl":"https://x.com/user/status/123"}' | npx tsx scripts/retweet.ts

# 引用推文
echo '{"tweetUrl":"https://x.com/user/status/123","comment":"有意思"}' | npx tsx scripts/quote.ts

# 搜索（「最新」标签页，X 的搜索操作符都可用）
echo '{"query":"\"忘了放哪\" lang:zh -filter:replies","limit":20}' | npx tsx scripts/search.ts

# 列出自己的推文
echo '{"tab":"with_replies","limit":200}' | npx tsx scripts/my-tweets.ts
echo '{"limit":40}' | npx tsx scripts/mentions.ts

# 按 URL 删除自己的推文
echo '{"tweetUrls":["https://x.com/me/status/123"]}' | npx tsx scripts/delete.ts

# 批量删除匹配正则的自己的推文
echo '{"match":"关键词|另一个","limit":500}' | npx tsx scripts/purge.ts
```

输出为单行 JSON：

```json
{"success": true, "message": "Tweet posted: https://x.com/user/status/123456"}
```

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CHROME_PATH` | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | Chrome 可执行文件路径 |
| `X_HEADLESS` | 未设置（有头） | 设为 `1` 以无头方式启动 Chrome |

在项目根目录的 `.env` 中设置。

### 无头模式

有头 Chrome 一启动就会成为前台应用。无人值守的任务因此会抢走正在用电脑的人的焦点，
别的自动化发出的键盘事件也会落到 Chrome 上。`X_HEADLESS=1` 可以避免：无头进程没有窗口，
永远不会进入前台。

无头 Chrome 的 `navigator.userAgent` 和 `Sec-CH-UA` client hints 都自报 `HeadlessChrome/<版本>`，
站点读得到。启动时会把两者都覆盖成有头 UA，版本号取自本机 Chrome 自己的主版本，不会随 Chrome
升级而错位；取不到版本号就拒绝启动，而不是带着暴露的 UA 上。

想盯着浏览器排查选择器时，不要设 `X_HEADLESS`。

### 超时与限制

编辑 `lib/config.ts` 可调整：

- 页面导航超时（默认：30 秒）
- 元素等待超时（默认：5 秒）
- 推文字符限制（默认：280）
- 每条推文最大图片数（默认：4）
- 视口大小（默认：1280x800）

### 数据目录

| 路径 | 用途 |
|------|------|
| `data/x-browser-profile/` | Chrome 配置文件（含登录会话） |
| `data/x-auth.json` | 认证状态标记 |

均已在 `.gitignore` 中忽略。

## 故障排查

### 认证过期

重新运行认证：

```bash
npx tsx scripts/setup.ts
```

### Chrome 启动失败

清除浏览器锁文件：

```bash
rm -f data/x-browser-profile/SingletonLock data/x-browser-profile/SingletonSocket data/x-browser-profile/SingletonCookie
```

### X 界面选择器变更

如果脚本因找不到元素而失败，可能是 X 更新了界面。更新 `lib/config.ts` 中的 `config.selectors`。

## 许可证

[MIT](LICENSE)
