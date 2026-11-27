[Chinese](../../../COMPATIBILITY.md) · [English](../en/COMPATIBILITY.md) · [日本語](../ja/COMPATIBILITY.md) · **한국어** · [Deutsch](../de/COMPATIBILITY.md) · [Français](../fr/COMPATIBILITY.md) · [Español](../es/COMPATIBILITY.md)

# 호환성 및 환경 매트릭스

> 버전: 2026-11-27 · 구현 **1.8.1** 기준
> 목적: 지원하는 DSH/Node.js/OS와 성능 저하 시 동작을 명시합니다.

## 1. 핵심 의존성

| 의존성 | 최소 | 권장 | 설명 |
| --- | --- | --- | --- |
| DSH | 0.2.0 | 최신 0.2.x | `cordis` 플러그인 시스템과 `compaction` 서비스 사용 |
| Node.js | 22.13.0 | 22.x / 24.x LTS | `node:sqlite`와 ESM 필요 |
| npm | 10.0 | 10.x / 11.x | 의존성 설치 시에만 |

## 2. 설치 방법

- **npm**: `npm install dsh-context-hub@<version>` (slim, `embed/node_modules` 미포함).
- **소스**: `git clone` + `npm install` (Node ≥22.13).
- **오프라인 tarball**: `scripts/pack.sh` 결과물에 `embed/node_modules`가 포함되어 추가 설치가 필요 없습니다.

## 3. OS 지원

| OS | 상태 | 비고 |
| --- | --- | --- |
| Linux x64 | ✅ 완전 지원 | onnxruntime·sharp 바이너리 동봉 |
| Linux arm64 | ✅ 지원 | onnxruntime arm64 동봉, sharp 미동봉 |
| macOS arm64 | ⚠️ 부분 | onnxruntime 있음, darwin x64 없음, sharp 없음 |
| Windows x64 | ⚠️ 부분 | onnxruntime 있음, sharp 없음 |

플러그인 본체는 순수 JavaScript라 DSH가 동작하는 어디서나 실행됩니다. 네이티브 바이너리에 의존하는 것은 선택적 로컬 벡터 서비스뿐입니다.

## 4. DSH 버전 호환성

| DSH | 상태 |
| --- | --- |
| 0.2.x | ✅ 지원(주 대상) |
| < 0.2.0 | ❌ 미지원(`compaction` API 없음) |

## 5. Node.js 버전 호환성

| Node.js | 상태 |
| --- | --- |
| 22.13+ | ✅ 최소 요구(`node:sqlite` 안정판) |
| 24.x | ✅ 검증됨 |

## 6. 선택 기능 의존성

| 기능 | 요구 사항 |
| --- | --- |
| 벡터 검색 | OpenAI 호환 `/embeddings` 또는 동봉 `embed/` |
| 쿼리 재작성 / 재순위 | 에이전트가 사용할 수 있는 모델 경로 |
| 압축 요약 | DSH `compaction` 서비스(네이티브) |

## 7. 알려진 제한

- npm 패키지는 slim이며 로컬 벡터에는 `cd embed && npm install --ignore-scripts`가 필요합니다.
- 동봉 `sharp`는 Linux x64 전용입니다. macOS/Windows는 직접 의존성을 설치해야 합니다.
- `npm pack`은 `node_modules`를 제외하므로 의존성 포함 배포는 `scripts/pack.sh`를 사용하세요.
- 영어 의미 검색(LongMemEval R@5 83.3%)은 어휘 검색과 동등하며 더 낫지 않습니다.

## 8. 업그레이드 경로

1. 기억 저장소 백업(`cp ~/.dsh/context-hub/memory.db ~/.dsh/context-hub/memory.db.bak`).
2. 플러그인 교체(`plugin_manager install_bundle` 또는 `npm install`).
3. 서버 측 플러그인 재로드를 위해 DSH 재시작.
4. `/context-hub doctor`로 확인.

DB 스키마 변경은 추가만 이루어지며 마이그레이션이 필요 없습니다.

## 9. 문제 해결

- **`/api/context-hub.status` 401**: 라우트는 등록되었으나 요청이 미인증입니다. 패널은 인증된 페이지에서 가져옵니다.
- **패널이 없음**: 클라이언트 구문 오류입니다. `node --check client/client.js` 실행.
- **`FTS5 unavailable`**: SQLite를 갱신하세요. 검색은 키워드만으로 저하됩니다.
- **벡터 서비스 미준비**: `embed/embed.log`와 `curl localhost:11434/health` 확인.

## 10. 테스트 범위

- `node test-smoke.mjs` — 서버 측 종단 테스트.
- `npm run test:panel-i18n` — 7개 언어 × 5개 탭.
- `npm run check:locales` — 어휘 데이터와 클라이언트 동기화.
- `node scripts/docs-i18n-check.mjs` — 문서 다국어.
- `node scripts/stress.mjs` / `scripts/concurrency.mjs` — 규모와 동시성.

## 11. 변경 이력

[CHANGELOG.md](../../../CHANGELOG.md)와 [RELEASE-1.8.0.md](../../../RELEASE-1.8.0.md) 참고.

## 12. 지원 범위

GitHub Issues를 통한 커뮤니티 지원(SLA 없음). 보고 시 `doctor` 출력, DSH·Node.js 버전, OS 정보를 포함하세요.

## 13. 피드백

https://github.com/ElementBen555/context-hub/issues 에 재현 절차와 로그를 첨부해 주세요.
