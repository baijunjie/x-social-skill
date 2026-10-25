[English](README.md) | **中文**

# x-social-skill

X (Twitter) 浏览器自动化 skill — 通过 Playwright + Chrome 发推、点赞、回复、转推、引用、搜索、列出提及，以及删除自己的推文。以 Claude Code 与 Codex plugin 的形式分发，只把 skill 装进你选定的项目——其他项目里的 agent 看不到它；每个项目可配多个账号。

## 为什么用浏览器自动化？

- **API 太贵** — X 官方 API 发推需要付费订阅（$200+/月）
- **真实浏览器指纹** — 用本机 Chrome 而非自带的 Chromium，X 要找的那些自动化特征本身就不存在
- **一次登录** — 每个账号手动登录一次，会话持久保存在 Chrome 配置文件中
- **需要时能无头** — 可选开启，`HeadlessChrome` 的 UA 与 client hints 都会被覆盖，见 [无头模式](#无头模式)

## 功能

| 操作 | 脚本（位于装好的 skill 目录） | 说明 |
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

所有脚本使用 stdin/stdout JSON 通信 — 管道输入，解析输出。完整 IO 协议见 [SKILL.md](skills/install/template/x-social/SKILL.template.md)。

## 快速开始

### 前置条件

- **Node.js** >= 20（含 npm）
- **Google Chrome** 已安装

### 1. 安装 plugin

plugin 里只有一个安装器，而且模型不能自行调用它，所以装好 plugin 后 agent 还看不到任何东西。

Claude Code：

```bash
claude plugin marketplace add baijunjie/x-social-skill
claude plugin install x-social@x-social-skill
# 重启 Claude Code
```

Codex：

```bash
codex plugin marketplace add baijunjie/x-social-skill
codex plugin add x-social@x-social-skill
# 开启新会话
```

请用 GitHub 源安装，不要用本地路径：本地 marketplace 直接指向该目录，目录一旦移动或删除，skill 就加载不了。

### 2. 装进项目

在需要 X 自动化的项目里运行安装器：

- Claude Code：`/x-social:install`，装到 `.claude/skills/x-social/`
- Codex：`$x-social:install`，装到 `.agents/skills/x-social/`

把装好的目录提交进仓库（目录里自带忽略 `node_modules/` 的 `.gitignore`），然后重启 Claude Code / 开启新的 Codex 会话。只有这个项目里的 agent 能看到 `x-social` skill。

npm 依赖由 `run.sh` 在首次运行时装进 skill 目录，不需要另外安装。

更新：先更新 plugin（`claude plugin marketplace update x-social-skill && claude plugin update x-social@x-social-skill`；Codex：`codex plugin marketplace upgrade x-social-skill && codex plugin add x-social@x-social-skill`），再在每个项目里重新运行安装器。没有变化时它会报告无需更新；要覆盖手改时，会先列出将被覆盖的文件。

### 3. 配置 Chrome 路径

默认路径为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。

如果 Chrome 安装在其他位置，查找并写入 `~/.x-social-skill/.env`：

```bash
# 查找 Chrome 安装位置（macOS）
CHROME=$(mdfind "kMDItemCFBundleIdentifier == 'com.google.Chrome'" 2>/dev/null | head -1)

# 如果找到，写入 .env
if [ -n "$CHROME" ]; then
  mkdir -p ~/.x-social-skill
  echo "CHROME_PATH=$CHROME/Contents/MacOS/Google Chrome" >> ~/.x-social-skill/.env
  echo "已添加 CHROME_PATH 到 ~/.x-social-skill/.env"
else
  echo "未找到 Chrome，请先安装 Google Chrome。"
fi
```

### 4. X 认证

让 agent 帮你配置 X，或者在装好的 skill 目录里自己运行：

```bash
./run.sh setup
```

此命令会用一个全新的 Chrome 配置文件打开登录页，你需要手动登录 X。脚本会自动检测登录完成（超时：5 分钟），读出账号的 handle，把会话保存到项目根目录的 `.x-social/accounts/<handle>/`——账号归属于 agent 当前所在的项目。在 git 项目之外运行，或设 `X_SOCIAL_HOME=~/.x-social-skill`，则配置所有项目共用的用户级账号。

换一个账号再运行一次即可添加该账号。配置了多个账号后，用 `X_ACCOUNT` 指定要用哪个，脚本不会替你猜。

## 使用

脚本由 agent 替你运行。手动运行时，在 skill 目录下：

```bash
# 发推
echo '{"content":"Hello world"}' | ./run.sh post

# 发推附带图片
echo '{"content":"看看这个","imagePaths":["/path/to/image.png"]}' | ./run.sh post

# 点赞
echo '{"tweetUrl":"https://x.com/user/status/123"}' | ./run.sh like

# 回复
echo '{"tweetUrl":"https://x.com/user/status/123","content":"写得好！"}' | ./run.sh reply

# 转推
echo '{"tweetUrl":"https://x.com/user/status/123"}' | ./run.sh retweet

# 引用推文
echo '{"tweetUrl":"https://x.com/user/status/123","comment":"有意思"}' | ./run.sh quote

# 搜索（「最新」标签页，X 的搜索操作符都可用）
echo '{"query":"\"忘了放哪\" lang:zh -filter:replies","limit":20}' | ./run.sh search

# 列出自己的推文
echo '{"tab":"with_replies","limit":200}' | ./run.sh my-tweets

# 列出提及
echo '{"limit":40}' | ./run.sh mentions

# 按 URL 删除自己的推文
echo '{"tweetUrls":["https://x.com/me/status/123"]}' | ./run.sh delete

# 批量删除匹配正则的自己的推文
echo '{"match":"关键词|另一个","limit":500}' | ./run.sh purge

# 用另一个账号操作
echo '{"content":"你好"}' | X_ACCOUNT=other_handle ./run.sh post
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
| `X_ACCOUNT` | 未设置（唯一已配置的账号） | 要操作的账号 handle；配置了多个账号时必填 |
| `X_HEADLESS` | 未设置（有头） | 设为 `1` 以无头方式启动 Chrome |
| `X_SOCIAL_HOME` | 项目根目录的 `.x-social/`，不在 git 项目中时为 `~/.x-social-skill` | 数据目录；只能通过环境变量设置 |

可在环境变量、项目的 `.x-social/.env`、`~/.x-social-skill/.env` 中设置，优先级依次降低。`CHROME_PATH` 这类对所有项目都一样的配置，写进用户级那份。

### 无头模式

有头 Chrome 一启动就会成为前台应用。无人值守的任务因此会抢走正在用电脑的人的焦点，
别的自动化发出的键盘事件也会落到 Chrome 上。`X_HEADLESS=1` 可以避免：无头进程没有窗口，
永远不会进入前台。

无头 Chrome 的 `navigator.userAgent` 和 `Sec-CH-UA` client hints 都自报 `HeadlessChrome/<版本>`，
站点读得到。启动时会把两者都覆盖成有头 UA，版本号取自本机 Chrome 自己的主版本，不会随 Chrome
升级而错位；取不到版本号就拒绝启动，而不是带着暴露的 UA 上。

想盯着浏览器排查选择器时，不要设 `X_HEADLESS`。

### 超时与限制

装好的 skill 里的 `lib/config.ts` 可调整以下各项；在那里改的内容，重新运行安装器时会被覆盖：

- 页面导航超时（默认：30 秒）
- 元素等待超时（默认：5 秒）
- 推文字符限制（默认：280）
- 每条推文最大图片数（默认：4）
- 视口大小（默认：1280x800）

### 数据目录

数据放在装好的 skill 之外（安装器重装时会替换 skill 目录）。数据目录是 agent 所在 git 项目根目录的 `.x-social/`（同一仓库的各个 worktree 共用主 checkout 的那份）；不在 git 项目中，或 `X_SOCIAL_HOME` 指向它时，用 `~/.x-social-skill/`。

| 路径（数据目录下） | 用途 |
|------|------|
| `.env` | 配置 |
| `accounts/<handle>/profile/` | 该账号的 Chrome 配置文件（含登录会话） |
| `accounts/<handle>/auth.json` | 认证状态标记 |

配置文件里是有效的会话 cookie，拿到它就等于登录了该账号。认证时会在项目的 `.x-social/` 里写一个忽略其中全部内容的 `.gitignore`；它已被 git 跟踪时拒绝写入。不要提交或分享它，队友各自登录。

1.1.0 之前配置文件放在工作目录的 `data/` 下，不会自动迁移，需要每个账号重新运行一次认证。

## 故障排查

### 认证过期

重新运行认证并登录该账号，会替换该账号的旧会话：

```bash
./run.sh setup
```

### Chrome 启动失败

脚本启动时会自动清理残留的 Chrome 锁文件；仍然失败时，确认没有别的任务在用同一账号，再手动清除：

```bash
rm -f .x-social/accounts/<handle>/profile/Singleton{Lock,Socket,Cookie}
```

### X 界面选择器变更

如果脚本因找不到元素而失败，可能是 X 更新了界面。更新 `skills/install/template/x-social/lib/config.ts` 中的 `config.selectors` 后重装。

## 许可证

[MIT](LICENSE)
