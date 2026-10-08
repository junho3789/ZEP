# ZEP Script Project

ZEP 맵의 지정 오브젝트와 **F 키로 상호작용**하면 코인을 지급하는 스크립트입니다.
기본 설정은 일반 오브젝트 레이어 `3`, 타일 좌표 `(10, 10)`, 보상 `10`코인입니다.
접속할 때 잔액을 표시하며, 유저별 잔액과 이미 받은 보상 ID를 함께 저장합니다.
오브젝트 보상은 **유저마다 한 번** 받을 수 있습니다. 다른 유저는 별도로 받습니다.
이 코인은 앱 내부 점수이며 ZEP 결제 재화가 아닙니다.

## 파일 구성

| 파일 | 용도 |
| --- | --- |
| `main.js` | ZEP에서 실행되는 코드 및 보상 설정 |
| `build.py` | 구문 검사·테스트 후 업로드 ZIP 생성 |
| `tests/coins.test.js` | ZEP API 모의 객체를 이용한 로컬 테스트 |
| `dist/zep-coins.zepapp.zip` | 기본 설정으로 만든 업로드용 ZIP |

외부 패키지, 데이터베이스, API 키는 필요하지 않습니다. 로컬 개발에는 Node.js 18 이상과 Python 3.9 이상을 사용하세요. 이 환경에서는 Node.js 24.19.0과 Python 3.12.14로 검증했습니다.

## 1. 설치와 로컬 테스트

1. Git과 Node.js, Python을 설치합니다. Windows에서는 명령어 `python3` 대신 `py -3`을 사용할 수 있습니다.
2. 터미널에서 저장소를 내려받고 폴더로 이동합니다.

   ```sh
   git clone https://github.com/junho3789/ZEP.git
   cd ZEP
   ```

   이미 저장소가 있으면 기존 폴더를 사용하세요. 기존 작업을 지우거나 강제 초기화하지 마세요.

3. 테스트를 실행합니다.

   ```sh
   node --check main.js
   node --test tests/coins.test.js
   ```

4. ZIP을 생성합니다. 이 명령은 테스트도 실행합니다.

   ```sh
   python3 build.py
   ```

   `dist/zep-coins.zepapp.zip`이 생성됩니다. ZIP 최상위에 `main.js`가 있으며 테스트나 개발 파일은 포함되지 않습니다. 같은 내용이면 재실행해도 파일을 변경하지 않습니다. 기존 ZIP과 내용이 다르면 덮어쓰지 않고 중단합니다. 코드를 수정한 뒤에는 새 이름을 지정하세요.

   ```sh
   python3 build.py --output dist/zep-coins-v2.zepapp.zip
   ```

`node main.js`로 실행하는 앱은 아닙니다. `App`과 `player`는 ZEP 서버가 제공하며, 로컬 테스트는 이를 모의 구현합니다.

## 2. 보상 오브젝트 설정

1. 적용할 ZEP 스페이스의 맵 편집기를 엽니다. 맵과 앱을 수정할 수 있는 권한이 필요합니다.
2. 보상용 오브젝트를 배치하고 F 상호작용이 가능한 설정을 사용합니다. 단순 장식물이나 통과 타일 접촉은 대상이 아닙니다.
3. 오브젝트의 **타일 좌표**와 레이어를 확인합니다. 픽셀 좌표가 아닙니다.
4. `main.js` 상단의 `OBJECT_REWARDS`를 실제 위치에 맞게 수정합니다.

   ```js
   var OBJECT_REWARDS = [
       { id: "object:lobby:treasure-01", layer: 3, x: 10, y: 10, coins: 10 },
       { id: "object:lobby:treasure-02", layer: 5, x: 15, y: 8, coins: 20 }
   ];
   ```

   일반 오브젝트는 레이어 `3`, 상단 오브젝트는 `5`입니다. `coins`는 양의 정수입니다. `id`는 오브젝트별로 고유하게 지정합니다. 좌표를 옮겨도 같은 보상이라면 ID를 유지하세요. **ID를 바꾸면 기존 유저도 새로운 보상으로 다시 받을 수 있습니다.** 같은 레이어·좌표를 두 번 등록하면 앱 시작 시 오류로 차단합니다.

5. 수정했다면 위의 빌드 명령으로 새 ZIP을 생성합니다. 기존 ZIP은 수정한 소스를 자동으로 반영하지 않습니다.

맵 이름은 보상 ID를 구분하기 위한 운영자 지정 문자열입니다. 코드가 현재 맵 ID를 자동으로 확인하지는 않습니다. 우선 한 맵에 한 활성 앱 인스턴스로 적용하세요. 여러 맵에 같은 앱을 설치하면 각 맵의 같은 좌표도 보상 대상으로 인식할 수 있습니다.

## 3. ZEP에 적용하기

1. ZEP의 앱 제작/관리 화면에서 스크립트 앱을 만들고, 업로드 항목에 생성한 `.zepapp.zip`을 선택합니다. 압축을 해제하거나 프로젝트 폴더 전체를 다시 압축하지 마세요.
2. 앱을 저장하고 대상 스페이스/맵에 설치하거나 적용합니다. UI의 메뉴 이름과 공개·승인 요구사항은 계정 및 현재 ZEP 정책에 따라 다를 수 있으므로 [공식 문서](https://docs-script.zep.us/)의 최신 앱 업로드 안내를 따르세요.
3. 적용한 맵을 다시 열거나 재접속합니다. 새 유저는 `보유 코인: 0` 메시지를 확인할 수 있습니다.
4. 설정한 오브젝트 가까이에서 F 키를 누릅니다. `+10 코인! 보유 코인: 10`처럼 지급 메시지가 표시됩니다.
5. 다시 F 키를 눌러 `이미 보상을 받은 오브젝트입니다`가 표시되는지 확인합니다.
6. 동일 계정으로 같은 스페이스를 나갔다가 재접속하여 잔액과 중복 방지가 유지되는지 확인합니다.
7. 다른 계정으로 접속해 각각 별도로 보상을 받을 수 있는지도 확인합니다.

실제 ZEP 서버에는 이 개발 환경에서 업로드하거나 접속하지 않았습니다. 위 단계는 배포 후 반드시 수행할 **실기 검증**입니다. 앱 업데이트/서버 재시작 후에도 같은 검증을 반복하세요. 메시지가 없으면 앱 적용 상태, 맵 좌표, 레이어, F 상호작용 설정부터 확인하세요.

## 저장 구조와 안전장치

공식 SDK가 정의하는 `player.storage` 문자열에 다음과 같은 JSON을 저장합니다.

```json
{
  "zepCoinRewards": {
    "version": 1,
    "coins": 10,
    "claimed": { "reward:object:lobby:treasure-01": true }
  }
}
```

- 저장 범위는 SDK 설명상 **스페이스 내 플레이어 저장소**입니다. 재접속 시 ZEP가 제공하는 저장 문자열로 잔액과 획득 기록을 복원합니다. 닉네임을 저장 키로 사용하지 않습니다. 계정 변경, 다른 스페이스, 앱 삭제·재설치, 게스트 식별자의 지속성은 여기서 보장하지 않습니다.
- 지급마다 현재 문자열을 읽고 코인과 획득 기록을 한 문자열로 함께 대입합니다. 퇴장 이벤트만 기다리지 않습니다. 기존 JSON의 다른 필드는 유지합니다. `zepCoinRewards`는 이 프로젝트 전용으로 예약하세요.
- 잘못된 JSON, 지원하지 않는 버전, 음수·소수 잔액, 저장 예외는 지급을 차단하며 데이터를 초기화하지 않습니다. 관리자 점검 없이 저장소를 지우지 마세요.
- 정수 정밀도 한계를 넘는 지급과 유저별 획득 기록 1,000개 초과를 차단합니다. 1,000개는 프로젝트 자체 제한이며 ZEP의 저장 용량 보장치가 아닙니다. 저장 용량과 쓰기 제한은 최신 ZEP 문서를 확인해야 합니다.
- SDK에 저장 성공 콜백, 원자적 비교·갱신, 서버 간 잠금은 명시되어 있지 않습니다. API 대입이 반환됐다는 사실만으로 영구 저장 완료를 확인할 수는 없습니다. 동시 서버/맵 인스턴스의 경쟁 쓰기나 다른 앱의 동일 저장소 쓰기까지 완전히 방지하는 구현은 아닙니다. 그런 운영에는 검증된 외부 저장소와 트랜잭션 설계를 별도로 추가해야 합니다.

## 퀴즈 등 보상 확장

모든 지급은 `CoinRewards.grant(player, rewardId)`로 통합합니다. 새 기능에서 사용할 보상을 앱 초기화 코드에 등록하고, **서버에서 정답을 확인한 이후** 지급 함수를 호출하세요.

```js
// main.js의 CoinRewards 정의 뒤에서 한 번 등록
CoinRewards.register("quiz:intro:q1", 25);

// 향후 구현할 정답 검증 핸들러 안에서만 호출
// var result = CoinRewards.grant(player, "quiz:intro:q1");
// player.showCenterLabel("보유 코인: " + result.coins);
```

`grant`의 `status`는 `granted`, `already_claimed`, `unknown_reward`, `storage_error`, `claim_limit`, `balance_limit` 중 하나입니다. 성공 여부를 확인한 뒤 메시지를 표시하세요. `CoinRewards.balance(player)`는 `ok`와 `coins`, 또는 `storage_error`를 반환합니다. 지급액은 등록된 서버 설정에서만 읽으며 사용자 입력을 지급액으로 받지 않습니다. 퀴즈 UI와 정답 검증 자체는 아직 구현하지 않았습니다. 반복 보상은 회차별 고유 ID와 별도 서버 조건을 설계해야 합니다.

## API 근거와 검증 범위

구현은 ZEP 공식 조직의 [zep-script-sdk](https://github.com/zep-us/zep-script-sdk) 커밋 `2ecfa48c4cfae1c085830b54627e09ed358e0675`의 정의를 확인했습니다.

| 사용하는 API | 공식 소스와 확인 내용 |
| --- | --- |
| `App.onJoinPlayer.Add(callback)` | [ScriptApp.d.ts](https://github.com/zep-us/zep-script-sdk/blob/2ecfa48c4cfae1c085830b54627e09ed358e0675/packages/zep-script/src/ScriptApp.d.ts): 접속 이벤트 |
| `App.onTriggerObject.Add(callback)` | 같은 파일: 맵 편집기 오브젝트의 F 상호작용, 인자 `(player, layerId, x, y, key)` |
| `player.storage` | [ScriptPlayer.d.ts](https://github.com/zep-us/zep-script-sdk/blob/2ecfa48c4cfae1c085830b54627e09ed358e0675/packages/zep-script/src/ScriptPlayer.d.ts): 스페이스 한정 플레이어 문자열 저장소 |
| `player.showCenterLabel(text)` | 같은 파일: 플레이어 화면 메시지 |

SDK의 [공식 변환 플러그인](https://github.com/zep-us/zep-script-sdk/blob/2ecfa48c4cfae1c085830b54627e09ed358e0675/packages/babel-plugin-zep-script/index.js)은 타입 정의의 `ScriptApp`을 런타임 `App`으로 변환합니다. 이 프로젝트는 런타임 이름을 직접 사용합니다. `loadData`/`saveData`처럼 해당 SDK에서 확인되지 않는 API는 호출하지 않습니다. ZIP의 최상위 `main.js` 구조는 공식 CLI의 `archive.ts`를 기준으로 했습니다.

공식 문서 웹사이트는 이 환경의 네트워크 정책으로 접근이 차단되어 SDK 원문을 근거로 삼았습니다. 로컬 테스트 15개는 접속 표시, 지급, 좌표·레이어 필터, 연속 중복, 유저 분리, 저장 문자열을 전달한 새 런타임 복원, 퀴즈 확장, 기존 필드 보존, 데이터 오류, 한도와 저장 예외 등을 검증합니다. **모의 재접속 테스트는 ZEP 서버의 영구 저장 자체를 검증하지 않습니다.**

## GitHub 반영

코드, 테스트, README와 ZIP을 함께 커밋하면 됩니다. 이 작업은 로컬 커밋을 준비하며 자동으로 GitHub에 푸시하지 않습니다.

```sh
git status
git log -1 --oneline
git push origin main
```

푸시 거절 시 원격 변경을 먼저 확인하고 통합하세요. `--force`나 작업 파일을 삭제하는 초기화 명령은 사용하지 마세요.
