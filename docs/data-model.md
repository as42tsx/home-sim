# 数据模型 v2

单位是毫米。平面坐标 x 向右、y 向下。各楼层共用同一套平面坐标，用 `elevation` 区分高度。房间多边形不入库，由墙中线推导。

模式文件：`schema/plan.v2.schema.json`（JSON Schema draft 2020-12）。标识符匹配 `^[A-Za-z0-9_-]{1,64}$`。实体上 `additionalProperties: false`。方案和每个实体都可以带可选的 `ext` 对象，给以后的字段留位置。运行时校验在 `src/model/validate.js`，不依赖 Ajv，浏览器也能跑。

## 方案

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 固定为 `2` |
| `meta.id` / `name` | 方案标识与名称 |
| `meta.createdAt` / `updatedAt` | 纪元毫秒 |
| `meta.unit` | 固定 `"mm"` |
| `meta.displayUnit` | `metric` 或 `imperial`，只影响以后的界面 |
| `meta.codeset` | `cn`、`jp` 或 `us`，楼梯提示读 `rules/` 下对应文件 |
| `meta.template` | `apt-1br`、`apt-2br`、`apt-3br`、`jp-ikkodate`、`us-villa`，或 `null` |
| `floors` | 至少一个楼层，按标高升序存放 |
| `stairs` | 跨楼层楼梯，不挂在某一层上 |
| `markers.walkStart` | 可选。`{ floor, x, y, yaw }` |

`createEmptyPlan()` 给出一份能通过校验的空方案，里面正好一个空楼层。

## 楼层

`id`、`name`、`elevation`（该层地面标高）、`height`（层高，本层地面到上层地面）、`slab`（楼板厚）、`ceiling`（净高）。`height` 为 `null` 的墙用本层 `ceiling`。

数组都必填，可以是空的：`nodes`、`walls`、`openings`、`rooms`、`furniture`、`voids`。

相邻层的建议关系是 `下一层.elevation = 本层.elevation + 本层.height`，容差 1 mm。差得更多时校验给出警告 `FLOOR_GAP`，不把方案判成非法。标高没按升序排则是错误 `FLOORS_UNSORTED`。

查找一律带楼层 id：`getFloor(plan, floorId)`。还有 `floorAbove`、`floorBelow`、`adjacentFloors`。模型、几何、楼梯、楼板、导入导出都不写死第一层。

## 墙

`id`、`a`、`b`（同一层上的节点，且不能是同一个点）、`thickness`（60–500）、`height`（数字，或 `null` 表示用本层净高）、`bearing`、`exterior`、`demolished`、`finish.left` / `finish.right`。

**待产品确认：可选 `virtual`（省略即 false）。** 为 true 时这是房间分隔线，不是实体墙：参与房间推导，内缩厚度按 0，不画成墙，不能挂洞口，不能是承重（否则 `VIRTUAL_BEARING`）。v1.3 模板用它做开放连通：一居玄关与客餐厅、两居过道与客餐厅、三居客厅与餐厅以及过道与客厅。数据里厚度仍写成 120，以满足墙厚下限；算法忽略这个厚度。

`demolished: true` 的墙不参与房间推导。短于 50 mm 的墙在规范化时丢掉。

## 洞口

`id`、`wall`（同一层的墙，且不能是虚拟墙）、`t`（0 到 1，洞口中心在 a→b 上的位置）、`kind`（`door`、`window`、`slide`、`shoji`、`fusuma`、`garage`、`bay`）、`width`、`height`、`sill`、`hinge`（`left`/`right`）、`swing`（`in`/`out`）。

宽度大于所在墙段长度是 `OPENING_TOO_WIDE`。洞口挂在别的层的墙上是 `OPENING_WALL_FLOOR`。

端距另算（`src/openings/clearance.js`）：自由净距 = 墙段长度 − 两端「非共线、非虚拟」邻墙的最大半墙厚。洞口边缘到自由净距端部小于 100 mm 时报 `OPENING_CLEARANCE`；边缘越出节点报 `OPENING_CROSSES_NODE`。共线延伸的墙不重复扣厚度。

## 房间（只存属性）

`id`、`name`、`type`、`floor`（地面材料，不是楼层）、`floorOffset`（相对本层地面的毫米高差，省略按 0）、`seed`（`{x, y}`，用来在改墙之后把属性对回推导出的面）。

`type`：`bedroom`、`living`、`dining`、`ldk`、`kitchen`、`bath`、`toilet`、`washroom`、`balcony`、`corridor`、`entry`、`study`、`storage`、`closet`、`washitsu`、`garage`、`loft`、`other`。

## 家具

`id`、`type`、`name`、`cx`、`cy`、`z`、`w`、`d`（50–6000）、可选 `h`、`rot`（度）、`color`（`#RRGGBB`）、可选 `host`（`{ wall, side: left|right }`）。

## 空洞

`id`、`poly`（至少三个 `[x, y]`）、`reason`（`double-height`、`stair`、`other`）。空洞开在它所在的那一层楼板上。

## 楼梯

顶层数组。`id`、`kind`（`straight`、`L`、`U`）、`from`、`to`（两个不同的楼层 id）、`x`、`y`、`rot`、`width`、`tread`、`maxRiser`、`handrail`（`left`/`right`/`both`）、`opening`（固定 `"auto"`）。L / U 必须有 `landing: { at, size }`，`at` 是 0 到 1 的踏步比例。直跑的平台可选。

`to` 必须是 `from` 正上方那一层：`to.elevation = from.elevation + from.height`（容差 1 mm）。否则 `STAIR_NOT_ADJACENT`。同一层是 `STAIR_SAME_FLOOR`，找不到楼层是 `STAIR_FLOOR`。

**待产品确认：可选 `turn`（`left`/`right`，默认 `left`）和 `well`（U 形两跑之间的净距，默认 0）。**

放置约定（`src/stairs/stairs.js`）：

- `(x, y)` 是第一级踢面线的中点。
- `rot` 是上楼方向，度。0 为 +x，90 为 +y（y 向下）。
- 梯段以行走中线为轴，左右各一半宽度。
- 级数 `n = ceil(rise / maxRiser)`，`rise = to.elevation − from.elevation`。正好整除时不加级。踢面高 `riser = rise / n`。踏步数 `treads = n − 1`。
- 直跑水平投影长 `(n − 1) × tread`。
- L / U 在 `landing.at × n` 处把级数拆成整数（四舍五入，0.5 进到远离 0 的一侧，所以 7.5 → 8），两端各至少 1 级。平台占掉一级踏步的位置，两跑的踏面数之和是 `n − 2`。`runLength` 不含平台深度。
- L 形转 90°：左转 `rot − 90`，右转 `rot + 90`。第二跑从平台转向侧那条边的中点出发。`landing.size` 等于梯宽时，第二跑与平台齐平。
- U 形转 180°。第二跑中线沿转向法线偏移 `width + well`。平台宽度覆盖两跑，即 `2 × width + well`。

这些数是几何。对照 `rules/*.json` 的 `checkStair` 只产生提示，不是合规认证。

## 房间怎么推导

`deriveRooms(plan, floorId, opts)` 不改输入，返回 `{ rooms, derived, normalized, unclosed }`。`deriveAllFloors` 对每一层各算一次，层与层互不影响。

1. **规范化。** 拆除墙不参与。容差内的节点并到一个代表点（更小的 y，其次 x，其次 id）。丢掉零长度和短于 50 mm 的墙。节点落在另一堵墙的内部就在那里拆墙（T 接）；两墙相交则两段都拆开并共用新节点（X 接）。共线且重叠超过容差的墙合并；只是首尾相接、没有重叠的不并，这样虚拟分隔线不会被吃进旁边的实墙。洞口按世界位置重算 `t`，记到拆开后的子墙上。`map` 是原墙 id 到结果 id 的对应。默认容差 10 mm，等于 1 px = 1 mm 时界面的 10 px 吸附。界面应按 `SNAP_PX * mmPerPx` 传入。
2. **找面。** 平面图按角度走半边。悬挂的边先剪掉，不参与成面，但记在 `unclosed` 里，并给出最近一对悬挂端点的距离，给「还差 N mm 闭合」用。每个连通块丢掉无界面。一个连通块完全落在另一块的面里时，它的外轮廓从那个面里挖掉，同时自己仍作为房间输出。顺序按质心 y，再按 x。
3. **内净。** 每个面的中线多边形，每条边按该墙一半厚度向内退（虚拟墙按 0）。输出含 `centerline`、`polygon`（内净）、`area` / `areaM2`、`centerlineArea` / `centerlineAreaM2`、`centroid`、`wallIds`、`bbox`。验收例：中线 4000×3000、墙厚 240，内净 3760×2760 = 10.3776 m²。
4. **对回属性。** 先用种子点是否落在中线多边形内。点在边界上不算在内。对不上或多对一时，用面积重叠。合并后面保留面积较大的那一侧的 id、名称、类型、地面材料。拆分后，含有原种子的那一块留原 id，其余用注入的 id 生成器，名称取下一个未用的「房间 N」。消失的房间丢掉。返回的种子会改到面内一点。

## 楼板

`computeSlab(plan, floorId)`：

- 轮廓 = 本层房间中线面，并上非虚拟、未拆除墙的占地矩形。矩形长为墙段、宽为墙厚、以中线为轴，不伸出端点，所以外角会缺四个小方块。
- 开洞 = 本层 `voids` 与所有 `to` 等于本层的楼梯投影的并集。空洞和楼梯重叠时并成一个洞。
- 楼板 = 轮廓减去开洞。`openingArea` 是并集面积，不先裁到轮廓里。

## 模板文件

`schema/template.v2.schema.json`：`{ kind: "home-sim-template", id, name, source, areaBasis, expected, plan }`。`expected` 是中线面积、房间数和中线套内合计（v1.3 的 `areaBasis` 仍是 `centerline`），不是推导出的使用面积。`templates/index.json` 的 `netAreaM2` 是不含阳台的使用面积（推导内净，四舍五入到两位小数）。面积核对见 `docs/template-area-report.md`。

## 版本

`src/model/migrate.js` 只做 v2 恒等。`schemaVersion` 大于 2 得到 `NEWER_VERSION`，提示「请使用新版本」。更旧或无法识别的版本是 `UNSUPPORTED_VERSION`。没有 v1 导入器。

## 导入、导出、分享

`exportPlanJSON` / `importPlanJSON` 往返后深相等。坏输入不抛错：JSON 语法错误是 `INVALID_JSON`。导入会先迁移再校验。多楼层原样保留。

分享链接哈希是 `#p=` 加一个前缀。`d` 为 JSON → deflate-raw → base64url；没有 `CompressionStream` 时用 `z`（lz-string）。哈希的 UTF-8 字节超过 48 KB 则 `{ ok: false, code: "TOO_LONG" }`，不给链接。截断、损坏、解不开、校验失败一律 `LINK_INCOMPLETE`。编解码不写存储。

## 语义错误码

结构类：`REQUIRED`、`UNKNOWN_PROPERTY`、`INVALID_TYPE`、`OUT_OF_RANGE`、`BAD_COLOR`、`INVALID_ENUM`、`BAD_ID`。

语义类：`DUPLICATE_ID`（含 meta、楼层和全部实体）、`DANGLING_NODE`、`WALL_DEGENERATE`、`OPENING_WALL_MISSING`、`OPENING_ON_VIRTUAL`、`OPENING_TOO_WIDE`、`OPENING_WALL_FLOOR`、`FLOORS_UNSORTED`、`FLOOR_GAP`（警告）、`STAIR_FLOOR`、`STAIR_SAME_FLOOR`、`STAIR_NOT_ADJACENT`、`WALK_FLOOR`、`VIRTUAL_BEARING`、`NEWER_VERSION`、`UNSUPPORTED_VERSION`、`INVALID_JSON`。

端距另有 `OPENING_CLEARANCE`、`OPENING_CROSSES_NODE`，不在 `validatePlan` 里，由 `checkOpeningPlacement` 给出。
