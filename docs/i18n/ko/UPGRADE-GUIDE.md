[Chinese](../../../UPGRADE-GUIDE.md) · [English](../en/UPGRADE-GUIDE.md) · [日本語](../ja/UPGRADE-GUIDE.md) · **한국어** · [Deutsch](../de/UPGRADE-GUIDE.md) · [Français](../fr/UPGRADE-GUIDE.md) · [Español](../es/UPGRADE-GUIDE.md)

# 업그레이드 가이드 (→ 1.8.0)

> 모든 1.x에서 1.8.0으로 올릴 때 적용됩니다.

## 🚀 빠른 업그레이드

```bash
# 배포 tarball (의존성 포함)
plugin_manager install_bundle(target="/absolute/path/dist/dsh-context-hub-1.8.0.tgz")
dsh restart
```

npm이라면 `npm install dsh-context-hub@1.8.0` 후 DSH를 재시작합니다.

## 📋 업그레이드 전 확인

- 기억 저장소 백업: `cp ~/.dsh/context-hub/memory.db{,.bak}`.
- Node.js ≥ 22.13, DSH 0.2.x 확인.
- 현재 버전 확인: `/context-hub status`.

## ✨ 새 기능 안내

- **명시적 기억 신호**: "기억해", "하지 마", "선호", "할 일" 등은 LLM 없이 즉시 저장됩니다.
- **충돌 감지**: 부정·수치 변경·상태 전이를 감지해 supersede로 연결합니다.
- **기억 뷰**: `/context-hub graph <번호>`, `/context-hub timeline [scope]`, `/context-hub conflicts <번호>`.
- **JSONL 입출력**: `/context-hub export-jsonl`과 `import-jsonl <경로>`(hash 기반 멱등).
- **언어**: `/context-hub locale [auto|zh|en|ja|ko|de|fr|es]`, 패널에서도 전환 가능.

## 🔧 설정 변경

새 옵션: `reviewPolicy`(`off` / `low-confidence` / `layered`), `locale`(`auto` 또는 언어 코드). 기존 항목의 기본값은 그대로이므로 설정 변경이 필수는 아닙니다.

```yaml
- id: dsh-context-hub
  config:
    reviewPolicy: layered
    locale: auto
```

## 🐛 문제 해결

- 업그레이드 후 패널이 없음 → 강력 새로고침. 계속되면 `node --check client/client.js`.
- 언어가 바뀌지 않음 → 서버 측 플러그인 재로드를 위해 DSH 재시작 후 페이지 새로고침.
- 기억 저장소 사용 불가 → `$DSH_HOME/context-hub/memory.db` 권한 확인. 기억 없이도 대화는 계속됩니다.

## 📊 성능 영향

| 작업 | 추가 지연 |
| --- | --- |
| 명시 신호 쓰기 | 약 0ms |
| 충돌 감지 | +50~200ms |
| 계층 검토(LLM) | +200~500ms |
| 그래프 생성 | +500~2000ms |

벡터 검색 부담은 이전과 같습니다(선택, 기본 꺼짐).

## 🆚 버전 비교

| 기능 | 1.7.x | 1.8.0 |
| --- | --- | --- |
| 명시 신호 | ❌ | ✅ |
| 충돌 감지 | ❌ | ✅ |
| 그래프 / 타임라인 / 충돌 | ❌ | ✅ |
| JSONL 입출력 | ❌ | ✅ |
| 정직한 검색 지표 | ❌ | ✅ |
| 패널 다국어 | ❌ | ✅ 7개 언어 |

## 📞 도움말

- `dsh context-hub doctor` 출력
- DSH·Node.js 버전, OS
- 로그: `tail -n 50 ~/.dsh/logs/context-hub.log`
- 이슈: https://github.com/ElementBen555/context-hub/issues

## 🎉 완료

업그레이드 후 확인:

```bash
/context-hub status
/context-hub doctor
/context-hub probe
/context-hub locale
```
