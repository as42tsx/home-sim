# 第三方运行库

浏览器与 Node 共用这些文件，不经过打包器。裸导入已改成相对路径，算法未改。版本与许可证如下。

## polygon-clipping 0.15.7

- 许可证：MIT（Mike Fogel；2016 年从 martinez 分叉的部分另有 Alexander Milevski 的版权）。见 `polygon-clipping/LICENSE.polygon-clipping.md`。
- 文件：`polygon-clipping/polygon-clipping.esm.js`。
- 改动：文件头已注明。`'splaytree'` 改为 `./splaytree/splay.esm.js`，`'robust-predicates'` 改为 `./robust-predicates/index.js`。

## splaytree 3.1.2

- 许可证：MIT（Alexander Milevski）。见 `polygon-clipping/splaytree/LICENSE`。
- 文件：`polygon-clipping/splaytree/splay.esm.js`（上游 ESM 构建，未改算法）。

## robust-predicates 3.0.2

- 许可证：Unlicense（公有领域）。见 `polygon-clipping/robust-predicates/LICENSE`。
- 文件：`polygon-clipping/robust-predicates/index.js` 及其 `esm/` 目录。

## lz-string 1.5.0

- 许可证：随包的 `LICENSE` 为 MIT（pieroxy）。上游源文件头仍写着 WTFPL；再分发以该 MIT 文本为准。
- 文件：`lz-string/lz-string.js`。
- 改动：去掉 UMD 尾部，改为 ESM，导出 `compressToEncodedURIComponent`、`decompressFromEncodedURIComponent` 和默认导出。压缩算法未改。分享链接在没有 `CompressionStream('deflate-raw')` 时使用它。

`three` 不在本目录。以后由 `index.html` 里的 import map 指向 `./vendor/three/three.module.js`。
