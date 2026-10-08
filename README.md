# ZEP Script Project

ZEP Script 상호작용 오브젝트의 번호·값으로 코인을 지급하고, **좌상단에 개인 보유 코인을 표시**합니다. 코인은 앱 내부 점수이며 ZEP 결제 재화가 아닙니다.

## ZEP 적용 방법

1. GitHub의 `dist/zep-coins-hud.zepapp.zip`을 다운로드합니다. 기존 ZIP과 진단 ZIP은 이전 산출물로 보존했습니다.
2. ZEP **나의 앱**에서 기존 앱을 새 ZIP으로 업데이트합니다. 압축을 풀지 마세요. 맵 접속 시 자동 실행하려면 **Normal app** 유형으로 대상 맵의 설정에 적용합니다. UI 메뉴는 현재 ZEP 버전에 따라 다를 수 있습니다.
3. 맵 편집기에서 오브젝트 유형을 **ZEP Script 상호작용**으로 설정합니다.
4. **번호 `1`, 값 `coin:10`, 실행 범위 `1`, 실행 방법 `F키를 눌러 실행`**으로 설정하고 저장합니다. 위치는 자유롭게 정할 수 있습니다. 좌표나 레이어를 코드에 입력하지 않습니다.
5. 재접속해 좌상단 코인 카드를 확인합니다. 오브젝트 앞에서 F를 누르면 코인이 지급되고 잔액이 갱신됩니다.
6. 다시 F를 눌러 중복 방지를 확인하고, 같은 계정으로 재접속해 잔액과 획득 기록 유지 여부를 확인합니다.

## 코인 UI

갈색 카드와 금색 코인 아이콘, `보유 코인` 제목, `1,234` 형식의 숫자를 표시합니다. 로딩 중에는 `불러오는 중…`, 데이터 오류는 `확인 불가`로 표시합니다.

공식 `player.showWidgetResponsive("coin-hud.html", 8, 68, 80, 2)`를 사용합니다. 인자는 위·오른쪽·아래·왼쪽 여백의 화면 대비 %입니다. 좌상단에 배치되며, 실제 PC·모바일에서 ZEP 기본 UI와의 겹침과 크기를 확인한 후 여백 및 HTML 스타일을 조정할 수 있습니다.

위젯이 준비됐다는 메시지를 받은 뒤 현재 잔액을 전달합니다. 성공적인 지급 직후에도 갱신하므로 퀴즈 보상이 공통 함수를 사용하면 같은 UI에 반영됩니다. 위젯으로 보상 지급을 요청하는 기능은 없습니다. 퇴장하면 위젯을 제거합니다. UI 갱신 오류가 저장된 보상을 취소하지 않습니다. 지급·중복 안내는 개인 채팅이며, `!coins`로 잔액을 다시 확인할 수 있습니다.

## 번호와 값

| 번호 | 값 | 동작 |
| --- | --- | --- |
| `1` | `coin:10` | 10코인 지급 |
| `2` | `coin:20` | 20코인 지급 |
| `3` | `balance` | 잔액 표시 갱신 및 개인 채팅 안내 |

번호는 선행 0 없는 1~999999999 정수, 지급액은 1~999999 정수입니다. 소수·음수·공백·알 수 없는 명령은 지급하지 않습니다. 독립된 보상에는 다른 번호를 사용하세요. 같은 번호는 위치나 지급액을 바꿔도 유저별 한 번만 받을 수 있습니다. 번호를 바꾸면 새 보상이 됩니다. 여러 맵에서도 스페이스 내 번호를 중복하지 않도록 운영하세요.

가이드 207쪽에 따라 `App.onObjectTouched`에서 `obj.type === 21`, 번호 `obj.text`, 값 `obj.param1`을 읽습니다. 이 이벤트는 충돌 또는 상호작용에 반응하므로 F/바로 실행은 맵 편집기 설정을 따릅니다. 스크립트가 별도로 F 키만 허용하지는 않습니다. `tileID`는 보상 번호가 아닙니다.

## 저장과 이전 버전 호환

`player.storage` JSON의 `zepCoinRewards`에 version=1, coins, claimed를 저장하며 다른 필드는 보존합니다. 번호 `1`은 기존 `object:lobby:treasure-01` ID를 사용하여 이미 저장된 획득 기록을 유지합니다. 다른 번호는 `object:script:<번호>` ID를 사용합니다.

지급마다 잔액과 획득 기록을 함께 대입하고 **`player.save()`를 호출**합니다(가이드 373·426쪽). 기존 좌표 버전에는 save 호출이 빠져 있었습니다. 이미 저장되지 않은 과거 데이터까지 자동 복구하지는 못합니다. 저장 범위는 같은 스페이스의 해당 플레이어입니다.

손상 JSON·지원하지 않는 버전·잘못된 잔액은 초기화하지 않고 지급을 차단합니다. 자체 한도는 유저당 획득 기록 1,000개와 JavaScript 안전 정수 범위이며 ZEP 저장 용량 보장치가 아닙니다. save 예외는 메모리 문자열을 이전 값으로 복원하고 실패를 반환합니다. 영구 저장 완료 확인과 다중 서버 원자적 트랜잭션은 API에서 확인되지 않았습니다. 경쟁 쓰기, 게스트 지속성, 다른 계정·스페이스, 앱 삭제·재설치는 별도 검증 대상입니다.

## 개발·테스트·ZIP

Node.js 18 이상과 Python 3.9 이상을 사용하며 외부 패키지·DB·API 키는 필요 없습니다. 기존 체크아웃을 사용하세요. 클라우드 작업은 이미 격리되어 있어 별도 worktree는 필요하지 않습니다.

```sh
node --check main.js
node --test tests/coins.test.js tests/hud.test.js
python3 build.py
```

빌드는 테스트 후 `dist/zep-coins-hud.zepapp.zip`을 생성합니다. ZIP 최상위에는 **main.js와 coin-hud.html**이 포함됩니다. 같은 내용은 재실행해도 변경하지 않고 기존 ZIP이 다르면 덮어쓰지 않습니다. 수정 후에는 새 이름을 지정하세요.

```sh
python3 build.py --output dist/zep-coins-hud-v2.zepapp.zip
```

보상·UI 테스트 22개는 번호별 지급, 중복 방지, 저장 호출·예외, 유저 분리, 기존 데이터 보존, 위젯 준비·갱신·제거, 오류 표시, HTML 메시지 검증·숫자 표시를 검증합니다. 모의 테스트이므로 실제 ZEP의 영구 저장과 브라우저 시각 배치를 검증하지는 않습니다. 배포 후 F 상호작용, 다른 계정의 독립 잔액, 재접속, PC·모바일 배치를 확인하세요. `node main.js`는 실행 방법이 아닙니다. App·player·위젯은 ZEP 런타임이 제공합니다.

## 보상 확장

앱 초기화에서 `CoinRewards.register("quiz:intro:q1", 25)`를 한 번 호출하고, 서버의 정답 판정 통과 후 `CoinRewards.grant(player, "quiz:intro:q1")`를 호출하면 저장과 UI 갱신을 공유합니다. 퀴즈 UI와 정답 판정 자체는 아직 구현하지 않았습니다.

지급 상태는 granted, already_claimed, unknown_reward, storage_error, claim_limit, balance_limit입니다. `CoinRewards.balance(player)`는 ok와 coins 또는 storage_error를 반환합니다. 위젯 입력을 정답·지급액으로 신뢰하지 않습니다.

## 공식 근거와 이전 진단

사용자가 제공한 **ZEP Guidebook (KR).pdf**의 10쪽(Normal app), 206~207쪽(번호·값), 249~257쪽(라이프사이클), 273쪽(충돌·상호작용), 373·426쪽(storage·save), 394~395쪽(개인 채팅), 400~402쪽(반응형 위젯), 430~436쪽(위젯 메시지·제거)을 기준으로 구현했습니다. [공식 가이드](https://docs-kr.zep.us/creator/tutor/tutorial/4) 및 [공식 SDK](https://github.com/zep-us/zep-script-sdk)도 참고하세요.

기존 dist/zep-coins.zepapp.zip은 좌표 보상, zep-interaction-probe.zepapp.zip은 상단 진단, zep-interaction-probe-chat.zepapp.zip은 채팅 진단으로 보존했습니다. 현재 앱은 zep-coins-hud.zepapp.zip입니다. 진단 재빌드는 `python3 build.py --entry tools/interaction-probe.js`이며 변경된 기존 ZIP은 다른 --output을 사용하세요. 진단은 storage를 읽고 쓰거나 보상을 지급하지 않습니다. !diag와 !diag-reset은 진단 앱 전용입니다.
