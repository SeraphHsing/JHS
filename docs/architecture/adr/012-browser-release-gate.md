# ADR-012：Browser 与发布门禁

状态：Accepted

Playwright 位于 Node 22+ 独立子项目，不进入根项目依赖或默认本地 check。本地功能回归驱动已安装的 msedge（可切 chrome），不由功能测试自动下载浏览器；视觉回归使用 package-lock 锁定的 Playwright Chromium，须显式准备。CI 使用临时 runner 的 Chromium。Harness 以真实 host URL 配合本地 `route.fulfill`，其他网络全部 abort。

从 6.5.0 起，发布门禁由 Vitest、真实浏览器 fixture、视觉回归、启动性能和构建产物一致性检查组成。`check:release` 必须全部通过；外部站点和云服务的在线状态不作为可重复的自动发布门禁。

7.0 实现细节：develop 的浏览器 harness 默认使用 `dist/dev/JHS-7.0.dev.user.js`，正式产物保持不变。功能规格覆盖六个视口，另有仅运行控件状态规格的 `firefox-controls` 项目；需要该项目时显式准备 Firefox。视觉规格按各自范围覆盖两视口或六视口，基线分平台隔离。

`check:browser` 先运行启动性能再运行功能，前项失败会阻断后项；诊断时可独立运行 `npm --prefix tests/browser run test:functional`。独立功能通过不能替代完整门禁通过，也不能替代已安装脚本的登录实站验收。具体操作见 [开发与发布说明](../../development.md)。
