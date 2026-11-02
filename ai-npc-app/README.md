# ZEP AI NPC 앱 v1.0.0

맵을 산책하다 유저가 접근하면 멈추고, F키로 채팅 팝업을 여는 ZEP Script 앱입니다. 관리자 웹 에디터에서 NPC별 이름·성격·말투·배경을 설정합니다.

**[ZEP 업로드 ZIP 다운로드](https://github.com/junho3789/ZEP/raw/refs/heads/main/ai-npc-app/dist/zep-ai-npc-v1.0.0.zip)** · [전체 소스 다운로드](https://github.com/junho3789/ZEP/archive/refs/heads/main.zip)

ZIP에는 `main.js`, `chat.html`, `npc.png`만 포함됩니다. AI 대화를 사용하려면 아래 별도 서버를 배포하고 연결해야 합니다. ZIP 설치만으로 AI 응답이 생성되지는 않습니다.

## 제공 기능

| 상황 | 동작 |
|---|---|
| 평상시 | 정해진 배회 구역에서 2~5타일 걷기와 0.5~2초 쉬기를 반복 |
| 유저가 2타일 이내 접근 | 이동 중지, 대화 대기 |
| 근처에서 F키 또는 `!npc` 입력 | 가장 가까운 NPC와 개인 채팅 팝업 열기 |
| 모바일 | NPC 방향을 보고 펀치/상호작용 버튼 사용. `!npc` 명령도 지원 |
| 대화 중 유저가 4타일 초과로 이동 | 해당 유저 팝업 닫기, 늦게 도착한 응답 무시 |
| 모든 유저가 4타일 초과로 이동 | 다시 배회 |
| 페르소나 변경 | 다음 AI 요청부터 새 설정 적용, 해당 NPC의 이전 대화 맥락 초기화 |

거리는 대각선도 한 타일로 계산하는 체비쇼프 거리입니다. 유저가 3~4타일에 있으면 정지 상태를 유지합니다. 여러 유저가 동시에 대화할 수 있고, 대화 기록은 유저·NPC별로 분리됩니다.

기본 NPC는 친근한 안내 친구 **모아**(`moa`)와 차분한 책 친구 **서가**(`sage`)입니다. 기본 스프라이트는 이 앱을 위해 코드로 제작한 공통 샘플이며, 두 NPC를 이름으로 구분합니다.

## 1. AI 서버 배포

Node.js 22 이상, OpenAI API 사용 가능한 계정과 키, HTTPS 서버 주소가 필요합니다. AI 사용료는 설정한 API 계정에 발생합니다.

```sh
cd ai-npc-app/server
cp .env.example .env
```

`.env`를 다음과 같이 설정합니다. 예시 문구를 실제 비밀 키로 바꾸세요.

```dotenv
PORT=3000
OPENAI_API_KEY=여기에_API_키
OPENAI_MODEL=gpt-4.1-mini
ZEP_SHARED_SECRET=서버와_ZEP를_연결할_서로다른_24자이상_랜덤키
ADMIN_SECRET=관리자에디터에_사용할_별도의_24자이상_랜덤키
PERSONA_FILE=data/personas.json
```

랜덤 키는 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`로 생성할 수 있습니다. 두 번 실행하여 서로 다른 키를 사용하세요. `.env`는 Git에 포함하지 않습니다.

```sh
npm start
```

서버를 HTTPS 역방향 프록시 또는 Node 호스팅 서비스 뒤에 배포합니다. 공개 주소 예: `https://npc.example.com`. `/health`가 `{"ok":true}`인지 확인하세요. `/health`는 프로세스 실행 여부만 나타내며 AI 키나 외부 API 연결을 검증하지 않습니다.

Docker를 사용하는 경우 `server` 폴더를 빌드 컨텍스트로 사용하고 환경 변수를 전달하세요. `/app/data`에 영속 볼륨을 연결해야 관리자 설정이 유지됩니다. 컨테이너는 일반 `node` 사용자로 실행하므로 볼륨 쓰기 권한을 부여해야 합니다. 현재 파일 저장 방식은 단일 서버 프로세스용입니다.

## 2. ZEP 앱 설치

1. 위의 ZEP 업로드 ZIP을 다운로드합니다.
2. ZEP Script 개발자 화면에서 새 **일반 앱(Normal App)**을 만들고 ZIP을 업로드합니다.
3. 테스트용 맵에 앱을 설치합니다. 이 앱은 기존 투표·스탬프 앱과 별개의 앱입니다.
4. 기본 시작 타일 `(8,8)`, `(12,8)`과 배회 영역 `x=3~16`, `y=3~16`을 확인합니다. 이 영역이 맵 안에 있어야 하고 시작 타일은 비어 있어야 합니다.
5. 맵 소유자 또는 관리자 권한으로 채팅에 `!npc-setup`을 입력합니다.
6. HTTPS 서버 주소를 입력하고, 다음 비밀번호 입력창에 서버의 `ZEP_SHARED_SECRET`을 입력합니다. **OpenAI API 키나 ADMIN_SECRET을 입력하지 않습니다.**
7. NPC 2타일 이내로 접근한 뒤 F키 또는 `!npc`로 대화를 시작합니다.

연결 정보는 이 앱의 ZEP 서버 측 App storage에 저장하며 공개 ZIP과 HTML 위젯에는 넣지 않습니다. 앱 소스와 설치 권한을 가진 운영자는 신뢰해야 합니다. AI API 키는 별도 서버에만 둡니다. 일반 유저가 연결 설정을 변경하지 못하도록 서버에서 읽기 전용 `player.role`을 검사합니다(관리자 3000, 소유자 3001).

## 3. 관리자 페르소나 에디터

ZEP 관리자로 `!npc-admin`을 입력하거나 브라우저에서 `https://npc.example.com/admin`을 엽니다.

1. `ADMIN_SECRET`으로 목록을 불러옵니다.
2. `moa` 또는 `sage`를 선택합니다.
3. 이름, 성격, 말투, 배경·알고 있는 정보·대화 규칙을 수정하고 저장합니다.
4. 변경된 페르소나는 다음 AI 요청부터 적용됩니다. 표시 이름은 ZEP에서 최대 약 60초 후 갱신됩니다. 열린 팝업 제목은 다시 열 때 갱신됩니다.

예를 들어 `성격: 활발하고 유쾌한 탐험가`, `말투: 친근한 반말, 짧은 문장, 가끔 이모지`로 설정할 수 있습니다. 캐릭터가 알아야 할 맵 안내 정보는 배경에 직접 입력하세요. AI가 맵 구조를 자동으로 읽지는 않습니다.

에디터 인증 키는 브라우저 저장소에 저장하지 않고 로그아웃 때 입력을 지웁니다. 현재는 공유 관리자 키 방식이며 별도 계정·역할별 권한은 없습니다. 다른 관리자가 먼저 저장하면 충돌을 표시하므로 목록을 다시 불러오고 수정하세요. 진행 중인 응답 하나는 이전 설정으로 완료될 수 있습니다.

## NPC 추가·배회 영역 수정

`zep/config.js`의 `characters` 배열에 캐릭터를 추가하거나 좌표를 수정합니다. NPC ID는 영문 소문자·숫자·밑줄·하이픈으로 구성합니다. 같은 ID를 중복하지 마세요. 관리자 에디터에도 **같은 ID**로 페르소나를 저장합니다. 에디터에서 설정만 추가해도 맵 오브젝트가 자동 생성되지는 않습니다.

```js
{ id: "guide", name: "길잡이", x: 10, y: 10,
  minX: 5, maxX: 15, minY: 5, maxY: 15 }
```

벽·통행 불가 타일과 모든 일반/상단 오브젝트가 있는 타일은 보수적으로 피합니다. 장식이 많은 맵은 배회 영역을 빈 통로로 설정하세요. 각 이동 요청도 `usePath=true`를 사용합니다.

변경 후 저장소 루트에서 재빌드하고 ZIP을 다시 업로드합니다. 별도 패키지 설치는 필요하지 않습니다.

```sh
python3 ai-npc-app/build.py
```

걷기 이미지 교체 시 `zep/npc.png`를 32×48 프레임, 가로 3칸·세로 4칸(총 96×192), 행 순서 아래·왼쪽·오른쪽·위로 구성합니다. 방향별 3프레임의 가운데 프레임이 정지 이미지입니다.

## 검증과 현재 범위

```sh
node --test ai-npc-app/tests/zep.test.cjs ai-npc-app/server/server.test.mjs
python3 ai-npc-app/build.py
```

ZEP SDK 기반 모의 실행과 서버 핸들러 테스트 6개 통과: 근접 정지/재개, 장애물 회피, F키 팝업, 발신자 검증, 퇴장/거리 이탈 및 늦은 응답 폐기, 관리자 인증, 페르소나 저장/충돌/재시작 복원, 유저/NPC별 문맥 분리, 설정 변경 시 문맥 초기화, AI 오류 처리. 서버의 외부 AI 호출은 테스트용 응답으로 대체했습니다.

실제 ZEP 맵 설치, 모바일 UI, 이동 중 정지의 시각적 자연스러움, 운영 서버 배포와 실제 AI 응답 품질은 아직 검증하지 않았습니다. 공식 SDK의 `putObjectWithKey`, `moveObjectWithKey`, `getObjectWithKey`, `addOnKeyDown`, `showWidgetResponsive`, `httpPostJson`을 기준으로 구현했습니다. 런타임 버전에 따라 실제 맵에서 확인이 필요합니다.

AI 응답은 전체 답변을 받아 표시하며 생각 중 표시를 제공합니다. 실시간 토큰 스트리밍은 포함하지 않습니다. 최근 10회 대화를 서버 메모리에 보관하며 30분간 사용하지 않거나 서버가 재시작하면 초기화됩니다. 팝업을 다시 열면 화면 대화 목록은 비지만 서버 맥락은 유지될 수 있습니다. 현재 메모리 제한은 최대 1,000개 대화 세션이며, 고트래픽 운영의 공유 속도 제한·영구 대화 저장은 별도 구성이 필요합니다. 말투는 모델 지시로 적용하며 응답마다 완벽한 일관성을 보장하지는 않습니다.

## 공식 API 참고

- [ZEP 공식 Script SDK](https://github.com/zep-us/zep-script-sdk)
- [App 이벤트·HTTP](https://github.com/zep-us/zep-script-sdk/blob/main/packages/zep-script/src/ScriptApp.d.ts)
- [맵 오브젝트·이동](https://github.com/zep-us/zep-script-sdk/blob/main/packages/zep-script/src/ScriptMap.d.ts)
- [위젯 메시지](https://github.com/zep-us/zep-script-sdk/blob/main/packages/zep-script/src/ScriptWidget.d.ts)
