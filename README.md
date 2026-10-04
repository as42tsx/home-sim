# 家装模拟器 Home Sim

在浏览器里画户型、看面积、算楼梯。打开就能用，不用登录，不收费。方案留在这台电脑上。电脑端优先；分享链接在手机上也能打开。

在线地址：<https://as42tsx.github.io/home-sim/>

## 当前状态

M1 可以在浏览器里选模板或从空白开始，画墙、看使用面积、放门窗和家具，撤销重做，并自动保存在这台电脑上。按 `T` 或「看 3D」进入三维鸟瞰（剖切、漫游、复位）。「分享」生成只读链接，「导出 PNG」按当前是平面还是三维出图。

只有一层时楼层切换条整块隐藏。M1 不显示加楼层的「+」。导入两层样例时，平面图停在最低一层并提示楼层数，三维按标高把各层叠在一起。

## 怎么用

桌面顶栏从左到右是方案名、户型 / 布置 / 3D、撤销、重做、分享、文件、语言和「看 3D」。左侧是工具，右侧是当前选中对象的属性。

- **户型**：选择、画墙、房间、门、窗、拆墙、测量、平移。画墙时直接输入毫米，回车按这个长度落点。
- **布置**：从左侧家具库拖到平面图上。重叠时两件都用红色描边。`R` 旋转 15°，手机上的「旋转」一次 90°。
- **3D**：鸟瞰可旋转缩放。剖切把视口切到约 1.2 m。漫游会先回到平面图，点一下选择起点（视线高度 1.6 m），`Esc` 退出漫游。

文件菜单可以导出 / 导入 JSON，或导出 PNG（平面或当前三维视角，长边 3200 像素）。

分享链接形如 `https://as42tsx.github.io/home-sim/#p=…`。对方打开后是只读：可以平移、缩放、点选查看和看 3D，不能改墙和家具，也不会写入他的浏览器，直到点「保存到我的方案」。超过 48 KB 时不生成链接，改用导出 JSON。链接被截断时提示「链接不完整」。

手机（宽度小于 600 px）顶栏只留方案、撤销和重做，其余在底部「更多」。底部四个标签是户型、布置、3D、更多。户型模式左侧浮动五个工具（选择、画墙、门、窗、拆墙），单指使用当前工具，双指平移缩放。只读分享页把标签收成 2D、3D 和「保存」。

平板竖屏（600–899 px）保留左侧工具条，家具库和属性收进底部抽屉。900–1199 px 时属性面板改为可收起的浮层。

### 键盘

| 键 | 作用 |
| --- | --- |
| `V` `W` `D` `N` `X` `M` `H` | 选择、画墙、门、窗、拆墙、测量、平移 |
| 数字后回车 | 按毫米长度放下这一段墙 |
| `Backspace` | 画墙时删掉刚输入的数字，或撤回上一段 |
| `Esc` | 结束画墙（已画的保留）；漫游中退出漫游 |
| `T` | 看 3D |
| `R` | 旋转选中的家具 15°；没有选中家具时切换到房间工具 |
| `F` | 翻转门的开向 |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做 |
| `Ctrl+D` | 复制选中的家具 |
| `Shift` | 暂时关闭吸附 |
| 空格拖动 | 平移画布 |

## 已知限制

- 界面一次只编辑当前楼层。多楼层的加层、楼梯拖拽和「隐藏上层」不在 M1。
- 模板面积对照的是设计表 v1.3 的中线面积，容差 ±0.1 m²。需求稿里写的 0.01 m² 是内净口径的目标，和这套中线表不是同一个数。
- 三维在不支持 WebGL 的浏览器里会停用，平面图不受影响。
- 本仓库还没有项目许可证，见下文。不放置 LICENSE 文件。

## 净室声明

产品灵感来自 wy51ai/floorplan-3d，但该仓库没有开源许可证。本仓库没有参考、没有复制它的任何源码、户型数据或模型，全部独立实现。持续集成里有标识符检查（`npm run cleanroom`），用来防止那些名字混进来。

## 目录

```
index.html                 编辑器壳（桌面优先）
styles/                    设计 token、壳层网格、编辑器样式
src/model/                 方案、校验、迁移、常量
src/geometry/              向量、线段、多边形、布尔
src/rooms/                 墙规范化与房间推导
src/openings/              门窗端距
src/stairs/                楼梯几何；规范表在 rules/
src/slab/                  分层楼板与开洞
src/io/                    JSON、分享链接、PNG 尺寸
src/plan2d/                二维平面（SVG）
src/view3d/                数据驱动的三维视图（three.js 只在进入 3D 时加载）
src/ui/                    编辑器界面，含平面 PNG
src/editor/                撤销、吸附、碰撞等纯逻辑
src/store/                 本机方案列表与自动保存
src/i18n/  i18n/           文案加载器与中英 JSON
schema/                    plan v2 与模板模式、示例
templates/                 一居、两居、三居
rules/                     cn / jp / us 楼梯限值
fixtures/                  两层带楼梯的示例
dev/                       三维调试页（不进普通编辑流程）
docs/                      数据模型、面积核对、M1 验收记录
vendor/                    three.js、多边形布尔、lz-string
test/                      node --test
e2e/                       Playwright 验收脚本（不进 node --test）
scripts/                   面积报告、净室检查
```

## 数据模型

见 [docs/data-model.md](docs/data-model.md) 和 [schema/plan.v2.schema.json](schema/plan.v2.schema.json)。

坐标毫米，x 向右、y 向下。楼层共用一个平面坐标系。房间只存名称、类型、地面材料和种子点，多边形每次由墙推出来。

## 房间识别

对指定楼层（不会去改别的层，也不会改输入）：

1. 丢掉已拆除的墙，把容差内的节点焊在一起，拆开 T 接和交叉，合并真正重叠的共线墙，短于 50 mm 的墙忽略。虚拟分隔线按厚度 0 参加。
2. 半边遍历找出每个闭合面，剪掉悬挂边。套在别的面里的连通块挖成洞，自己仍算出一个房间。
3. 每条边按自己那堵墙的一半厚度向内退，得到内净面积。中线面积另记。
4. 用种子点把原来的房间名对回去。合并时留下面积较大的那一侧；拆分时种子所在的一块留原 id，其余叫「房间 N」。

缺一条边时房间数为 0，并给出最近两个断点的距离。默认容差 10 mm。

## 模板与面积

三套户型来自设计批次的 v1.3 表（v1.2 作废），编成墙和门窗，不预存房间多边形。核对表由 `npm run report` 生成，见 [docs/template-area-report.md](docs/template-area-report.md)。

v1.3 的坐标是墙中线。`expected.rooms.areaM2` 仍是中线面积，推导中线与它相差在 ±0.1 m² 以内。给用户看的使用面积是推导内净、不含阳台，记在 `templates/index.json` 的 `netAreaM2`：一居 34.41 m²、两居 57.07 m²、三居 80.56 m²。报告里的不含阳台内净合计是 34.4052 / 57.0744 / 80.5644 m²。三居不含阳台的中线合计是 88.9200 m²（`expected.interiorTotalM2` 为 88.9）。端距违反 0 条。三套模板的不可达房间都是（无）。

## 楼梯规范参数

`checkStair` 只给提示，对照的是调用方传入的规则对象。下面的数是 2026-09-30 按所列出处核对后写进 `rules/*.json` 的。**不是合规认证，也不能代替正式出版物。**

### 中国 `rules/cn.json`

出处：

- GB 50096-2011《住宅设计规范》第 5.7.3、5.7.4 条（套内楼梯；不在已公布的 GB 55038-2025 替代清单里）：<https://gf.cabr-fire.com/article-7235.htm>
- GB 50352-2019《民用建筑设计统一标准》第 6.8 节：<https://gf.cabr-fire.com/article-30062.htm>

| 项 | 数值 | 条文 | 已核对 |
| --- | ---: | --- | --- |
| 一边临空梯段净宽 `widthOpenSide` | ≥ 750 mm | GB 50096-2011 §5.7.3 | 是 |
| 两边为墙梯段净宽 `widthBetweenWalls` | ≥ 900 mm | GB 50096-2011 §5.7.3 | 是 |
| 踏步宽 `treadMin` | ≥ 220 mm | GB 50096-2011 §5.7.4 | 是 |
| 踏步高 `riserMax` | ≤ 200 mm | GB 50096-2011 §5.7.4 | 是 |
| 扇形踏步宽 `winderTreadMin` | ≥ 220 mm | GB 50096-2011 §5.7.4 | 是 |
| 扇形踏步量取位置 `winderMeasureOffset` | 距扶手中心 250 mm | GB 50096-2011 §5.7.4 | 是 |
| 转向平台宽 `landingTurnMin` | ≥ 梯段净宽且 ≥ 1200 mm | GB 50352-2019 §6.8.4 | 是 |
| 直跑中间平台宽 `straightLandingMin` | ≥ 900 mm | GB 50352-2019 §6.8.4 | 是 |
| 每梯段踏步 `flightStepsMin` / `flightStepsMax` | 3–18 级 | GB 50352-2019 §6.8.5 | 是 |
| 平台处净高 `headroomLanding` | ≥ 2000 mm | GB 50352-2019 §6.8.6 | 是 |
| 梯段净高 `headroomFlight` | ≥ 2200 mm | GB 50352-2019 §6.8.6 | 是 |
| 室内扶手高 `handrailMin` | 不宜 < 900 mm | GB 50352-2019 §6.8.8 | 是 |
| 水平栏杆长度超过 `guardLongThreshold` | 500 mm 时栏杆 ≥ 1050 mm（`guardLongMin`） | GB 50352-2019 §6.8.8 | 是 |
| 表 6.8.10 住宅套内踏步 `tableTreadMin` / `tableRiserMax` | ≥ 220 mm / ≤ 200 mm | GB 50352-2019 表 6.8.10 | 是 |
| `gb55038Check` | 无数值 | GB 55038-2025 | 否 |

宽度检查取 900 mm（两边为墙），严于临空的 750 mm。GB 55038-2025《住宅项目规范》自 2025-05-01 起为强制性规范，可能重述套内楼梯限值；尚未对照其正文，所以 `verified` 为 false，不拿它做判断。

### 日本 `rules/jp.json`

建筑基准法施行令（昭和 25 年政令第 338 号），条文取自 e-Gov：<https://laws.e-gov.go.jp/api/1/lawdata/325CO0000000338>

| 项 | 数值 | 条文 | 已核对 |
| --- | ---: | --- | --- |
| 住宅楼梯踢上 `riserMax` | ≤ 230 mm | 第 23 条第 1 项但书 | 是 |
| 住宅楼梯踏面 `treadMin` | ≥ 150 mm | 第 23 条第 1 项但书 | 是 |
| 楼梯及休息平台宽 `widthMin` | ≥ 750 mm | 第 23 条第 1 项表（四） | 是 |
| 折返楼梯踏面量取 `winderMeasureOffset` | 自窄端 300 mm | 第 23 条第 2 项 | 是 |
| 扶手计入宽度的上限 `handrailWidthCredit` | 100 mm | 第 23 条第 3 项 | 是 |
| 可作上述扣除的扶手高度 `handrailCreditHeightMax` | ≤ 500 mm | 第 23 条第 3 项 | 是 |
| 超过此高度须设平台 `landingIntervalRise` | 4 m | 第 24 条第 1 项 | 是 |
| 直楼梯平台踏宽 `straightLandingMin` | ≥ 1200 mm | 第 24 条第 2 项 | 是 |
| 折返平台宽 `landingTurnMin` | ≥ 750 mm | 第 23 条第 1 项表（四） | 是 |
| 扶手 `handrailRequired` | 有扶手要求，无毫米数 | 第 25 条 | 是 |
| 梯段净高 `headroom` | 无数值 | 令第 23–27 条没有楼梯净高 | 否 |

净高没有法定数字，不编造。共同住宅的共用楼梯不适用「住宅」那一档但书，本表只覆盖住宅套内。

### 美国 `rules/us.json`

2021 IRC §R311.7。数值对照 Stairway Manufacturers' Association 对 2021 IRC 的逐字摘录（ICC 站点屏蔽了自动抓取，所以注明「已对照 SMA 转载的条文，未直接读到 ICC 页面」）。PDF：<https://www.viewrail.com/wp-content/uploads/2025/04/2021-International-Residential-Code-Visual-Interpretation.pdf> 。ICC：<https://codes.iccsafe.org/content/IRC2021P2/chapter-3-building-planning> 。2024 IRC 重排过楼梯条文，没有采用。

| 项 | 数值 | 条文 | 已核对 |
| --- | ---: | --- | --- |
| 扶手高度以上净宽 `widthClear` | ≥ 36 in（914 mm） | R311.7.1 | 是 |
| 单侧扶手处净宽 `widthBelowOneHandrail` | ≥ 31½ in（787 mm） | R311.7.1 | 是 |
| 双侧扶手处净宽 `widthBelowTwoHandrails` | ≥ 27 in（698 mm） | R311.7.1 | 是 |
| 扶手凸出 `handrailProjectionMax` | ≤ 4½ in（114 mm）/侧 | R311.7.8.2 | 是 |
| 净高 `headroom` | ≥ 6 ft 8 in（2032 mm） | R311.7.2 | 是 |
| 一跑最大升高 `flightRiseMax` | 12 ft 7 in（3835 mm） | R311.7.3 | 是 |
| 踢面 `riserMax` | ≤ 7¾ in（196 mm） | R311.7.5.1 | 是 |
| 踢面高差 `riserVariation` | ≤ ⅜ in（9.5 mm） | R311.7.5.1 | 是 |
| 踏面 `treadMin` | ≥ 10 in（254 mm） | R311.7.5.2 | 是 |
| 踏面差 `treadVariation` | ≤ ⅜ in（9.5 mm） | R311.7.5.2 | 是 |
| 扇步行走线踏面 `winderTreadWalkline` | ≥ 10 in（254 mm） | R311.7.5.2.1 | 是 |
| 扇步任意点踏面 `winderTreadMin` | ≥ 6 in（152 mm） | R311.7.5.2.1 | 是 |
| 行走线 `walklineOffset` | 距内侧 12 in（305 mm） | R311.7.4 | 是 |
| 踏步鼻子 `nosingMin` / `nosingMax` | ¾–1¼ in（19–32 mm） | R311.7.5.3 | 是 |
| 免鼻子的踏面 `nosingExemptTread` | ≥ 11 in（279 mm） | R311.7.5.3 | 是 |
| 平台深 `straightLandingMin`、转向平台 `landingTurnMin` | ≥ 36 in（914 mm），且不小于梯段宽 | R311.7.6 | 是 |
| 需扶手的最少级数 `handrailMinRisers` | 4 | R311.7.8 | 是 |
| 扶手高 `handrailMin`–`handrailHeightMax` | 34–38 in（864–965 mm） | R311.7.8.1 | 是 |
| 栏杆高 `guardHeight` | ≥ 36 in（914 mm） | R312.1.2 | 是 |
| 楼梯临空侧栏杆 `stairGuardMin` | ≥ 34 in（864 mm） | R312.1.2 | 是 |
| 螺旋梯宽 / 踏面 / 踢面 / 净高 | ≥ 26 in（660）、≥ 6¾ in（171）、≤ 9½ in（241）、≥ 6 ft 6 in（1982 mm） | R311.7.10.1 | 是 |

宽度检查用 914 mm，不用扶手以下的收窄值。净高记在规则里，M1 还不量竖向净空。

产品默认栏杆高另有一个常数 1100 mm（`GUARD_HEIGHT_MM`），与上表无关，只是以后界面的缺省值。

## 本地运行

开发和 `npm test` 直接跑 `src/` 里的 ES modules，不需要构建。发布页（GitHub Pages）会先 `npm run build`，站点根上的页面加载 `dist/` 里的包，而不是 `src/app.js`。

```bash
cd /path/to/parent && python3 -m http.server 8000
```

浏览器打开 <http://localhost:8000/home-sim/>（站点以仓库目录名为子路径）。相对路径在这个子路径下可用。三维调试页是 <http://localhost:8000/home-sim/dev/view3d.html>。

## 测试

需要 Node 20 或更新（持续集成用 Node 22）。

```bash
npm ci
npm test
```

`npm test` 就是 `node --test`。面积报告：`npm run report`。标识符检查：`npm run cleanroom`。浏览器验收（需要本机 Chrome，不随 `npm test` 跑）：`npm run e2e`。

## 部署

推送到 `main` 后，GitHub Actions 先跑测试，通过才组装 `_site/`（页面、样式、`src/`、文案、模式、模板、规范、`vendor/`、`dev/`、`fixtures/`）并发布到 GitHub Pages。测试失败的提交不会部署。运行时不请求第三方域名。

## 第三方组件

见 [vendor/README.md](vendor/README.md)。

| 库 | 版本 | 许可证 |
| --- | --- | --- |
| polygon-clipping | 0.15.7 | MIT |
| splaytree | 3.1.2 | MIT |
| robust-predicates | 3.0.2 | Unlicense |
| lz-string | 1.5.0 | MIT |
| three.js | 0.186.1 | MIT（`vendor/three/LICENSE`） |

开发依赖只有 `ajv` 和 `ajv-formats`，测试用来编译 JSON Schema，不进页面。

## 许可证

本项目的许可证等 Ace 指定（产品说明里的建议是 MIT）。在那之前不放置 LICENSE 文件。`vendor/` 里各库仍按其自带许可证再分发。
