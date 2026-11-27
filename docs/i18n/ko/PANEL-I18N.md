[Chinese](../../../PANEL-I18N.md) · [English](../en/PANEL-I18N.md) · [日本語](../ja/PANEL-I18N.md) · **한국어** · [Deutsch](../de/PANEL-I18N.md) · [Français](../fr/PANEL-I18N.md) · [Español](../es/PANEL-I18N.md)

# 패널 언어 전환

패널은 실행 중에 언어를 바꿀 수 있습니다. 선택은 브라우저별로 기억되고 기억 저장소와도 동기화됩니다.

## 개요

- 7개 언어: zh / en / ja / ko / de / fr / es.
- `auto`는 브라우저 언어(`navigator.language`)를 따릅니다.
- 패널 본문·표·버튼·툴팁이 모두 바뀌며 새로고침이 필요 없습니다.

## 사용 단계

1. 패널 열기(사이드바 하단 배지 또는 Esc).
2. **언어** 탭 클릭.
3. 언어를 선택하면 즉시 다시 그려집니다.
4. 선택은 `localStorage`에 저장되고 서버가 지원하면 기억 저장소에도 기록됩니다.

## 특징

- 즉시 반영: 상태 기반이라 새로고침이나 DSH 재시작이 필요 없습니다.
- 영속화: `localStorage`의 `context-hub.locale`과 SQLite의 `config:locale`.
- 단계적 폴백: 없는 키는 영어 → 중국어 순으로 대체됩니다.
- 하위 컴포넌트(표·범례·버튼)도 같은 언어를 사용합니다.

## 명령줄

```bash
/context-hub locale            # 현재 언어와 목록
/context-hub locale ko         # 한국어로 전환
/context-hub locale auto       # 시스템 언어 따르기
```

## 지원 언어

| 코드 | 언어 | 항목 수 |
| --- | --- | --- |
| zh | 简体中文 | 257/257 |
| en | English | 257/257 |
| ja | 日本語 | 257/257 |
| ko | 한국어 | 257/257 |
| de | Deutsch | 257/257 |
| fr | Français | 257/257 |
| es | Español | 257/257 |

## 저장 위치

- 브라우저: `localStorage["context-hub.locale"]`.
- 서버: 기억 저장소 `kv` 테이블의 `config:locale`.
- 테스트: `npm run test:panel-i18n`이 7개 언어 × 5개 탭을 실제 렌더링해 검증합니다.

## 문제 해결

- 바뀌지 않음: 캐시된 JS를 버리려면 강력 새로고침(`Ctrl+Shift+R`).
- 패널 자체가 없음: 클라이언트 구문 오류로 번들이 등록되지 않았습니다. `node --check client/client.js`를 실행하세요.
- 재시작 후 초기화: 실행 중인 플러그인이 지원하지 않으면 `config:locale`이 기록되지 않습니다. 업그레이드 후 DSH를 재시작하세요.

## 관련 문서

- [README](README.md)
- [COMPATIBILITY](COMPATIBILITY.md)
- 어휘 데이터: `scripts/locale-data/*.json`
