# Visual regression baselines

视觉回归使用 `toHaveScreenshot()` 与提交的 PNG 基线逐像素比较
（`maxDiffPixelRatio: 0.02`）。基线更新必须基于实际审图。

`scripts/visual-gate.mjs` 当前分别执行：

- 通用视觉、UI evolution 和 UI root 规格：`desktop-wide`（1440×900）与 `mobile`（390×844）。
- 详情与设置、菜单复用、原生推荐规格：配置中的六个视口，包括 1280×720、820×1180、360×640 和 844×390；具体场景的跳过由规格定义。
- 共用查看器与图片类型分离规格：六个视口，直接详情和同源 iframe 的浅深主题；普通剧照与 906×1784 长缩略图分开预览。

`snapshotPathTemplate` 带 `win32` / `linux` 平台后缀，避免字体、栅格化和系统布局差异互相污染。

生成/更新当前平台基线（视觉模式始终使用 package-lock 锁定的 Chromium）：

    npm run build:dev
    cd tests/browser
    npm ci
    npx playwright install chromium --with-deps

PowerShell 示例（在 `tests/browser`，按已审查场景选择规格与项目）：

```powershell
$env:JHS_VISUAL_REGRESSION = '1'
npx playwright test specs/visual-regression.spec.js --project=desktop-wide --project=mobile --update-snapshots
Remove-Item Env:JHS_VISUAL_REGRESSION
```

上述命令只更新通用视觉规格。其他规格须逐场景审查后明确选择更新，不能用批量接受差异代替缺陷修复。完整命令与分支产物说明见 [开发与发布说明](../../../../docs/development.md)。

可设置 `JHS_BROWSER_WORKERS=4` 并行执行门禁；未设置时仍使用一个 worker，启动性能和断言不变。

Windows 与 Ubuntu 24.04 的基线必须分别生成并提交；Linux 基线应在与 CI
相同的 Ubuntu 24.04 环境生成。禁止拿一个平台生成的 PNG 覆盖另一平台。

门禁命令（根目录）：

    npm run check:visual

普通 check:browser 默认跳过视觉回归；只有 `npm run check:visual`
（内部显式设置 JHS_VISUAL_REGRESSION=1）才与已提交基线做真实 diff。
基线 PNG 生成后作为普通文件提交。
