# 《魔女之旅》同人游戏：设计与维护文档

本文是这个游戏的**主文档**。AI 代理的工作守则另见仓库根目录的 [AGENTS.md](../AGENTS.md)，玩家反馈集中在 [Issue #7](https://github.com/shoal-rat/majo-no-tabitabi/issues/7)。仓库从《月帷巫女》引擎分出，`docs/DESIGN.md` 和 `docs/api/*.md` 的前半部分描述的是那款游戏（神社、月帷、影祟、八系灵诀），只当引擎参考；两者冲突时以本文为准。各系统的接口细节仍在 `docs/api/<系统>.md`，每个文件末尾的 “as built / round” 小节是本作的新增内容。

## 1. 铁律

1. **玩家可见的文字不写在代码里。** 全部放在 `src/locales/zh-CN/<命名空间>.js`，用 `t()` / `raw()` 读取；文件名以所属系统开头（`ui.touch.js`、`combat.js`、`elements.js`……）。按键用 `{guard}`、`{cast}` 这类占位符，经 `fill()` / `G.input.keyLabel()` 在电脑上显示键名，在手机上显示按钮名。交付前 `node tools/check-i18n.mjs src` 必须通过。
2. **存档向后兼容。** 存档键 `majo_no_tabitabi_episodes_save_v1` 不改；新增持久字段一律在 `src/core/save.js` 的 `defaultState()` / `defaultSettings()` 给默认值；改动剧情进度时要让旧存档能补齐（参考 `story.js start()` 的回填）。
3. **测试不碰玩家存档。** 只用 `tools/play.mjs` 和 `tools/acceptance/*`（一次性无头浏览器档案，`autostart=1` 不写档）。不要用常规浏览器、内置浏览器、47327 端口或桌面版测。
4. **原创与参考。** 动画官方剧照只作私下参考，放在仓库外的 `~/Claude_Test_1/majo-no-tabitabi-refs/`，永远不进仓库、不发布。对白、怪物、地标、关卡由本作原创；可以借鉴《旷野之息》的设计**方法**（三角形法则、引力、化学引擎三规则），不搬它的内容、名字和外观。
5. **性能分档。** 新内容按 `G.quality`（`low/med/high`）缩放数量；静态几何合并（`bakeStatic` / 分块烘焙）、重复物实例化、远处换低模或剔除；手机默认 `mobile`（掌上：至少 1080 行、30 帧，吃紧时先减景物再降到 900 / 720 行，设置「保持 1080」可锁定）。
6. **系统间访问一律可选链**（`G.fx?.burst(...)`），`update()` 里不抛异常、不每帧分配对象。

## 2. 地图与剧情

- 坐标：X、Z 各 ±2450 m，+X 东，−Z 北，海平面 y=0。路线从东到西：故乡 (2220,50) → 芙兰的森林与林中试炼地 (2055..2100) → 星痕湖 (1725,−48) → 东部草原 (1340,−110) → 西行荒野 (180,−208) → 高山口 (−1235,−286) → 魔法使之国 (−2160,−520)。主路 `ROAD_ACROSS`，剧情锚点 `JOURNEY_ANCHORS`，均在 `src/data/journey-map.js`。
- 任务：`src/story/questdefs.js`（第一话 `apprentice`、第二话 `mages`），对白在 `src/locales/zh-CN/story*.js`。第二话在城门道别后播放尾声与片尾名单（`G.ui.showEnding`，名单内容在 `ui.credits`，其中「制作」一节写明 Director：Shoal_Rat、github.com/shoal-rat，以及 Claude Opus 5.5、Claude Fable 5.2、ChatGPT 5.2 Astra，不要删改）。
- 元素随剧情解锁：读书后得风；芙兰坦白后得水、火、冰；授名（`invest`）时得岩 2 级、雷 2 级以及风水火冰的蓄力大式。
- 地标：`src/data/landmarks.js` 收录全图 47 个原创地标（id、类型、尺度 large/medium/small、坐标、`affords` 可互动方式）。布局按三角形法则与「引力」：不同大小的目标从不同方向吸引玩家，骑帚每 4～5 秒就有新东西入眼；`node tools/journey/poi-coverage.mjs` 可出覆盖热力图。

## 3. 魔法使之国（垂直之城）

本作城市的设计核心：**高楼、高城门、街谷底部昏暗，生活在高处，骑扫帚在露台之间跳跃是最方便也最好看的走法。**
- 建筑：`src/world/builders/mage-city.js`、`bellcrown.js`，数据 `src/data/bellcrown.js`。城门拱高 22.5 m、城门塔 92 m；城心抬高 16 m，有大教堂和玫瑰窗。约 1000 个可落脚的露台、屋顶起降台和廊桥都是真平台（`G.world.addPlatform`）。
- `CITY_LIFE`（`src/data/bellcrown.js` 导出，也挂在 `G.structures.places.landOfMages.life`）提供尖塔、露台、街道中线、广场、空中航道、禁入区等坐标，供城市生活（飞行魔女与人流，`src/world/life/city-*`）使用。
- 街谷明暗：`veilhook` 的 `mvCanyonSky()` 让城内低处只保留约 1/3 天光，到露台高度恢复；广场保持开阔。参数在 `world/sky.js`（`U.mvCanyon*`）。
- 剧情点（城门穿越、屋顶相撞、修瓦、旅馆、练习场）必须始终可用；改城市布局后跑 `journey-story.mjs` 与 `journey-city-clouds.mjs`。
- 旅馆柜台有小店（`SHOPS.city_shop`，修好屋瓦后开张），用星屑买面包和四种成长道具。

## 4. 画面

- **色调**：设置项 `look`，`soft`（默认，参考二游的通透调色：收住高饱和色、低对比、冷色抬起的阴影、高光压在纸白以下、淡蓝空气透视）与 `vivid`（原版）。预设在 `src/render/post.js` 的 `GRADES` / `LOOKS`，由 `world/sky.js` 每帧混合。草叶材质保持 100% 原色（作者在 PR #2/#3 中选定）。
- **光比与太阳**：日常太阳轨迹正午约 50°（`veil.js DAY_ARC`），上午下午有长斜影和暖色侧光；湖面日食的剧情太阳不受影响。`LOOKS.soft.key/fill` 控制日光与天光比例；云隙光柱 `shafts` 有上限，避免逆光整屏发白。
- **天气**：`world/journey-weather.js`。沿途时间占比约 30% 晴、40% 晴天积云、20% 多云、10% 阵雨。积云以 330 m 的翻卷噪声为主（`cloudVolume.js`），云底偏灰蓝；云影边缘收紧（`cloud-shafts.js mvCloudSunAt`）。
- **演出镜头**：设置项 `cinematic`（慢动作、镜头切角、屏幕闪色），`shake` 控制震动。

## 5. 玩法系统

- **元素**（`src/elements/`，`docs/api/elements.md` “Element weaving”）：化学引擎三规则——元素改变物质、元素改变元素、物质不直接改变物质。地面元素区域（水洼、电光水洼、冰面、蒸汽云、泥沼、霜地、熔岩），29 种组合与法术融合（炎旋、雷雨云、冰雹、巨浪……），首次发现记入 `G.state.elementNotes` 并显示在手记「元素笔记」页。
- **战斗**（`src/combat/`，`docs/api/combat.md`）：故乡与城内不刷怪；东部草原轻量，西行荒野与高山口有营地、精英（5 个具名，打败一次即记录）与空袭伏击；每种怪要不同的应对（元素护盾只被克制元素打破、架势条、破绽）。芙兰对练三阶段，通关后可重温，林中空地还有星尘试炼。
- **地形破坏**（`src/world/destruction.js`，`docs/api/terrain.md` “Destruction round”）：坑、隆起、倒树、碎石、断墙都会存档；`G.world.carveGuard()` 保护城镇、故乡、剧情锚点。**恢复**（按 `playTime`）：焦痕约 4 分钟褪去，草 2.5～6 分钟长回，烧焦的树 8 分钟后 4 分钟内长回新叶，倒下的树 20 分钟后长出树苗、30 分钟长成；坑本身保留，坑底 10 分钟后慢慢长草。
- **特效与决斗演出**（`src/fx/circles.js`、`src/fx/duel.js`）：施法魔法阵、彗星光尾、格挡蜂巢与星芒、慢动作节拍、决斗取景。
- **手机**（`src/ui/touch.js`，`docs/api/ui.md` “Touch and small screens”）：左摇杆、右侧拖视角、随状态变化的按钮；动作经 `G.input.virtual` 注入，玩法代码只读 action，不读原始键码。
- **衣装**（`src/data/outfits.js`、`src/ui/wardrobe.js`，`docs/api/heroine.md` “Wardrobe (journey)”）：日常服、魔女服、潮祭水着、暮海水着四套。伊蕾娜第一话只有十四五岁，所以两套水着要等两话都走完（`majo_finished`）才开放；日常服和魔女服在授名（`majo_named`）后可自由挑选。两话进行中由剧情决定衣装（第一话日常服、第二话魔女服），读档和每个剧情节点前都会换回，过场里不会穿错；通关后玩家的选择在读档时保留，剧情不再改动。水着模型由 `node tools/journey/swimwear.mjs` 从原引擎的两套水着生成（换上伊蕾娜的发型与瞳色），衣装图用 `node tools/costume/wardrobe-pics.mjs` 重拍。
- **野外探索**（`src/gameplay/wilds*.js`，数据 `src/data/wilds.js`，文字 `gameplay.wilds.*`，`docs/api/gameplay.md` “Activities round”）：借鉴《旷野之息》的方法，内容原创。
  - **迷星**：48 颗（39 颗挂在地标上：塔顶、风车帽、桥洞下、石棚里、井口；9 颗在各区最高的山顶），远处一闪一闪（每颗一个点精灵，一次绘制），碰到即拾，骑帚也行。每 6 颗发一次奖励并浮现一句「漏星魔女的手记」，第 12/24/36/48 颗各送一级成长。
  - **地标**：首次靠近弹出名字（大地标用横幅），记入地图和手记「旅途见闻」页（按 6 个区统计地方、迷星、匣子）。石堆可以「添一块石头」，高处（望楼、灯塔、古堡顶、水道桥）会自动把附近的迷星标在地图上。
  - **机关**（17 处，只靠元素规则解）：点火（烽火篮、灯塔灯）、烧荆棘、雷或岩击碎落石、冰冻水潭定住漂流的匣子、水或冰浇灭余烬、淋湿后一道雷走遍十三块立石、三阵风吹转风车桩、点燃天灯后追上它。状态存 `G.state.wilds.puzzles`；冻住的水面、飞走的天灯属于物理状态，不存档，重来即可。
  - **飞行环线**：3 条（海岬、古树、南谷），穿过第一个光环就开始计时，奖章与最佳成绩存 `G.state.wilds.rings`。奖章时间由验收脚本里的自动驾驶在巡航速度下标定。
  - **经济**：探索约给 2400 星屑和 6 级免费成长；`UPGRADES` 价格已下调，彻底探索的玩家一周目大约能到 15/20 级。
  - 都不进城市、故乡和剧情锚点的保护范围，不碰剧情步骤；验收：`node tools/acceptance/journey-activities.mjs`（`ACT_RINGS=all` 飞全部三条环线）。
- **路边的托付**（`src/gameplay/errands*.js`，数据 `src/data/errands.js`，文字与对白 `gameplay.errands.*`，`docs/api/gameplay.md` “Errands round”）：五个旅人的小故事——骑帚送信并带回回信、追被风卷走的帽子（风魔法能把它兜回来）、用火点着牧羊人的炉子、用冰冻住断桥下的浅滩让南瓜车过河、把迷星手记念给城前路边祠的魔女听；有扫帚才出现，主线当前目标在 220 m 内时让路，状态存 `G.state.errands`，进行中的托付占用 HUD 目标栏，手记「旅途见闻」页有一栏；练习草地的土跑道是 `ROADS` 里的环形小路（`PRACTICE_TRACK`），道具在 `world/builders/practice-field.js`；验收 `node tools/acceptance/journey-errands.mjs`。

## 6. 验收与维护工具

| 命令 | 检查什么 |
| --- | --- |
| `node tools/acceptance/journey-story.mjs` | 两话主线、读档、对练结局、片尾名单、重温对练 |
| `node tools/acceptance/journey-flight.mjs` | 横穿地图、天气、太阳、风车、玩家坑的存档往返 |
| `node tools/acceptance/journey-cloud-weather.mjs` | 云量变化与存档时间重现 |
| `node tools/acceptance/journey-city-clouds.mjs` | 城墙被云遮住再出现、云隙光 |
| `node tools/acceptance/journey-eclipse.mjs` | 渡湖日食与水面反射 |
| `node tools/acceptance/journey-activities.mjs` | 野外探索：八类机关用真实法术解开、拾迷星、石堆、飞一条环线、存档往返、地图与手记页截图 |
| `node tools/acceptance/journey-errands.mjs` | 路边委托：五个委托完整走完（对话、送信飞行、追帽子、生火、冻河、迷星），途中两次存档往返 |
| `node tools/check-i18n.mjs src` | 代码里没有写死的中文 |
| `node tools/dead-code.mjs` | 列出没被打包进游戏的源文件（清理引擎遗留用） |
| `node tools/play.mjs --name x --script f.js [--mobile]` | 无头运行、截图、触屏模拟 |

清理原则：引擎遗留但本作用不到的模块直接删除（2026-11-22 已删 22 个：旧神社/村庄/千灯镇/宫殿等建筑生成器、旧同伴与过场、海岸与浮空岛地形）；旧地图坐标的数据（`src/data/world.js` 的 `ANCHORS` 等）仍被引擎底层引用，改动前先确认调用方。
