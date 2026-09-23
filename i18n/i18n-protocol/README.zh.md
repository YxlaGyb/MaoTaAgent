---
description: "翻译的方言：有哪些语言、一门语言的回落链是什么、插件如何交出它的词，以及所有交付如何折成一份目录。"
kind: "package-reference"
---

# i18n-protocol

[English](README.md) | 中文

## 概述

翻译据以写作的词，以及提供方据以作答的词。它只有一个文件、零依赖：语言表及每门语言的回落、把 `system` 这类偏好对着机器说法解析掉的规则、`i18n.*` 提供方契约、交付件被读入时经过的边界检查，以及把所有交付折成一份目录的那一步。它不认识任何插件、进程或界面，所以存储、插件与应用可以各自 import 它而不必互相 import。存储、回答宿主的插件、渲染出的文字是三件不同的事。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### 语言

| 导出 | 含义 |
|---|---|
| `Language` | `{ id, label, fallback }`。`label` 是这门语言用自己写的名字，`fallback` 是这门语言没有某个键的词时该去哪门语言里找，没有则是 null。 |
| `BUILTIN_LANGUAGES` | 简体中文回落英文，英文不回落。自行声明语言的部署会替换掉这张表。 |
| `SYSTEM_PREFERENCE` | `"system"`，表示"问机器"的那个偏好值。 |
| `isLanguageId(value)` | 一个字符串的形状是否像语言 id。 |
| `languageOf(value)` | 列表中与某个 id 匹配的语言，比较时忽略大小写。 |
| `languageProblems(languages)` | 列表里的每一处毛病：形状不像 id 的 id、只有大小写不同的两个 id、空 label、指向不存在语言的回落，以及打圈的回落链。 |

语言 id 由 `LANGUAGE_ID` 匹配：两三个字母的主子标签加任意多个子标签，所以 `en`、`zh-CN`、`zh-Hans-CN` 都能过。

### 解析人要的语言

| 函数 | 答案 |
|---|---|
| `resolveLocale(preference, languages, spoken)` | 该用哪门语言渲染。`system`、空串、指向不存在语言的偏好，都回落到机器的说法（按前缀比较），再回落到第一门自己不回落的语言。 |
| `localeChain(languages, locale)` | 查找顺序：这门语言、它的回落、回落的回落，依此类推，每门语言只出现一次。不在列表里的语言自成一条链，所以一个过期的偏好仍然能渲染出东西。 |

### 文案

| 导出 | 含义 |
|---|---|
| `Messages` | `Record<string, string>`，一个键一个词或一句话。 |
| `defineMessages<T>(messages)` | 声明一份字典而不丢掉它的键，于是调用方能在编译期被告知有哪些键。 |
| `format(text, vars)` | 替换 `{name}` 占位符。没有值的占位符原样留下，且每一处都会被替换，不只是第一处。 |
| `MessageVars` | `format` 接受的值：字符串与数字。 |

### 提供方契约

有词要交的插件提供 `i18n.<name>` 能力，它写词用的命名空间就是这个 name。`isI18nCapability(value)` 与 `namespaceOf(capability)` 是围绕这些名字的辅助函数，`I18N_CAPABILITY_PREFIX` 是 `"i18n."`。

| 方法 | 参数 | 答案 |
|---|---|---|
| `describe` | 无 | `I18nDescription`：`{ locales }`，这个插件有词的语言。 |
| `catalog` | 无 | `I18nContribution`：`{ namespace, messages }`，`messages` 是每个语言一份 `Messages`。 |

描述里不带命名空间，因为能力本身就是命名空间：插件不可能用一个不属于自己的名字来打广告。`readI18nDescription(value)` 与 `readI18nWords(value)` 是读取器，载荷不是那个形状时返回 null，而不是返回一个半可用的形状。

### 折叠交付件

| 导出 | 含义 |
|---|---|
| `Catalog` | `Record<locale, Record<namespace, Messages>>`：下游所有东西都读的那一种形状。 |
| `emptyCatalog()` | 一份空目录。 |
| `buildCatalog(languages, contributions)` | `{ catalog, problems }`。同一个命名空间被交付两次会报告并跳过，没有任何语言声明的 locale 会报告并丢掉。 |
| `lookup(catalog, languages, locale, namespace, key)` | 那个词：先沿语言的回落链找这个命名空间，再沿同一条链找 `COMMON_NAMESPACE`，都没有就把键本身原样返回。 |
| `COMMON_NAMESPACE` | `"common"`，任何交付者都可以写进去的命名空间。 |
| `namespaceKeys(contribution)` | `Record<locale, string[]>`：某个交付的命名空间在每个它写到的语言里有哪些键，已排序。 |
| `parityProblems(contributions)` | 只写了一种语言的命名空间，以及一种语言有而另一种没有的每个键，逐个交付件地读。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 全部：语言、解析器、文案、契约、折叠。 |

### 为什么这套方言是叶子

扩展点属于拥有它的那个包，所以交词的插件只写 `i18n.<name>`、对谁来消费一字不提，而消费它的存储只写能力前缀、对谁来写词一字不提。本包让这件事成立：`i18n.` 与 `common` 只在这一个地方被写下来，而两边都能 import 它，因为它谁都不 import。这也意味着解析器只有一份：`zh-Hans-CN` 这种半规格标签无论在哪里被问都以同样方式解析，于是存储和应用不可能对某个偏好的含义产生分歧。

### 为什么命名空间来自能力

`I18nDescription` 声明 `locales`，并且刻意不声明命名空间。如果插件自己给命名空间起名，那个名字就可能与交付者的身份发生偏移，而两个插件可以同时宣称同一个名字却谁都不算错。从能力推导出来，意味着插件的身份和它的地址是同一件事，一份交付只会被归到一个别的插件也归不进去的名字下。因此"同一个命名空间被交付两次"是值得报告的错误，而不是需要解决的合并。

### 边界检查是干什么的

交付件跨进程边界，所以存储不能相信它的形状：`readI18nDescription` 与 `readI18nWords` 逐字段检查，宁可整个拒绝也不部分接受，因为一个半可读的命名空间比一个压根没到的更糟。`languageProblems` 出于同样的理由存在于另一端，作用在部署手写的语言表上。本仓库内部的一切都是有类型的，所以这里不校验静态接口已经保证的值。

### 三件事划定这套方言的边界

一个词就是字符串，没有复数形式也没有标记，所以语法上需要其中任一的语言会被渲染成好几个键。`format` 只做替换、不做别的，所以译者的文字永远不会被当作模板解释。目录是在问过插件的那一刻、用它们的回答一次性折成的，所以后来才加语言的插件，要像任何其他提供方一样把自己的变化公告出来。

-----

<a id="further-exploration"></a>
## 进一步探索

- [i18n-native](../i18n-native/README.md)：调用这些提供方、折叠它们的词、回答宿主的存储。
- [hook-protocol](../../packages/hooks/hook-protocol/README.md)：相邻的那套方言，本包跟随的正是它的能力前缀发现方式。
