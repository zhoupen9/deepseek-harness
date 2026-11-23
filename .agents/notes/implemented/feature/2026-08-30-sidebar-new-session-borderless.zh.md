# Agent Note: 侧栏 New Session 无底色左对齐控件

Status: implemented

[English](2026-08-30-sidebar-new-session-borderless.md) | 中文

## 问题

展开侧栏的 New Session 控件是一个填充的 38px 横条——高亮按钮填充加 l2 边框——其图标与标签居中。该底色使其读作一个重量级的主行动按钮，与上方的品牌行和下方的工作区列表争夺注意力，而居中的布局又让标签左缘与列内其他左对齐的行参差不齐。

## 决策

将展开的 New Session 控件渲染为无边框——无背景、无边框——并使其图标与标签左对齐。悬停保留图标按钮已共享的交互背景（`--dsw-alias-interactive-bg-hover`），使控件在无静态底色的情况下仍可读作可交互。折叠的轨道通过 `justify-content: center` 保持其孤立图标居中，因为左对齐只适用于宽度的图标加标签形式。

## 曾考虑的替代方案

**仅左对齐、保留底色**：否决。底色才是更重的问题：无底色左对齐的控件降低了按钮的强调，使其与品牌行安静的 New Session 快捷方式一致。

**同时移除悬停反馈**：否决。轻微的悬停与其他外壳图标控件保持一致，并在控件仅剩图标的轨道上保留可点击暗示。

## 后果

展开的 New Session 控件现在读作一条安静、左对齐的行，与侧栏其余部分一致，悬停是其唯一的强调。改动限于 `SidebarRoot.module.css`（`.newSession`、`.newSession:hover` 与 `.collapsed .newSession` 规则）；不涉及标记或本地化。

## 验证

`sidebar-styles.client.spec.ts` 套件断言 `.newSession` 为 `justify-content: flex-start`、`background: transparent`、`border: none`，悬停使用 `--dsw-alias-interactive-bg-hover`，且 `.collapsed .newSession` 重新居中其图标。
