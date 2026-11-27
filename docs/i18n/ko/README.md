[Chinese](../../../README.md) · [English](../en/README.md) · [日本語](../ja/README.md) · **한국어** · [Deutsch](../de/README.md) · [Français](../fr/README.md) · [Español](../es/README.md)

# dsh-context-hub · 컨텍스트 허브

**압축·기억·인사이트**를 하나의 DSH 번들에 담은 플러그인입니다. 한 번만 설치하면 호스트 측 빌드가 필요 없고(순수 ESM JavaScript), 데이터는 로컬 SQLite에 저장됩니다.

> 문서 색인:
> - [docs/spec.md](../../spec.md) — 기능 명세 v1.0 (동결)
> - [docs/design.md](../../design.md) — 아키텍처, 데이터 흐름, DSH 계약, 실패 모드
> - [docs/COMPATIBILITY.md](COMPATIBILITY.md) — 호환성 매트릭스
> - [docs/PANEL-I18N.md](PANEL-I18N.md) — 패널 언어 전환
> - 전체 설명은 [영어판](../en/README.md) / [중국어판](../../../README.md)을 참고하세요

## 왜 셋이 아니라 하나인가

DSH에서 이 셋은 같은 컨텍스트 파이프라인의 세 단계입니다. 기억은 "새 세션에 무엇을 가져갈지", 압축은 "들어가지 않을 때 무엇을 버리고 남길지", 인사이트는 "앞의 둘이 제대로 동작하는지 어떻게 알지"를 결정합니다. 저장소·주입 경로(`agent.inject()`)·검색 진입점을 공유하므로 셋으로 나누면 중복과 충돌만 늘어납니다.

## 기능

| 기능 | 구현 | 진입점 |
| --- | --- | --- |
| 기억 | `turn/end`에서 현재 모델이 구조화 기억을 추출하고 5차원 품질 게이트를 통과한 항목만 SQLite에 기록 | 자동 + `context_hub_remember` |
| 검색(리콜) | 키워드 + FTS5 trigram 하이브리드(동의어 확장·scope 가중·시간 감쇠), 선택적으로 벡터 코사인 | 자동 + `context_hub_search` |
| 검색 품질 | `context_hub_probe`가 top-k 적중률 측정, `context_hub_explain`이 항목별 점수 표시 | `context_hub_probe` / `context_hub_explain` |
| 거버넌스 | session/project/global 계층, TTL 아카이브, 용량 축출, 충돌 supersede | 자동 |
| 압축 | DSH 네이티브 압축 재사용. `compactor: hub`이면 `summarize()`를 감싸 8개 섹션 프롬프트 사용, 실패 시 폴백 | `/context-hub compact` |
| 압축 요약을 기억으로 | `compaction/summary`를 구독해 `kind=summary`로 저장, 이후 검색 가능 | 자동 |
| 접힌 구간 검색·복원 | 세션 로그 전체(접힌 구간 포함)를 스캔, seq 구간 원문을 다음 단계에 재주입 | `context_hub_history` / `context_hub_restore` |
| 메시지 단위 펼치기 | `unfold`: 다음 N단계에서 요약 노드를 원문으로 대체(모델 요청만 변경) | `context_hub_unfold` |
| 엄격한 예산 | 1회 주입에 토큰 상한(기본 1200)과 총 제한 시간(기본 4000ms), 초과 시 주입하지 않음 | 자동 |
| 인사이트 | surface/총 토큰, 구성 분해, 출력 예약, 수위, 접힌 구간, 최근 요청, 기억 구성, 비용 곡선 | `/context-hub status`, 사이드바 배지 + 패널 |
| 감사 | 소프트 삭제, 명시적 대체, 감사 체인, 관측 로그, JSON 내보내기 | `/context-hub audit/log/export` |
| 기억 관계 | `memory_links`(related/supersedes), 검색 시 1홉 확장(최대 1개) | 자동 + `explain` |
| 메시지 색인 | `messages` + `messages_fts` 증분 색인, 기억이 없어도 원문 검색 가능 | 자동 |
| 검토 흐름 | `reviewPending=true`이면 저신뢰 추출을 보류로 보내고 수동 승인/거부 | `/context-hub review` |

## 설치

```bash
# npm (1.8.0부터, embed 의존성이 없는 slim 패키지)
# plugin_manager install_bundle(target="dsh-context-hub@1.8.0")

# 배포 tarball (embed/node_modules 포함, 절대 경로 .tgz 지정)
# plugin_manager install_bundle(target="/absolute/path/dist/dsh-context-hub-<version>.tgz")
```

설치 후 profile의 `package.json`에 의존성과 번들 항목이 추가되고 `cordis.patch.yml`에 `id: dsh-context-hub`가 삽입됩니다. 소스 수정 후 재로드(재설치 불필요):

```
plugin_manager set_plugin(target="include:dsh-context-hub", enabled=true)
```

> 참고: `ctx.tools.register`의 `parameters` / `output.schema`는 표준 JSON Schema여야 합니다(객체에는 `required: [...]` 배열). 속성별 `required: true`는 `defineTool` 전용 축약형입니다.

## 검증됨

- **1.8.0**: P1/P2 보강 작업 완료(A1/A3/A4/B5/C4/C5/E4/A5/E3/E5/D4/D5), 새 명령 5개(export-jsonl/import-jsonl/graph/timeline/conflicts), JSONL 입출력, 기억 뷰, 호환성 문서.
- **1.7.x**: 패널에서 native ⇄ hub 전환·영속화, 실패 시 409. 검색 단계 소요 시간 기록, `rerank.reasoningEffort=low`로 30% 절감.
- **1.6.6**: 기억 10만 + 메시지 2만에서 rank p50 85.6ms / p95 99.8ms / p99 106.6ms, DB 67MB, RSS 249MB.
- **1.6.0**: 주입 토큰 상한·시간 초과 우회, git 프로젝트 식별(구행 마이그레이션), 메시지 단위 unfold.
- **1.5.3**: `multilingual-e5-small`로 zh-holdout R@5 100%, 영어 LongMemEval 12문항 83.3%.
- 이전 이력은 [중국어판](../../../README.md)에 있습니다.

## 사용법

```
/context-hub status                  # 인사이트: 컨텍스트 압박 / 접힌 구간 / 기억 저장소
/context-hub doctor                  # 자체 점검: FTS5/벡터/재작성/재순위
/context-hub search <키워드>          # 장기 기억 검색
/context-hub remember <내용>          # 수동으로 1건 기억
/context-hub history <키워드>         # 세션 로그 전체(접힌 구간 포함) 검색
/context-hub restore <시작seq> [끝seq]     # 접힌 원문 복원 후 주입(4000자)
/context-hub unfold [id:<n>|시작seq] [끝seq] [steps:<n>]
/context-hub explain <키워드>         # 검색 디버그: 후보와 점수 내역
/context-hub probe [n]               # 적중률 프로브(기본 10)
/context-hub log [n]                 # 관측 이벤트 타임라인
/context-hub audit <번호>             # 감사 체인
/context-hub forget <번호>            # 소프트 삭제
/context-hub supersede <번호> <새 내용> # 명시적 대체
/context-hub export                  # JSON 내보내기(0600)
/context-hub compact                 # 즉시 압축
/context-hub compactor <hub|native>  # 압축기 전환
/context-hub reembed                 # 모든 벡터 재계산
/context-hub watermark [on|off]      # 수위 압축 전환(영속)
/context-hub config [키] [값]          # 예산·TTL·추출·충돌·의미 검색 설정
/context-hub review [approve|reject] <번호>
/context-hub locale [auto|zh|en|ja|ko|de|fr|es]  # 패널/명령 언어
```

패널: 웹 페이지를 새로고침하면 왼쪽 사이드바 하단에 "링 + 컨텍스트 비율" 배지가 표시됩니다. 클릭하면 640px 카드가 열리고 고정 KPI 헤더 아래 **개요**(구성 바와 표, 비용 곡선, 활동 Top5), **기억**(활성/보류/대체/보관/색인, 범위·유형 그래프, 최근 사용, 승인/거부), **관측**(상세, 활동 전체, 최근 요청과 검색 레인), **설정**(예산·TTL·추출, 의미 검색 스위치, 수위, 압축기와 모드, 능력 배지), **언어** 탭이 있습니다. Esc 또는 배경 클릭으로 닫히고 10초마다 자동 갱신되며, 색상은 DSH 테마 토큰을 따릅니다.

![패널 미리보기](../../panel-preview.png)

데이터는 호스트 라우트 `/api/context-hub.status`(`connection` 서비스가 인증, 미인증은 401)에서 가져옵니다. 수위 전환은 `POST /api/context-hub.watermark`, 쓰기는 `POST /api/context-hub.review`와 `POST /api/context-hub.action`입니다.

모델 측 도구: `context_hub_search` / `remember` / `history` / `restore` / `decompress` / `unfold` / `status` / `doctor`, 그리고 읽기 전용 `explain` / `log` / `probe` / `abtest`.

## 설정

기본값은 `src/index.js`의 `defaults`에 있으며 플러그인 config나 환경 변수로 덮어쓸 수 있습니다. 주요 항목:

| 설정 | 기본 | 범위 |
| --- | --- | --- |
| `recallMaxItems` | 8 | 1–20 |
| `recallMaxChars` | 1800 | 200–8000 |
| `recallMaxTokens` | 1200 | 100–4000 (주입 토큰 상한) |
| `recallTimeoutMs` | 4000 | 0–20000 (총 제한, 초과 시 주입 안 함) |
| `recallCooldownTurns` | 6 | 0–20 |
| `sessionTtlDays` / `projectTtlDays` / `globalTtlDays` | 7 / 90 / 0 | 3·7·15·30 / 0–3650 / 0–3650 |
| `capacityPerScope` | 5000 | 100–100000 |
| `extractPassesPerTurn` | 2 | 1–10 |
| `admissionThreshold` | 0.6 | 0–1 |
| `conflictPolicy` | `evidence` | `evidence` / `recency` |
| `compactor` | `native` | `native` / `hub` |
| `mode` | `auto` | `auto` / `observe` / `assist` / `takeover` / `full` |
| `reviewPending` | false | 저신뢰 추출을 보류로 |
| `embedding.enabled` / `baseUrl` / `model` | false / 빈 값 / 빈 값 | OpenAI 호환 엔드포인트 |
| `embedding.fusion` | `weighted` | `weighted` / `rrf` |
| `rewrite.enabled` | false | 쿼리 재작성(실패 시 폴백) |
| `rerank.enabled` | false | LLM 재순위 |
| `watermark.enabled` / `triggerRatio` / `retainTokens` | false / 0.7 / 20000 | 수위 압축 |
| `unfold.steps` / `maxChars` | 3 / 8000 | 펼치기 예산 |

전체 목록은 [영어판](../en/README.md#configuration)에 있습니다. 설치된 항목은 `cordis.patch.yml`에 `config:`를 추가해 설정합니다(`insert:`는 최초 설치 전용).

```yaml
- id: dsh-context-hub
  config:
    compactor: hub
    embedding:
      enabled: true
      baseUrl: https://api.example.com/v1
      model: text-embedding-3-small
      apiKeyEnv: MY_EMBED_KEY
```

### 로컬 임베딩 서비스(동봉)

기억 텍스트를 외부 API로 보내지 않으려면 동봉된 `embed/`(transformers.js + ONNX CPU, OpenAI 호환)를 사용합니다. 저장소에는 `embed/node_modules/`(약 475MB)가 포함되어 clone 후 추가 설치가 필요 없습니다. npm 패키지(의존성 없음)만 아래가 필요합니다.

```bash
cd embed && npm install --ignore-scripts
./start.sh                        # 수동 시작: 127.0.0.1:11434
curl -s localhost:11434/health    # {"ok":true,...,"ready":true}
```

`embedding.baseUrl`이 루프백이고 `embedding.autoStart`가 참이면 플러그인이 자동으로 시작해 `/health`를 폴링한 뒤 벡터를 채웁니다. 실패해도 성능만 저하되고 대화는 멈추지 않습니다. 모델은 `embed/.cache/Xenova/<model>/`에 있으며 첫 요청 시 다운로드됩니다(오프라인용 Release `dsh-context-hub-models-e5-q8.tar.gz` 제공).

## 배포와 릴리스

- `package.json`의 `files`는 `src` / `client` / `cordis.patch.yml` / `locale` / `icon.svg` / `README.md` / `LICENSE` / `CHANGELOG.md` / `docs` / `scripts` / `test-smoke.mjs` / `embed/`를 포함합니다.
- 표시 메타데이터: `locale/en.json`, `locale/zh.json`의 `meta.title` / `meta.description`, `icon.svg`(610B).
- 패키징은 두 가지: `npm pack`(slim, `embed/node_modules` 미포함)과 `scripts/pack.sh`(`git archive`, vendored 의존성 포함 약 157MB).
- 2026-11-27 기준 **npm 1.8.0 공개**(public, slim 약 280kB).
- 배포물: `dist/dsh-context-hub-*.tgz`(버전·파일 수·바이트·SHA-256은 생성 시 `dist/INSTALL.md` 기준).

## 데이터

- 기본 경로: `$DSH_HOME/context-hub/memory.db` (`DSH_HOME` 미설정 시 `~/.dsh`).
- 재정의: 환경 변수 `DSH_CONTEXT_HUB_DB=/path/to/memory.db`.
- 기억은 **파생 캐시**입니다. 세션 로그가 유일한 진실이며 DB 손상·삭제가 대화를 막지 않습니다.

## 설계 경계(현재 버전)

- 기본적으로 네이티브 압축을 대체하지 않습니다. `compactor: native`에서는 `compaction-basic`이 압축을 담당하고 이 플러그인은 트리거와 검색 보완만 합니다. `compactor: hub`에서는 `summarize()`를 감쌉니다(서비스 재등록 없음, 실패 시 폴백).
- 패널은 거버넌스·스위치·예산 파라미터만 쓰고 기억 내용은 편집하지 않습니다. 컨텍스트는 읽기 전용이며 세션에 되쓰지 않습니다.
- 사용자 정의 세션 이벤트 타입을 추가하지 않고 기존 `user/message`와 `turn/end`만 사용합니다.
- 검색은 키워드 겹침 + FTS5 trigram에 선택적으로 벡터 코사인과 LLM 쿼리 재작성을 더합니다. 어느 하나가 불가해도 자동으로 저하되며 주 경로에 영향이 없습니다.
- 수위 압축은 기본적으로 꺼져 있습니다. `watermark.enabled: true`이면 pre-step에서 `triggerRatio`와 `retainTokens`/`retainTurns`에 따라 가장 오래된 접두부만 접습니다.
- 추출 실패는 `logger.warn`만 기록하고 대화를 막지 않습니다.

## 로드맵

- **1.8.0**: 12개 P1/P2 보강(결정적 쓰기, 충돌 분류, 계층 검토, 쿼리 위생, 압축 영수증, 요약 품질 루프, 정직한 지표, 근접 중복 제거, 기억 뷰, JSONL 입출력, 호환성 문서, 이식성).
- **1.7.x**: 그래프 1홉, 압축 원장, 패널 압축기 전환, 성능 개선.
- **1.6.x**: 주입 상한·기한, git 식별, 메시지 단위 unfold, vendored 배포.
- **1.5.x**: 패널 재구성(KPI 헤더 + 4탭), 메시지 색인, 다국어 embedder, 수위 retainTurns.
- 이후: 영어 의미 검색 강화, 수위 기본 동작 검토, 패널 locale 연동.

미해결: 영어 의미 검색 정확도(LongMemEval R@5 83.3%), 수위 대구간 접기 승인 흐름, docs 중 design/spec/comparison은 중국어만 제공됩니다.
