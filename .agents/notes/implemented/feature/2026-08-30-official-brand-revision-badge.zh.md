# Agent Note: 官方品牌加页脚版本标签

Status: implemented

[English](2026-08-30-official-brand-revision-badge.md) | 中文

## 问题

`ui-brand-official` 插件在 `sidebar.brand.name` 槽位渲染 DeepSeek Harness 字标，但只有外壳回退——「DSH Local Build」标签——会显示构建的 git 版本。因此启用官方品牌的本地开发者会失去版本标识：该版本由侧栏的回退分支计算，一旦名称槽位被占据就不再渲染。

## 决策

侧栏外壳在品牌行下方、New Session 上方声明一个新的 `sidebar.footer.version` 席位，`ui-brand-official` 的 `OfficialBuildRevision` 在那里渲染可选的版本标签。版本不再堆叠在字标下方，因此品牌行保持单一干净的一行，外壳的品牌行顶部对齐适配也随之移除。该选择是构建期公开值 `DSH_CLIENT_REVISION_BADGE=true`；文本为 `version[-commit]`，由与侧栏回退所读取相同的 `DSH_CLIENT_VERSION` 与 `DSH_CLIENT_COMMIT_HASH` 值拼装。它以淡灰色（`--dsw-alias-label-tertiary`）渲染在品牌行下方，收起轨道时隐藏，标志关闭或 `DSH_CLIENT_VERSION` 缺失时省略。官方发布构建不设置该标志，因此其字标保持干净；本地构建在 `DSH_CLIENT_BUILD_PROFILE=official` 与 `DSH_CLIENT_TITLE` 之外设置它，即可获得官方品牌加版本。

## 曾考虑的替代方案

**在名称槽位中把版本渲染到字标下方**：否决。把它堆叠在 24px 字标下方会迫使品牌行增长为两行，并要求将外壳品牌槽位顶部对齐；品牌行下方的席位让精心维护的字标保持干净，并把版本放在品牌附近而不拥挤它。

**只要存在版本元数据就渲染版本**：否决。官方发布构建同样内联 `DSH_CLIENT_VERSION` 与 `DSH_CLIENT_COMMIT_HASH`，无条件的版本行会改变精心维护的发布字标；选择标志使发布外观保持不变。

**把字标嵌入外壳回退**：否决。外壳回退是通用的，且已经渲染 DeepSeek 鲸鱼标志；把完整字标放进去会把品牌图形移入外壳，而不是保留在品牌插件中。

## 后果

本地构建通过设置 `DSH_CLIENT_REVISION_BADGE=true` 即可显示官方字标加 git 版本。版本标签位于 `ui-brand-official` 内——一个 CSS 模块加一个格式化辅助函数——渲染到外壳拥有的品牌行下方的 `sidebar.footer.version` 席位，而侧栏品牌行保持单行居中的布局。版本格式化是一个小型私有辅助函数而非共享导出，因为为一个小的折叠拓宽客户端插件的公开 API 并不划算。

## 验证

`browser-plugin.client.spec.tsx` 套件断言：选择显示时版本标签以 `version-commit` 文本渲染；标志关闭、缺少版本元数据以及收起轨道时文本均不出现。`sidebar-root.client.spec.tsx` 与 `apply.client.spec.tsx` 套件断言外壳声明并渲染 `sidebar.footer.version`，且与其他页脚席位共享相同的 `wide` 标志。
