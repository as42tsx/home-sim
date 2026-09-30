# 3D 视图（M1）

数据驱动的整栋视图。内部单位是米（平面图毫米 ÷ 1000），Y 轴向上，平面图的 Y 对应世界的 Z。不写死某一套户型的尺寸，相机和阴影都从当前方案的包围盒算出来。

运行时只依赖已 vendor 的 three@0.186.1（`vendor/three/`，MIT）。页面需要这张 import map，由 `index.html` 持有，本分支不改它：

```html
<script type="importmap">
{
  "imports": {
    "three": "./vendor/three/three.module.js",
    "three/addons/": "./vendor/three/addons/"
  }
}
</script>
```

调试页 `dev/view3d.html` 用的是相对路径 `../vendor/three/...`。颜色从 `styles/tokens.css` 的自定义属性读取（`getComputedStyle(document.documentElement)`），读不到时用 `src/view3d/model/tokens.js` 里的回退值。

## 场景

```
Scene
└─ Building
   ├─ Floor（name = floor.id，position.y = elevation 米）
   │  ├─ slab        地面层：大地平面；上层：computeSlab 挤出的楼板（顶面在本组 y=0，厚度向下）
   │  ├─ walls       该层全部墙片，按材质合并成一个 Mesh
   │  ├─ openings    门扇、窗玻璃，各一个合并 Mesh
   │  ├─ furniture   按形状零件分的 InstancedMesh
   │  └─ stairs      每部楼梯一个合并 Mesh（挂在 from 层）
   └─ selection      选中家具的半透明盒子，不参与拾取
```

- 默认显示整栋。`setCurrentFloor` 只记录当前层，不隐藏其他层。
- 隐藏层：`group.visible = false`，`raycast` 直接返回 `false`（three r186 的射线会在返回 `false` 时停止向下遍历），同时关掉投射阴影。
- 地面层是标高最低的那一层（标高相同再比 id），不是数组第 0 项。
- 墙来自归一化后的非虚拟、非拆除墙。门洞两侧是通高墙段，窗下有窗台、门窗上方有过梁。虚拟墙不产生任何几何。
- 房间地面用 `deriveRooms` 的净多边形，并用楼板洞口裁切，按房间类型着 `--room-*` 顶点色，每层合并成一个 Mesh。
- 门扇默认关闭。点击门扇只重建该层的门 Mesh（玻璃不动）。平开绕铰链转，推拉 / 障子 / 福斯玛 / 车库门沿墙平移。窗是玻璃片。
- 楼梯用 `computeStair` 的踏步盒子，顶部与层高齐平。夹具 `two-floor-stair` 的洞口能让射线穿过 2F 打到 1F 的踏步。
- 家具不读取 `src/furniture/catalog.js`。`type` 按契约表映射到 `shape`，未知类型用 `box`。每种形状最多 4 个零件、3 种材质（`src/view3d/furniture-shapes.js`）。同一层里，相同「形状 + 零件」共用一个 `InstancedMesh`（矩阵 + `instanceColor`）。

剖切（`setCutaway(true)`）不重建几何：墙和门的着色器把高度帽在 1.2 m。

## 绘制预算与实测

红线（PRD §4 / US-07 / §12.5）：

- 单层 100 件家具，每帧 draw call ≤ 400。
- 每层静态建筑（楼板、墙、洞口）合并后，颜色通道远低于每层 10 次绘制。
- 改一件家具的颜色，只重建这一件，≤ 16 ms。

静态一层的颜色通道是：地面或楼板、房间地面、墙、门、玻璃，有楼梯再加一部楼梯。墙用一份材质加顶点色，所以承重墙和内墙不再各占一次绘制。three r186 在把线性颜色写回画布时会多一次全屏 blit，因此 `renderer.info.render.calls` 比楼层里的 Mesh 数多 1。阴影再给每个 `castShadow` 的物体加一次阴影 pass（玻璃和地面不投射）。

SwiftShader 无头 Chrome 实测（`renderer.info.render.calls` / `triangles`，含上面的 blit；阴影贴图桌面 2048）：

| 场景 | 阴影 | calls | triangles | 说明 |
|---|---:|---:|---:|---|
| apt-2br | 开 | 8 | 1268 | 无家具。楼层估算 7 |
| apt-2br | 关 | 6 | 680 | 5 个静态 Mesh + blit |
| apt-3br | 开 | 8 | 1684 | 无家具 |
| apt-3br | 关 | 6 | 904 |  |
| two-floor-stair | 开 | 18 | 1182 | f1 估算 10，f2 估算 7 |
| two-floor-stair | 关 | 12 | 654 | f1 估算 6，f2 估算 5 |
| stress=100（三居，目录类型循环） | 开 | 58 | 9844 |  |
| stress=100 | 关 | 31 | 4984 | 约 25 个实例 Mesh + 5 个静态 Mesh + blit |

100 件、阴影关闭是 31 次绘制，低于 60 的内部目标和 PRD 的 400。阴影打开是 58。家具种类再增加也只增加「形状零件」的数量，不随件数线性增长。

`renderInfo().floors[id].calls` 是该层可见 Mesh 的估算（隐藏层为 0，投射阴影的 Mesh 再 +1），不含全屏 blit，也不含楼层组之外的选中框。`calls` / `triangles` 来自上一帧渲染之后的 `renderer.info`（`autoReset` 保持开启：three 先清零再画阴影和颜色，所以读到的是这一帧的合计）。

改一件颜色：`furnitureBuilds` 从 0 变为 1，`lastBuildMs` 约 0.2 ms（SwiftShader，远小于 16 ms）。初次构建和 `structure` / `full` 不增加 `furnitureBuilds`。

## 按需渲染

没有连续的 `requestAnimationFrame` 循环。只有这些情况会画一帧：轨道控制器变化、过渡动画、漫游中的移动、`update` / `resize` / `requestRender`、截图前后把画面放回去。

过渡用墙上时钟计时，播完就停。空闲超过 1 秒不再申请帧；实现上是动画或移动一结束就取消 rAF。调试页实测：`enter({ animate: false })` 之后帧数停在 1，再等 1.5 秒仍是 1，随后 3 秒窗口里仍然是 1。带动画的 `enter()` 约 927 ms 结束（目标 900 ms），期间大约画到第 27 帧，然后停止。

`toPNG({ longEdge })` 把像素比设为 1，按长边渲染一帧（默认 1600，限制在 2–4096），`gl.finish()` 后立刻 `readPixels`，自己编码 PNG，再恢复视口。不设置 `preserveDrawingBuffer`。实测 480 长边得到 576408 字节的 PNG，文件头 `89 50 4E 47`，`createImageBitmap` 能解码成 480×300。

像素比：桌面 ≤ 2，`(pointer: coarse)` ≤ 1.5。一盏平行光投射阴影，阴影相机会到建筑包围盒（不含大地平面）。地址栏带 `?noshadow` 时关闭阴影。

## 增量更新

`view.update(change)`：

| kind | 行为 |
|---|---|
| `meta` | 什么都不做，也不渲染 |
| `furniture` | 只改 `ids` 里的实例槽（增删、尺寸、颜色、位置）。`furnitureBuilds` 加上去重后的 id 数 |
| `structure` | 只重建该层的 slab / walls / openings / stairs，家具组保留，已打开的门保留 |
| `full` | 重建现有层，拆掉方案里已经没有的层；非漫游时重新取景 |

槽位用空闲列表。移除的实例缩到 0.001 并移到 y=−50，避免 0 缩放把包围球算成 NaN。容量不够时按倍增复制矩阵，这次复制不计入 `furnitureBuilds`。

## 过渡

总长 900 ms（Luna §3），时间来自 `performance.now()`：

- 0–450 ms：相机从俯视到水平面上 55°，smoothstep。俯视时 `camera.up` 指向世界 −Z，画面与 2D 一致；结束时 up 为 +Y，相机在目标的 +Z 一侧。
- 300–750 ms：墙从 0 升到全高，ease-out。外墙先于内墙，每道墙错开 20 ms（墙很多时会缩短间隔，保证最后一道在 750 ms 前结束）。合并几何上用顶点属性 `aStart` / `aRise` / `aFullH` 加一个 uniform 时间，在 `onBeforeCompile` 里裁切，不增加 draw call。`aFullH` 是整道墙的高度，所以过梁要等墙升到那个高度才出现。
- 600–900 ms：家具从 +200 mm 落下，弹簧曲线 `cubic-bezier(.34, 1.56, .64, 1)`。位移加在实例矩阵之后、视图矩阵之前，所以是楼层局部的米，不会被实例缩放放大。
- `exit()` 用 600 ms 倒放相机和墙；家具不再重新落一次。
- `reducedMotion`：200 ms 透明度，墙直接是全高。

`createView3D` 在 three.js 加载完成后才 resolve。轨道控制器在构造时会 `update()` 并把目标当成原点，所以先把相机放到斜视终点，构造之后立刻把姿态写回去，俯视期间不再调用 `controls.update()`，避免极角接近 0 时方位角失稳。

## 漫游

`enterWalk()` 使用 `plan.markers.walkStart`（`floor` / `x` / `y` / `yaw`，该层必须存在），否则用当前层面积最大房间的形心。眼高是该层标高 + 1.6 m。

WASD 和方向键约 1.4 m/s。移动方向每帧从相机的 `getWorldDirection` 读出，右方向是前方向 × 世界上方，不再用另一套 yaw 去推位移。偏航 0 看向世界 +X，此时右方向是 +Z。鼠标拖拽改变朝向（不强制指针锁定，方便自动化）。Esc 退出并恢复进入前的相机。只有在移动或拖拽时才渲染。

碰撞是半径 0.25 m 的圆对非虚拟墙中心线，门、推拉门、障子、福斯玛、车库门留出可通行缺口（窗不留）。夹具里从 (1.0 m, 1.5 m) 沿 +X 走向 x=4.0 m 的内墙，停在 x≈3.74 m（3.75 m 减去一步的余量）。按 D 时 Z 从 1.5 m 增到约 2.10 m，与右方向一致。

## API

`src/view3d/index.js`：

```js
isWebGLAvailable()
// { ok: true } 或 { ok: false, reason: '这台设备的浏览器不支持 3D，2D 功能不受影响' }

createView3D({ container, getPlan, floorId, reducedMotion=false, onSelectFurniture })
```

返回的视图：`enter` / `exit` / `update` / `setCurrentFloor` / `select` / `setCutaway` / `enterWalk` / `exitWalk` / `requestRender` / `renderInfo` / `toPNG` / `resize` / `dispose`。

`renderInfo()` 字段：`calls`、`triangles`、`geometries`、`textures`、`frames`、`lastFrameAt`、`furnitureBuilds`、`lastBuildMs`、`floors: { [id]: { visible, calls } }`。

调试扩展（契约之外，集成时可用可不用）：

- `setFloorVisible(floorId, boolean)`
- `debugState()` 相机、朝向、楼层子节点名
- `debugRay(ox, oy, oz, dx, dy, dz)` 前 12 个命中

调试页把视图放在 `window.__v3d`，并设置 `window.__HOMESIM_DEBUG__ = { renderInfo, view }`。查询参数：`?t=apt-2br`（默认）、`?fixture=two-floor-stair`、`?stress=100`、`?noshadow`、`?reduced`。

带 `// @browser-only` 的文件只有 `src/view3d/index.js` 和 `src/view3d/gl.js`。它们不静态 `import 'three'`，three 在 `createView3D` 里动态加载，所以当前的 Node 冒烟测试可以直接 import。纯数据模块在 `src/view3d/model/` 和 `src/view3d/furniture-shapes.js`，没有这个标记。

## 集成时要接上的部分

- 在 `index.html` 加上面的 import map（相对站点根目录的 `./vendor/three/...`）。
- 用 `import('../view3d/index.js')` 懒加载。`floorId` 用 UI 的当前层，不要写 `floors[0]`。
- `getPlan` 返回当前文档。家具变更由编辑器改文档再 `update({ kind:'furniture', floorId, ids })`，视图自己不改方案。
- `reducedMotion` 来自 `matchMedia('(prefers-reduced-motion: reduce)')`。
- 点击家具会调用 `onSelectFurniture(id | null)`。高亮需要再调用 `select(id)`。
- 若冒烟测试改为跳过浏览器模块，认第一行 `// @browser-only`。不要在这两个文件里改成静态导入 three，否则现有的 Node 冒烟会失败。
- 不要从 3D 代码 import 家具目录；形状表以契约为准，在 `furniture-shapes.js`。
- 整栋显隐如果要做「只看当前层」，调用 `setFloorVisible`，不要假设 `setCurrentFloor` 会隐藏其他层。
