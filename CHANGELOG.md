# Changelog

このプロジェクトの主な変更を記録します。版数は [Semantic Versioning](https://semver.org/) に従います。
Notable changes to this project are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- 初版。npm に `@c4h/daedalus` として公開します。主な API は `fitWorldFile`（対応点から相似または affine のワールドファイルを当てはめ、採用の可否・warning・残差を返す）と、その入出力の型（`GcpPair`・`GeoBasis`・`FitOptions`・`FitResult`・`WorldFile` ほか）です。全 export は README の公開 API の節にあります。
- First release, published to npm as `@c4h/daedalus`. The main API is `fitWorldFile` (fits a similarity or affine world file to ground control points and reports whether it can be adopted, with warnings and residuals) and the types of its input and output (`GcpPair`, `GeoBasis`, `FitOptions`, `FitResult`, `WorldFile` and others). Every export is listed in the Public API section of the README.
- 対応していないことは README の「[非目標](./README.ja.md#非目標)」にあります。
- What is not supported is listed under "[Non-goals](./README.md#non-goals)" in the README.
