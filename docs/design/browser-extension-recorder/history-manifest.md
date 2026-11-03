# 浏览器录制历史原件归档

2026-11-03，经用户同意清理过渡文档与视觉稿。原件按仓库相对路径保存于 [history-2026-11-03.zip](history-2026-11-03.zip)，没有覆盖图像、提示词、原始日期或历史失败记录。归档内容属于历史来源，不作为当前实现要求；当前状态只认 [DESIGN.md](../../../apps/browser-extension/DESIGN.md#附录-a视觉稿状态登记唯一权威入口)。

本次将旧工作流步骤核对、编辑发布、固定引导问卷退出当前入口；保留待修订的 Skill 会话稿和当前基础界面。归档中的 DESIGN.md 是清理前的登记快照，不是第二份现行登记。ADR 与 PoC 原始验证记录仍在原位置。

## 恢复与校验

ZIP 内的 MANIFEST.json 记录每份原件的仓库相对路径、字节数与 SHA-256。先将 ZIP 解压到独立临时位置，按清单核对后读取需要的文件；不要将历史快照直接覆盖现行规范。图片原始内容不变，压缩包不承担运行时资源职责。

归档 SHA-256：`205cf09c8ead2dccbc84bdd4ec5e4b6905cec435bb3442064a9d505bb9372751`。

历史 Markdown 的相对链接保留原文语境；查阅时按原仓库路径与清单定位。未归档的有效图稿仍在当前目录，运行证据仍按原 PoC 记录定位。下列文件名锚点用于让历史引用准确指向归档成员。

## 原件清单

<a id="apps-browser-extension-design-qa-md"></a>

- `apps/browser-extension/design-qa.md` — 12849 bytes；SHA-256 `c5ef9b5319cafe34878a2a0f1855c3299043c7da58507bf9d2f836a7afaf5f67`。

<a id="apps-browser-extension-design-md"></a>

- `apps/browser-extension/DESIGN.md` — 99979 bytes；SHA-256 `d4a379d0329498c0bc2df077ab516bce285aec1771fb5e9aa50326cb0a602422`。

<a id="apps-browser-extension-product-md"></a>

- `apps/browser-extension/PRODUCT.md` — 6746 bytes；SHA-256 `be81164b01070a9a82aac3985586dbdd519ab831e0e708e177f055e34e5623d8`。

<a id="docs-architecture-browser-extension-recorder-md"></a>

- `docs/architecture/browser-extension-recorder.md` — 77112 bytes；SHA-256 `168fbead9b6b801c21d924afd883884aea0a128f3529b4d8cef6322e4379a858`。

<a id="docs-architecture-browser-recording-skill-agent-md"></a>

- `docs/architecture/browser-recording-skill-agent.md` — 33355 bytes；SHA-256 `3dfd6097e3e5c4982a48ad60aa0d54874568c853d8b52bb9eb00fa2d01f940eb`。

<a id="docs-architecture-browser-workflow-guided-organization-md"></a>

- `docs/architecture/browser-workflow-guided-organization.md` — 26278 bytes；SHA-256 `51b8bf19e8dcf26b6eb54c354aeb419ca0e3c0a7051f9a1430eceda5ae65f948`。

<a id="docs-design-browser-extension-recorder-connection-panel-prompts-md"></a>

- `docs/design/browser-extension-recorder/connection-panel-prompts.md` — 3590 bytes；SHA-256 `b2df37e484924ac2f3c3a1faeb3a420602419d4c5fcfb8c0da8ec83775593bb2`。

<a id="docs-design-browser-extension-recorder-model-settings-connection-feedback-prompts-md"></a>

- `docs/design/browser-extension-recorder/model-settings-connection-feedback-prompts.md` — 11151 bytes；SHA-256 `504b5b171a5c6efda4af763bab2366521568e448242c628ce807d0dfee6cd1b3`。

<a id="docs-design-browser-extension-recorder-model-settings-connection-feedback-v1-png"></a>

- `docs/design/browser-extension-recorder/model-settings-connection-feedback-v1.png` — 1479959 bytes；SHA-256 `48a9d80d281abd0d929b246f23ee2e7e884c5cd2ffda87bf57ac25f2b0bd5ac6`。

<a id="docs-design-browser-extension-recorder-model-settings-connection-feedback-v2-png"></a>

- `docs/design/browser-extension-recorder/model-settings-connection-feedback-v2.png` — 1518502 bytes；SHA-256 `026d8182773050e750b65b815b5e5ba5c1c9e590120f8a57e17f566a4246adb2`。

<a id="docs-design-browser-extension-recorder-model-settings-model-list-prompts-md"></a>

- `docs/design/browser-extension-recorder/model-settings-model-list-prompts.md` — 7943 bytes；SHA-256 `df4bf05a94abb5a5289803cfc787a8a35956c49b31c5a0aca12fbbd6ad392639`。

<a id="docs-design-browser-extension-recorder-model-settings-model-list-v1-png"></a>

- `docs/design/browser-extension-recorder/model-settings-model-list-v1.png` — 1469692 bytes；SHA-256 `ac96872da6d6a439b8e551e287c062bb9ae6fd9173bc104f92962f7d6a2a516e`。

<a id="docs-design-browser-extension-recorder-model-settings-model-list-v2-png"></a>

- `docs/design/browser-extension-recorder/model-settings-model-list-v2.png` — 1462460 bytes；SHA-256 `c2615b6ba582adacfc4716cc127431de7d1e826e22fda969ccc2e599efc46dcf`。

<a id="docs-design-browser-extension-recorder-model-settings-v1-png"></a>

- `docs/design/browser-extension-recorder/model-settings-v1.png` — 1092913 bytes；SHA-256 `a8e37bcfc999ad23694d25f8fd895aac8332227a2f95765690a1131671f760d1`。

<a id="docs-design-browser-extension-recorder-popup-box-task-toolbar-prompts-md"></a>

- `docs/design/browser-extension-recorder/popup-box-task-toolbar-prompts.md` — 7235 bytes；SHA-256 `8e02a85b5ddddf6870c80f773591a727adebb7c5a8e5ce888da3029e02971b71`。

<a id="docs-design-browser-extension-recorder-popup-box-task-toolbar-v1-png"></a>

- `docs/design/browser-extension-recorder/popup-box-task-toolbar-v1.png` — 1495859 bytes；SHA-256 `6ace0483a2a35e333ef42f36919edbbd5426be07f988a30ab2ba386c7cde47e1`。

<a id="docs-design-browser-extension-recorder-popup-box-task-toolbar-v2-png"></a>

- `docs/design/browser-extension-recorder/popup-box-task-toolbar-v2.png` — 1490705 bytes；SHA-256 `1e9251265ab0c875ccb6a11ed4319be0f6dd3032d741b12dd06d0b411acb187c`。

<a id="docs-design-browser-extension-recorder-popup-refinement-prompts-md"></a>

- `docs/design/browser-extension-recorder/popup-refinement-prompts.md` — 5135 bytes；SHA-256 `ac49073c623a53656b6f91e74b2b6f870691368d3f8a0266e62df88a5552a651`。

<a id="docs-design-browser-extension-recorder-popup-wrapper-prompts-md"></a>

- `docs/design/browser-extension-recorder/popup-wrapper-prompts.md` — 8008 bytes；SHA-256 `2b432b6ae4cc54f2c846d1f5c5158a20e745d73c5cff94e18c498dfee08c59bc`。

<a id="docs-design-browser-extension-recorder-prompts-md"></a>

- `docs/design/browser-extension-recorder/prompts.md` — 8478 bytes；SHA-256 `8f4fc1b0ab8fb83978145b740c964fac60d72a4429721acc42e03d7b7d0a27b9`。

<a id="docs-design-browser-extension-recorder-readme-md"></a>

- `docs/design/browser-extension-recorder/README.md` — 4404 bytes；SHA-256 `bca1fbe4557a3bffdb5a970c7f6a47795918d0e937a99c438f6c9ae05dcb9a23`。

<a id="docs-design-browser-extension-recorder-recording-detail-v1-png"></a>

- `docs/design/browser-extension-recorder/recording-detail-v1.png` — 1094478 bytes；SHA-256 `b3a1c09611829283e1e18919eb3eb5da13a42c016bda1317fe0d634af508c3fc`。

<a id="docs-design-browser-extension-recorder-recording-detail-v2-png"></a>

- `docs/design/browser-extension-recorder/recording-detail-v2.png` — 1499752 bytes；SHA-256 `9c09caf0ff6307cd82772c3c14cf8918394845f14ef5eccaddbcf4992aa0d59e`。

<a id="docs-design-browser-extension-recorder-recording-detail-v3-png"></a>

- `docs/design/browser-extension-recorder/recording-detail-v3.png` — 1072284 bytes；SHA-256 `326358b6e800213749855f9be58091d975b8992c33dfe6089d3e0091383e1433`。

<a id="docs-design-browser-extension-recorder-recording-detail-v4-png"></a>

- `docs/design/browser-extension-recorder/recording-detail-v4.png` — 1294915 bytes；SHA-256 `2883e15087d4a9bdf56822ce5208c2bcbe415f194fe077af5dca189c57af16d3`。

<a id="docs-design-browser-extension-recorder-recording-detail-v5-png"></a>

- `docs/design/browser-extension-recorder/recording-detail-v5.png` — 1471711 bytes；SHA-256 `de806b51b7d8b1562aac76ca045f70852963c654db30801fdfdd0acf242f5040`。

<a id="docs-design-browser-extension-recorder-recording-flow-prompts-md"></a>

- `docs/design/browser-extension-recorder/recording-flow-prompts.md` — 11163 bytes；SHA-256 `fc19331bc25414a41a35ad449a3e9ebd654c3c378b3b0f814d09a787e5b40f13`。

<a id="docs-design-browser-extension-recorder-recording-list-v1-png"></a>

- `docs/design/browser-extension-recorder/recording-list-v1.png` — 1065733 bytes；SHA-256 `7320e9aac55b6c3627fee18f26c2cbac24d5e0ab74e88c4c4785d0ac984e1965`。

<a id="docs-design-browser-extension-recorder-recording-pagination-prompts-md"></a>

- `docs/design/browser-extension-recorder/recording-pagination-prompts.md` — 3209 bytes；SHA-256 `a2010031ae1a6cf1c837d76e8bc56834cb9196bcd5ca10798bdaa58114566540`。

<a id="docs-design-browser-extension-recorder-recording-partial-v1-png"></a>

- `docs/design/browser-extension-recorder/recording-partial-v1.png` — 1178817 bytes；SHA-256 `1020e8ab83c46ad57a0434aedb866a1eba7d1132157042e92edb656ab6c7ffcf`。

<a id="docs-design-browser-extension-recorder-recording-replay-actions-prompts-md"></a>

- `docs/design/browser-extension-recorder/recording-replay-actions-prompts.md` — 10981 bytes；SHA-256 `ccd1866facca36f78d44664759dc2b9b4cb154e81e082dafa30e6595f258d5dc`。

<a id="docs-design-browser-extension-recorder-recording-start-v1-png"></a>

- `docs/design/browser-extension-recorder/recording-start-v1.png` — 1227581 bytes；SHA-256 `95935e32b22ed48d34307434ddcbe6940e26076aaf7d593b77b3912954b89bec`。

<a id="docs-design-browser-extension-recorder-recording-start-v2-png"></a>

- `docs/design/browser-extension-recorder/recording-start-v2.png` — 1089818 bytes；SHA-256 `9ab99553d60b05e27bb719420ded4ef27229b52c4a2fbeb67b8715355b4c224e`。

<a id="docs-design-browser-extension-recorder-recording-start-v3-png"></a>

- `docs/design/browser-extension-recorder/recording-start-v3.png` — 1317886 bytes；SHA-256 `775a07f358fa7061cbae82eac39dde14c20abca3e32a529e3ffe0eba1b0dd355`。

<a id="docs-design-browser-extension-recorder-skill-agent-additional-states-prompts-md"></a>

- `docs/design/browser-extension-recorder/skill-agent-additional-states-prompts.md` — 3993 bytes；SHA-256 `457d9dc94ea38a6d07de3ef9a9d573671f99d4ce7bdd4402e0e2a824d86ed7f5`。

<a id="docs-design-browser-extension-recorder-skill-agent-additional-states-v1-png"></a>

- `docs/design/browser-extension-recorder/skill-agent-additional-states-v1.png` — 1518619 bytes；SHA-256 `810ab6abf275145e81e9207997ba6ddf453c60241bab30b3e62a0270aea0a44d`。

<a id="docs-design-browser-extension-recorder-skill-agent-session-prompts-md"></a>

- `docs/design/browser-extension-recorder/skill-agent-session-prompts.md` — 10537 bytes；SHA-256 `10c6dcec5764f7a5e4b4c9e81bad9ebf4c3db5b2ac9d964e3770656d22f77f0b`。

<a id="docs-design-browser-extension-recorder-skill-agent-state-refinement-prompts-md"></a>

- `docs/design/browser-extension-recorder/skill-agent-state-refinement-prompts.md` — 14320 bytes；SHA-256 `175c37cbab7d123eb669dfb355ccde3c76df8cefc622f53f7cea4bee8e815651`。

<a id="docs-design-browser-extension-recorder-skill-organizer-session-states-v1-png"></a>

- `docs/design/browser-extension-recorder/skill-organizer-session-states-v1.png` — 1535846 bytes；SHA-256 `b343cd10b6f3bb29e7045d66008c567af8e928ea26d0906da231bfd6ff6862db`。

<a id="docs-design-browser-extension-recorder-skill-replay-history-states-v1-png"></a>

- `docs/design/browser-extension-recorder/skill-replay-history-states-v1.png` — 1280340 bytes；SHA-256 `ae70e76e1e0bdcf6be76605a20ccf27fca0514365dc9544144fef13eaffeda73`。

<a id="docs-design-browser-extension-recorder-step-review-design-md"></a>

- `docs/design/browser-extension-recorder/step-review-design.md` — 4280 bytes；SHA-256 `3e188aba0996423a922ac114635842df576f871a76771e9520c6d2c84cb0431e`。

<a id="docs-design-browser-extension-recorder-step-review-prompts-md"></a>

- `docs/design/browser-extension-recorder/step-review-prompts.md` — 10043 bytes；SHA-256 `38c1f634ddd3a9d1922973600dbfda9018027350bf7b12bb59873139d22025e2`。

<a id="docs-design-browser-extension-recorder-workflow-direct-compile-prompts-md"></a>

- `docs/design/browser-extension-recorder/workflow-direct-compile-prompts.md` — 6225 bytes；SHA-256 `83240f18d97a6f2b43078f898803435b72b85ec951969947de67b672c36e4cbb`。

<a id="docs-design-browser-extension-recorder-workflow-direct-compile-v1-png"></a>

- `docs/design/browser-extension-recorder/workflow-direct-compile-v1.png` — 1578450 bytes；SHA-256 `ef8f963c89c62361ad595f99bf5953a4b7d9e5b00da8b855b7b572c784f31ed6`。

<a id="docs-design-browser-extension-recorder-workflow-editor-board-v1-png"></a>

- `docs/design/browser-extension-recorder/workflow-editor-board-v1.png` — 1449565 bytes；SHA-256 `78e407af09b823594ac79fe98aac1c61bb5ec9cbf1176090bb4cc3264549c66d`。

<a id="docs-design-browser-extension-recorder-workflow-editor-prompts-md"></a>

- `docs/design/browser-extension-recorder/workflow-editor-prompts.md` — 5426 bytes；SHA-256 `306ab96ab5e96124ba3fe420dd913d5978ed54c7f3dc3ce56172758df6f64bb9`。

<a id="docs-design-browser-extension-recorder-workflow-guided-continuation-states-v1-png"></a>

- `docs/design/browser-extension-recorder/workflow-guided-continuation-states-v1.png` — 1230646 bytes；SHA-256 `4b8714dcf94ec9f7c308279324e95d2e25a83cb82fcb5f822649c5a248ce6c4c`。

<a id="docs-design-browser-extension-recorder-workflow-guided-continuation-states-v2-png"></a>

- `docs/design/browser-extension-recorder/workflow-guided-continuation-states-v2.png` — 1562901 bytes；SHA-256 `26f56ed26d92de7f439d130e526efbfd6b5b6e5c036c3976ab8c71eede0a8384`。

<a id="docs-design-browser-extension-recorder-workflow-guided-prompts-md"></a>

- `docs/design/browser-extension-recorder/workflow-guided-prompts.md` — 9930 bytes；SHA-256 `7762b28e9d7618246d7f422e915c333d2b6eeba434f2a7dfa0f38ccf81786ebd`。

<a id="docs-design-browser-extension-recorder-workflow-guided-question-decisions-v1-png"></a>

- `docs/design/browser-extension-recorder/workflow-guided-question-decisions-v1.png` — 1075906 bytes；SHA-256 `e2d19294f774b48416b28de053a51151158ce1eaee1cdc5910ace185a02876b7`。

<a id="docs-design-browser-extension-recorder-workflow-guided-question-evidence-v1-png"></a>

- `docs/design/browser-extension-recorder/workflow-guided-question-evidence-v1.png` — 1073378 bytes；SHA-256 `43b8ed65b3142296418813e5df591e578cb70e5ab964ab92b883db812d636fa3`。

<a id="docs-design-browser-extension-recorder-workflow-guided-question-focus-v1-png"></a>

- `docs/design/browser-extension-recorder/workflow-guided-question-focus-v1.png` — 1088571 bytes；SHA-256 `4011b2da2735ca10cae2deb0167cb1433867813e4743d6271c878f1359426d87`。

<a id="docs-design-browser-extension-recorder-workflow-guided-question-states-v1-png"></a>

- `docs/design/browser-extension-recorder/workflow-guided-question-states-v1.png` — 1425956 bytes；SHA-256 `f3179ad46e27b9abd0475581e28121a9b85962685cbdde0a9317c7be80235dbe`。

<a id="docs-design-browser-extension-recorder-workflow-guided-question-states-v2-png"></a>

- `docs/design/browser-extension-recorder/workflow-guided-question-states-v2.png` — 1560203 bytes；SHA-256 `8caf06fe2496d6cd1bbefb4003eb1a3c57699d8282f02e595c2cdc30fc921dc5`。

<a id="docs-design-browser-extension-recorder-workflow-guided-refinement-prompts-md"></a>

- `docs/design/browser-extension-recorder/workflow-guided-refinement-prompts.md` — 11602 bytes；SHA-256 `8f54355be6cf8a61cf81233254f3486b570107e5d683bc507f99df93cf09c60c`。

<a id="docs-design-browser-extension-recorder-workflow-history-board-v1-png"></a>

- `docs/design/browser-extension-recorder/workflow-history-board-v1.png` — 1255837 bytes；SHA-256 `4d321b74e1bc1236afd9841eb82688cce4e010c83f24b47ac1e18a2438d922b1`。

<a id="docs-design-browser-extension-recorder-workflow-history-board-v2-png"></a>

- `docs/design/browser-extension-recorder/workflow-history-board-v2.png` — 1352229 bytes；SHA-256 `941bcab9ab18a811aa5cde52684a2e0348c5a861c8bba4f7eec49943fd2e2e6e`。

<a id="docs-design-browser-extension-recorder-workflow-history-prompts-md"></a>

- `docs/design/browser-extension-recorder/workflow-history-prompts.md` — 4664 bytes；SHA-256 `871cd8972a2ba40b96bc03654f4ed46852a69c5871c82551c107bde723fff287`。

<a id="docs-design-browser-extension-recorder-workflow-phase2-board-v1-png"></a>

- `docs/design/browser-extension-recorder/workflow-phase2-board-v1.png` — 1495951 bytes；SHA-256 `bd436f29244281a508da879932ee076ef77bdc4822fd5ef3c1e110dbf16935d4`。

<a id="docs-design-browser-extension-recorder-workflow-phase2-board-v2-png"></a>

- `docs/design/browser-extension-recorder/workflow-phase2-board-v2.png` — 1454076 bytes；SHA-256 `9bc3543a5da3a9014fb40eed31c16410b0487ea036a407b3c9b4363f1258a2da`。

<a id="docs-design-browser-extension-recorder-workflow-phase2-board-v3-png"></a>

- `docs/design/browser-extension-recorder/workflow-phase2-board-v3.png` — 1687284 bytes；SHA-256 `89b02f96a0387ea7d0bfd0fe65933e79ed064898fd8b9151f23d14081a28f9f2`。

<a id="docs-design-browser-extension-recorder-workflow-phase2-prompts-md"></a>

- `docs/design/browser-extension-recorder/workflow-phase2-prompts.md` — 7242 bytes；SHA-256 `0254d044eb6d22ecc345e50c7bfbb2656322bfd25fb9d433327e959630d6a420`。

<a id="docs-design-browser-extension-recorder-workflow-recent-all-compact-v1-png"></a>

- `docs/design/browser-extension-recorder/workflow-recent-all-compact-v1.png` — 1589959 bytes；SHA-256 `1507936355bb287dea214b7e33622d9d619b87d18eef696feb5d3448f76462d9`。

<a id="docs-design-browser-extension-recorder-workflow-recent-all-prompts-md"></a>

- `docs/design/browser-extension-recorder/workflow-recent-all-prompts.md` — 6085 bytes；SHA-256 `0b82f4152d68ff356e573a228b887df8c1bb4f1478b11d6d10ef30f8e752bedf`。

<a id="docs-design-browser-extension-recorder-workflow-step-review-evidence-v1-png"></a>

- `docs/design/browser-extension-recorder/workflow-step-review-evidence-v1.png` — 1438502 bytes；SHA-256 `794953a25f6e67e447758008bfd09e0e0c761e19fddafb05a6fd94e2f18cb546`。

<a id="docs-design-browser-extension-recorder-workflow-step-review-focus-v1-png"></a>

- `docs/design/browser-extension-recorder/workflow-step-review-focus-v1.png` — 1484543 bytes；SHA-256 `caa53078472eba66278bb28731b46fe6b0f3d43208da16791aba81d8b2883d18`。

<a id="docs-design-browser-extension-recorder-workflow-step-review-footer-v1-png"></a>

- `docs/design/browser-extension-recorder/workflow-step-review-footer-v1.png` — 1431898 bytes；SHA-256 `bbc96c985d89aa16b8e4530eed84dfd33f8edf1572188273ae1cd3781474302d`。
