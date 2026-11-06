# YouTube Music · Lyrics+

由 [10416606](https://github.com/10416606) 维护的 MyGo Music YouTube Music 插件，重点改进歌词可靠性。

基于 [EGOIST 的原插件](https://github.com/egoist/mygo-music-youtube-music) 修改，保留原有播放、登录、歌单和音乐浏览逻辑。来源和权属说明见 [NOTICE.md](NOTICE.md)。

## 安装

1. 安装 [MyGo Music](https://music.egoist.dev/zh/)，本版沿用 0.1.6 支持的插件接口。
2. macOS 安装播放依赖：

   ```sh
   brew install ffmpeg yt-dlp
   ```

3. 在 MyGo Music 的“设置 → 插件 → +”输入：

   ```text
   https://github.com/10416606/mygo-music-youtube-lyrics
   ```

4. 允许插件启动播放程序。登录 Google 后可以访问自己的歌单；歌词查询本身使用匿名接口。

[一键安装](mygo-music://install-plugin?repo=10416606/mygo-music-youtube-lyrics) · [下载发布版](https://github.com/10416606/mygo-music-youtube-lyrics/releases/latest)

也可以下载发布页的 `plugin.zip`，从本机安装。ffmpeg 或 yt-dlp 不在标准目录时，在插件的 Programs Folder 中指定它们所在的文件夹。

### 从原版切换

本版保留 `youtube-music` 插件 ID，以替换现有插件。请先备份原插件，不要将两个相同 ID 的插件同时放在插件目录中。首次迁移建议退出客户端后替换代码文件，保留原来的插件数据目录，再启动客户端。

通过本仓库安装后，后续更新来自本仓库。手工复制代码的用户需要重新加载插件；需要 GitHub 更新来源时，请通过仓库地址安装。

## 歌词改进

- YouTube Music 歌词查询不携带 Google 登录会话。
- YouTube 没有同步歌词或接口暂时失败时，使用 [LRCLIB](https://lrclib.net/docs) 备用源。
- 匹配歌名、歌手和时长，并保留 Live 等版本差异，减少错配。
- Better Lyrics 是最后的备用源；遇到缺少 API Key 的 401 错误时暂停请求。
- 对请求设置等待上限，合并同一首歌的并发请求，遵守 Retry-After。
- 成功歌词缓存 7 天，最多 30 首；失败结果不缓存为“纯音乐”，再次播放会重试。
- 未取得歌词时显示“暂未获取到歌词，请稍后重试”。

歌词仍取决于来源收录情况。上传者名称代替歌手、混剪或未标注现场版可能匹配不到；没有时间轴的纯文本不会被编造成同步歌词。

## 数据与权限

- LRCLIB 只收到查询所需的歌名、歌手、专辑和时长，不接收 Google Cookie。
- Google 登录和播放的会话处理沿用上游实现，详见 [上游说明](README.upstream.md)。
- 访问域名：`music.youtube.com`、`s.youtube.com`、`api.betterlyrics.org`、`lrclib.net`。
- 本地诊断仅保存歌曲编号、来源、状态和耗时，最多 12 条；不保存请求凭据或歌词正文。
- 发布包采用文件白名单，不打包账号、歌单、音频、缓存或本机配置。

## 自己迭代

克隆仓库，安装 Node.js 22 或更新版本及 Python 3。没有第三方 npm 依赖，无需 `npm install`。

```sh
npm run check
npm test
npm run package
```

`index.js` 是插件实现，`plugin.json` 是名称、版本和权限配置，`test/lyrics.test.mjs` 是匿名请求、缓存、备用源和异常情况的回归测试。打包产物在 `dist/plugin.zip`。

### 发布更新

1. 修改代码，更新 `plugin.json`、`package.json` 和 `CHANGELOG.md` 中的版本。
2. 执行上面的检查和测试。
3. 提交并推送，然后创建与版本一致的标签：

   ```sh
   git tag v0.2.1
   git push origin main --tags
   ```

GitHub Actions 会检查代码并创建带有 `plugin.zip` 的发布版。MyGo Music 检查插件更新后即可获取。首次发布对应 `v0.2.0`。

请勿将 `storage.json`、Cookie、`.env`、插件数据目录或本机音频加入仓库；这些文件已列入 `.gitignore`。
